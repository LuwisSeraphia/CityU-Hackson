"""Exercise V2 against a disposable PostgreSQL schema, never personal rows."""

import argparse
import asyncio
import json
import re
import sys
from pathlib import Path
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "apps" / "api"))

from app.config import settings
from app.db import Base, Conversation, Database, Job, Memory
from app.knowledge import models as knowledge_models  # noqa: F401
from app.memory_v2.models import Profile
from app.memory_v2.schemas import Deletion
from app.memory_v2.service import MemoryV2
from sqlalchemy import text
from sqlalchemy.orm import sessionmaker


class Provider:
    async def structured(self, instruction, content):
        return {
            "mixed_narrative": False,
            "candidates": [
                {
                    "kind": "fact",
                    "title": "测试偏好",
                    "content": content,
                    "subject": "self",
                    "predicate": "preference.communication",
                    "evidence": content,
                    "temporal_status": "active",
                    "profile_category": "communication",
                }
            ],
        }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--live",
        action="store_true",
        help="Use Qwen for one synthetic extraction (billable)",
    )
    args = parser.parse_args()
    schema = "verification_v2_" + uuid4().hex
    assert re.fullmatch(r"verification_v2_[0-9a-f]{32}", schema)
    db = Database(settings.database_url)
    original_engine = db.engine
    created = False
    try:
        with original_engine.begin() as conn:
            conn.execute(text(f'CREATE SCHEMA "{schema}"'))
            created = True
        db.engine = original_engine.execution_options(
            schema_translate_map={None: schema}
        )
        db.sessions = sessionmaker(db.engine, expire_on_commit=False)
        Base.metadata.create_all(db.engine)
        with db.session() as session:
            row = Conversation(owner="verification-v2")
            session.add(row)
            session.flush()
            cid = row.id
        if args.live:
            from app.memory_v2.schemas import Extraction
            from app.providers import QwenProvider

            class CheckedProvider(QwenProvider):
                async def structured(self, instruction, content):
                    result = await super().structured(instruction, content)
                    try:
                        Extraction.model_validate(result)
                    except Exception:
                        print(
                            json.dumps(
                                {"synthetic_validation_output": result},
                                ensure_ascii=True,
                            )
                        )
                        raise
                    return result

            provider = CheckedProvider(settings)
        else:
            provider = Provider()
        service = MemoryV2(db, provider)
        result = service.enqueue("verification-v2", cid, "我喜欢简洁回答", "pg-record")
        asyncio.run(service.process(result["job_id"]))
        with db.session() as session:
            job = session.get(Job, result["job_id"])
            if job.state != "SUCCEEDED":
                raise RuntimeError(json.dumps({"state": job.state, "error": job.error}))
            memory = session.query(Memory).one()
            mid = memory.id
            assert memory.content and "简洁" in memory.content
            assert session.query(Profile).one().state == "active"
        service.delete(
            "verification-v2",
            Deletion(
                request_id="pg-delete",
                scope="erase_records",
                targets=[{"type": "memory", "id": mid, "expected_revision": 1}],
            ),
        )
        with db.session() as session:
            assert session.get(Memory, mid).status == "deleted"
            assert session.query(Profile).one().content == ""
        print(
            json.dumps(
                {
                    "database": "PostgreSQL",
                    "isolated_schema": True,
                    "provider": "Qwen" if args.live else "fixture",
                    "write_profile_delete": "passed",
                }
            )
        )
    finally:
        if created:
            with original_engine.begin() as conn:
                conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        original_engine.dispose()


if __name__ == "__main__":
    main()
