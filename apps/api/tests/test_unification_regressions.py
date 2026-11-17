"""Regressions for atomic writes and material-level evidence isolation."""

import asyncio

import pytest

from app.application.context.plan import ContextPlan
from app.infrastructure.indexing import IndexService
from app.config import Settings
from app.db import Job, Memory, Source
from app.domain.memory.access import source_materials
from app.domain.memory.models import Evidence
from test_memory_v2 import setup, candidate, submit


def test_enqueue_participates_in_caller_transaction():
    db, service, cid = setup([candidate()])
    with pytest.raises(RuntimeError):
        with db.session() as session:
            service.enqueue("a", cid, "我喜欢安静", "rollback", session=session)
            raise RuntimeError("reply persistence failed")
    with db.session() as session:
        assert session.query(Source).count() == 0
        assert session.query(Job).count() == 0


def test_shared_source_returns_only_verified_span():
    db, service, cid = setup([candidate()])
    submit(service, cid)
    with db.session() as session:
        memory = session.query(Memory).one()
        source = session.query(Source).one()
        source.content += " 其他人的私密资料"
        items = source_materials(session, "a", memory, "查看原文")
        assert len(items) == 1
        assert items[0]["content"] == "我喜欢安静"
        assert items[0]["id"].startswith("source:")
        assert source_materials(session, "other", memory, "查看原文") == []


def test_material_types_do_not_hide_fact_or_second_source():
    plan = ContextPlan(
        None, Settings(_env_file=None), "a", "default", "", {"memory_budget_tokens": 6400}
    )
    materials = [
        {"id": "p", "material_id": "profile:p:1", "fact_id": "f", "content": "偏好"},
        {"id": "m", "version": 1, "fact_id": "f", "content": "事实"},
        {"id": "s1", "material_id": "source:s1:0:2", "content": "原文"},
        {"id": "s2", "material_id": "source:s2:0:2", "content": "原文"},
    ]
    assert plan.select(materials) == materials
    assert plan.select(materials) == []


def test_indexing_cannot_restore_deleted_memory_after_embed():
    db, service, cid = setup([candidate()])
    submit(service, cid)
    with db.session() as session:
        jid = session.query(Job).filter_by(kind="index").one().id
        mid = session.query(Memory).one().id

    class Provider:
        async def embed(self, texts):
            with db.session() as session:
                session.get(Memory, mid).status = "deleted"
            return [[1.0, 0.0]]

    result = asyncio.run(IndexService(db, Provider(), Settings(_env_file=None)).update(jid))
    assert result == []
    with db.session() as session:
        assert session.get(Memory, mid).embedding is None


def test_invalid_evidence_offsets_fail_closed():
    db, service, cid = setup([candidate()])
    submit(service, cid)
    with db.session() as session:
        session.query(Evidence).one().end = 10000
    with db.session() as session:
        assert source_materials(session, "a", session.query(Memory).one(), "原文") == []


def test_tool_proposal_defers_without_creating_source_or_job():
    from app.application.tools import ToolController
    from app.domain.memory.models import Policy

    db, service, cid = setup([candidate()])
    with db.session() as session:
        session.add(Policy(owner="a", conversation_id=cid, mode="on"))
    controller = ToolController(db, service.provider, None, None, None)
    result = asyncio.run(
        controller.execute(
            "propose_memory",
            "{}",
            {
                "owner": "a",
                "conversation_id": cid,
                "skip_memory": False,
            },
        )
    )
    assert result["outcome"] == "deferred_until_reply"
    with db.session() as session:
        assert session.query(Source).count() == 0
        assert session.query(Job).count() == 0


def test_runtime_rejects_reused_request_with_changed_options():
    from fastapi.testclient import TestClient
    from app.main import create_app
    from app.db import Database
    from test_memory import FakeProvider

    db = Database("sqlite://", testing=True)
    settings = Settings(api_token="test", worker_enabled=False, _env_file=None)
    app = create_app(settings, database=db, provider=FakeProvider())
    with TestClient(app, headers={"Authorization": "Bearer test"}) as client:
        cid = client.post("/api/v1/conversations", json={}).json()["id"]
        request = {
            "conversation_id": cid,
            "text": "你好",
            "request_id": "same",
            "memory_policy_override": "skip",
        }
        assert client.post("/api/v1/agent/runs", json=request).status_code == 202
        request["memory_policy_override"] = "default"
        assert client.post("/api/v1/agent/runs", json=request).status_code == 409


def test_calibrated_retrieval_with_v2_filters_private_before_rerank():
    from app.domain.memory.models import MemoryMeta
    from app.domain.memory.access import request_context
    from app.domain.retrieval.service import Retriever

    db, _, _ = setup([])
    with db.session() as session:
        memory = Memory(
            owner="a", project="default", kind="episode", title="隐私", content="分手经历"
        )
        session.add(memory)
        session.flush()
        session.add(MemoryMeta(owner="a", memory_id=memory.id, data={"sensitivity": "private"}))

    class Provider:
        async def rerank(self, *args, **kwargs):
            raise AssertionError("private material reached reranker")

    settings = Settings(memory_v2_enabled=True, memory_retrieval_policy="v2", _env_file=None)
    token = request_context.set({"owner": "a", "text": "推荐午餐"})
    try:
        result = asyncio.run(Retriever(db, Provider(), settings).search("a", "default", "分手"))
    finally:
        request_context.reset(token)
    assert result["items"] == []
    assert result["diagnostics"]["actual_strategy"] == "hybrid_calibrated"


def test_trace_associates_jobs_through_source_and_resolves_profile_materials():
    from app.infrastructure.db import Run
    from app.domain.memory.models import Profile
    from app.infrastructure.tracing import trace_view

    db, service, cid = setup([candidate()])
    submit(service, cid)
    with db.session() as session:
        source = session.query(Source).one()
        source.message_id = "user-message"
        memory = session.query(Memory).one()
        profile = Profile(
            owner="a",
            category="goal",
            origin="self_report",
            state="active",
            content="测试画像",
            evidence_ids=[memory.id],
        )
        session.add(profile)
        session.flush()
        run = Run(
            owner="a",
            conversation_id=cid,
            request_key="trace-test",
            user_message_id="user-message",
            status="SUCCEEDED",
            data={
                "trace_v1": {
                    "injected": [
                        {
                            "id": profile.id,
                            "kind": "profile",
                            "material_id": f"profile:{profile.id}:{profile.revision}",
                        }
                    ],
                    "cited": [{"id": profile.id}],
                }
            },
        )
        session.add(run)
        session.flush()
        rid, pid, mid = run.id, profile.id, memory.id
    trace = trace_view(db, "a", rid)
    assert trace["injected"][0]["title"] == "测试画像"
    assert trace["injected"][0]["evidence_id"] == mid
    assert trace["cited"][0]["kind"] == "profile"
    assert trace["memory_job"]["job_id"] is not None
    assert {j["kind"] for j in trace["background_jobs"]} >= {"memory_v2", "index", "profile_v2"}
    with db.session() as session:
        session.get(Profile, pid).revision += 1
    assert trace_view(db, "a", rid)["injected"][0]["redacted"]
    assert trace_view(db, "a", rid)["cited"][0]["redacted"]
    with db.session() as session:
        session.get(Profile, pid).owner = "other"
    assert trace_view(db, "a", rid)["cited"][0]["title"] is None


def test_trace_source_span_and_job_outcomes_are_not_guessed():
    from app.infrastructure.tracing import source_ref
    from app.domain.memory.job_status import job_view
    from app.domain.memory.models import Batch, Withdrawal

    db, service, cid = setup([candidate()])
    submit(service, cid)
    with db.session() as session:
        memory = session.query(Memory).one()
        span = session.query(Evidence).one()
        ref = {"id": f"source:{span.source_id}:{span.start}:{span.end}"}
        assert source_ref(session, "a", ref, False)["evidence_id"] == memory.id
        assert source_ref(session, "other", ref, False)["redacted"]
        job = session.query(Job).filter_by(kind="memory_v2").one()
        batch = session.query(Batch).one()
        batch.state = "rejected"
        assert job_view(session, job)["outcome"] == "rejected"
        session.add(Withdrawal(owner="a", source_id=span.source_id))
        session.flush()
        assert source_ref(session, "a", ref, False)["redacted"]


def test_standalone_index_job_finishes_without_legacy_service():
    db, service, cid = setup([candidate()])
    submit(service, cid)
    with db.session() as session:
        job = session.query(Job).filter_by(kind="index").one()
        identifier = job.id
    from test_memory import FakeProvider

    index = IndexService(db, FakeProvider(), Settings(_env_file=None))
    asyncio.run(index.process(identifier))
    with db.session() as session:
        job = session.get(Job, identifier)
        assert job.state == "SUCCEEDED" and job.stage == "INDEXED"
        assert session.query(Memory).one().index_status == "READY"
    asyncio.run(index.process(identifier))
    with db.session() as session:
        assert session.get(Job, identifier).state == "SUCCEEDED"


def test_standalone_index_failure_keeps_memory_and_marks_job_failed():
    class FailingEmbedding:
        async def embed(self, texts):
            raise RuntimeError("provider unavailable")

    db, service, cid = setup([candidate()])
    submit(service, cid)
    with db.session() as session:
        identifier = session.query(Job).filter_by(kind="index").one().id
    asyncio.run(IndexService(db, FailingEmbedding(), Settings(_env_file=None)).process(identifier))
    with db.session() as session:
        job = session.get(Job, identifier)
        assert job.state == "FAILED"
        assert job.error["code"] == "INDEX_FAILED"
        assert session.query(Memory).one().content == "我喜欢安静"
