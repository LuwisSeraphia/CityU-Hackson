from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.db import Database, Conversation, Memory
from app.errors import AppError
from app.main import create_app
from app.memory_v2.context_policy import (
    ContextPlan,
    allowed,
    effective_options,
    filter_query,
    request_context,
    response_strategy,
    update_working_state,
    working_state_view,
)
from app.memory_v2.models import Profile, WorkingState


@pytest.fixture
def setup():
    db = Database("sqlite://", testing=True)
    db.migrate()
    config = Settings(
        memory_v2_enabled=True, api_token="test", owner_id="a", worker_enabled=False, _env_file=None
    )
    with db.session() as session:
        conversation = Conversation(owner="a")
        session.add(conversation)
        session.flush()
        cid = conversation.id
    return db, config, cid


def test_single_override_and_zero_budget(setup):
    db, config, _ = setup
    with db.session() as session:
        options = effective_options(
            session, "a", {"mode": "deep", "memory_budget_tokens": 0}, "复盘", config
        )
        assert options["memory_budget_tokens"] == 0
        assert effective_options(session, "a", None, "你好", config)["mode"] == "fast"
    plan = ContextPlan(db, config, "a", "default", "你好", options)
    assert plan.select([{"id": "x", "content": "偏好"}]) == []


def test_sensitive_mood_does_not_grant_recall(setup):
    db, config, _ = setup
    with db.session() as session:
        memory = Memory(
            owner="a", project="default", title="旧经历", content="上次分手让我难过", kind="episode"
        )
        session.add(memory)
        session.flush()
        assert not allowed(session, "a", memory, "今天心情不好")
        assert allowed(session, "a", memory, "记得我上次分手的事吗")
        assert not allowed(session, "a", memory, "", inference=True)
        token = request_context.set({"owner": "a", "text": "今天心情不好"})
        try:
            assert (
                filter_query(
                    session, session.query(Memory).filter_by(owner="a"), "a", config
                ).count()
                == 0
            )
        finally:
            request_context.reset(token)


def test_no_irrelevant_or_personality_profiles(setup):
    db, config, _ = setup
    with db.session() as session:
        memory = Memory(owner="a", project="default", title="生活", content="喜欢散步", kind="fact")
        session.add(memory)
        session.flush()
        session.add(
            Profile(
                owner="a",
                category="lifestyle",
                content="喜欢散步",
                origin="self_report",
                state="active",
                evidence_ids=[memory.id],
            )
        )
        options = effective_options(session, "a", None, "债券定价", config)
    assert ContextPlan(db, config, "a", "default", "债券定价", options).profiles() == []


def test_budget_deduplicates_and_never_silently_truncates_current_input(setup):
    db, config, _ = setup
    with db.session() as session:
        options = effective_options(session, "a", {"memory_budget_tokens": 100}, "解释", config)
    plan = ContextPlan(db, config, "a", "default", "解释", options)
    assert (
        len(
            plan.select(
                [
                    {"id": "1", "fact_id": "f", "content": "a"},
                    {"id": "2", "fact_id": "f", "content": "b"},
                ]
            )
        )
        == 1
    )
    with pytest.raises(AppError) as error:
        plan.fit([{"role": "user", "content": "中" * 20000}], [])
    assert error.value.code == "CONTEXT_BUDGET_EXCEEDED"


def test_emotion_expires_and_explicit_request_wins(setup):
    db, config, cid = setup
    assert response_strategy("我很难过，但是直接给我建议") == "plan"
    assert response_strategy("让我吐槽，不用给建议") == "listen"
    update_working_state(db, "a", cid, "message-id", "今天很难过")
    with db.session() as session:
        row = session.query(WorkingState).one()
        row.data = {
            **row.data,
            "last_activity_at": (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat(),
        }
        assert working_state_view(row, config)["emotion_context"] == []


def test_settings_and_sensitive_policy_api(setup):
    db, config, cid = setup
    headers = {"Authorization": "Bearer test"}
    app = create_app(config, database=db)
    with TestClient(app) as client:
        response = client.patch(
            "/api/v2/settings/response",
            headers=headers,
            json={
                "request_id": "settings",
                "expected_revision": 1,
                "mode": "deep",
                "memory_budget_tokens": 2000,
            },
        )
        assert response.status_code == 200, response.text
        assert (
            client.get("/api/v2/settings/response", headers=headers).json()["options"]["mode"]
            == "deep"
        )
        assert (
            client.patch(
                "/api/v2/settings/response",
                headers=headers,
                json={"request_id": "bad", "expected_revision": 2, "memory_budget_tokens": 10000},
            ).status_code
            == 422
        )
        with db.session() as session:
            memory = Memory(owner="a", title="感情", content="分手经历", kind="episode")
            session.add(memory)
            session.flush()
            mid = memory.id
        response = client.patch(
            f"/api/v2/memory/items/{mid}/use-policy",
            headers=headers,
            json={"request_id": "policy", "expected_revision": 1, "recall_policy": "explicit_only"},
        )
        assert response.status_code == 200, response.text
        assert (
            client.get("/api/v2/memory/items/missing/use-policy", headers=headers).status_code
            == 404
        )


def test_runtime_uses_plan_without_irrelevant_memory(setup):
    import time
    from app.db import Run
    from test_memory import FakeProvider

    class Capture(FakeProvider):
        seen = []

        async def chat(self, messages, **kwargs):
            self.seen.append(messages)
            return {"role": "assistant", "content": "债券是债务融资工具。"}

    db, config, cid = setup
    provider = Capture()
    with db.session() as session:
        session.add(
            Memory(owner="a", kind="fact", title="私人经历", content="分手经历不应进入知识问答")
        )
    with TestClient(
        create_app(config, database=db, provider=provider), headers={"Authorization": "Bearer test"}
    ) as client:
        result = client.post(
            "/api/v1/agent/runs",
            json={
                "conversation_id": cid,
                "text": "什么是债券",
                "request_id": "runtime-plan",
                "memory_policy_override": "skip",
                "response_options": {"mode": "fast", "memory_budget_tokens": 0},
            },
        )
        assert result.status_code == 202, result.text
        rid = result.json()["run_id"]
        for _ in range(100):
            status = client.get(f"/api/v1/agent/runs/{rid}").json()
            if status["status"] != "RUNNING":
                break
            time.sleep(0.01)
        assert status["status"] == "SUCCEEDED", status
        assert provider.seen and "分手经历" not in str(provider.seen)
        with db.session() as session:
            assert session.get(Run, rid).data["context_plan"]["memory_tokens"] == 0


def test_personal_review_intent_and_category_coverage(setup):
    from app.application.context.plan import profile_review_scope
    assert profile_review_scope("你觉得我是什么性格") == "all"
    assert profile_review_scope("根据之前的聊天总结一下我") == "all"
    assert profile_review_scope("我的学习习惯怎么样") == "learning"
    assert profile_review_scope("总结这篇文章") is None
    assert profile_review_scope("这个角色是什么性格") is None
    db, config, _ = setup
    with db.session() as session:
        for category in ["learning", "lifestyle", "goal", "communication"]:
            memory = Memory(owner="a", project="default", title=category, content=category, kind="fact")
            session.add(memory)
            session.flush()
            session.add(Profile(owner="a", category=category, content=category, origin="self_report", state="active", evidence_ids=[memory.id]))
        options = effective_options(session, "a", {"memory_budget_tokens": 6400}, "你觉得我是什么性格", config)
    plan = ContextPlan(db, config, "a", "default", "你觉得我是什么性格", options)
    assert len(plan.profiles()) == 4
    assert plan.report["profile_selection"]["budget"] == 3200
    focused = ContextPlan(db, config, "a", "default", "我的学习习惯怎么样", options)
    assert [p["category"] for p in focused.profiles()] == ["learning"]
    zero = ContextPlan(db, config, "a", "default", "总结一下我", {**options, "memory_budget_tokens": 0})
    assert zero.profiles() == []


def test_selected_profile_citations_register_both_ids_and_link_to_memory():
    from app.application.context.plan import register_profile_evidence
    evidence = {"memory": {"id": "memory", "content": "原文"}}
    register_profile_evidence(evidence, [{"id": "profile", "material_id": "profile:profile:2",
        "content": "明确偏好", "evidence_ids": ["memory"], "origin": "self_report"}])
    assert evidence["profile"]["citation_id"] == "memory"
    assert evidence["profile:profile:2"] == evidence["profile"]
    assert "invented" not in evidence
    assert evidence["memory"]["content"] == "原文"
    register_profile_evidence(evidence, [{"id": "unsupported", "evidence_ids": []}])
    assert "unsupported" not in evidence


def test_learning_advice_routes_and_preserves_conditional_suggestions(setup):
    from app.application.context.plan import profile_review_scope
    from app.application.runtime import guard_missing_completion
    assert profile_review_scope("我最近有哪些可以学习的东西") == "learning_advice"
    assert profile_review_scope("我应该学什么") == "learning_advice"
    text = "如果还没有完成基础练习，可以先尝试 SQL。"
    assert guard_missing_completion(text, []) == text
    assert "无法确认" in guard_missing_completion("你还没有完成项目。", [])


def test_background_digest_reuse_and_invalidation(setup):
    import asyncio
    import json
    from app.domain.profile_digest import refresh_digests, invalidate_digest
    db, config, _ = setup
    class Provider:
        calls = 0
        async def structured(self, prompt, text):
            self.calls += 1
            return {"items": [{"id": item["id"], "content": "先读文档"} for item in json.loads(text)]}
    with db.session() as session:
        memory = Memory(owner="a", project="default", kind="fact", title="学习", content="先阅读官方文档再实践")
        session.add(memory)
        session.flush()
        session.add(Profile(owner="a", category="learning", content=memory.content, origin="self_report", state="active", evidence_ids=[memory.id]))
    provider = Provider()
    invalidate_digest("a")
    asyncio.run(refresh_digests(db, provider, "a"))
    asyncio.run(refresh_digests(db, provider, "a"))
    assert provider.calls == 1
    options = {"memory_budget_tokens": 6400}
    plan = ContextPlan(db, config, "a", "default", "我应该学什么", options)
    assert plan.profiles()[0]["content"] == "先读文档"
    assert plan.report["profile_digest"]["kind"] == "background_summary"
    invalidate_digest("a")
    fallback = ContextPlan(db, config, "a", "default", "我应该学什么", options)
    assert fallback.profiles()[0]["content"] == "先阅读官方文档再实践"
