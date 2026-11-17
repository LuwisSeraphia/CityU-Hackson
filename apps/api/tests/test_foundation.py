import asyncio
import json

import httpx
import pytest

from app.config import Settings
from app.db import Conversation, Database, Memory, owned
from app.errors import AppError
from app.providers import QwenProvider
from app.schemas import validate_text


def test_database_persistence_and_owner_boundary(tmp_path):
    url = "sqlite:///" + str(tmp_path / "test.db")
    db = Database(url, testing=True)
    db.migrate()
    with db.session() as session:
        row = Conversation(owner="a")
        session.add(row)
        session.flush()
        identifier = row.id
    db.engine.dispose()
    other_process = Database(url, testing=True)
    other_process.migrate()
    with other_process.session() as session:
        assert owned(session, Conversation, identifier, "a").title == "新的对话"
        with pytest.raises(AppError):
            owned(session, Conversation, identifier, "b")
    with pytest.raises(AppError):
        Database(url)


def test_rollback_and_credentials():
    db = Database("sqlite://", testing=True)
    db.migrate()
    with pytest.raises(RuntimeError):
        with db.session() as session:
            session.add(Memory(owner="a", title="test", content="private", kind="episode"))
            raise RuntimeError()
    with db.session() as session:
        assert session.query(Memory).count() == 0
    with pytest.raises(AppError, match="凭据"):
        validate_text("password=not-a-real-password")


def test_real_provider_protocol_tool_calls_and_error_redaction():
    seen = []

    def handler(request):
        seen.append(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "id": "provider-test",
                "usage": {"total_tokens": 10},
                "choices": [
                    {
                        "message": {
                            "role": "assistant",
                            "content": None,
                            "tool_calls": [
                                {
                                    "id": "tool1",
                                    "type": "function",
                                    "function": {
                                        "name": "search_memory",
                                        "arguments": '{"query":"项目"}',
                                    },
                                }
                            ],
                        }
                    }
                ],
            },
        )

    provider = QwenProvider(
        Settings(dashscope_api_key="test-only", _env_file=None), httpx.MockTransport(handler)
    )
    answer = asyncio.run(
        provider.chat([{"role": "user", "content": "项目"}], tools=[{"type": "function"}])
    )
    assert answer["tool_calls"][0]["id"] == "tool1"
    assert seen[0]["tool_choice"] == "auto"
    assert provider.last_usage["provider_request_id"] == "provider-test"
    bad = QwenProvider(
        Settings(dashscope_api_key="test-only", _env_file=None),
        httpx.MockTransport(lambda _: httpx.Response(401, text="sensitive upstream content")),
    )
    with pytest.raises(AppError) as error:
        asyncio.run(bad.chat([]))
    assert "sensitive" not in error.value.message


def test_embedding_dimensions_and_search_sources_are_verified():
    settings = Settings(dashscope_api_key="test-only", embedding_dimensions=3, _env_file=None)
    provider = QwenProvider(
        settings,
        httpx.MockTransport(
            lambda _: httpx.Response(200, json={"data": [{"index": 0, "embedding": [1, 2]}]})
        ),
    )
    with pytest.raises(AppError, match="维度"):
        asyncio.run(provider.embed(["hello"]))
    provider = QwenProvider(
        settings,
        httpx.MockTransport(
            lambda _: httpx.Response(
                200, json={"choices": [{"message": {"content": "https://invented.invalid"}}]}
            )
        ),
    )
    with pytest.raises(AppError, match="来源"):
        asyncio.run(provider.search("公开项目"))


def test_search_uses_native_api_and_provider_source_metadata():
    seen = []

    def handler(request):
        seen.append((str(request.url), json.loads(request.content)))
        return httpx.Response(
            200,
            json={
                "request_id": "native-search-test",
                "output": {
                    "search_info": {
                        "search_results": [
                            {
                                "title": "官方说明",
                                "url": "https://example.com/docs",
                                "snippet": "原始摘要",
                            }
                        ]
                    }
                },
            },
        )

    provider = QwenProvider(
        Settings(dashscope_api_key="test-only", _env_file=None), httpx.MockTransport(handler)
    )
    sources = asyncio.run(provider.search("公开技术文档"))
    assert seen[0][0].endswith("/text-generation/generation")
    assert seen[0][1]["parameters"]["search_options"]["enable_source"]
    assert sources[0]["url"] == "https://example.com/docs"
    assert provider.last_usage["provider_request_id"] == "native-search-test"


def test_vector_distance_compiles_for_postgresql():
    from sqlalchemy import select
    from sqlalchemy.dialects import postgresql

    statement = select(Memory.id).order_by(Memory.embedding.cosine_distance([1.0, 0.0]))
    assert "<=>" in str(statement.compile(dialect=postgresql.dialect()))
