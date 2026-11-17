import asyncio
import pytest
from pydantic import ValidationError
from app.application.contracts.intent import IntentPlan
from app.application.intent.planner import IntentPlanner


def test_duplicate_need_ids_rejected():
    need = dict(need_id="x", source="memory", purpose="event", query="项目")
    with pytest.raises(ValidationError):
        IntentPlan(needs=[need, need])


def test_model_and_fallback_are_distinct():
    class Provider:
        async def structured(self, *args):
            return {
                "task": "recall",
                "subject": "self",
                "needs": [
                    {
                        "need_id": "history",
                        "source": "memory",
                        "purpose": "event",
                        "query": "项目决策",
                    }
                ],
            }

    result = asyncio.run(IntentPlanner(Provider()).plan("当时为什么放弃方案", []))
    assert result.origin == "model"
    assert result.plan.needs[0].source == "memory"

    class Broken:
        async def structured(self, *args):
            raise ValueError("invalid")

    result = asyncio.run(IntentPlanner(Broken()).plan("我的学习习惯怎么样", []))
    assert result.origin == "fallback" and result.degraded_reason
    assert any(n.source == "memory" for n in result.plan.needs)


def test_planner_does_not_accept_privilege_fields():
    with pytest.raises(ValidationError):
        IntentPlan(owner="someone_else")


def test_dependencies_and_ranges_reject_unsafe_shapes():
    a = dict(need_id="a", source="memory", purpose="event", query="项目", depends_on=["b"])
    b = dict(need_id="b", source="memory", purpose="event", query="项目", depends_on=["a"])
    with pytest.raises(ValidationError):
        IntentPlan(needs=[a, b])
    with pytest.raises(ValidationError):
        IntentPlan(needs=[{**a, "depends_on": [], "time_scope": "range"}])
