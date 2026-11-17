import asyncio
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

from app.config import Settings
from app.db import Conversation, Database, Memory, Message, Run, Source, Summary, ToolExecution, uid
from app.errors import AppError
from app.files import FileService
from app.memory import MemoryService
from app.persistence import snapshot, validate_manifest, verify_snapshot
from test_memory import FakeProvider, candidate


def seeded(tmp_path):
    url = "sqlite:///" + str(tmp_path / "persistence.db")
    db = Database(url, testing=True)
    db.migrate()
    owner = "verification-" + uid()
    settings = Settings(embedding_dimensions=3, _env_file=None)
    with db.session() as session:
        conversation = Conversation(owner=owner)
        session.add(conversation)
        session.flush()
        cid = conversation.id
    provider = FakeProvider()
    provider.candidates = [candidate()]
    memory = MemoryService(db, provider, settings)
    job = memory.enqueue(owner, cid, "我喜欢简洁回答", "persist")
    asyncio.run(memory.process(job))
    FileService(db, settings).upload(owner, cid, "probe.md", "合成资料".encode())
    with db.session() as session:
        message = session.query(Message).filter_by(owner=owner).first()
        run = Run(
            owner=owner,
            conversation_id=cid,
            request_key="run",
            status="SUCCEEDED",
            message_id=message.id,
        )
        session.add(run)
        session.flush()
        session.add(
            ToolExecution(
                owner=owner, run_id=run.id, call_id="test", name="search_memory", status="SUCCEEDED"
            )
        )
        session.add(
            Summary(owner=owner, conversation_id=cid, content="合成摘要", message_ids=[message.id])
        )
    return db, url, owner


def test_persisted_snapshot_survives_a_new_python_process(tmp_path):
    db, url, owner = seeded(tmp_path)
    manifest = snapshot(db, owner)
    validate_manifest(manifest)
    assert "我喜欢简洁回答" not in json.dumps(manifest, ensure_ascii=False)
    assert "合成资料" not in json.dumps(manifest, ensure_ascii=False)
    db.engine.dispose()
    # SQLite is an explicitly selected test double; the production CLI never permits it.
    code = """import json, os, sys
from app.db import Database
from app.persistence import verify_snapshot
value = json.load(sys.stdin)
db = Database(value['url'], testing=True)
result = verify_snapshot(db, value['manifest'])
result['pid'] = os.getpid()
db.engine.dispose()
print(json.dumps(result))
"""
    child = subprocess.run(
        [sys.executable, "-c", code],
        cwd=Path(__file__).resolve().parents[1],
        input=json.dumps({"url": url, "manifest": manifest}),
        text=True,
        capture_output=True,
        timeout=30,
        check=True,
        encoding="utf-8",
        env={**os.environ, "PYTHONIOENCODING": "utf-8"},
    )
    result = json.loads(child.stdout)
    assert result["verified"] and result["pid"] != os.getpid()
    assert result["table_counts"]["memory_versions"] == 1


def test_fingerprints_detect_same_count_changes_and_deletion_but_ignore_other_owner(tmp_path):
    db, _, owner = seeded(tmp_path)
    manifest = snapshot(db, owner)
    with db.session() as session:
        session.add(Conversation(owner="unrelated-user", title="不在验收范围"))
    assert verify_snapshot(db, manifest)["verified"]
    with db.session() as session:
        session.query(Memory).filter_by(owner=owner).one().embedding = [0.0, 1.0, 0.0]
        session.query(Source).filter_by(owner=owner).one().content = "同条数但内容已变化"
        session.query(Summary).filter_by(owner=owner).delete()
    result = verify_snapshot(db, manifest)
    assert not result["verified"]
    assert set(result["changed_tables"]) == {
        "memory_versions",
        "source_records",
        "conversation_summaries",
    }
    assert "同条数但内容已变化" not in str(result)


def test_empty_snapshot_invalid_owner_and_incomplete_report_are_rejected(tmp_path):
    db = Database("sqlite://", testing=True)
    db.migrate()
    with pytest.raises(AppError, match="verification"):
        snapshot(db, "local-user")
    empty = snapshot(db, "verification-" + uid())
    with pytest.raises(AppError, match="完整"):
        verify_snapshot(db, empty)
    with pytest.raises(AppError, match="格式"):
        validate_manifest(None)
    empty["tables"].pop("memory_versions")
    with pytest.raises(AppError, match="不匹配"):
        verify_snapshot(db, empty)
