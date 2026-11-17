"""Coordinate automatic memory writes inside the successful reply transaction."""

from app.domain.memory.service import MemoryV2


class MemoryWriteCoordinator:
    def __init__(self, db, provider, legacy):
        self.db, self.provider, self.legacy = db, provider, legacy

    def complete_reply(self, session, run):
        data = run.data
        if data["skip_memory"]:
            return {"outcome": "skipped", "reason_code": "SKIP_REQUESTED", "job_id": None}
        arguments = (run.owner, run.conversation_id, data["text"], "auto:" + run.user_message_id)
        if data.get("memory_policy_revision") is not None:
            result = MemoryV2(self.db, self.provider).enqueue(
                *arguments,
                automatic=True,
                policy_revision=data["memory_policy_revision"],
                message_id=run.user_message_id,
                session=session,
            )
            if result:
                return {**result, "outcome": "queued", "reason_code": None}
        else:
            job_id = self.legacy.enqueue(
                *arguments,
                automatic=True,
                message_id=run.user_message_id,
                epoch=data["epoch"],
                session=session,
            )
            if job_id:
                return {"job_id": job_id, "outcome": "queued", "reason_code": None}
        return {"job_id": None, "outcome": "skipped", "reason_code": "MEMORY_NOT_AUTHORIZED"}
