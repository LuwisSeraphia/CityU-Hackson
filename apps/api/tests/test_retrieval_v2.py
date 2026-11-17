import asyncio
import pytest
from app.config import Settings
from app.context_budget import MemoryBudget
from app.retrieval_policy import communication_preference, operation_only, needs_memory
from app.retrieval import Retriever, retrieval_context
from app.db import Database, Memory, Run
from app.tracing import trace_view
from app.errors import AppError
from fastapi.testclient import TestClient
from app.main import create_app
from test_memory import FakeProvider
import time
import json


def test_policy_and_budget():
    assert Settings(_env_file=None).memory_retrieval_policy == "legacy"
    assert communication_preference("用户喜欢先给结论的回答")
    assert not communication_preference("用户喜欢青禾项目的绿色页面")
    assert not communication_preference("写论文时喜欢英文回答")
    assert operation_only("用户要求忘记页面颜色偏好")
    assert not operation_only("我经常忘记带钥匙")
    assert needs_memory("结合我的时间安排下一步")
    assert not needs_memory("解释数据库索引")
    b = MemoryBudget(100)
    assert not b.select([{"id": "x", "content": "长" * 100}])[0]


def test_v2_scored_selection_empty_cache_and_invalidation():
    class Provider:
        count = 0

        async def embed(self, values):
            self.count += 1
            return [[1, 0, 0]]

        async def rerank(self, query, documents, *, scored=False):
            return [
                {"index": i, "score": 0.95 if "5小时" in d and "时间" in query else 0.01}
                for i, d in enumerate(documents)
            ]

    db = Database("sqlite://", testing=True)
    db.migrate()
    with db.session() as s:
        s.add_all(
            [
                Memory(
                    owner="a",
                    project="default",
                    kind="fact",
                    title="工时",
                    content="青禾每周5小时",
                    status="current",
                    embedding=[1, 0, 0],
                    embedding_model="text-embedding-v4",
                    index_status="READY",
                ),
                Memory(owner="b", kind="fact", title="私人", content="秘密", status="current"),
            ]
        )
    p = Provider()
    r = Retriever(db, p, Settings(memory_retrieval_policy="v2", _env_file=None))

    async def run():
        token = retrieval_context.set({"cache": {}})
        try:
            first = await r.search("a", "default", "我的时间安排")
            assert len(first["items"]) == 1
            second = await r.search("a", "default", "我的时间安排")
            assert second["diagnostics"]["cache_hit"] and p.count == 1
            assert not (await r.search("a", "default", "饮食禁忌"))["items"]
            with db.session() as s:
                s.query(Memory).filter_by(owner="a").one().status = "deleted"
            assert not (await r.search("a", "default", "我的时间安排"))["items"]
        finally:
            retrieval_context.reset(token)

    asyncio.run(run())


def test_legacy_trace_is_explicit_and_owner_scoped():
    db = Database("sqlite://", testing=True)
    db.migrate()
    with db.session() as s:
        row = Run(owner="a", conversation_id="test", request_key="test")
        s.add(row)
        s.flush()
        identifier = row.id
    assert trace_view(db, "a", identifier)["availability"] == "legacy_unavailable"
    with pytest.raises(AppError):
        trace_view(db, "b", identifier)


def test_pretrieval_reaches_model_without_model_tool_call():
    class Provider(FakeProvider):
        requests = []

        async def rerank(self, query, documents, *, scored=False):
            return [{"index": i, "score": 0.99} for i in range(len(documents))]

        async def chat(self, messages, **kwargs):
            self.requests.append(json.dumps(messages, ensure_ascii=False))
            return {"role": "assistant", "content": "依据本轮记忆规划。"}

    settings = Settings(
        api_token="test-token", worker_enabled=False, memory_retrieval_policy="v2", _env_file=None
    )
    db = Database("sqlite://", testing=True)
    p = Provider()
    with TestClient(
        create_app(settings, database=db, provider=p),
        headers={"Authorization": "Bearer test-token"},
    ) as c:
        cid = c.post("/api/v1/conversations", json={}).json()["id"]
        with db.session() as s:
            s.add(
                Memory(
                    owner=settings.owner_id,
                    kind="fact",
                    title="时间",
                    content="青禾每周可投入5小时",
                    project="default",
                    status="current",
                    embedding=[1, 0, 0],
                    embedding_model=settings.embedding_model,
                    index_status="READY",
                )
            )
        rid = c.post(
            "/api/v1/agent/runs",
            json={
                "conversation_id": cid,
                "text": "结合我的时间安排青禾工作",
                "request_id": "pre",
                "memory_policy_override": "skip",
            },
        ).json()["run_id"]
        for _ in range(100):
            if c.get(f"/api/v1/agent/runs/{rid}").json()["status"] != "RUNNING":
                break
            time.sleep(0.01)
        assert "5小时" in p.requests[0]
        trace = c.get(f"/api/v1/agent/runs/{rid}/trace").json()
        assert trace["retrievals"][0]["origin"] == "server"
        assert len(trace["injected"]) == 1
        assert trace["answer_elapsed_ms"] >= 0
