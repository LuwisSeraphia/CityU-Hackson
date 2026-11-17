"""Scoped hybrid retrieval. PostgreSQL computes vector distance; tests use cosine."""

import math
import re
from collections import defaultdict
from contextvars import ContextVar
import hashlib
import json
import time

from app.infrastructure.db import Memory, Suppression, Source
from app.errors import AppError
from app.domain.retrieval.policy import communication_preference, operation_only

retrieval_context = ContextVar("retrieval_context", default=None)


def terms(value):
    words = set(re.findall(r"[a-z0-9]+", value.casefold()))
    chinese = re.findall(r"[\u4e00-\u9fff]+", value)
    return words | {part[i : i + 2] for part in chinese for i in range(max(1, len(part) - 1))}


def similarity(a, b):
    if len(a) != len(b):
        return -1
    denominator = math.sqrt(sum(x * x for x in a) * sum(x * x for x in b))
    return sum(x * y for x, y in zip(a, b)) / denominator if denominator else 0


def result(row, db=None):
    metadata = {}
    if db is not None:
        from app.domain.memory.models import MemoryMeta
        with db.session() as session:
            meta = session.query(MemoryMeta).filter_by(owner=row.owner, memory_id=row.id).first()
            metadata = meta.data if meta else {}
    return {
        "id": row.id,
        "kind": row.kind,
        "content": row.content,
        "status": row.status,
        "version": row.version,
        "source_ids": row.source_ids,
        "fact_id": row.fact_id,
        "event_time": row.event_time,
        "memory_created_at": row.created,
        **{key: metadata[key] for key in ("recorded_at", "event_timezone", "event_time_source", "event_time_precision", "revision_reason") if key in metadata},
    }


class Retriever:
    def __init__(self, db, provider, settings):
        self.db, self.provider, self.settings = db, provider, settings

    async def search(self, owner, project, query, *, history=False):
        if self.settings.memory_retrieval_policy == "v2":
            return await self.search_v2(owner, project, query, history=history)
        warnings = []
        with self.db.session() as session:
            base = session.query(Memory).filter(
                Memory.owner == owner,
                Memory.project == project,
                Memory.status.in_(
                    ["current", "planned", "historical"] if history else ["current", "planned"]
                ),
            )
            from app.domain.memory.access import filter_query

            base = filter_query(session, base, owner, self.settings)
            rows = base.order_by(Memory.created.desc()).limit(2000).all()
            tokens = terms(query)
            lexical = sorted(
                ((len(tokens & terms(r.content)), r) for r in rows),
                key=lambda p: p[0],
                reverse=True,
            )
            lexical = [r for score, r in lexical[:30] if score > 0]
            vector = []
            if base.filter(
                Memory.index_status == "READY",
                Memory.embedding_model == self.settings.embedding_model,
            ).first():
                try:
                    embedding = (await self.provider.embed([query]))[0]
                    if self.db.engine.dialect.name == "postgresql":
                        vector = (
                            base.filter(
                                Memory.embedding.is_not(None),
                                Memory.embedding_model == self.settings.embedding_model,
                            )
                            .order_by(Memory.embedding.cosine_distance(embedding))
                            .limit(30)
                            .all()
                        )
                    else:
                        vector = sorted(
                            [r for r in rows if r.embedding is not None],
                            key=lambda r: similarity(embedding, r.embedding),
                            reverse=True,
                        )[:30]
                except AppError:
                    warnings.append("向量检索暂不可用，本次仅使用关键词检索。")
        scores, lookup = defaultdict(float), {}
        for ranking in (lexical, vector):
            for rank, row in enumerate(ranking):
                scores[row.id] += 1 / (60 + rank + 1)
                lookup[row.id] = row
        ordered = [lookup[i] for i in sorted(scores, key=scores.get, reverse=True)[:12]]
        # Rerank only broad/ambiguous candidate sets, reducing cost on simple retrieval.
        if len(ordered) > 4:
            try:
                indices = await self.provider.rerank(query, [r.content for r in ordered])
                ordered = [ordered[i] for i in dict.fromkeys(indices)]
            except AppError:
                warnings.append("重排暂不可用，已保留混合检索排序。")
        # Avoid filling the context with many chunks of the same event/source.
        selected, groups = [], defaultdict(int)
        for row in ordered:
            group = row.source_ids[0] if row.source_ids else row.id
            if groups[group] < 2:
                selected.append(result(row, self.db))
                groups[group] += 1
            if len(selected) == 6:
                break
        return {"items": selected, "warnings": warnings}

    def core(self, owner, project):
        with self.db.session() as session:
            rows = (
                session.query(Memory)
                .filter_by(owner=owner, project=project, kind="fact", status="current")
                .order_by(Memory.created.desc())
                .limit(2000 if self.settings.memory_retrieval_policy == "v2" else 12)
                .all()
            )
            if self.settings.memory_retrieval_policy == "v2":
                return [result(r) for r in rows if communication_preference(r.content)][:3]
            return [result(r) for r in rows]

    async def search_v2(self, owner, project, query, *, history=False):
        started = time.monotonic()
        context = retrieval_context.get()
        with self.db.session() as session:
            from app.domain.memory.access import filter_query, request_context
            from app.domain.memory.models import MemoryEpoch

            base = session.query(Memory).filter(
                Memory.owner == owner,
                Memory.project == project,
                Memory.status.in_(
                    ["current", "planned", "historical"] if history else ["current", "planned"]
                ),
            )
            rows = (
                filter_query(session, base, owner, self.settings)
                .order_by(Memory.created.desc())
                .all()
            )
            permitted_ids = {row.id for row in rows}
            policy_context = request_context.get()
            policy_text = policy_context.get("text", "") if policy_context else ""
            epoch = session.get(MemoryEpoch, owner)
            policy_epoch = epoch.epoch if epoch else 0
            revision_rows = (
                session.query(Memory.id, Memory.version, Memory.status, Memory.index_status)
                .filter(Memory.owner == owner, Memory.project == project)
                .all()
            )
            deletions = [
                (r.id, r.created) for r in session.query(Suppression).filter_by(owner=owner)
            ]
        revision = hashlib.sha256(
            json.dumps([tuple(r) for r in revision_rows] + deletions).encode()
        ).hexdigest()
        key = (
            owner,
            project,
            query,
            policy_text,
            policy_epoch,
            history,
            revision,
            self.settings.embedding_model,
        )
        if context is not None and key in context["cache"]:
            cached = context["cache"][key]
            return {**cached, "diagnostics": {**cached["diagnostics"], "cache_hit": True}}
        tokens = terms(query)
        lexical = {r.id: len(tokens & terms(r.content)) / max(1, len(tokens)) for r in rows}
        vectors, warnings = {}, []
        indexed = [
            r
            for r in rows
            if r.index_status == "READY"
            and r.embedding is not None
            and r.embedding_model == self.settings.embedding_model
        ]
        if indexed or (
            self.db.engine.dialect.name == "postgresql"
            and any(r.index_status == "READY" for r in revision_rows)
        ):
            try:
                embedding = (await self.provider.embed([query]))[0]
                if self.db.engine.dialect.name == "postgresql":
                    with self.db.session() as session:
                        vector_rows = (
                            session.query(Memory)
                            .filter(
                                Memory.owner == owner,
                                Memory.id.in_(permitted_ids),
                                Memory.project == project,
                                Memory.status.in_(
                                    ["current", "planned", "historical"]
                                    if history
                                    else ["current", "planned"]
                                ),
                                Memory.index_status == "READY",
                                Memory.embedding.is_not(None),
                                Memory.embedding_model == self.settings.embedding_model,
                            )
                            .order_by(Memory.embedding.cosine_distance(embedding))
                            .limit(30)
                            .all()
                        )
                    vectors = {r.id: similarity(embedding, r.embedding) for r in vector_rows}
                    existing = {r.id for r in rows}
                    rows.extend(r for r in vector_rows if r.id not in existing)
                else:
                    vectors = {r.id: similarity(embedding, r.embedding) for r in indexed}
            except AppError:
                warnings.append("向量不可用，使用关键词候选。")
        ranks = defaultdict(float)
        for scores in (lexical, vectors):
            for rank, (identifier, score) in enumerate(
                sorted(scores.items(), key=lambda p: p[1], reverse=True)[:30], 1
            ):
                if score > 0:
                    ranks[identifier] += 1 / (60 + rank)
        lookup = {r.id: r for r in rows}
        candidates, details = [], []
        for identifier in sorted(ranks, key=ranks.get, reverse=True)[:60]:
            row = lookup[identifier]
            reason = "operation_only" if operation_only(row.content) else None
            if (
                reason is None
                and vectors.get(identifier, -1) < self.settings.memory_vector_min
                and lexical.get(identifier, 0) < self.settings.memory_lexical_min
            ):
                reason = "below_vector_threshold"
            detail = {
                "id": identifier,
                "version": row.version,
                "vector_similarity": vectors.get(identifier),
                "lexical_coverage": lexical.get(identifier, 0),
                "rrf_score": ranks[identifier],
                "rerank_score": None,
                "reason": reason,
            }
            details.append(detail)
            if reason is None and len(candidates) < 12:
                candidates.append(row)
        by_id = {r["id"]: r for r in details}

        def strong(r):
            return (
                vectors.get(r.id, -1) >= self.settings.memory_vector_strong
                and lexical.get(r.id, 0) >= self.settings.memory_lexical_min
            )

        reranked = bool(
            candidates and (len(candidates) > 4 or not all(strong(r) for r in candidates))
        )
        if reranked:
            try:
                scores = await self.provider.rerank(
                    query, [r.content for r in candidates], scored=True
                )
                selected = []
                for score in scores:
                    row = candidates[score["index"]]
                    by_id[row.id]["rerank_score"] = score["score"]
                    if score["score"] >= self.settings.memory_rerank_min:
                        selected.append(row)
                    else:
                        by_id[row.id]["reason"] = "below_rerank_threshold"
                candidates = selected
            except (AppError, TypeError):
                warnings.append("重排不可用，仅保留高相关候选。")
                candidates = [
                    r
                    for r in candidates
                    if strong(r) or (not vectors and query.strip() in r.content)
                ]
        chosen, seen = [], set()
        for row in candidates:
            identity = (row.fact_id or row.content, row.status)
            if identity in seen:
                by_id[row.id]["reason"] = "duplicate"
                continue
            seen.add(identity)
            if len(chosen) < self.settings.memory_result_limit:
                chosen.append(result(row, self.db))
                by_id[row.id]["reason"] = "selected_relevance"
        response = {
            "items": chosen,
            "warnings": warnings,
            "diagnostics": {
                "candidate_count": len(details),
                "selected_count": len(chosen),
                "candidates": details,
                "cache_hit": False,
                "rerank_used": reranked,
                "scan_limit": None,
                "actual_strategy": "hybrid_calibrated",
                "outcome": "matched" if chosen else "no_relevant_memory",
                "elapsed_ms": round((time.monotonic() - started) * 1000),
            },
        }
        if context is not None:
            if len(context["cache"]) >= 12:
                context["cache"].clear()
            context["cache"][key] = response
        return response

    def suppressed_messages(self, session, owner):
        ids = {
            identifier
            for item in session.query(Suppression).filter_by(owner=owner)
            for identifier in item.source_ids
        }
        return {
            r.message_id
            for r in session.query(Source).filter(Source.owner == owner, Source.id.in_(ids))
            if r.message_id
        }
