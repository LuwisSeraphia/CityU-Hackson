"""Process queued memory jobs and recover work interrupted by restart."""

import asyncio

from sqlalchemy import text

from app.errors import AppError
from app.infrastructure.db import Job, Run


async def run_worker(state):
    db = state["db"]
    guard = None
    try:
        if db.engine.dialect.name == "postgresql":
            guard = db.engine.connect()
            if not guard.execute(text("SELECT pg_try_advisory_lock(717732)")).scalar():
                raise RuntimeError("Only one API worker may run")
        with db.session() as session:
            session.query(Job).filter_by(state="RUNNING").update({"state": "QUEUED"})
            interrupted = [r.id for r in session.query(Run).filter_by(status="RUNNING")]
        for identifier in interrupted:
            state["runtime"].finish_error(
                identifier,
                AppError("SERVER_RESTARTED", "服务重启中断了回答，请重试。", 503, "agent", True),
            )
        state["worker_ready"] = True
        while True:
            with db.session() as session:
                row = session.query(Job).filter_by(state="QUEUED").order_by(Job.created).first()
                identifier = row.id if row else None
            if identifier:
                if row.kind == "memory_v2":
                    await state["memory_v2"].process(identifier)
                elif row.kind == "profile_v2":
                    await state["memory_v2"].profiles.process_profile(identifier)
                elif row.kind == "index":
                    await state["index"].process(identifier)
                elif row.kind == "memory":
                    await state["memory"].process(identifier)
                else:
                    with db.session() as session:
                        unknown = session.get(Job, identifier)
                        unknown.state = "FAILED"
                        unknown.error = {"code": "UNKNOWN_JOB_KIND", "retryable": False}
            else:
                await asyncio.sleep(0.4)
    finally:
        state["worker_ready"] = False
        if guard:
            guard.execute(text("SELECT pg_advisory_unlock(717732)"))
            guard.close()
