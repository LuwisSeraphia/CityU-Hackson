import asyncio

from app.db import Conversation, Job, Memory, Run, Suppression, ToolExecution
from app.memory import MemoryService, hour_values
from app.runtime import AgentRuntime, guard_missing_completion
from test_memory import candidate, save
from test_memory import environment as environment


def test_missing_completion_does_not_become_negative_fact():
    evidence = [{"content": "计划12月完成原型", "status": "planned"}]
    answer = guard_missing_completion("你的原型尚未完成，目前处于开发启动前。", evidence)
    assert "无法确认" in answer and "开发启动前" not in answer
    assert not answer.startswith("你的原型尚未完成")
    explicit = [{"content": "用户明确说原型尚未完成", "status": "current"}]
    assert guard_missing_completion("原型尚未完成。", explicit) == "原型尚未完成。"


def test_hour_values_preserve_changed_numbers():
    assert hour_values("八个小时") == hour_values("8 小时") == [8]
    assert hour_values("四个小时") == [4]
    assert hour_values("十二小时") == [12]
    assert hour_values("2.5小时") == [2.5]


def test_quote_repair_preserves_candidate_and_rejects_fabrication(environment):
    db, settings, provider, _, cid = environment
    source = "我偏好给测试记录使用编号 QH"
    provider.candidates = [candidate("用户偏好给测试记录使用编号 QH", evidence="用户使用QH")]
    original = provider.structured

    async def structured(prompt, content):
        if "修复证据引用" in prompt:
            return {"quotes": [{"index": 0, "evidence": source}]}
        return await original(prompt, content)

    provider.structured = structured
    memory = MemoryService(db, provider, settings)
    job = memory.enqueue("a", cid, source, "quote-repair")
    asyncio.run(memory.process(job))
    with db.session() as s:
        assert s.get(Job, job).state == "SUCCEEDED"
        assert s.query(Memory).one().content == provider.candidates[0]["content"]

    async def invalid(prompt, content):
        if "修复证据引用" in prompt:
            return {"quotes": [{"index": 0, "evidence": "不存在的原文"}]}
        return await original(prompt, content)

    provider.structured = invalid
    job = memory.enqueue("a", cid, source, "quote-invalid")
    asyncio.run(memory.process(job))
    with db.session() as s:
        assert s.get(Job, job).error["code"] == "EVIDENCE_INVALID"
        assert s.query(Memory).count() == 1


def test_update_recheck_merges_equivalent_but_keeps_real_change(environment):
    db, _, provider, _, _ = environment
    provider.candidates = [candidate("我每周可投入8小时")]
    save(environment, "我每周可投入8小时")
    with db.session() as s:
        old_id = s.query(Memory).one().id
    equivalent = True

    async def structured(prompt, content):
        if "复核更新" in prompt:
            return {"equivalent": equivalent}
        if "relations" in prompt:
            return {
                "relations": [
                    {
                        "index": 0,
                        "existing_id": old_id,
                        "relation": "update" if equivalent else "duplicate",
                    }
                ]
            }
        return {"candidates": provider.candidates}

    provider.structured = structured
    provider.candidates = [candidate("我每周可投入八小时")]
    save(environment, "我每周可投入八小时", "same")
    with db.session() as s:
        assert s.query(Memory).count() == 1
        assert len(s.get(Memory, old_id).source_ids) == 2
    equivalent = False
    provider.candidates = [candidate("我每周可投入4小时")]
    job = save(environment, "我每周可投入4小时", "changed")
    with db.session() as s:
        assert s.get(Job, job).payload["proposal_ids"]
        assert s.get(Memory, old_id).content == "我每周可投入8小时"


def test_prior_urls_require_success_same_owner_conversation_and_forgetting_cutoff(environment):
    db, _, _, _, cid = environment
    with db.session() as s:
        other = Conversation(owner="b")
        s.add(other)
        s.flush()
        for key, owner, conversation, status in [
            ("good", "a", cid, "SUCCEEDED"),
            ("failed", "a", cid, "FAILED"),
            ("other", "b", other.id, "SUCCEEDED"),
        ]:
            r = Run(owner=owner, conversation_id=conversation, request_key=key)
            s.add(r)
            s.flush()
            s.add(
                ToolExecution(
                    owner=owner,
                    run_id=r.id,
                    call_id=key,
                    name="web_search",
                    status=status,
                    result={"output": {"items": [{"url": "https://" + key + ".example/"}]}},
                )
            )
        current = Run(owner="a", conversation_id=cid, request_key="current")
        s.add(current)
        s.flush()
        assert AgentRuntime.prior_urls(None, s, current) == {"https://good.example/"}
        s.add(Suppression(owner="a", claim_key="deleted", source_ids=[], created="9999"))
        s.flush()
        assert AgentRuntime.prior_urls(None, s, current) == set()
