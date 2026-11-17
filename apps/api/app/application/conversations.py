"""Conversation lifecycle, separate from long-term memory erasure."""

from app.errors import AppError
from app.domain.memory.models import Tombstone, WorkingState
from app.infrastructure.db import (
    Conversation,
    Message,
    Run,
    Job,
    Source,
    Summary,
    ToolExecution,
    File,
    Chunk,
)


def delete_conversation(db, owner, identifier):
    with db.session() as session:
        # Lock the same row as Runtime.start so deletion cannot race a new Run.
        row = (
            session.query(Conversation)
            .filter_by(id=identifier, owner=owner)
            .with_for_update()
            .first()
        )
        if not row:
            raise AppError("NOT_FOUND", "对话不存在或无权访问。", 404)
        if (
            session.query(Tombstone)
            .filter_by(owner=owner, entity_type="conversation", original_id=identifier)
            .first()
        ):
            return {"id": identifier, "deleted": True}
        sources = session.query(Source.id).filter_by(owner=owner, conversation_id=identifier)
        if (
            session.query(Run)
            .filter_by(owner=owner, conversation_id=identifier, status="RUNNING")
            .first()
            or session.query(Job)
            .filter(
                Job.owner == owner, Job.source_id.in_(sources), Job.state.in_(["QUEUED", "RUNNING"])
            )
            .first()
        ):
            raise AppError("CONVERSATION_BUSY", "此对话仍有任务进行中，请等待完成后删除。", 409)
        runs = session.query(Run).filter_by(owner=owner, conversation_id=identifier).all()
        run_ids = [r.id for r in runs]
        session.query(ToolExecution).filter(
            ToolExecution.owner == owner, ToolExecution.run_id.in_(run_ids)
        ).delete(synchronize_session=False)
        for run in runs:
            run.data = {}
        for message in session.query(Message).filter_by(owner=owner, conversation_id=identifier):
            message.content, message.data = "", {"deleted": True}
        session.query(Summary).filter_by(owner=owner, conversation_id=identifier).delete()
        session.query(WorkingState).filter_by(owner=owner, conversation_id=identifier).delete()
        file_ids = [
            f.id for f in session.query(File).filter_by(owner=owner, conversation_id=identifier)
        ]
        session.query(Chunk).filter(Chunk.owner == owner, Chunk.file_id.in_(file_ids)).delete(
            synchronize_session=False
        )
        session.query(File).filter_by(owner=owner, conversation_id=identifier).delete()
        row.title = "已删除对话"
        session.add(Tombstone(owner=owner, entity_type="conversation", original_id=identifier))
        return {"id": identifier, "deleted": True}
