import asyncio

import pytest

from app.config import Settings
from app.context import ContextBuilder
from app.db import (
    Conversation,
    Database,
    Fact,
    Job,
    Memory,
    Message,
    Proposal,
    Source,
    Summary,
    preference,
)
from app.errors import AppError
from app.memory import MemoryService
from app.retrieval import Retriever


class FakeProvider:
    """Deterministic test double only; production has no fake provider selection."""

    last_usage = {"provider_request_id": "test-only"}
    fail_index = False
    candidates = []

    def require(self):
        pass

    async def structured(self, instruction, content):
        if "回答证据审校器" in instruction:
            import json

            return {"answer": json.loads(content)["draft"]}
        if "relations" in instruction:
            import json

            data = json.loads(content)
            return {
                "relations": [
                    {"index": c["index"], "existing_id": None, "relation": "unrelated"}
                    for c in data["candidates"]
                ]
            }
        return {"candidates": self.candidates}

    async def embed(self, texts):
        if self.fail_index:
            raise AppError("TEST_INDEX_FAILURE", "test", 502)
        return [[1.0, 0.0, 0.0] for _ in texts]

    async def rerank(self, query, documents):
        return list(range(min(6, len(documents))))

    async def chat(self, messages, **kwargs):
        return {"role": "assistant", "content": "保留用户偏好和未决问题。"}


def candidate(content="我喜欢简洁回答", **changes):
    return {
        "kind": "fact",
        "title": "沟通偏好",
        "content": content,
        "claim_key": "用户:回答偏好",
        "evidence": content,
        "modality": "confirmed",
        "attribution": "user",
        "important": False,
        "event_time": None,
        **changes,
    }


@pytest.fixture
def environment():
    db = Database("sqlite://", testing=True)
    db.migrate()
    settings = Settings(embedding_dimensions=3, _env_file=None)
    provider = FakeProvider()
    provider.candidates = [candidate()]
    with db.session() as session:
        conversation = Conversation(owner="a")
        session.add(conversation)
        session.flush()
        identifier = conversation.id
    return db, settings, provider, MemoryService(db, provider, settings), identifier


def save(env, text="我喜欢简洁回答", key="first", **kwargs):
    db, settings, provider, memory, cid = env
    job = memory.enqueue("a", cid, text, key, **kwargs)
    asyncio.run(memory.process(job))
    return job


def test_missing_candidates_field_fails_instead_of_becoming_noop(environment):
    db, _, provider, memory, cid = environment

    async def malformed(*args):
        return {}

    provider.structured = malformed
    identifier = memory.enqueue("a", cid, "我喜欢简洁回答", "invalid-extraction")
    asyncio.run(memory.process(identifier))
    with db.session() as session:
        job = session.get(Job, identifier)
        assert job.state == "FAILED"
        assert job.error["code"] == "EXTRACTION_INVALID"
        assert session.query(Memory).count() == 0


def test_empty_and_filtered_candidates_are_observable_without_creating_memories(environment):
    db, _, provider, _, _ = environment
    provider.candidates = []
    empty = save(environment, text="你好", key="empty")
    provider.candidates = [candidate(attribution="third_party")]
    filtered = save(environment, key="third-party")
    with db.session() as session:
        for identifier, count in ((empty, 0), (filtered, 1)):
            job = session.get(Job, identifier)
            assert (job.state, job.stage) == ("SUCCEEDED", "NOOP")
            assert job.payload["extraction"] == {
                "candidate_count": count,
                "user_candidate_count": 0,
            }
        assert session.query(Memory).count() == 0


def test_record_idempotent_merge_index_failure_and_retry(environment):
    db, _, provider, memory, cid = environment
    provider.fail_index = True
    job = save(environment)
    with db.session() as session:
        assert session.get(Job, job).state == "PARTIAL"
        assert session.query(Memory).count() == 1
    assert memory.enqueue("a", cid, "我喜欢简洁回答", "first") == job
    with pytest.raises(AppError):
        memory.enqueue("a", cid, "不同内容", "first")
    provider.fail_index = False
    memory.retry("a", job)
    asyncio.run(memory.process(job))
    save(environment, key="second")
    with db.session() as session:
        assert session.get(Job, job).state == "SUCCEEDED"
        assert session.query(Memory).count() == 1
        assert len(session.query(Memory).one().source_ids) == 2
        assert session.query(Source).count() == 2


def test_change_requires_review_edit_refresh_version_conflict(environment):
    db, _, provider, memory, cid = environment
    save(environment)
    provider.candidates = [candidate("我喜欢详细回答")]
    save(environment, "我喜欢详细回答", "change")
    with db.session() as session:
        proposal = session.query(Proposal).one()
        proposal_id, base, fact_id = proposal.id, proposal.base_id, proposal.fact_id
        assert session.query(Memory).count() == 1
    memory.edit_proposal("a", proposal_id, "我喜欢详细而有条理的回答")
    with pytest.raises(AppError):
        memory.decide("a", proposal_id, "approve", base)
    memory.edit_proposal("a", proposal_id, refresh=True)
    memory.decide("a", proposal_id, "approve", base)
    with db.session() as session:
        assert session.get(Memory, base).status == "historical"
        current = session.get(Memory, session.get(Fact, fact_id).current_id)
        assert current.version == 2
        assert current.content == "我喜欢详细而有条理的回答"
    with pytest.raises(AppError):
        memory.revise("a", fact_id, base, "过时修订")
    memory.delete("a", fact_id, current.id)
    with db.session() as session:
        proposal = session.get(Proposal, proposal_id)
        assert proposal.status == "expired" and proposal.content == "已删除"
        assert proposal.before == "已删除"
        assert session.get(Fact, fact_id).claim_key.startswith("deleted:")


def test_policy_rechecked_at_commit_and_skip_auto_after_forget(environment):
    db, settings, provider, memory, cid = environment
    with db.session() as session:
        epoch = preference(session, "a").epoch
    job = memory.enqueue("a", cid, "我喜欢简洁回答", "auto", automatic=True, epoch=epoch)
    with db.session() as session:
        pref = preference(session, "a")
        pref.enabled, pref.epoch = False, pref.epoch + 1
    asyncio.run(memory.process(job))
    with db.session() as session:
        assert session.query(Memory).count() == 0
        assert session.get(Job, job).state == "CANCELLED"
    save(environment, key="explicit")  # Explicit records still work with smart memory off.
    with db.session() as session:
        row = session.query(Memory).one()
        version, fact = row.id, row.fact_id
        session.add(Summary(owner="a", conversation_id=cid, content="旧事实", message_ids=[]))
    memory.delete("a", fact, version)
    with db.session() as session:
        assert session.get(Memory, version).content == ""
        assert session.get(Memory, version).embedding is None
        assert session.query(Source).count() == 2
        assert not session.query(Summary).one().valid
        pref = preference(session, "a")
        pref.enabled, pref.epoch = True, pref.epoch + 1
        epoch = pref.epoch
    save(environment, key="auto-again", automatic=True, epoch=epoch)
    retriever = Retriever(db, provider, settings)
    assert asyncio.run(retriever.search("a", "default", "回答偏好"))["items"] == []


def test_false_evidence_third_party_and_planned_status(environment):
    db, _, provider, memory, cid = environment
    provider.candidates = [candidate(evidence="原文没有")]
    job = save(environment)
    with db.session() as session:
        assert session.get(Job, job).state == "FAILED"
        assert session.query(Memory).count() == 0
    provider.candidates = [candidate(attribution="third_party")]
    save(environment, key="third-party")
    with db.session() as session:
        assert session.query(Memory).count() == 0
    provider.candidates = [
        candidate("下周要去图书馆", kind="episode", modality="planned", important=True)
    ]
    save(environment, "下周要去图书馆", "plan")
    with db.session() as session:
        proposal = session.query(Proposal).one()
        identifier = proposal.id
    memory.decide("a", identifier, "approve", "")
    with db.session() as session:
        assert session.query(Memory).one().status == "planned"
        assert session.query(Memory).one().kind == "episode"


def test_context_summary_has_message_pointers_and_retains_recent(environment):
    db, settings, provider, _, cid = environment
    settings.context_chars = 50
    with db.session() as session:
        for index in range(12):
            session.add(
                Message(
                    owner="a",
                    conversation_id=cid,
                    role="user" if index % 2 == 0 else "assistant",
                    content=f"内容 {index} " * 10,
                )
            )
    builder = ContextBuilder(db, provider, Retriever(db, provider, settings), settings)
    messages, compressed = asyncio.run(builder.build("a", cid))
    assert compressed and len(messages) == 7
    assert "内容 11" in messages[-1]["content"]
    with db.session() as session:
        assert len(session.query(Summary).one().message_ids) == 6
