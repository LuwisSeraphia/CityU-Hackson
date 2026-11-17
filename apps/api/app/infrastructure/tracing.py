"""Request-local telemetry, never a model-generated explanation."""

import time
from contextvars import ContextVar

from sqlalchemy import or_

from app.domain.memory.job_status import job_view
from app.domain.memory.models import Evidence, Profile, Withdrawal
from app.infrastructure.db import Job, Memory, Run, Source, Suppression, owned

calls = ContextVar("provider_calls", default=None)
last_call = ContextVar("last_provider_call", default=None)


def trace_view(db, owner, identifier):
    with db.session() as session:
        run = owned(session, Run, identifier, owner)
        trace = dict(run.data.get("trace_v1") or {})
        if not trace:
            return {
                "availability": "legacy_unavailable",
                "run_id": identifier,
                "status": run.status,
            }
        cutoff = max(
            (s.created for s in session.query(Suppression).filter_by(owner=owner)), default=""
        )
        # No text snapshots are persisted here. Resolve visible records at read time.
        redacted_run = bool(cutoff and run.created <= cutoff)
        for key in ("injected", "cited"):
            visible = []
            for item in trace.get(key, []):
                kind = item.get("kind") or (
                    "profile" if session.get(Profile, item["id"]) else "memory"
                )
                if item["id"].startswith("source:"):
                    visible.append(source_ref(session, owner, item, redacted_run))
                    continue
                row = session.get(Profile if kind == "profile" else Memory, item["id"])
                hidden = redacted_run or not row or row.owner != owner
                hidden = hidden or getattr(row, "status", getattr(row, "state", "")) == "deleted"
                # Profile contents are mutable: never label today's revision as the old input.
                material_id = item.get("material_id") or next(
                    (
                        ref.get("material_id")
                        for ref in trace.get("injected", [])
                        if ref["id"] == item["id"]
                    ),
                    None,
                )
                if kind == "profile" and row:
                    hidden = hidden or material_id != f"profile:{row.id}:{row.revision}"
                evidence_id = None
                if not hidden:
                    if kind == "profile":
                        # A profile opens its supporting memory, never an unrelated ID.
                        for mid in row.evidence_ids:
                            memory = session.get(Memory, mid)
                            if memory and memory.owner == owner and memory.status != "deleted":
                                evidence_id = mid
                                break
                    else:
                        evidence_id = row.id
                visible.append(
                    {
                        **item,
                        "kind": kind,
                        "redacted": bool(hidden),
                        "title": None if hidden else getattr(row, "title", row.content),
                        "evidence_id": evidence_id,
                    }
                )
            trace[key] = visible
        if redacted_run:
            trace["retrievals"] = []
            trace.pop("intent", None)
            trace.pop("information", None)
        plan = run.data.get("context_plan", {})
        if not redacted_run:
            trace["profile_context"] = {
                key: plan.get(key)
                for key in ("profile_review_scope", "profile_selection", "profile_digest")
            }
        source_ids = session.query(Source.id).filter_by(owner=owner, message_id=run.user_message_id)
        jobs = (
            []
            if not run.user_message_id
            else session.query(Job)
            .filter(
                Job.owner == owner,
                or_(Job.message_id == run.user_message_id, Job.source_id.in_(source_ids)),
            )
            .order_by(Job.created.desc())
            .all()
        )
        job = next((j for j in jobs if j.kind in ("memory", "memory_v2")), None)
        trace["memory_job"] = {
            "status": job.state if job else "not_started",
            "stage": job.stage if job else None,
            "job_id": job.id if job else None,
        }
        trace["background_jobs"] = [] if redacted_run else [job_view(session, j) for j in jobs]
        return {**trace, "availability": "recorded", "run_id": identifier, "status": run.status}


def clock():
    return time.monotonic()


def source_ref(session, owner, item, redacted):
    """Resolve only a verified span; a whole source may contain unrelated private text."""
    result = {**item, "kind": "source", "redacted": True, "title": None, "evidence_id": None}
    if redacted:
        return result
    try:
        _, sid, start, end = item["id"].split(":")
        start, end = int(start), int(end)
    except (ValueError, TypeError):
        return result
    source = session.get(Source, sid)
    if not source or source.owner != owner or not 0 <= start < end <= len(source.content):
        return result
    if session.query(Withdrawal).filter_by(owner=owner, source_id=sid).first():
        return result
    evidence = (
        session.query(Evidence).filter_by(owner=owner, source_id=sid, start=start, end=end).all()
    )
    for span in evidence:
        memory = session.get(Memory, span.memory_id)
        if memory and memory.owner == owner and memory.status != "deleted":
            return {
                **result,
                "redacted": False,
                "title": source.content[start:end],
                "evidence_id": memory.id,
            }
    return result
