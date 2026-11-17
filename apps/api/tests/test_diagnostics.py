import asyncio
import json
import os
from pathlib import Path
import subprocess
import sys

import httpx

from app import diagnostics
from app.config import Settings
from app.providers import QwenProvider


def configured(tmp_path, **changes):
    path = tmp_path / "apps/web"
    path.mkdir(parents=True, exist_ok=True)
    (path / ".env.local").write_text("AGENT_API_TOKEN=local-test-secret\n", encoding="utf-8")
    return Settings(
        api_token="local-test-secret",
        dashscope_api_key="cloud-test-secret",
        embedding_dimensions=3,
        _env_file=None,
        **changes,
    )


def db_ok(_):
    return [diagnostics.check("database", "passed", "test double")]


def test_default_diagnostic_never_calls_cloud_or_claims_verified(tmp_path):
    settings = configured(tmp_path)
    provider = QwenProvider(settings, httpx.MockTransport(lambda _: 1 / 0))
    result = asyncio.run(
        diagnostics.diagnose(settings, tmp_path, provider=provider, database_probe=db_ok)
    )
    assert result["ok"] and not result["cloud_verified"]
    assert result["checks"][-1]["status"] == "skipped"
    assert "local-test-secret" not in str(result) and "cloud-test-secret" not in str(result)


def test_missing_key_and_unsafe_endpoint_skip_live_calls(tmp_path):
    settings = configured(tmp_path).model_copy(
        update={"qwen_base_url": "http://user:password@host/"}
    )
    result = asyncio.run(diagnostics.diagnose(settings, tmp_path, live=True, database_probe=db_ok))
    assert not result["ok"] and not result["cloud_verified"]
    assert result["checks"][-1]["status"] == "skipped"
    assert "password" not in str(result)
    missing = Settings(_env_file=None)
    result = asyncio.run(diagnostics.diagnose(missing, tmp_path, live=True, database_probe=db_ok))
    assert not result["ok"] and not result["cloud_verified"]


def provider_handler(seen, *, fail_embedding=False, call_tool=True):
    def handler(request):
        payload = json.loads(request.content)
        seen.append(payload)
        base = {"id": "test-provider-id"}
        if request.url.path.endswith("/embeddings"):
            if fail_embedding:
                return httpx.Response(401, text="cloud-test-secret should never appear")
            base["data"] = [{"index": 0, "embedding": [1.0, 0.0, 0.0]}]
        elif "rerank" in request.url.path:
            base["output"] = {"results": [{"index": 0}, {"index": 1}]}
        elif request.url.path.endswith("/generation"):
            base["output"] = {
                "search_info": {"search_results": [{"url": "https://www.postgresql.org/docs/"}]}
            }
        else:
            message = {"role": "assistant", "content": "personal-agent-check"}
            if payload.get("tools") and call_tool:
                message.update(
                    content=None,
                    tool_calls=[
                        {
                            "id": "probe-1",
                            "type": "function",
                            "function": {
                                "name": "diagnostic_echo",
                                "arguments": '{"marker":"personal-agent-check"}',
                            },
                        }
                    ],
                )
            elif payload.get("response_format"):
                message["content"] = '{"preference":"简洁回答"}'
            base["choices"] = [{"message": message}]
        return httpx.Response(200, json=base)

    return handler


def test_live_diagnostics_exercise_tool_roundtrip_and_all_model_capabilities(tmp_path):
    settings, seen = configured(tmp_path), []
    provider = QwenProvider(settings, httpx.MockTransport(provider_handler(seen)))
    result = asyncio.run(
        diagnostics.diagnose(settings, tmp_path, live=True, provider=provider, database_probe=db_ok)
    )
    assert result["ok"] and result["cloud_verified"]
    assert len(seen) == 6
    assert seen[1]["messages"][-1]["tool_call_id"] == "probe-1"
    assert seen[2]["model"] == settings.extract_model
    assert seen[3]["dimensions"] == 3
    assert seen[-1]["parameters"]["search_options"]["enable_source"]
    assert {c["name"] for c in result["checks"][-5:]} == {
        "tool_calling",
        "structured_extraction",
        "embedding",
        "rerank",
        "web_search",
    }


def test_one_live_failure_does_not_hide_other_capabilities(tmp_path):
    settings, seen = configured(tmp_path), []
    provider = QwenProvider(
        settings, httpx.MockTransport(provider_handler(seen, fail_embedding=True, call_tool=False))
    )
    result = asyncio.run(
        diagnostics.diagnose(settings, tmp_path, live=True, provider=provider, database_probe=db_ok)
    )
    by_name = {c["name"]: c for c in result["checks"]}
    assert not result["ok"] and not result["cloud_verified"]
    assert by_name["tool_calling"]["code"] == "PROBE_TOOL_NOT_CALLED"
    assert by_name["embedding"]["status"] == "failed"
    assert by_name["web_search"]["status"] == by_name["structured_extraction"]["status"] == "passed"
    assert "cloud-test-secret" not in str(result)


def test_database_errors_never_echo_connection_secrets(monkeypatch):
    def unavailable(_):
        raise RuntimeError("postgresql://user:private-db-password@host/db")

    monkeypatch.setattr(diagnostics, "Database", unavailable)
    result = diagnostics.database_checks(Settings(_env_file=None))
    assert result[0]["status"] == "failed"
    assert "private-db-password" not in str(result)


def test_database_diagnostic_is_read_only_and_checks_extension_schema(monkeypatch):
    statements = []

    class Connection:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def begin(self):
            return self

        def execute(self, statement, parameters=None):
            query = str(statement)
            statements.append(query)
            value = 0 if "<=>" in query else 2 if "max(version)" in query else 1
            return type("Result", (), {"scalar": lambda _: value})()

    class Engine:
        def connect(self):
            return Connection()

        def dispose(self):
            pass

    monkeypatch.setattr(diagnostics, "Database", lambda _: type("DB", (), {"engine": Engine()})())
    result = diagnostics.database_checks(Settings(_env_file=None))
    assert all(r["status"] == "passed" for r in result)
    assert statements[0] == "SET TRANSACTION READ ONLY"
    assert any("<=>" in sql for sql in statements)
    assert not any(
        word in sql.upper()
        for sql in statements
        for word in ("INSERT", "UPDATE", "CREATE", "DELETE")
    )


def test_diagnostic_cli_returns_failure_in_utf8_without_exposing_secrets():
    result = subprocess.run(
        [sys.executable, "-X", "utf8", "-m", "app.diagnostics"],
        cwd=Path(__file__).resolve().parents[1],
        env={
            **os.environ,
            "DATABASE_URL": "sqlite://",
            "DASHSCOPE_API_KEY": "",
            "API_TOKEN": "test-cli-private-token",
        },
        capture_output=True,
        encoding="utf-8",
        timeout=30,
    )
    assert result.returncode == 1
    report = json.loads(result.stdout)
    assert not report["ok"] and not report["cloud_verified"]
    assert "不要发送到聊天" in result.stdout
    assert "test-cli-private-token" not in result.stdout + result.stderr
