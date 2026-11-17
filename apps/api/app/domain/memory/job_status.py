"""Read-only job projection shared by task lists and run traces."""

from app.domain.memory.models import Batch, CandidateRow


def job_view(session, job):
    batch_id = job.payload.get("batch_id")
    batch = session.get(Batch, batch_id) if batch_id else None
    if batch and batch.owner != job.owner:
        batch = None
    count = (
        session.query(CandidateRow).filter_by(owner=job.owner, batch_id=batch.id).count()
        if batch
        else None
    )
    outcome = None
    if batch:
        outcome = "no_candidates" if count == 0 else batch.state
    return {
        "id": job.id,
        "kind": job.kind,
        "state": job.state,
        "status": job.state,
        "stage": job.stage,
        "batch_id": batch.id if batch else None,
        "outcome": outcome,
        "error": job.error,
    }
