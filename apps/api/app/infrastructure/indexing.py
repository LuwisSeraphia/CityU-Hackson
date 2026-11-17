"""Index committed versions without allowing stale model results to overwrite them."""

from app.errors import AppError
from app.infrastructure.db import Job, Memory, now
from app.domain.memory.models import Withdrawal


class IndexService:
    def __init__(self, db, provider, settings):
        self.db, self.provider, self.settings = db, provider, settings

    async def process(self, job_id):
        """Own standalone index jobs; no extraction or legacy message receipts."""
        with self.db.session() as session:
            job = session.query(Job).filter_by(id=job_id).with_for_update().first()
            if not job or job.kind != "index" or job.state != "QUEUED":
                return
            job.state, job.stage, job.updated = "RUNNING", "INDEXING", now()
        try:
            targets = await self.update(job_id)
            with self.db.session() as session:
                job = session.query(Job).filter_by(id=job_id).with_for_update().one()
                if job.state == "CANCELLED":
                    return
                job.state, job.stage, job.error, job.updated = (
                    "SUCCEEDED",
                    "INDEXED" if targets else "NOOP",
                    None,
                    now(),
                )
        except Exception as error:
            with self.db.session() as session:
                job = session.query(Job).filter_by(id=job_id).with_for_update().one()
                if job.state == "CANCELLED":
                    return
                job.state, job.error, job.updated = (
                    "FAILED",
                    {
                        "code": error.code if isinstance(error, AppError) else "INDEX_FAILED",
                        "message": "记忆已保存，索引更新失败。",
                        "retryable": True,
                    },
                    now(),
                )
                session.query(Memory).filter(
                    Memory.owner == job.owner,
                    Memory.id.in_(job.payload.get("memory_ids", [])),
                    Memory.status != "deleted",
                    Memory.index_status != "READY",
                ).update({"index_status": "FAILED"}, synchronize_session=False)

    async def update(self, job_id):
        with self.db.session() as session:
            job = session.get(Job, job_id)
            if not job or job.state == "CANCELLED":
                return []
            rows = (
                session.query(Memory)
                .filter(
                    Memory.owner == job.owner,
                    Memory.id.in_(job.payload.get("memory_ids", [])),
                    Memory.status != "deleted",
                )
                .all()
            )
            targets = [(row.id, row.version, row.content) for row in rows]
        vectors = (
            await self.provider.embed([content for _, _, content in targets]) if targets else []
        )
        if len(vectors) != len(targets):
            raise AppError("EMBEDDING_INVALID", "索引向量数量与记忆数量不匹配。", 502)
        updated = []
        with self.db.session() as session:
            job = session.get(Job, job_id)
            if job.state == "CANCELLED":
                return []
            if (
                job.source_id
                and session.query(Withdrawal)
                .filter_by(owner=job.owner, source_id=job.source_id)
                .first()
            ):
                job.state = "CANCELLED"
                return []
            for (identifier, version, content), vector in zip(targets, vectors):
                row = (
                    session.query(Memory)
                    .filter_by(id=identifier, owner=job.owner)
                    .with_for_update()
                    .first()
                )
                if (
                    not row
                    or row.status == "deleted"
                    or row.version != version
                    or row.content != content
                ):
                    continue
                row.embedding, row.index_status = vector, "READY"
                row.embedding_model = self.settings.embedding_model
                updated.append((identifier, content))
        return updated
