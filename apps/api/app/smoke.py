"""Opt-in real integration acceptance. No SQLite and no provider doubles."""

import argparse
import asyncio
import json
from pathlib import Path

from app.infrastructure.config import settings
from app.application.context.history import ContextBuilder
from app.infrastructure.db import (
    Conversation,
    Database,
    Job,
    Memory,
    Message,
    Proposal,
    Run,
    Summary,
    ToolExecution,
    uid,
)
from app.errors import AppError
from app.domain.files import FileService
from app.domain.memory.legacy import MemoryService
from app.infrastructure.providers import QwenProvider
from app.persistence import snapshot, validate_manifest
from app.domain.retrieval.service import Retriever
from app.application.runtime import AgentRuntime
from app.api.schemas import ChatInput
from app.application.tools import ToolController


def memory_checkpoint(db, owner):
    """Confirm a real indexed fact exists before testing connection persistence."""
    with db.session() as session:
        rows = session.query(Memory).filter_by(owner=owner, kind="fact").all()
        if not rows:
            raise AppError(
                "SMOKE_MEMORY_EMPTY",
                "记忆处理没有形成事实（可能为 NOOP 或候选被过滤），尚不能验证持久化。请检查提取模型结果。",
                503,
                "extract",
            )
        current = [row for row in rows if row.status == "current"]
        if not current:
            raise AppError(
                "SMOKE_MEMORY_STATE",
                "偏好未形成当前有效事实，请检查提取的类型和时间状态。",
                503,
                "extract",
            )
        ready = [
            row.id for row in current if row.index_status == "READY" and row.embedding is not None
        ]
        if not ready:
            raise AppError(
                "SMOKE_MEMORY_INDEX",
                "事实已保存，但向量索引尚未就绪，请检查索引任务和 embedding 接口。",
                503,
                "index",
            )
        return set(ready)


async def verify():
    provider = QwenProvider(settings)
    provider.require()
    db = Database(settings.database_url)
    db.migrate()
    owner = "verification-" + uid()
    with db.session() as session:
        first = Conversation(owner=owner, title="真实集成验收：写入")
        second = Conversation(owner=owner, title="真实集成验收：新会话")
        session.add_all([first, second])
        session.flush()
        first_id, second_id = first.id, second.id
    memory = MemoryService(db, provider, settings)
    job_id = memory.enqueue(owner, first_id, "我喜欢简洁而有条理的回答。", uid())
    await memory.process(job_id)
    with db.session() as session:
        job = session.get(Job, job_id)
        if job.state != "SUCCEEDED":
            raise AppError("SMOKE_MEMORY", "真实记忆处理未完成，请检查提取/向量模型配置。", 503)
        proposals = [
            (p.id, p.base_id)
            for p in session.query(Proposal).filter_by(owner=owner, status="pending")
        ]
    # These are isolated verification data, never the user's personal memory proposals.
    for identifier, base in proposals:
        memory.decide(owner, identifier, "approve", base)
    with db.session() as session:
        jobs = [j.id for j in session.query(Job).filter_by(owner=owner, state="QUEUED")]
    for identifier in jobs:
        await memory.process(identifier)
    expected_memories = memory_checkpoint(db, owner)
    db.engine.dispose()
    db = Database(settings.database_url)
    try:
        persisted = memory_checkpoint(db, owner)
    except AppError as error:
        raise AppError(
            "SMOKE_PERSISTENCE", "重连后未读到重连前已确认保存的可检索事实。", 503
        ) from error
    if not expected_memories.issubset(persisted):
        raise AppError("SMOKE_PERSISTENCE", "重连前后的事实版本不一致，请检查数据库持久化。", 503)
    memory = MemoryService(db, provider, settings)
    retriever = Retriever(db, provider, settings)
    recalled = await retriever.search(owner, "default", "我喜欢怎样的回答？")
    if not recalled["items"]:
        raise AppError("SMOKE_RETRIEVAL", "真实检索没有召回刚写入的偏好。", 503)
    files = FileService(db, settings)
    files.upload(
        owner,
        second_id,
        "verification.md",
        "验收项目使用 PostgreSQL 和 pgvector 存储长期记忆。".encode(),
    )
    controller = ToolController(db, provider, memory, retriever, files)
    runtime = AgentRuntime(db, provider, memory, retriever, files, controller, settings)
    run_id = runtime.start(
        owner,
        ChatInput(
            conversation_id=second_id,
            text="这是集成验收。请依次调用 search_memory 查询我的回答偏好、search_files 阅读本会话文档，并 web_search 搜索 PostgreSQL pgvector 官方使用说明。根据三种来源简洁回答，分别引用个人记忆、文件和网页的证据 ID。不要保存这条。",
            request_id=uid(),
            memory_policy_override="skip",
        ),
    )
    task = runtime.tasks[run_id]
    await task
    with db.session() as session:
        run = session.get(Run, run_id)
        executions = session.query(ToolExecution).filter_by(run_id=run_id, status="SUCCEEDED").all()
        names = {item.name for item in executions}
        reply = session.get(Message, run.message_id) if run.message_id else None
        citations = reply.data.get("citations", []) if reply else []
        provider_ids = [
            item.get("provider_request_id")
            for item in run.data.get("usage", [])
            if item.get("provider_request_id")
        ]
        if (
            run.status != "SUCCEEDED"
            or not {"search_memory", "web_search"}.issubset(names)
            or not names.intersection({"read_file", "search_files"})
        ):
            raise AppError(
                "SMOKE_AGENT", "真实模型未完成要求的记忆、文件和网页工具调用；检查运行记录。", 503
            )
        if (
            not provider_ids
            or not any(i.startswith("file:") for i in citations)
            or not any(i.startswith("run:") for i in citations)
            or not any(i in {r["id"] for r in recalled["items"]} for i in citations)
        ):
            raise AppError("SMOKE_CITATIONS", "真实回答缺少调用凭据或三类可回查来源。", 503)
    # Exercise actual cloud summarization in an isolated verification conversation.
    compression_settings = settings.model_copy(update={"context_chars": 100})
    with db.session() as session:
        for index in range(8):
            session.add(
                Message(
                    owner=owner,
                    conversation_id=first_id,
                    role="user" if index % 2 == 0 else "assistant",
                    content=f"验收消息 {index}：保留事实出处、未来计划和未解决问题。",
                )
            )
    _, compressed = await ContextBuilder(db, provider, retriever, compression_settings).build(
        owner, first_id
    )
    with db.session() as session:
        summary = (
            session.query(Summary)
            .filter_by(owner=owner, conversation_id=first_id, valid=True)
            .first()
        )
        if not compressed or not summary or not summary.message_ids:
            raise AppError("SMOKE_SUMMARY", "未产生带原文引用的真实摘要。", 503)
    manifest = snapshot(db, owner)
    validate_manifest(manifest)
    db.engine.dispose()
    return {
        "verified": True,
        "verification_owner": owner,
        "run_id": run_id,
        "provider_request_ids": provider_ids,
        "persistence_snapshot": manifest,
        "checks": [
            "real Qwen extraction and embedding",
            "PostgreSQL reconnect persistence",
            "cross-conversation retrieval",
            "memory/file/web tool loop and citations",
            "real context compression",
        ],
        "not_checked": [
            "Independent process / OS / container restart; verify this report with app.persistence after exit/restart."
        ],
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="真实集成验收会消耗百炼额度，并写入独立 verification owner 的验收记录。"
    )
    parser.add_argument("--live", action="store_true")
    parser.add_argument(
        "--report", type=Path, help="将脱敏验收快照写入新文件，用于重启后的只读核对。"
    )
    args = parser.parse_args()
    if not args.live:
        parser.error("确认要执行真实调用后传入 --live；本命令没有模拟降级。")
    if args.report and (args.report.exists() or not args.report.parent.is_dir()):
        parser.error("报告路径必须是已有目录下的新文件，不覆盖已有验收报告。")
    try:
        report = json.dumps(asyncio.run(verify()), ensure_ascii=False, indent=2)
        if args.report:
            with args.report.open("x", encoding="utf-8") as output:
                output.write(report)
        print(report)
    except AppError as error:
        print(json.dumps(error.body(), ensure_ascii=False, indent=2))
        raise SystemExit(1)
    except Exception:
        print("真实验收失败，请检查数据库连接、模型权限及本机配置；未输出敏感配置。")
        raise SystemExit(1)
