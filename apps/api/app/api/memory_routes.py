from fastapi import APIRouter, Depends, Query, UploadFile, Response
from pydantic import Field
from typing import Literal

from app.infrastructure.db import Conversation, Job, Memory, Source, owned
from app.errors import AppError
from app.domain.memory.job_status import job_view
from app.api.schemas import validate_text, Strict
from app.domain.memory.models import Batch, CandidateRow, MemoryMeta, Policy, Profile
from app.domain.memory.schemas import Decisions, Deletion, Edit, PolicyChange, ProfileChange, ProfileDecision, Record
from app.domain.memory.schemas import Revision
from app.domain.memory.service import check_revision, invalidate, serialize, withdrawn


def router(state, authenticate, settings):
    routes = APIRouter(prefix="/api/v2", tags=["personal-memory"])

    def ready(owner=Depends(authenticate)):
        if not settings.memory_v2_enabled:
            raise AppError("FEATURE_DISABLED", "V2 记忆功能尚未启用。", 409)
        return owner

    def service():
        return state["memory_v2"]

    def portability():
        from app.domain.memory.portability import Portability

        return Portability(state["db"], settings)

    class ExportRequest(Strict):
        request_id: str = Field(min_length=1, max_length=128)

    class RestoreRequest(ExportRequest):
        mode: Literal["restore", "merge"] = "restore"
        expected_epoch: int = Field(ge=1)
        resolutions: list[dict[str, str]] = Field(default_factory=list, max_length=10000)

    class SearchRequest(Strict):
        query: str = Field(min_length=1, max_length=500)
        intent: Literal["current", "history"] = "current"
        project: str = Field(default="default", min_length=1, max_length=128)

    @routes.post("/exports", status_code=202)
    def export(body: ExportRequest, owner=Depends(ready)):
        return portability().create(owner, "export")

    @routes.get("/exports/{identifier}")
    def export_status(identifier: str, owner=Depends(ready)):
        return portability().read(owner, identifier)

    @routes.get("/exports/{identifier}/download")
    def download(identifier: str, owner=Depends(ready)):
        return Response(
            portability().read(owner, identifier, download=True),
            media_type="application/zip",
            headers={"Content-Disposition": 'attachment; filename="personal-memory.zip"'},
        )

    @routes.post("/imports/preflight", status_code=202)
    async def preflight(file: UploadFile, owner=Depends(ready)):
        data = await file.read(200 * 1024 * 1024 + 1)
        return portability().create(owner, "import", data)

    @routes.get("/imports/{identifier}")
    def import_status(identifier: str, owner=Depends(ready)):
        return portability().read(owner, identifier)

    @routes.post("/imports/{identifier}/commit", status_code=202)
    def restore(identifier: str, body: RestoreRequest, owner=Depends(ready)):
        if any(
            set(r) != {"conflict_id", "action"} or r["action"] not in ("keep_local", "use_import")
            for r in body.resolutions
        ):
            raise AppError("INVALID_REQUEST", "导入冲突处理格式不正确。", 422)
        if len({r["conflict_id"] for r in body.resolutions}) != len(body.resolutions):
            raise AppError("INVALID_REQUEST", "不能重复指定冲突处理。", 422)
        return portability().restore(
            owner, identifier, body.expected_epoch, mode=body.mode, resolutions=body.resolutions
        )

    @routes.post("/memory/search")
    async def search(body: SearchRequest, owner=Depends(ready)):
        from app.domain.memory.access import request_context

        token = request_context.set({"owner": owner, "text": body.query})
        try:
            return await state["retriever"].search(
                owner, body.project, body.query, history=body.intent == "history"
            )
        finally:
            request_context.reset(token)

    def listing(model, owner, cursor, limit, filters=None):
        with state["db"].session() as session:
            query = session.query(model).filter_by(owner=owner, **(filters or {}))
            if cursor:
                query = query.filter(model.id > cursor)
            rows = query.order_by(model.id).limit(limit + 1).all()
            return {
                "items": [serialize(row) for row in rows[:limit]],
                "next_cursor": rows[limit - 1].id if len(rows) > limit else None,
            }

    @routes.get("/conversations/{identifier}/memory-policy")
    def policy_get(identifier: str, owner=Depends(ready)):
        with state["db"].session() as session:
            owned(session, Conversation, identifier, owner)
            row = session.query(Policy).filter_by(owner=owner, conversation_id=identifier).first()
            return serialize(row) if row else {"mode": "legacy", "revision": 1}

    @routes.patch("/conversations/{identifier}/memory-policy")
    def policy(identifier: str, body: PolicyChange, owner=Depends(ready)):
        return service().policy(owner, identifier, body)

    @routes.post("/memory/records", status_code=202)
    def record(body: Record, owner=Depends(ready)):
        from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

        try:
            ZoneInfo(body.timezone)
        except (ValueError, ZoneInfoNotFoundError):
            raise AppError("INVALID_TIMEZONE", "时区无效。", 422)
        revision = None
        if body.mode == "authorized":
            with state["db"].session() as session:
                owned(session, Conversation, body.conversation_id, owner)
                row = (
                    session.query(Policy)
                    .filter_by(owner=owner, conversation_id=body.conversation_id)
                    .first()
                )
                revision = row.revision if row else None
        result = service().enqueue(
            owner,
            body.conversation_id,
            body.text,
            body.request_id,
            timezone=body.timezone,
            automatic=body.mode == "authorized",
            policy_revision=revision,
        )
        if result is None:
            raise AppError("MEMORY_NOT_AUTHORIZED", "当前会话未授权自动记忆。", 403)
        return result

    @routes.get("/conversations/{identifier}/memory-jobs")
    def conversation_jobs(identifier: str, owner=Depends(ready)):
        with state["db"].session() as session:
            owned(session, Conversation, identifier, owner)
            rows = (session.query(Job).join(Source, Job.source_id == Source.id)
                    .filter(Job.owner == owner, Source.owner == owner,
                            Source.conversation_id == identifier, Job.kind == "memory_v2")
                    .order_by(Job.created.desc(), Job.id.desc()).limit(20).all())
            return {"items": [job_view(session, row) for row in rows]}

    @routes.get("/memory/jobs/{identifier}")
    def job(identifier: str, owner=Depends(ready)):
        with state["db"].session() as session:
            row = owned(session, Job, identifier, owner)
            return job_view(session, row)

    @routes.post("/memory/jobs/{identifier}/retry", status_code=202)
    def retry(identifier: str, owner=Depends(ready)):
        with state["db"].session() as session:
            row = owned(session, Job, identifier, owner, lock=True)
            if row.kind != "memory_v2" or row.state != "FAILED":
                raise AppError("JOB_NOT_RETRYABLE", "任务不能重试。", 409)
            source = owned(session, Source, row.source_id, owner)
            if not service().valid_job(session, row, source):
                raise AppError("SOURCE_WITHDRAWN", "来源或授权已失效。", 409)
            row.state, row.error = "QUEUED", None
            return {"id": row.id, "state": row.state}

    @routes.get("/memory/batches")
    def batches(
        cursor: str | None = None, limit: int = Query(50, ge=1, le=100), owner=Depends(ready)
    ):
        return listing(Batch, owner, cursor, limit)

    @routes.get("/memory/batches/{identifier}")
    def batch(identifier: str, owner=Depends(ready)):
        with state["db"].session() as session:
            row = owned(session, Batch, identifier, owner)
            def candidate_view(candidate):
                value = serialize(candidate)
                previous = session.get(Memory, candidate.data.get("base_id")) if candidate.data.get("base_id") else None
                value["data"] = {**value["data"], "previous_content": (
                    previous.content if previous and previous.owner == owner and previous.status in ("current", "planned") else None
                )}
                return value
            return {
                **serialize(row),
                "candidates": [
                    candidate_view(c)
                    for c in session.query(CandidateRow).filter_by(owner=owner, batch_id=row.id)
                ],
            }

    @routes.post("/memory/batches/{identifier}/decisions")
    def decisions(identifier: str, body: Decisions, owner=Depends(ready)):
        return service().decisions(owner, identifier, body)

    @routes.patch("/memory/candidates/{identifier}")
    def edit(identifier: str, body: Edit, owner=Depends(ready)):
        content = validate_text(body.content, 4000)
        with state["db"].session() as session:

            def apply():
                row = owned(session, CandidateRow, identifier, owner, lock=True)
                check_revision(row, body.expected_revision)
                if row.state != "pending":
                    raise AppError("CANDIDATE_NOT_PENDING", "候选已处理。", 409)
                batch = owned(session, Batch, row.batch_id, owner, lock=True)
                origin = owned(session, Source, batch.source_id, owner)
                if withdrawn(session, owner, origin.id):
                    raise AppError("SOURCE_WITHDRAWN", "来源已撤回。", 409)
                # A correction is new evidence, never rewrite the original quotation.
                source = Source(
                    owner=owner,
                    conversation_id=origin.conversation_id,
                    project=origin.project,
                    content=content,
                    request_key="edit:" + body.request_id,
                )
                session.add(source)
                session.flush()
                row.data = {
                    **row.data,
                    "content": content,
                    "evidence": content,
                    "start": 0,
                    "end": len(content),
                    "edited_source_id": source.id,
                }
                row.revision += 1
                batch.revision += 1
                return {"id": row.id, "revision": row.revision, "batch_revision": batch.revision}

            return service().mutation(
                session, owner, "edit:" + identifier, body.model_dump(), apply
            )

    @routes.get("/memory/items")
    def items(
        cursor: str | None = None, limit: int = Query(50, ge=1, le=100), owner=Depends(ready)
    ):
        return listing(Memory, owner, cursor, limit, {"status": "current"})

    @routes.get("/memory/items/{identifier}")
    def item(identifier: str, owner=Depends(ready)):
        with state["db"].session() as session:
            row = owned(session, Memory, identifier, owner)
            meta = session.query(MemoryMeta).filter_by(owner=owner, memory_id=row.id).first()
            return {
                "id": row.id,
                "content": row.content,
                "status": row.status,
                "version": row.version,
                "source_ids": row.source_ids,
                "event_time": row.event_time,
                "metadata": meta.data if meta else {},
                "revision": meta.revision if meta else row.version,
            }

    @routes.post("/memory/items/{identifier}/revisions")
    def revise(identifier: str, body: Revision, owner=Depends(ready)):
        from app.infrastructure.db import Fact
        from app.domain.memory.models import Evidence

        with state["db"].session() as session:

            def apply():
                old = owned(session, Memory, identifier, owner, lock=True)
                fact = owned(session, Fact, old.fact_id, owner, lock=True)
                meta = session.query(MemoryMeta).filter_by(owner=owner, memory_id=old.id).first()
                if (
                    fact.deleted
                    or fact.current_id != old.id
                    or body.expected_revision != (meta.revision if meta else old.version)
                ):
                    raise AppError("VERSION_CONFLICT", "记忆已更新。", 409)
                if not old.source_ids:
                    raise AppError("SOURCE_WITHDRAWN", "原始证据已删除。", 409)
                origin = owned(session, Source, old.source_ids[0], owner)
                content = validate_text(body.content, 4000)
                source = Source(
                    owner=owner,
                    content=content,
                    project=old.project,
                    conversation_id=origin.conversation_id,
                    request_key="revision:" + body.request_id,
                )
                session.add(source)
                session.flush()
                new = Memory(
                    owner=owner,
                    project=old.project,
                    fact_id=fact.id,
                    kind=old.kind,
                    title=old.title,
                    content=content,
                    source_ids=[source.id],
                    version=old.version + 1,
                    status="current",
                )
                session.add(new)
                session.flush()
                old.status, fact.current_id = ("corrected" if body.reason == "correction" else "historical"), new.id
                data = {
                    **(meta.data if meta else {}),
                    "assertion_kind": "explicit",
                    "supersedes_id": old.id,
                    "revision_reason": body.reason,
                }
                from app.domain.memory.decision_policy import time_fields
                data.update(time_fields({**data, "kind": old.kind, "evidence": content, "event_time": None}, source.created))
                new.event_time = data.get("event_time")
                if body.context is not None:
                    data["context"] = body.context
                session.add(MemoryMeta(owner=owner, memory_id=new.id, data=data))
                session.add(
                    Evidence(
                        owner=owner,
                        memory_id=new.id,
                        source_id=source.id,
                        start=0,
                        end=len(content),
                    )
                )
                session.add(
                    Job(
                        owner=owner,
                        source_id=source.id,
                        kind="index",
                        stage="INDEXING",
                        payload={"memory_ids": [new.id]},
                    )
                )
                service().pause_profiles(session, owner, {old.id})
                if old.kind == "fact" and data.get("subject") == "self" and data.get("profile_category") and not data.get("profile_deferred"):
                    session.add(Profile(owner=owner, category=data["profile_category"], content=content,
                                        origin="self_report", state="active", evidence_ids=[new.id], context=data.get("context", {})))
                invalidate(session, owner)
                return {"id": new.id, "revision": 1, "version": new.version}

            return service().mutation(
                session, owner, "revision:" + identifier, body.model_dump(), apply
            )

    @routes.get("/profiles")
    def profiles(
        cursor: str | None = None, limit: int = Query(50, ge=1, le=100), owner=Depends(ready)
    ):
        return listing(Profile, owner, cursor, limit)

    @routes.post("/profiles/review")
    async def review_profiles(owner=Depends(ready)):
        return await service().profiles.infer_profiles(owner)

    @routes.post("/profiles/{identifier}/corrections")
    def correct_profile(identifier: str, body: Edit, owner=Depends(ready)):
        with state["db"].session() as session:

            def apply():
                row = owned(session, Profile, identifier, owner, lock=True)
                check_revision(row, body.expected_revision)
                if not row.evidence_ids:
                    raise AppError("PROFILE_EVIDENCE_INVALID", "原画像缺少可追溯证据。", 409)
                memory = owned(session, Memory, row.evidence_ids[0], owner)
                if not memory.source_ids:
                    raise AppError("PROFILE_EVIDENCE_INVALID", "原证据已删除。", 409)
                origin = owned(session, Source, memory.source_ids[0], owner)
                content = validate_text(body.content, 4000)
                source = Source(
                    owner=owner,
                    conversation_id=origin.conversation_id,
                    project=origin.project,
                    content=content,
                    request_key="profile-edit:" + body.request_id,
                )
                session.add(source)
                session.flush()
                from app.infrastructure.db import Fact

                fact = Fact(
                    owner=owner, project=origin.project, claim_key="profile-correction:" + row.id
                )
                session.add(fact)
                session.flush()
                replacement = Memory(
                    owner=owner,
                    project=origin.project,
                    fact_id=fact.id,
                    kind="fact",
                    title="用户纠正的画像",
                    content=content,
                    source_ids=[source.id],
                )
                session.add(replacement)
                session.flush()
                fact.current_id = replacement.id
                row.state, row.revision = "outdated", row.revision + 1
                new = Profile(
                    owner=owner,
                    category=row.category,
                    origin="self_report",
                    content=content,
                    state="active",
                    evidence_ids=[replacement.id],
                )
                session.add(new)
                session.add(
                    Job(
                        owner=owner,
                        source_id=source.id,
                        kind="index",
                        stage="INDEXING",
                        payload={"memory_ids": [replacement.id]},
                    )
                )
                invalidate(session, owner)
                session.flush()
                return {"id": new.id, "revision": new.revision, "state": new.state}

            return service().mutation(
                session, owner, "profile-correct:" + identifier, body.model_dump(), apply
            )

    def profile_change(identifier, body, owner, decision=False):
        with state["db"].session() as session:

            def apply():
                row = owned(session, Profile, identifier, owner, lock=True)
                check_revision(row, body.expected_revision)
                if decision:
                    if row.state != "pending":
                        raise AppError("PROFILE_NOT_PENDING", "画像不是待确认状态。", 409)
                    row.state = "active" if body.action == "accept" else "rejected"
                else:
                    if row.state in ("pending", "rejected", "outdated"):
                        raise AppError(
                            "PROFILE_REQUIRES_EXPLICIT_DECISION", "此画像不可直接启用。", 409
                        )
                    if body.state:
                        row.state = body.state
                    if body.pinned is not None:
                        row.pinned = body.pinned
                if row.state == "active":
                    evidence = [owned(session, Memory, i, owner) for i in row.evidence_ids]
                    if not evidence or any(
                        m.status not in ("current", "planned") for m in evidence
                    ):
                        raise AppError("PROFILE_EVIDENCE_INVALID", "画像证据已失效。", 409)
                row.revision += 1
                invalidate(session, owner)
                return {
                    "id": row.id,
                    "revision": row.revision,
                    "state": row.state,
                    "pinned": row.pinned,
                }

            return service().mutation(
                session, owner, "profile:" + identifier, body.model_dump(), apply
            )

    @routes.post("/profiles/{identifier}/decision")
    def decide_profile(identifier: str, body: ProfileDecision, owner=Depends(ready)):
        return profile_change(identifier, body, owner, True)

    @routes.patch("/profiles/{identifier}")
    def patch_profile(identifier: str, body: ProfileChange, owner=Depends(ready)):
        return profile_change(identifier, body, owner)

    @routes.post("/privacy/deletions", status_code=202)
    def delete(body: Deletion, owner=Depends(ready)):
        result = service().delete(owner, body)
        from app.domain.memory.models import Transfer

        with state["db"].session() as session:
            for transfer in session.query(Transfer).filter_by(owner=owner):
                portability().path(transfer.id).unlink(missing_ok=True)
                transfer.state = "invalidated"
        return result

    @routes.get("/privacy/deletions/{identifier}")
    def deletion_status(identifier: str, owner=Depends(ready)):
        from app.domain.memory.models import Mutation

        with state["db"].session() as session:
            for row in session.query(Mutation).filter_by(owner=owner, operation="deletion"):
                if row.result.get("deletion_id") == identifier:
                    return row.result
        raise AppError("NOT_FOUND", "删除记录不存在。", 404)

    return routes
