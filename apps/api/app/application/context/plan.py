"""Bounded context selection and fail-closed personal memory use."""

from app.application.intent.rules import profile_review_scope, response_strategy

import json
import re
from datetime import datetime, timezone

from app.infrastructure.db import Memory, now
from app.errors import AppError
from app.application.contracts.context import ResponseOptions
from app.domain.retrieval.service import terms
from app.domain.memory.models import Profile, ResponseSettings, WorkingState

from app.domain.memory.access import (
    SENSITIVE as SENSITIVE,
    allowed as allowed,
    filter_query as filter_query,
    request_context as request_context,
)


def token_estimate(value):
    # UTF-8 bytes are deliberately conservative; never advertise exact model tokens.
    raw = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    return len(raw.encode("utf-8")) + 8




def effective_options(session, owner, overrides, text, settings, intent=None):
    row = session.query(ResponseSettings).filter_by(owner=owner).first()
    options = ResponseOptions.model_validate(row.options if row else {}).model_dump()
    options.update(overrides or {})
    requested = options["mode"]
    if requested == "auto" and intent is not None:
        options["mode"] = (
            "deep"
            if intent.plan.task in ("review", "recall", "advise")
            else "personalized"
            if intent.plan.needs
            else "fast"
        )
    elif requested == "auto":
        options["mode"] = (
            "deep"
            if profile_review_scope(text) or re.search("复盘|深入|对比.*历史|长期规划", text)
            else "personalized"
            if re.search("我的|适合我|根据我|上次|之前|继续", text)
            else "fast"
        )
    mode = options["mode"]
    caps = {
        "fast": settings.memory_budget_fast,
        "personalized": settings.memory_budget_personalized,
        "deep": settings.memory_budget_deep,
    }
    cap = options["memory_budget_tokens"]
    options["memory_budget_tokens"] = min(
        caps[mode] if cap is None else cap, settings.memory_budget_max
    )
    options["retrieval_rounds"] = min(
        options["retrieval_rounds"] or {"fast": 1, "personalized": 2, "deep": 3}[mode],
        settings.retrieval_rounds_max,
    )
    return {**options, "requested_mode": requested}


class ContextPlan:
    def __init__(self, db, settings, owner, project, text, options, intent=None):
        self.db, self.settings, self.owner, self.project = db, settings, owner, project
        self.text, self.options = text, options
        self.personal_allowed = True
        self.intent = intent
        self.review_scope = (
            ("all" if any(n.source == "profile" for n in intent.plan.needs) else None)
            if intent
            else profile_review_scope(text)
        )
        self.used = 0
        self.selected = set()
        self.report = {
            "estimated": True,
            "count_method": "utf8_bytes_upper_estimate",
            "options": options,
            "selected_ids": [],
            "excluded": [],
            "strategy": intent.plan.response_style if intent else response_strategy(text),
            "profile_review_scope": self.review_scope,
        }

    def select(self, items, cap=None):
        output = []
        remaining = self.options["memory_budget_tokens"] - self.used
        remaining = min(remaining, cap) if cap is not None else remaining
        for item in items:
            key = item.get("material_id") or ("memory", item["id"], item.get("version"))
            cost = token_estimate(item)
            reason = "duplicate" if key in self.selected else "budget" if cost > remaining else None
            if reason:
                self.report["excluded"].append({"id": item["id"], "reason": reason})
                continue
            output.append(item)
            self.selected.add(key)
            self.used += cost
            remaining -= cost
            self.report["selected_ids"].append(item["id"])
        return output

    def profiles(self):
        if not self.personal_allowed:
            self.report["profile_selection"] = {
                "eligible_count": 0,
                "selected_count": 0,
                "categories": [],
                "budget": 0,
                "status": "blocked",
            }
            return []
        with self.db.session() as session:
            rows = (
                session.query(Profile)
                .filter_by(owner=self.owner, state="active")
                .order_by(Profile.pinned.desc(), Profile.created.desc())
                .limit(100)
                .all()
            )
            selected = []
            seen_content = set()
            for row in rows:
                if self.intent and not any(n.source == "profile" for n in self.intent.plan.needs):
                    continue
                if self.review_scope == "learning_advice":
                    if row.category not in {
                        "background",
                        "goal",
                        "learning",
                        "lifestyle",
                        "communication",
                    }:
                        continue
                elif self.review_scope and self.review_scope != "all":
                    if row.category != self.review_scope:
                        continue
                elif not self.review_scope:
                    if row.category == "personality" and not re.search(
                        "性格|思考习惯|决策习惯", self.text
                    ):
                        continue
                    if row.category != "communication" and not terms(row.content) & terms(
                        self.text
                    ):
                        continue
                evidence = [session.get(Memory, mid) for mid in row.evidence_ids]
                if not evidence or not all(
                    m
                    and m.owner == self.owner
                    and m.project == self.project
                    and m.status in ("current", "planned")
                    and allowed(session, self.owner, m, self.text)
                    for m in evidence
                ):
                    continue
                normalized = re.sub(r"\s+", "", row.content).casefold()
                if normalized in seen_content:
                    self.report["excluded"].append({"id": row.id, "reason": "duplicate_profile"})
                    continue
                seen_content.add(normalized)
                selected.append(
                    {
                        "id": row.id,
                        "material_id": f"profile:{row.id}:{row.revision}",
                        "content": row.content,
                        "origin": row.origin,
                        "category": row.category,
                        "evidence_ids": row.evidence_ids,
                        "fact_id": evidence[0].fact_id,
                    }
                )
            if self.review_scope in {"all", "learning_advice"}:
                # Round robin: each category gets a turn before one category gets seconds.
                groups = {}
                for item in selected:
                    groups.setdefault(item["category"], []).append(item)
                selected = [
                    group[index]
                    for index in range(max(map(len, groups.values()), default=0))
                    for group in groups.values()
                    if index < len(group)
                ]
            from app.domain.profile_digest import reuse_digest

            selected, cache_status = reuse_digest(self.owner, self.project, selected)
            self.report["profile_digest"] = cache_status
            cap = self.options["memory_budget_tokens"] * (4 if self.review_scope else 3) // 8
            output = self.select(selected, cap)
            self.report["profile_selection"] = {
                "eligible_count": len(selected),
                "selected_count": len(output),
                "categories": sorted({item["category"] for item in output}),
                "budget": cap,
            }
            return output

    def fit(self, messages, tools):
        reserve = self.settings.model_output_reserve + self.settings.model_tool_reserve + 512
        limit = self.settings.model_context_limit - reserve
        current = list(messages)
        # Drop complete oldest user/assistant turns, never orphan a tool-result pair.
        while token_estimate(current) + token_estimate(tools) > limit:
            starts = [i for i, m in enumerate(current) if m.get("role") == "user"]
            if len(starts) < 2:
                raise AppError("CONTEXT_BUDGET_EXCEEDED", "本轮必要内容超出预算，请分段输入。", 413)
            del current[starts[0] : starts[1]]
        self.report["estimated_input_tokens"] = token_estimate(current) + token_estimate(tools)
        self.report["memory_tokens"] = self.used
        return current


def update_working_state(db, owner, conversation_id, message_id, text, intent=None):
    with db.session() as session:
        row = (
            session.query(WorkingState)
            .filter_by(owner=owner, conversation_id=conversation_id)
            .first()
        )
        if not row:
            row = WorkingState(owner=owner, conversation_id=conversation_id, revision=1)
            session.add(row)
        else:
            row.revision += 1
        emotion = re.findall("难过|伤心|烦躁|很累|好烦|开心", text)
        row.valid = True
        row.data = {
            "source_message_ids": [message_id],
            "last_activity_at": now(),
            "strategy": intent.plan.response_style if intent else response_strategy(text),
            "emotion_context": emotion,
            "topic_terms": sorted(terms(text))[:20],
        }


def working_state_view(row, settings):
    data = dict(row.data) if row.valid else {}
    if (
        data
        and (
            datetime.now(timezone.utc) - datetime.fromisoformat(data["last_activity_at"])
        ).total_seconds()
        > settings.emotion_recheck_minutes * 60
    ):
        data["emotion_context"], data["emotion_state"] = [], "needs_recheck"
    return data


def register_profile_evidence(evidence, profiles):
    """Register only selected, validated profiles; link citations to readable memory evidence."""
    for profile in profiles:
        if not profile.get("evidence_ids"):
            continue
        item = {**profile, "citation_id": profile["evidence_ids"][0]}
        evidence[profile["id"]] = item
        evidence[profile["material_id"]] = item
