import asyncio
import hmac
import json
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import Depends, FastAPI, File as Upload, Header, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import Field
from sqlalchemy import text

from app.infrastructure.config import settings as default_settings
from app.infrastructure.worker import run_worker
from app.infrastructure.indexing import IndexService
from app.infrastructure.db import (
    Conversation,
    Database,
    Job,
    Memory,
    Message,
    Run,
    Source,
    Summary,
    owned,
    preference,
)
from app.errors import AppError
from app.domain.files import FileService
from app.domain.memory.legacy import MemoryService
from app.infrastructure.providers import QwenProvider
from app.domain.retrieval.service import Retriever
from app.application.runtime import AgentRuntime
from app.api.schemas import ChatInput, RecordInput, Revision, Strict
from app.application.tools import ToolController
from app.application.temporary import TemporaryInput, temporary_chat
from app.api.views import conversation_view, evidence_view, memory_view


class Decision(Strict):
    base_version_id: str | None = None


class Deletion(Decision):
    scope: Literal["fact_and_versions"] = "fact_and_versions"
    preserve_sources: Literal[True] = True


class MemoryPolicy(Strict):
    enabled: bool


class EditCandidate(Strict):
    text: str = Field(min_length=1, max_length=4000)


class NewConversation(Strict):
    request_id: str | None = Field(
        default=None, min_length=1, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$"
    )
    project: str = Field(default="default", min_length=1, max_length=128)


def create_app(settings=default_settings, *, database=None, provider=None):
    state = {"db": database, "error": None, "worker": None, "worker_ready": False}
    cloud = provider or QwenProvider(settings)

    @asynccontextmanager
    async def lifespan(app):
        try:
            db = database or Database(settings.database_url)
            if settings.auto_migrate:
                db.migrate()
            else:
                with db.engine.connect() as connection:
                    connection.execute(text("SELECT 1 FROM schema_revisions"))
            state["db"] = db
            memory = MemoryService(db, cloud, settings)
            from app.domain.memory.service import MemoryV2

            state["memory_v2"] = MemoryV2(db, cloud)
            retriever = Retriever(db, cloud, settings)
            files = FileService(db, settings)
            controller = ToolController(db, cloud, memory, retriever, files)
            state.update(
                memory=memory,
                index=IndexService(db, cloud, settings),
                retriever=retriever,
                files=files,
                runtime=AgentRuntime(db, cloud, memory, retriever, files, controller, settings),
            )
            if settings.worker_enabled:
                state["worker"] = asyncio.create_task(run_worker(state))
                await asyncio.sleep(0)
        except Exception:
            state["error"] = "PostgreSQL 未连接：请检查数据库服务、DATABASE_URL 和 pgvector 扩展。"
        yield
        tasks = list(state.get("runtime").tasks.values()) if state.get("runtime") else []
        if state["worker"]:
            tasks.append(state["worker"])
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        if state["db"]:
            state["db"].engine.dispose()

    app = FastAPI(
        title="Personal Agent", version="1.1", lifespan=lifespan, docs_url=None, redoc_url=None
    )
    app.state.services = state

    @app.exception_handler(AppError)
    async def app_error(request, error):
        return JSONResponse(error.body(), status_code=error.status)

    @app.exception_handler(RequestValidationError)
    async def invalid(request, error):
        return JSONResponse(
            AppError("INVALID_REQUEST", "请求格式不正确，请检查输入。", 422).body(), status_code=422
        )

    @app.exception_handler(Exception)
    async def unknown(request, error):
        return JSONResponse(
            AppError(
                "INTERNAL_ERROR", "服务暂不可用，请检查后端状态。", 503, retryable=True
            ).body(),
            status_code=503,
        )

    def authenticate(authorization: str = Header(default="")):
        expected = settings.api_token.get_secret_value()
        if not expected:
            raise AppError("API_TOKEN_NOT_CONFIGURED", "请运行本地配置脚本生成 API_TOKEN。", 503)
        if not hmac.compare_digest(authorization, "Bearer " + expected):
            raise AppError("UNAUTHORIZED", "无权访问此服务。", 401)
        return settings.owner_id

    from app.api.knowledge_classification import ClassificationInput, classify_knowledge

    @app.post("/api/knowledge/classify")
    async def classify_local_note(body: ClassificationInput, owner=Depends(authenticate)):
        return await classify_knowledge(body, cloud)

    def ready(owner=Depends(authenticate)):
        if state["error"] or not state["db"]:
            raise AppError("DATABASE_UNAVAILABLE", state["error"] or "数据库尚未连接。", 503)
        if settings.worker_enabled and not state["worker_ready"]:
            raise AppError(
                "WORKER_UNAVAILABLE", "后台任务服务未启动；请确保只有一个后端进程。", 503
            )
        return owner

    from app.api.knowledge_routes import router as knowledge_router

    app.include_router(knowledge_router(state, ready, settings, cloud))
    from app.api.memory_routes import router as memory_v2_router

    app.include_router(memory_v2_router(state, ready, settings))
    from app.api.context_routes import router as context_router

    app.include_router(context_router(state, ready, settings))

    @app.get("/api/v1/health/live")
    async def live():
        return {"alive": True}

    @app.get("/api/v1/health/ready")
    async def health():
        return {
            "mode": settings.runtime_mode,
            "worker_required": settings.worker_enabled,
            "database": bool(state["db"] and not state["error"]),
            "model_configured": bool(settings.dashscope_api_key.get_secret_value()),
            "api_token_configured": bool(settings.api_token.get_secret_value()),
            "worker": state["worker_ready"],
            "message": state["error"],
            "model": settings.chat_model,
            "provider_verified": False,
            "intent_planner_enabled": settings.intent_planner_enabled,
        }

    @app.get("/api/v1/workspace")
    async def workspace(owner=Depends(ready)):
        from app.domain.memory.models import Tombstone

        with state["db"].session() as session:
            deleted = session.query(Tombstone.original_id).filter_by(
                owner=owner, entity_type="conversation"
            )
            rows = (
                session.query(Conversation)
                .filter_by(owner=owner)
                .filter(~Conversation.id.in_(deleted))
                .order_by(Conversation.updated.desc())
                .all()
            )
            return {"conversations": [conversation_view(session, r) for r in rows]}

    @app.post("/api/v1/temporary/messages")
    async def temporary(body: TemporaryInput, owner=Depends(authenticate)):
        return await temporary_chat(cloud, settings, body)

    @app.post("/api/v1/conversations", status_code=201)
    async def create_conversation(body: NewConversation, owner=Depends(ready)):
        with state["db"].session() as session:
            if body.request_id:
                from app.domain.memory.models import Tombstone

                if (
                    session.query(Tombstone)
                    .filter_by(owner=owner, entity_type="conversation", original_id=body.request_id)
                    .first()
                ):
                    raise AppError("CONVERSATION_DELETED", "该会话已删除，请新建对话。", 409)
                existing = session.get(Conversation, body.request_id)
                if existing:
                    if existing.owner != owner or existing.project != body.project:
                        raise AppError("IDEMPOTENCY_CONFLICT", "会话请求编号已被使用。", 409)
                    return conversation_view(session, existing)
            row = Conversation(owner=owner, project=body.project)
            if body.request_id:
                row.id = body.request_id
            session.add(row)
            session.flush()
            if settings.memory_v2_enabled:
                from app.domain.memory.models import Policy

                session.add(Policy(owner=owner, conversation_id=row.id, mode="off"))
            return conversation_view(session, row)

    @app.delete("/api/v1/conversations/{identifier}")
    async def remove_conversation(identifier: str, owner=Depends(ready)):
        from app.application.conversations import delete_conversation

        return delete_conversation(state["db"], owner, identifier)

    @app.get("/api/v1/conversations/{identifier}")
    async def conversation(identifier: str, owner=Depends(ready)):
        with state["db"].session() as session:
            return conversation_view(session, owned(session, Conversation, identifier, owner))

    @app.get("/api/v1/settings/memory")
    async def get_policy(owner=Depends(ready)):
        with state["db"].session() as session:
            pref = preference(session, owner)
            return {"enabled": pref.enabled, "epoch": pref.epoch}

    @app.patch("/api/v1/settings/memory")
    async def set_policy(body: MemoryPolicy, owner=Depends(ready)):
        with state["db"].session() as session:
            pref = preference(session, owner)
            pref.enabled, pref.epoch = body.enabled, pref.epoch + 1
            return {"enabled": pref.enabled, "epoch": pref.epoch}

    @app.post("/api/v1/memory/records", status_code=202)
    async def record(
        body: RecordInput,
        idempotency_key: str = Header(alias="Idempotency-Key", min_length=1, max_length=128),
        owner=Depends(ready),
    ):
        cloud.require()
        return {
            "job_id": state["memory"].enqueue(
                owner, body.conversation_id, body.text, idempotency_key
            )
        }

    @app.get("/api/v1/memory/jobs/{identifier}")
    async def job(identifier: str, owner=Depends(ready)):
        with state["db"].session() as session:
            row = owned(session, Job, identifier, owner)
            return {
                "id": row.id,
                "state": row.state,
                "stage": row.stage,
                "error": row.error,
                "source_id": row.source_id,
            }

    @app.post("/api/v1/memory/jobs/{identifier}/retry", status_code=202)
    async def retry_job(identifier: str, owner=Depends(ready)):
        cloud.require()
        return {"job_id": state["memory"].retry(owner, identifier)}

    @app.post("/api/v1/messages/{identifier}/retry-memory", status_code=202)
    async def retry_message(identifier: str, owner=Depends(ready)):
        with state["db"].session() as session:
            row = owned(session, Message, identifier, owner)
            job_id = row.data.get("jobId")
        return {"job_id": state["memory"].retry(owner, job_id)}

    @app.get("/api/v1/memory/library")
    async def library(
        query: str = "",
        kind: Literal["all", "fact", "episode", "source"] = "all",
        page: int = 1,
        owner=Depends(ready),
    ):
        page = max(1, min(page, 10000))
        with state["db"].session() as session:
            if kind == "source":
                rows = session.query(Source).filter_by(owner=owner)
                if query:
                    rows = rows.filter(Source.content.contains(query, autoescape=True))
                total = rows.count()
                return {
                    "total": total,
                    "items": [
                        evidence_view(session, "raw:" + r.id, owner)
                        for r in rows.order_by(Source.created.desc())
                        .offset((page - 1) * 10)
                        .limit(10)
                    ],
                }
            rows = session.query(Memory).filter(
                Memory.owner == owner, Memory.status.in_(["current", "planned"])
            )
            if kind != "all":
                rows = rows.filter_by(kind=kind)
            if query:
                rows = rows.filter(Memory.content.contains(query, autoescape=True))
            return {
                "total": rows.count(),
                "items": [
                    memory_view(session, r)
                    for r in rows.order_by(Memory.created.desc()).offset((page - 1) * 10).limit(10)
                ],
            }

    @app.get("/api/v1/evidence/{identifier:path}")
    async def evidence(identifier: str, owner=Depends(ready)):
        with state["db"].session() as session:
            if identifier.startswith("knowledge:"):
                from app.domain.knowledge.models import Asset, AssetChunk, Item, Version

                key = identifier.removeprefix("knowledge:")
                version = session.query(Version).filter_by(id=key, owner=owner).first()
                if version:
                    item = owned(session, Item, version.item_id, owner)
                    if item.lifecycle != "active":
                        raise AppError("EVIDENCE_UNAVAILABLE", "知识已删除。", 404)
                    return {
                        "id": identifier,
                        "kind": "source",
                        "origin": "memory",
                        "title": version.title,
                        "text": version.body,
                        "version": version.version,
                        "status": "current"
                        if item.current_version_id == version.id
                        else "historical",
                        "createdAt": version.created,
                    }
                chunk = owned(session, AssetChunk, key, owner)
                asset = owned(session, Asset, chunk.asset_id, owner)
                return {
                    "id": identifier,
                    "kind": "source",
                    "origin": "file",
                    "title": asset.name + " · " + chunk.locator,
                    "text": chunk.content,
                    "status": "current",
                    "version": 1,
                    "createdAt": asset.created,
                }
            if identifier.startswith("run:"):
                _, run_id, external_id = identifier.split(":", 2)
                run = owned(session, Run, run_id, owner)
                row = next(
                    (r for r in run.data.get("external", []) if r["id"] == external_id), None
                )
                if not row:
                    raise AppError("NOT_FOUND", "来源不存在。", 404)
                return {
                    "id": identifier,
                    "kind": "source",
                    "origin": "web",
                    "url": row["url"],
                    "title": row["title"],
                    "text": row.get("content", "") or "搜索接口未提供摘要，可打开原网页核验。",
                    "status": "current",
                    "version": 1,
                    "createdAt": run.created,
                }
            if identifier.startswith("file:"):
                from app.infrastructure.db import Chunk, File

                chunk = owned(session, Chunk, identifier[5:], owner)
                file = owned(session, File, chunk.file_id, owner)
                return {
                    "id": identifier,
                    "kind": "source",
                    "origin": "file",
                    "title": file.name + " · " + chunk.locator,
                    "text": chunk.content,
                    "status": "current",
                    "version": 1,
                    "createdAt": file.created,
                }
            return evidence_view(session, identifier, owner)

    @app.patch("/api/v1/memory/facts/{identifier}")
    async def revise(identifier: str, body: Revision, owner=Depends(ready)):
        version_id = state["memory"].revise(owner, identifier, body.base_version_id, body.text)
        with state["db"].session() as session:
            return evidence_view(session, version_id, owner)

    @app.delete("/api/v1/memory/facts/{identifier}")
    async def delete(identifier: str, body: Deletion, owner=Depends(ready)):
        job_id = state["memory"].delete(owner, identifier, body.base_version_id)
        with state["db"].session() as session:
            active = [r.id for r in session.query(Run).filter_by(owner=owner, status="RUNNING")]
        for run_id in active:
            state["runtime"].cancel(owner, run_id)
        return {"job_id": job_id}

    @app.post("/api/v1/memory/proposals/{identifier}/{decision}")
    async def decide(
        identifier: str,
        decision: Literal["approve", "reject", "refresh"],
        body: Decision,
        owner=Depends(ready),
    ):
        if decision == "refresh":
            state["memory"].edit_proposal(owner, identifier, refresh=True)
        else:
            state["memory"].decide(owner, identifier, decision, body.base_version_id)
        return {"ok": True}

    @app.patch("/api/v1/memory/proposals/{identifier}")
    async def edit_proposal(identifier: str, body: EditCandidate, owner=Depends(ready)):
        state["memory"].edit_proposal(owner, identifier, body.text)
        return {"ok": True}

    @app.get("/api/v1/conversations/{identifier}/insights")
    async def insights(identifier: str, owner=Depends(ready)):
        with state["db"].session() as session:
            row = owned(session, Conversation, identifier, owner)
            summaries = (
                session.query(Summary)
                .filter_by(owner=owner, conversation_id=identifier, valid=True)
                .order_by(Summary.created.desc())
                .first()
            )
            pending = (
                session.query(Job)
                .filter_by(owner=owner)
                .filter(Job.state.in_(["QUEUED", "RUNNING", "PARTIAL", "FAILED"]))
                .count()
            )
            run = (
                session.query(Run)
                .filter_by(owner=owner, conversation_id=identifier)
                .order_by(Run.created.desc())
                .first()
            )
            return {
                "core": state["retriever"].core(owner, row.project),
                "summary": {"text": summaries.content, "message_ids": summaries.message_ids}
                if summaries
                else None,
                "jobs_pending": pending,
                "last_run": {
                    "id": run.id,
                    "status": run.status,
                    "events": run.data.get("events", []),
                    "usage": run.data.get("usage", []),
                    "warnings": run.data.get("warnings", []),
                }
                if run
                else None,
            }

    @app.post("/api/v1/conversations/{identifier}/files", status_code=201)
    async def upload(identifier: str, file: UploadFile = Upload(...), owner=Depends(ready)):
        data = await file.read(settings.max_file_bytes + 1)
        return await asyncio.to_thread(
            state["files"].upload, owner, identifier, file.filename or "file", data
        )

    @app.get("/api/v1/conversations/{identifier}/files")
    async def files(identifier: str, owner=Depends(ready)):
        return state["files"].list(owner, identifier)

    @app.post("/api/v1/agent/runs", status_code=202)
    async def start(body: ChatInput, owner=Depends(ready)):
        return {"run_id": state["runtime"].start(owner, body)}

    @app.get("/api/v1/agent/runs/{identifier}")
    async def run_status(identifier: str, owner=Depends(ready)):
        with state["db"].session() as session:
            run = owned(session, Run, identifier, owner)
            return {
                "id": run.id,
                "status": run.status,
                "stage": run.data.get("stage"),
                "active_tool": run.data.get("active_tool"),
                "events": run.data.get("events", []),
                "error": run.data.get("error"),
            }

    @app.get("/api/v1/agent/runs/{identifier}/trace")
    async def run_trace(identifier: str, owner=Depends(ready)):
        from app.infrastructure.tracing import trace_view

        return trace_view(state["db"], owner, identifier)

    @app.get("/api/v1/agent/runs/{identifier}/trace/retrievals/{retrieval_id}")
    async def retrieval_trace(identifier: str, retrieval_id: str, owner=Depends(ready)):
        data = await run_trace(identifier, owner)
        for row in data.get("retrievals", []):
            if row["id"] == retrieval_id:
                return row
        raise AppError("TRACE_NOT_FOUND", "该检索轨迹不存在或已被遗忘。", 404)

    @app.post("/api/v1/agent/runs/{identifier}/cancel")
    async def cancel(identifier: str, owner=Depends(ready)):
        state["runtime"].cancel(owner, identifier)
        return {"ok": True}

    @app.get("/api/v1/agent/runs/{identifier}/events")
    async def events(identifier: str, request: Request, owner=Depends(ready)):
        await run_status(identifier, owner)

        async def generate():
            previous = None
            while not await request.is_disconnected():
                status = await run_status(identifier, owner)
                encoded = json.dumps(status, ensure_ascii=False)
                if encoded != previous:
                    yield "event: status\ndata: " + encoded + "\n\n"
                    previous = encoded
                if status["status"] != "RUNNING":
                    break
                await asyncio.sleep(0.3)

        return StreamingResponse(
            generate(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
        )

    return app


app = create_app()
