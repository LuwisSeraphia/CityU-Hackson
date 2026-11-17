import json
import asyncio
import io
import time

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.db import Database, Message, Run, ToolExecution
from app.errors import AppError
from app.files import parse_file
from app.main import create_app
from app.tools import tool_schemas
from app.web import public_url
from test_memory import FakeProvider


class ToolProvider(FakeProvider):
    async def chat(self, messages, **kwargs):
        if messages[-1]["role"] == "tool":
            result = json.loads(messages[-1]["content"])
            identifier = result["items"][0]["id"]
            return {"role": "assistant", "content": f"文件提到项目使用 PostgreSQL。[{identifier}]"}
        return {
            "role": "assistant",
            "content": None,
            "tool_calls": [
                {
                    "id": "read-1",
                    "type": "function",
                    "function": {"name": "search_files", "arguments": '{"query":"PostgreSQL"}'},
                }
            ],
        }


def test_real_runtime_tool_roundtrip_file_citation_and_owner_auth():
    db = Database("sqlite://", testing=True)
    settings = Settings(api_token="test-token", worker_enabled=False, _env_file=None)
    app = create_app(settings, database=db, provider=ToolProvider())
    headers = {"Authorization": "Bearer test-token"}
    with TestClient(app, headers=headers) as client:
        assert client.get("/api/v1/workspace", headers={"Authorization": "bad"}).status_code == 401
        cid = client.post("/api/v1/conversations", json={}).json()["id"]
        response = client.post(
            f"/api/v1/conversations/{cid}/files",
            files={"file": ("project.md", "项目使用 PostgreSQL。".encode(), "text/markdown")},
        )
        assert response.status_code == 201, response.text
        run_id = client.post(
            "/api/v1/agent/runs",
            json={
                "conversation_id": cid,
                "text": "文件说了什么？",
                "request_id": "run-1",
                "memory_policy_override": "skip",
            },
        ).json()["run_id"]
        for _ in range(100):
            status = client.get(f"/api/v1/agent/runs/{run_id}").json()
            if status["status"] != "RUNNING":
                break
            time.sleep(0.01)
        assert status["status"] == "SUCCEEDED", status
        conversation = client.get(f"/api/v1/conversations/{cid}").json()
        citation = conversation["messages"][-1]["citations"][0]
        evidence = client.get("/api/v1/evidence/" + citation).json()
        assert evidence["origin"] == "file" and "PostgreSQL" in evidence["text"]
        with db.session() as session:
            assert session.query(ToolExecution).one().status == "SUCCEEDED"
            assert session.query(Run).one().data["usage"][0]["provider_request_id"] == "test-only"
        repeated = client.post(
            "/api/v1/agent/runs",
            json={
                "conversation_id": cid,
                "text": "文件说了什么？",
                "request_id": "run-1",
                "memory_policy_override": "skip",
            },
        )
        assert repeated.json()["run_id"] == run_id
        with db.session() as session:
            assert session.query(Message).count() == 2


def test_missing_configuration_is_explicit_and_no_fake_reply():
    with TestClient(create_app(Settings(_env_file=None))) as client:
        state = client.get("/api/v1/health/ready").json()
        assert not state["database"] and not state["model_configured"]
        assert (
            client.post(
                "/api/v1/agent/runs",
                json={"conversation_id": "none", "text": "你好", "request_id": "missing"},
            ).status_code
            == 503
        )


def test_no_arbitrary_paths_private_urls_or_approval_tool():
    names = {tool["function"]["name"] for tool in tool_schemas()}
    assert "read_file" in names and "approve" not in names and "shell" not in names
    for url in (
        "file:///etc/passwd",
        "http://localhost",
        "http://user:pass@example.com",
        "https://example.com:8000",
    ):
        with pytest.raises(AppError):
            public_url(url)
    assert parse_file("sample.md", "项目说明".encode())[0][1] == "项目说明"
    with pytest.raises(AppError):
        parse_file("script.exe", b"anything")


def test_tool_budget_and_cancellation_are_terminal():
    class Endless(FakeProvider):
        async def chat(self, messages, **kwargs):
            return {
                "role": "assistant",
                "tool_calls": [
                    {
                        "id": str(len(messages)),
                        "type": "function",
                        "function": {"name": "not_a_tool", "arguments": "{}"},
                    }
                ],
            }

    db = Database("sqlite://", testing=True)
    app = create_app(
        Settings(api_token="token", worker_enabled=False, max_tools=1, _env_file=None),
        database=db,
        provider=Endless(),
    )
    with TestClient(app, headers={"Authorization": "Bearer token"}) as client:
        cid = client.post("/api/v1/conversations", json={}).json()["id"]
        run = client.post(
            "/api/v1/agent/runs",
            json={"conversation_id": cid, "text": "测试", "request_id": "limit"},
        ).json()["run_id"]
        for _ in range(100):
            status = client.get(f"/api/v1/agent/runs/{run}").json()
            if status["status"] != "RUNNING":
                break
            time.sleep(0.01)
        assert status["status"] == "FAILED"
        assert status["error"]["code"] == "TOOL_BUDGET"


def test_cancel_during_model_call_persists_retryable_message():
    class Slow(FakeProvider):
        slow = True

        async def chat(self, messages, **kwargs):
            if self.slow:
                await asyncio.sleep(10)
            return {"role": "assistant", "content": "重试后的完整回答"}

    db = Database("sqlite://", testing=True)
    provider = Slow()
    app = create_app(
        Settings(api_token="token", worker_enabled=False, _env_file=None),
        database=db,
        provider=provider,
    )
    with TestClient(app, headers={"Authorization": "Bearer token"}) as client:
        cid = client.post("/api/v1/conversations", json={}).json()["id"]
        run = client.post(
            "/api/v1/agent/runs",
            json={"conversation_id": cid, "text": "取消测试", "request_id": "cancel"},
        ).json()["run_id"]
        client.post(f"/api/v1/agent/runs/{run}/cancel")
        for _ in range(100):
            status = client.get(f"/api/v1/agent/runs/{run}").json()
            if status["status"] == "CANCELLED":
                break
            time.sleep(0.01)
        assert status["status"] == "CANCELLED"
        messages = client.get(f"/api/v1/conversations/{cid}").json()["messages"]
        assert messages[-1]["answer"]["retryText"] == "取消测试"
        failed_id = messages[-1]["id"]
        provider.slow = False
        retry = client.post(
            "/api/v1/agent/runs",
            json={
                "conversation_id": cid,
                "text": "取消测试",
                "request_id": "retry",
                "retry_message_id": failed_id,
                "memory_policy_override": "skip",
            },
        ).json()["run_id"]
        for _ in range(100):
            if client.get(f"/api/v1/agent/runs/{retry}").json()["status"] != "RUNNING":
                break
            time.sleep(0.01)
        messages = client.get(f"/api/v1/conversations/{cid}").json()["messages"]
        assert len(messages) == 2
        assert messages[-1]["id"] == failed_id
        assert messages[-1]["text"] == "重试后的完整回答"


def test_temporary_mode_has_no_database_writes_and_ignores_memory():
    db = Database("sqlite://", testing=True)
    app = create_app(
        Settings(api_token="token", worker_enabled=False, _env_file=None),
        database=db,
        provider=FakeProvider(),
    )
    with TestClient(app, headers={"Authorization": "Bearer token"}) as client:
        result = client.post(
            "/api/v1/temporary/messages",
            json={"messages": [{"role": "user", "content": "临时文本"}]},
        )
        assert result.status_code == 200
        with db.session() as session:
            assert session.query(Message).count() == 0
            assert session.query(Run).count() == 0


def test_docx_parsing_and_file_conversation_scope():
    from docx import Document
    from app.db import Conversation
    from app.files import FileService

    document = Document()
    document.add_paragraph("用 PostgreSQL 保存记忆")
    binary = io.BytesIO()
    document.save(binary)
    assert "PostgreSQL" in parse_file("project.docx", binary.getvalue())[0][1]
    db = Database("sqlite://", testing=True)
    db.migrate()
    with db.session() as session:
        a, b = Conversation(owner="a"), Conversation(owner="a")
        session.add_all([a, b])
        session.flush()
        first, second = a.id, b.id
    service = FileService(db, Settings(_env_file=None))
    uploaded = service.upload("a", first, "project.txt", b"PostgreSQL")
    assert service.read_sections("a", first, uploaded["id"])["items"][0]["content"] == "PostgreSQL"
    with pytest.raises(AppError):
        service.read_sections("a", second, uploaded["id"])
    with pytest.raises(AppError):
        service.search("a", second, "PostgreSQL", uploaded["id"])
    with pytest.raises(AppError):
        service.search("b", first, "PostgreSQL")


def test_ssrf_dns_private_and_mixed_addresses_are_blocked(monkeypatch):
    import socket
    from app.web import fetch_page

    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        lambda *a, **kw: [(2, 1, 6, "", ("127.0.0.1", 443)), (2, 1, 6, "", ("8.8.8.8", 443))],
    )
    with pytest.raises(AppError, match="内部"):
        fetch_page("https://public.example/document")


def test_tool_budget_reserves_final_answer_without_tools():
    class LoopProvider(FakeProvider):
        rounds = 0
        async def chat(self, messages, **kwargs):
            self.rounds += 1
            if not kwargs.get("tools"):
                return {"role": "assistant", "content": "目前没有文件依据，可以先明确学习目标。"}
            return {"role": "assistant", "content": None, "tool_calls": [{"id": f"call-{self.rounds}", "type": "function", "function": {"name": "search_files", "arguments": '{"query":"学习"}'}}]}
    db = Database("sqlite://", testing=True)
    provider = LoopProvider()
    settings = Settings(api_token="test-token", worker_enabled=False, max_rounds=2, _env_file=None)
    app = create_app(settings, database=db, provider=provider)
    with TestClient(app, headers={"Authorization": "Bearer test-token"}) as client:
        cid = client.post("/api/v1/conversations", json={}).json()["id"]
        rid = client.post("/api/v1/agent/runs", json={"conversation_id": cid, "text": "我可以学什么", "request_id": "budget", "memory_policy_override": "skip"}).json()["run_id"]
        for _ in range(100):
            status = client.get(f"/api/v1/agent/runs/{rid}").json()
            if status["status"] != "RUNNING":
                break
            time.sleep(0.01)
        assert status["status"] == "SUCCEEDED", status
        assert provider.rounds == 3
        with db.session() as session:
            assert session.get(Run, rid).data["tool_budget_exhausted"] is True


def test_intent_runtime_prefetches_without_model_tool_request():
    from app.db import Memory
    from app.domain.memory.models import Profile
    class PlannedProvider(FakeProvider):
        async def structured(self, instruction, content):
            if "信息规划器" in instruction:
                return {"task": "advise", "subject": "self", "needs": [
                    {"need_id": "goals", "source": "profile", "purpose": "goal", "query": "数据库学习"},
                    {"need_id": "events", "source": "memory", "purpose": "event", "query": "数据库学习", "priority": "required"}]}
            return {"answer": "可以围绕数据库学习继续实践。"}
        async def chat(self, messages, **kwargs):
            return {"role": "assistant", "content": "可以围绕数据库学习继续实践。"}
    settings = Settings(api_token="test-token", worker_enabled=False, memory_v2_enabled=True, intent_planner_enabled=True, _env_file=None)
    db = Database("sqlite://", testing=True)
    app = create_app(settings, database=db, provider=PlannedProvider())
    with TestClient(app, headers={"Authorization": "Bearer test-token"}) as client:
        cid = client.post("/api/v1/conversations", json={}).json()["id"]
        with db.session() as session:
            memory = Memory(owner=settings.owner_id, project="default", kind="fact", title="数据库学习", content="正在进行数据库学习", status="current")
            session.add(memory)
            session.flush()
            session.add(Profile(owner=settings.owner_id, category="goal", content="数据库学习", origin="self_report", state="active", evidence_ids=[memory.id]))
        rid = client.post("/api/v1/agent/runs", json={"conversation_id": cid, "text": "下一步怎么安排", "request_id": "intent-pre", "memory_policy_override": "skip"}).json()["run_id"]
        for _ in range(100):
            status = client.get(f"/api/v1/agent/runs/{rid}").json()
            if status["status"] != "RUNNING": break
            time.sleep(0.01)
        assert status["status"] == "SUCCEEDED", status
        trace = client.get(f"/api/v1/agent/runs/{rid}/trace").json()
        assert trace["intent"]["origin"] == "model"
        assert any(item["source"] == "memory" and item["status"] == "found" for item in trace["information"])
        assert trace["injected"]
