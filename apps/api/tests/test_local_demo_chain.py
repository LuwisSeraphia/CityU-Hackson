import time

from fastapi.testclient import TestClient

from app.local_demo import create_local_demo


def test_http_chain_is_persistent_idempotent_and_explicitly_demo(tmp_path):
    path = tmp_path / "chat.sqlite"
    headers = {"Authorization": "Bearer integration-token"}
    with TestClient(create_local_demo(path, "integration-token"), headers=headers) as client:
        state = client.get("/api/v1/health/ready").json()
        assert state["mode"] == "local_demo" and state["database"]
        assert state["model_configured"] is False
        assert (
            client.post(
                "/api/v1/conversations", json={}, headers={"Authorization": "wrong"}
            ).status_code
            == 401
        )
        body = {"request_id": "browser-created-conversation"}
        cid = client.post("/api/v1/conversations", json=body).json()["id"]
        assert client.post("/api/v1/conversations", json=body).json()["id"] == cid
        assert len(client.get("/api/v1/workspace").json()["conversations"]) == 1
        request = {
            "conversation_id": cid,
            "text": "你好，测试消息",
            "request_id": "request-1",
            "memory_policy_override": "skip",
        }
        result = client.post("/api/v1/agent/runs", json=request)
        assert result.status_code == 202, result.text
        rid = result.json()["run_id"]
        assert client.post("/api/v1/agent/runs", json=request).json()["run_id"] == rid
        response = client.get(f"/api/v1/agent/runs/{rid}/events")
        assert '"status": "SUCCEEDED"' in response.text
        messages = client.get(f"/api/v1/conversations/{cid}").json()["messages"]
        assert len(messages) == 2
        assert "本地联调模式" in messages[-1]["text"]
        assert "非云端 AI" in messages[-1]["text"]
    with TestClient(create_local_demo(path, "integration-token"), headers=headers) as client:
        assert len(client.get(f"/api/v1/conversations/{cid}").json()["messages"]) == 2
        rid = client.post(
            "/api/v1/agent/runs", json={**request, "text": "另一条", "request_id": "request-2"}
        ).json()["run_id"]
        assert client.post(f"/api/v1/agent/runs/{rid}/cancel").status_code == 200
        for _ in range(100):
            state = client.get(f"/api/v1/agent/runs/{rid}").json()
            if state["status"] != "RUNNING":
                break
            time.sleep(0.01)
        assert state["status"] == "CANCELLED"


def test_cloud_entry_never_silently_falls_back_to_local_demo():
    from app.api.server import create_app
    from app.infrastructure.config import Settings

    with TestClient(create_app(Settings(_env_file=None))) as client:
        health = client.get("/api/v1/health/ready").json()
        assert health["mode"] == "cloud"
        assert health["database"] is False and health["model_configured"] is False
        response = client.post("/api/v1/conversations", json={})
        assert response.status_code == 503
        assert response.json()["error"]["code"] == "API_TOKEN_NOT_CONFIGURED"


def test_demo_skill_templates_are_explicit_and_not_execution_claims():
    import asyncio
    from app.local_demo import LocalDemoProvider

    provider = LocalDemoProvider()
    result = asyncio.run(provider.chat([{"role": "user", "content": "文件归档方案"}]))
    assert "固定规则" in result["content"] and "不操作磁盘" in result["content"]
    result = asyncio.run(provider.chat([{"role": "user", "content": "工作流程规划"}]))
    assert "流程规划模板" in result["content"] and "非云端 AI" in result["content"]


def test_demo_restart_marks_abandoned_run_retryable(tmp_path):
    from app.infrastructure.db import Run, Message

    path = tmp_path / "crash.sqlite"
    headers = {"Authorization": "Bearer crash-token"}
    app = create_local_demo(path, "crash-token")
    with TestClient(app, headers=headers) as client:
        cid = client.post("/api/v1/conversations", json={}).json()["id"]
        with app.state.services["db"].session() as session:
            user = Message(owner="local-user", conversation_id=cid, role="user", content="恢复测试")
            session.add(user)
            session.flush()
            run = Run(
                owner="local-user",
                conversation_id=cid,
                request_key="abandoned",
                user_message_id=user.id,
                data={"text": "恢复测试"},
            )
            session.add(run)
            session.flush()
            rid = run.id
    with TestClient(create_local_demo(path, "crash-token"), headers=headers) as client:
        result = client.get(f"/api/v1/agent/runs/{rid}").json()
        assert result["status"] == "FAILED"
        assert result["error"]["code"] == "SERVER_RESTARTED"
        assert (
            client.get(f"/api/v1/conversations/{cid}").json()["messages"][-1]["answer"]["retryText"]
            == "恢复测试"
        )
