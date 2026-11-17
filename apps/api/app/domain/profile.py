"""Profile inference and evidence invalidation."""

import json

from app.domain.memory.access import allowed as may_use
from app.domain.memory.models import MemoryMeta, Profile
from app.errors import AppError
from app.infrastructure.db import Job, Memory, Source
from app.validation import validate_text


class ProfileService:
    def __init__(self, db, provider):
        self.db, self.provider = db, provider

    async def infer_profiles(self, owner):
        from app.domain.memory.service import memory_epoch, withdrawn

        with self.db.session() as session:
            memories = (
                session.query(Memory)
                .filter_by(owner=owner, status="current")
                .order_by(Memory.created.desc())
                .limit(100)
                .all()
            )
            sources = {s.id: s for s in session.query(Source).filter_by(owner=owner)}
            allowed = {
                m.id: m
                for m in memories
                if m.source_ids
                and may_use(session, owner, m, "", inference=True)
                and all(
                    sid in sources and not withdrawn(session, owner, sid) for sid in m.source_ids
                )
            }
            groups = {
                row.memory_id: row.data.get("event_group_key")
                for row in session.query(MemoryMeta).filter_by(owner=owner)
                if row.memory_id in allowed
                and row.data.get("subject") == "self"
                and not row.data.get("profile_deferred", False)
                and row.data.get("event_group_key")
            }
            # Unknown event identity never counts as independent evidence.
            allowed = {mid: memory for mid, memory in allowed.items() if mid in groups}
            if len(set(groups.values())) < 3:
                return {"created": 0}
            if len({sid for m in allowed.values() for sid in m.source_ids}) < 3:
                return {"created": 0}
            if (
                len({sources[sid].created[:10] for m in allowed.values() for sid in m.source_ids})
                < 2
            ):
                return {"created": 0}
            epoch = memory_epoch(session, owner).epoch
            data = [{"id": m.id, "content": m.content} for m in allowed.values()]
        response = await self.provider.structured(
            '仅从证据提出保守性格倾向，不诊断、不定型。返回 {"profiles":[{"content":"可能…",'
            '"evidence_ids":["记忆ID"],"counterevidence_ids":[]}]}，最多3条。证据不足返回空数组。',
            json.dumps(data, ensure_ascii=False),
        )
        from pydantic import BaseModel, ConfigDict, Field

        class Inference(BaseModel):
            model_config = ConfigDict(extra="forbid")
            content: str = Field(min_length=1, max_length=1000)
            evidence_ids: list[str] = Field(min_length=1, max_length=100)
            counterevidence_ids: list[str] = Field(default_factory=list, max_length=100)

        class Result(BaseModel):
            model_config = ConfigDict(extra="forbid")
            profiles: list[Inference] = Field(max_length=3)

        result = Result.model_validate(response)
        count = 0
        with self.db.session() as session:
            if memory_epoch(session, owner).epoch != epoch:
                raise AppError("VERSION_CONFLICT", "证据已变化，请重试。", 409)
            for item in result.profiles:
                ids = set(item.evidence_ids)
                if len({groups.get(mid) for mid in ids} - {None}) < 3:
                    continue
                if not (ids | set(item.counterevidence_ids)) <= allowed.keys():
                    raise AppError("INVALID_EVIDENCE", "画像引用了无效证据。", 422)
                if len({allowed[mid].project for mid in ids}) != 1:
                    continue
                source_ids = {sid for mid in ids for sid in allowed[mid].source_ids}
                days = {sources[sid].created[:10] for sid in source_ids}
                if len(source_ids) < 3 or len(days) < 2:
                    continue
                if any(
                    ids <= set(p.evidence_ids)
                    for p in session.query(Profile).filter_by(owner=owner, origin="inference")
                ):
                    continue
                session.add(
                    Profile(
                        owner=owner,
                        category="personality",
                        content=validate_text(item.content),
                        origin="inference",
                        state="pending",
                        evidence_ids=sorted(ids),
                        context={"counterevidence_ids": item.counterevidence_ids},
                    )
                )
                count += 1
        return {"created": count}

    async def process_profile(self, job_id):
        from app.domain.memory.service import withdrawn

        with self.db.session() as session:
            job = session.get(Job, job_id)
            if not job or job.state != "QUEUED":
                return
            if job.source_id and withdrawn(session, job.owner, job.source_id):
                job.state = "CANCELLED"
                return
            job.state, job.stage = "RUNNING", "PROFILE"
            owner = job.owner
        try:
            result = await self.infer_profiles(owner)
            from app.domain.profile_digest import refresh_digests
            try:
                result["summary_count"] = await refresh_digests(self.db, self.provider, owner)
            except Exception:
                # Summary failure must not undo valid profiles or block answering.
                result["summary_status"] = "fallback"

            with self.db.session() as session:
                job = session.get(Job, job_id)
                if job.state != "CANCELLED":
                    job.state, job.payload = "SUCCEEDED", {**job.payload, **result}
        except Exception:
            with self.db.session() as session:
                job = session.get(Job, job_id)
                if job.state != "CANCELLED":
                    job.state = "FAILED"
                    job.error = {"code": "PROFILE_UPDATE_FAILED", "retryable": True}

    @staticmethod
    def pause_profiles(session, owner, memory_ids):
        for profile in session.query(Profile).filter_by(owner=owner):
            if (
                set(profile.evidence_ids) | set(profile.context.get("counterevidence_ids", []))
            ) & memory_ids:
                profile.state, profile.revision = "paused", profile.revision + 1
