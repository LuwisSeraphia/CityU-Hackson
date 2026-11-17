"""Read-only readiness audit. Never emits personal text or deletes records."""

from pathlib import Path
import json
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "api"))

from sqlalchemy.orm import Session
from app.infrastructure.config import Settings
from app.infrastructure.db import Database, Source, Memory, Job, Conversation
from app.domain.memory.models import (
    Batch,
    CandidateRow,
    Profile,
    Evidence,
    MemoryMeta,
    Tombstone,
)


def audit(db, owner):
    with db.engine.connect() as connection:
        if connection.dialect.name == "postgresql":
            connection.exec_driver_sql("SET TRANSACTION READ ONLY")
        with Session(bind=connection) as session:
            models = [
                Conversation,
                Source,
                Memory,
                Job,
                Batch,
                CandidateRow,
                Profile,
                Evidence,
                MemoryMeta,
                Tombstone,
            ]
            counts = {
                model.__tablename__: session.query(model).filter_by(owner=owner).count()
                for model in models
            }
            old_sources = {
                j.source_id
                for j in session.query(Job).filter_by(owner=owner, kind="memory")
                if j.source_id
            }
            new_sources = {
                j.source_id
                for j in session.query(Job).filter_by(owner=owner, kind="memory_v2")
                if j.source_id
            }
            sources = {s.id for s in session.query(Source).filter_by(owner=owner)}
            memory_classes = {
                "legacy_only_provenance": 0,
                "v2_only_provenance": 0,
                "mixed_or_unknown_provenance": 0,
            }
            for memory in session.query(Memory).filter_by(owner=owner):
                ids = set(memory.source_ids)
                key = (
                    "legacy_only_provenance"
                    if ids and ids <= old_sources - new_sources
                    else "v2_only_provenance"
                    if ids and ids <= new_sources - old_sources
                    else "mixed_or_unknown_provenance"
                )
                memory_classes[key] += 1
            jobs = {}
            for job in session.query(Job).filter_by(owner=owner):
                key = f"{job.kind}:{job.state}"
                jobs[key] = jobs.get(key, 0) + 1
            return {
                "scope": "configured_owner_all_projects",
                "read_only": True,
                "counts": counts,
                "jobs": jobs,
                "source_provenance": {
                    "legacy_only": len(sources & (old_sources - new_sources)),
                    "v2_only": len(sources & (new_sources - old_sources)),
                    "mixed": len(sources & old_sources & new_sources),
                    "unknown": len(sources - old_sources - new_sources),
                },
                "memory_provenance": memory_classes,
                "deletion_authorized": False,
                "note": "Provenance counts are advisory, not deletion selectors. No personal text, IDs or credentials included.",
            }


if __name__ == "__main__":
    settings = Settings()
    db = Database(settings.database_url)
    try:
        report = audit(db, settings.owner_id)
        target = ROOT / "docs" / "memory-unification-readiness.json"
        target.write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        print(json.dumps(report, ensure_ascii=False, indent=2))
    finally:
        db.engine.dispose()
