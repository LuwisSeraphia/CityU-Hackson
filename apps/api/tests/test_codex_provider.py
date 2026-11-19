import asyncio
import json
from pathlib import Path

from app.codex_provider import CodexProvider


def test_cli_adapter_uses_isolated_schema_protocol_and_no_backend_secrets(monkeypatch):
    monkeypatch.setattr("app.codex_provider.shutil.which", lambda _: "/local/codex")
    monkeypatch.setenv("API_TOKEN", "do-not-pass")
    seen = {}

    class Process:
        returncode = 0

        async def communicate(self, prompt):
            seen["prompt"] = prompt.decode()
            Path(seen["command"][seen["command"].index("-o") + 1]).write_text(
                json.dumps({"role": "assistant", "content": "真实接口协议替身", "tool_calls": []})
            )
            return None, None

    async def create(*command, **kwargs):
        seen["command"] = command
        assert "API_TOKEN" not in kwargs["env"]
        assert "--ignore-user-config" in command
        assert "shell_tool" in command and "read-only" in command
        return Process()

    monkeypatch.setattr("app.codex_provider.asyncio.create_subprocess_exec", create)
    response = asyncio.run(CodexProvider().chat([{"role": "user", "content": "公开测试问题"}]))
    assert response["content"] == "真实接口协议替身"
    assert "公开测试问题" in seen["prompt"]
