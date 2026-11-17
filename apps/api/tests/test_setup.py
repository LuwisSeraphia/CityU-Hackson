import importlib.util
import json
import re
from pathlib import Path

from app.config import Settings


def test_local_configuration_is_matched_secret_safe_and_non_overwriting(tmp_path):
    root = Path(__file__).resolve().parents[3]
    spec = importlib.util.spec_from_file_location("setup_local", root / "scripts/setup_local.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    for path in ("apps/api", "infra"):
        (tmp_path / path).mkdir(parents=True)
    (tmp_path / "apps/api/.env.example").write_text(
        (root / "apps/api/.env.example").read_text(encoding="utf-8"), encoding="utf-8"
    )
    result = module.configure(tmp_path)
    assert result["created"]
    api = (tmp_path / "apps/api/.env").read_text(encoding="utf-8")
    assert not (tmp_path / "apps/web").exists()
    infra = (tmp_path / "infra/.env").read_text(encoding="utf-8")
    token = next(
        line.split("=", 1)[1] for line in api.splitlines() if line.startswith("API_TOKEN=")
    )
    password = infra.strip().split("=", 1)[1]
    assert token and password in api
    assert token not in str(result) and password not in str(result)
    assert not module.configure(tmp_path)["created"]
    assert (tmp_path / "apps/api/.env").read_text(encoding="utf-8") == api


def test_bailian_tutorial_configuration_and_requests_match_project():
    root = Path(__file__).resolve().parents[3]
    tutorial = (root / "docs/bailian-api-tutorial.md").read_text(encoding="utf-8")
    config = re.search(r"```dotenv\n(.*?)\n```", tutorial, re.S).group(1)
    fields = dict(line.split("=", 1) for line in config.splitlines())
    defaults = Settings(_env_file=None)
    for name in ("CHAT_MODEL", "EXTRACT_MODEL", "EMBEDDING_MODEL", "RERANK_MODEL", "SEARCH_MODEL"):
        assert fields[name] == getattr(defaults, name.lower())
    assert int(fields["EMBEDDING_DIMENSIONS"]) == defaults.embedding_dimensions
    assert fields["DASHSCOPE_API_KEY"] == "YOUR_BAILIAN_API_KEY"
    assert "DATABASE_URL" not in fields and "API_TOKEN" not in fields
    for name, suffix in (
        ("QWEN_BASE_URL", "/compatible-mode/v1"),
        ("SEARCH_URL", "/api/v1/services/aigc/text-generation/generation"),
        ("RERANK_URL", "/api/v1/services/rerank/text-rerank/text-rerank"),
    ):
        assert fields[name] == "https://YOUR_WORKSPACE_ID.cn-beijing.maas.aliyuncs.com" + suffix
    requests = [json.loads(block) for block in re.findall(r"```json\n(.*?)\n```", tutorial, re.S)]
    assert [request["model"] for request in requests] == [
        defaults.chat_model,
        defaults.extract_model,
        defaults.embedding_model,
        defaults.rerank_model,
        defaults.search_model,
    ]
    assert requests[1]["response_format"]["type"] == "json_object"
    assert requests[2]["dimensions"] == defaults.embedding_dimensions
    assert requests[4]["parameters"]["search_options"]["enable_source"]
    for path in re.findall(r"\./(scripts/[\w-]+\.ps1)", tutorial):
        assert (root / path).is_file()
