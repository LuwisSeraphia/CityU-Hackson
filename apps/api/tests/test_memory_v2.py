import asyncio

import pytest

from app.db import Conversation, Database, Job, Memory, Source
from app.errors import AppError
from app.memory_v2.models import Batch, CandidateRow, Evidence, Profile
from app.memory_v2.schemas import Decisions, Deletion, PolicyChange
from app.memory_v2.service import MemoryV2


class Provider:
    def __init__(self, candidates, mixed=False):
        self.value = {"candidates": candidates, "mixed_narrative": mixed}

    async def structured(self, *args):
        return self.value


def candidate(text="我喜欢安静", **overrides):
    return {
        "kind": "fact",
        "title": "环境偏好",
        "content": text,
        "subject": "self",
        "predicate": "preference.environment",
        "evidence": text,
        "context": {},
        "assertion_kind": "explicit",
        "temporal_status": "active",
        "event_time": None,
        "sensitivity": "normal",
        "profile_category": "lifestyle",
        **overrides,
    }


def setup(candidates, mixed=False):
    db = Database("sqlite://", testing=True)
    db.migrate()
    with db.session() as session:
        conv = Conversation(owner="a")
        session.add(conv)
        session.flush()
        cid = conv.id
    return db, MemoryV2(db, Provider(candidates, mixed)), cid


def submit(service, cid, text="我喜欢安静", key="test"):
    result = service.enqueue("a", cid, text, key)
    asyncio.run(service.process(result["job_id"]))
    return result


def test_explicit_record_and_evidence_are_indexed_in_existing_store():
    db, service, cid = setup([candidate()])
    result = submit(service, cid)
    with db.session() as session:
        assert session.get(Job, result["job_id"]).state == "SUCCEEDED"
        memory = session.query(Memory).one()
        evidence = session.query(Evidence).one()
        assert memory.content == "我喜欢安静"
        assert evidence.start == 0 and evidence.end == 5
        assert session.query(Profile).one().state == "active"
        assert session.query(Job).filter_by(kind="index").count() == 1


def test_sensitive_candidate_requires_idempotent_confirmation():
    db, service, cid = setup([candidate(sensitivity="private")], mixed=True)
    submit(service, cid)
    with db.session() as session:
        assert session.query(Memory).count() == session.query(Profile).count() == 0
        batch, row = session.query(Batch).one(), session.query(CandidateRow).one()
        bid, rid = batch.id, row.id
    body = Decisions(
        request_id="accept",
        expected_revision=1,
        decisions=[
            {"candidate_id": rid, "expected_revision": 1, "action": "accept", "defer_profile": True}
        ],
    )
    assert service.decisions("a", bid, body) == service.decisions("a", bid, body)
    with db.session() as session:
        assert session.query(Memory).count() == 1
        assert session.query(Profile).count() == 0


def test_turning_policy_off_cancels_inflight_extraction():
    db, service, cid = setup([candidate()])
    service.policy("a", cid, PolicyChange(request_id="on", expected_revision=1, mode="on"))
    result = service.enqueue("a", cid, "我喜欢安静", "automatic", automatic=True, policy_revision=2)
    service.policy("a", cid, PolicyChange(request_id="off", expected_revision=2, mode="off"))
    asyncio.run(service.process(result["job_id"]))
    with db.session() as session:
        assert session.get(Job, result["job_id"]).state == "CANCELLED"
        assert session.query(Memory).count() == 0


def test_wrong_quote_fails_closed():
    db, service, cid = setup([candidate(evidence="不存在")])
    result = submit(service, cid)
    with db.session() as session:
        assert session.get(Job, result["job_id"]).state == "FAILED"
        assert session.query(Memory).count() == 0


def test_delete_withdraws_source_and_clears_profile_and_quote():
    db, service, cid = setup([candidate()])
    result = submit(service, cid)
    with db.session() as session:
        mid = session.query(Memory).one().id
    body = Deletion(
        request_id="delete",
        scope="erase_records",
        targets=[{"type": "memory", "id": mid, "expected_revision": 1}],
    )
    assert service.delete("a", body)["state"] == "completed"
    with db.session() as session:
        assert session.get(Memory, mid).content == ""
        assert session.get(Source, result["source_id"]).content == ""
        assert session.query(Profile).one().content == ""
        assert session.query(Evidence).count() == 0


def test_owner_and_revision_boundaries():
    db, service, cid = setup([candidate()])
    with pytest.raises(AppError) as exc:
        service.policy("b", cid, PolicyChange(request_id="x", expected_revision=1, mode="on"))
    assert exc.value.status == 404
    service.policy("a", cid, PolicyChange(request_id="x", expected_revision=1, mode="on"))
    with pytest.raises(AppError) as exc:
        service.policy("a", cid, PolicyChange(request_id="y", expected_revision=1, mode="off"))
    assert exc.value.status == 409


def test_duplicate_request_does_not_extract_twice():
    db, service, cid = setup([candidate()])
    result = submit(service, cid)
    assert service.enqueue("a", cid, "我喜欢安静", "test")["job_id"] == result["job_id"]
    with pytest.raises(AppError):
        service.enqueue("a", cid, "不同内容", "test")
    with db.session() as session:
        assert session.query(Memory).count() == 1


def test_distinct_episode_does_not_replace_previous_episode():
    first = candidate(kind="episode", profile_category=None)
    db, service, cid = setup([first])
    submit(service, cid, key="first")
    service.provider.value = {
        "candidates": [candidate("今天去散步", kind="episode", profile_category=None)],
        "mixed_narrative": False,
    }
    submit(service, cid, text="今天去散步", key="second")
    with db.session() as session:
        assert session.query(Memory).filter_by(status="current").count() == 2


def test_third_party_and_inferences_never_auto_become_user_profile():
    db, service, cid = setup([candidate(subject="小王")])
    submit(service, cid)
    with db.session() as session:
        assert session.query(Memory).count() == 0
        assert session.query(Profile).count() == 0
        assert session.query(Batch).one().state == "pending"


def test_policy_change_during_provider_call_cancels_commit():
    db, service, cid = setup([candidate()])
    service.policy("a", cid, PolicyChange(request_id="on", expected_revision=1, mode="on"))
    original = service.provider.structured

    async def cancel_during_call(*args):
        service.policy("a", cid, PolicyChange(request_id="off", expected_revision=2, mode="off"))
        return await original(*args)

    service.provider.structured = cancel_during_call
    result = service.enqueue("a", cid, "我喜欢安静", "racing", automatic=True, policy_revision=2)
    asyncio.run(service.process(result["job_id"]))
    with db.session() as session:
        assert session.get(Job, result["job_id"]).state == "CANCELLED"
        assert session.query(Memory).count() == 0


def test_archive_roundtrip_and_checksum(tmp_path):
    from app.config import Settings
    from app.memory_v2.portability import Portability, export_archive, validate_archive

    db, service, cid = setup([candidate()])
    submit(service, cid)
    archive, epoch = export_archive(db, "a")
    assert len(validate_archive(archive)["memory_versions"]) == 1
    target = Database("sqlite://", testing=True)
    target.migrate()
    port = Portability(target, Settings(storage_dir=str(tmp_path), _env_file=None))
    job = port.create("b", "import", archive)
    assert port.restore("b", job["job_id"], 1)["index_status"] == "pending"
    assert port.restore("b", job["job_id"], 1)["state"] == "completed"
    with target.session() as session:
        assert session.query(Memory).filter_by(owner="b").one().content == "我喜欢安静"
        assert session.query(Profile).filter_by(owner="b").one().state == "active"
    merge = port.create("b", "import", archive)
    conflicts = merge["report"]["conflicts"]
    assert conflicts
    assert all("local_preview" in c and "import_preview" in c for c in conflicts)
    with pytest.raises(AppError) as error:
        port.restore("b", merge["job_id"], 2, mode="merge")
    assert error.value.code == "IMPORT_CONFLICTS"
    port.restore(
        "b",
        merge["job_id"],
        2,
        mode="merge",
        resolutions=[{"conflict_id": c["conflict_id"], "action": "keep_local"} for c in conflicts],
    )
    with target.session() as session:
        assert session.query(Memory).filter_by(owner="b").count() == 1
    with pytest.raises(AppError):
        validate_archive(b"not a zip")


def test_api_policy_batch_and_ownership(tmp_path):
    from fastapi.testclient import TestClient
    from app.config import Settings
    from app.main import create_app

    db, service, cid = setup([candidate(sensitivity="private")], mixed=True)
    settings = Settings(
        api_token="test",
        owner_id="a",
        worker_enabled=False,
        memory_v2_enabled=True,
        storage_dir=str(tmp_path),
        _env_file=None,
    )
    app = create_app(settings, database=db, provider=service.provider)
    headers = {"Authorization": "Bearer test"}
    with TestClient(app) as client:
        assert client.get("/api/v2/profiles").status_code == 401
        assert (
            client.get("/api/v2/conversations/missing/memory-policy", headers=headers).status_code
            == 404
        )
        response = client.patch(
            f"/api/v2/conversations/{cid}/memory-policy",
            headers=headers,
            json={"request_id": "on", "expected_revision": 1, "mode": "on"},
        )
        assert response.status_code == 200, response.text
        response = client.post(
            "/api/v2/memory/records",
            headers=headers,
            json={"request_id": "input", "conversation_id": cid, "text": "我喜欢安静"},
        )
        assert response.status_code == 202, response.text
        job_id = response.json()["job_id"]
        asyncio.run(service.process(job_id))
        jobs = client.get(f"/api/v2/conversations/{cid}/memory-jobs", headers=headers)
        assert jobs.status_code == 200
        assert jobs.json()["items"][0]["id"] == job_id
        assert jobs.json()["items"][0]["batch_id"]
        assert client.get(f"/api/v2/conversations/{cid}/memory-jobs").status_code == 401
        assert client.get("/api/v2/conversations/missing/memory-jobs", headers=headers).status_code == 404
        response = client.get("/api/v2/memory/batches", headers=headers)
        bid = response.json()["items"][0]["id"]
        batch = client.get(f"/api/v2/memory/batches/{bid}", headers=headers).json()
        row = batch["candidates"][0]
        response = client.post(
            f"/api/v2/memory/batches/{bid}/decisions",
            headers=headers,
            json={
                "request_id": "confirm",
                "expected_revision": 1,
                "decisions": [
                    {"candidate_id": row["id"], "expected_revision": 1, "action": "accept"}
                ],
            },
        )
        assert response.status_code == 200, response.text
        assert len(client.get("/api/v2/profiles", headers=headers).json()["items"]) == 1


def test_mixed_safe_candidates_auto_save_while_private_candidate_waits():
    db, service, cid = setup([
        candidate(),
        candidate("我喜欢爵士", predicate="preference.music"),
        candidate("我的住址保密", predicate="address", sensitivity="private"),
    ], mixed=True)
    submit(service, cid, "我喜欢安静。我喜欢爵士。我的住址保密")
    with db.session() as session:
        assert session.query(Memory).count() == 2
        assert session.query(Profile).filter_by(state="active").count() == 2
        assert session.query(Batch).one().state == "partial"
        assert session.query(CandidateRow).filter_by(state="pending").count() == 1


def test_relative_event_uses_original_message_time_and_preserves_preference():
    from app.db import Message
    from app.memory_v2.models import MemoryMeta
    text = "今天心情不好，听了无意。这种时候喜欢听R&B"
    db, service, cid = setup([
        candidate("今天心情不好，听了无意", kind="episode", predicate="listening", profile_category=None),
        candidate("这种时候喜欢听R&B", predicate="preference.music"),
    ])
    with db.session() as session:
        message = Message(owner="a", conversation_id=cid, role="user", content=text, created="2026-11-05T16:30:00+00:00")
        session.add(message)
        session.flush()
        mid = message.id
    result = service.enqueue("a", cid, text, "dated", message_id=mid)
    asyncio.run(service.process(result["job_id"]))
    with db.session() as session:
        event = session.query(Memory).filter_by(kind="episode").one()
        assert event.event_time == "2026-11-06"
        meta = session.query(MemoryMeta).filter_by(memory_id=event.id).one().data
        assert meta["recorded_at"] == "2026-11-05T16:30:00+00:00"
        assert meta["event_time_precision"] == "day"
        assert session.query(Profile).one().content == "这种时候喜欢听R&B"


@pytest.mark.parametrize("reason,previous_status", [("change", "historical"), ("correction", "corrected")])
def test_conflict_confirmation_versions_and_invalidates_profile(reason, previous_status):
    db, service, cid = setup([candidate()])
    submit(service, cid)
    service.provider.value = {"candidates": [candidate("我喜欢热闹")]}
    submit(service, cid, "我喜欢热闹", "second")
    with db.session() as session:
        row = session.query(CandidateRow).filter_by(state="pending").one()
        bid, rid = row.batch_id, row.id
        assert "conflicting_fact" in row.data["review_reasons"]
    body = Decisions(request_id="decision", expected_revision=1, decisions=[
        {"candidate_id": rid, "expected_revision": 1, "action": "accept", "reason": reason}
    ])
    assert service.decisions("a", bid, body) == service.decisions("a", bid, body)
    with db.session() as session:
        assert session.query(Memory).filter_by(content="我喜欢安静").one().status == previous_status
        assert session.query(Memory).filter_by(status="current").one().version == 2
        assert session.query(Profile).filter_by(content="我喜欢安静").one().state == "paused"
        assert session.query(Profile).filter_by(state="active").one().content == "我喜欢热闹"


def test_same_batch_claims_wait_without_failing_entire_job():
    db, service, cid = setup([candidate(), candidate("我喜欢热闹")])
    result = submit(service, cid, "我喜欢安静。我喜欢热闹")
    with db.session() as session:
        assert session.get(Job, result["job_id"]).state == "SUCCEEDED"
        assert session.query(Memory).count() == 0
        assert session.query(CandidateRow).filter_by(state="pending").count() == 2


def test_relative_dates_timezone_and_unknown_dates():
    from app.domain.memory.decision_policy import time_fields, transient
    from app.domain.memory.schemas import Record
    from pydantic import ValidationError
    data = candidate("昨天听了歌", kind="episode")
    assert time_fields(data, "2026-01-01T01:00:00+00:00", "America/New_York")["event_time"] == "2025-12-30"
    assert time_fields(candidate("曾听过歌", kind="episode"), "2026-01-01T01:00:00+00:00")["event_time"] is None
    assert transient(candidate("今天心情不好", profile_category="personality"))
    assert not transient(candidate("心情不好时喜欢听R&B", evidence="今天心情不好时喜欢听R&B"))
    with pytest.raises(ValidationError):
        Record(request_id="x", conversation_id="x", text="x", timezone="invalid")


def test_retrieval_includes_event_time_precision_without_inventing_hour():
    from app.config import Settings
    from app.domain.retrieval.service import Retriever
    db, service, cid = setup([candidate("今天听了无意", kind="episode", profile_category=None)])
    submit(service, cid, "今天听了无意")
    result = asyncio.run(Retriever(db, service.provider, Settings(memory_v2_enabled=True, _env_file=None)).search("a", "default", "无意"))
    item = result["items"][0]
    assert len(item["event_time"]) == 10
    assert item["event_time_precision"] == "day"
    assert item["event_timezone"] == "Asia/Shanghai"
    assert "T" in item["recorded_at"]
