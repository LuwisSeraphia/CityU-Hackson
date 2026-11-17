import asyncio
from app.application.contracts.intent import IntentPlan, PlannedIntent, InformationNeed
from app.application.context.plan import ContextPlan
from app.application.information import InformationCoordinator
from app.config import Settings


class Retriever:
    calls = 0

    async def search(self, owner, project, query, **kwargs):
        self.calls += 1
        self.history = kwargs["history"]
        return {"items": [{"id": "m", "content": "有效证据", "version": 1}]}


def execute(allowed=True, budget=3200):
    retriever = Retriever()
    intent = PlannedIntent(
        origin="model",
        plan=IntentPlan(
            needs=[
                InformationNeed(
                    need_id="m",
                    source="memory",
                    purpose="event",
                    query="项目",
                    time_scope="history",
                )
            ]
        ),
    )
    plan = ContextPlan(
        None,
        Settings(_env_file=None),
        "a",
        "default",
        "问题",
        {"memory_budget_tokens": budget, "retrieval_rounds": 2},
        intent=intent,
    )
    items, results = asyncio.run(
        InformationCoordinator(retriever).prefetch(
            intent, {"owner": "a", "project": "default", "personal_allowed": allowed}, plan
        )
    )
    return retriever, items, results


def test_pretrieval_does_not_wait_for_model_tool_call():
    retriever, items, results = execute()
    assert retriever.calls == 1 and retriever.history
    assert items and results[0]["status"] == "found"


def test_permissions_and_zero_budget_do_not_execute_search():
    for allowed, budget in [(False, 3200), (True, 0)]:
        retriever, items, results = execute(allowed, budget)
        assert retriever.calls == 0 and not items
        assert results[0]["status"] == "blocked"


def test_zero_personal_budget_does_not_disable_file_information():
    class Controller:
        async def execute(self, name, arguments, scope):
            assert name == "search_files"
            return {"items": [{"id": "f", "content": "文件正文"}]}

    intent = PlannedIntent(
        origin="model",
        plan=IntentPlan(
            needs=[InformationNeed(need_id="f", source="file", purpose="evidence", query="文件")]
        ),
    )
    plan = ContextPlan(
        None,
        Settings(_env_file=None),
        "a",
        "default",
        "文件",
        {"memory_budget_tokens": 0, "retrieval_rounds": 1},
        intent=intent,
    )
    items, results = asyncio.run(
        InformationCoordinator(Retriever(), Controller()).prefetch(
            intent, {"owner": "a", "project": "default", "personal_allowed": False}, plan
        )
    )
    assert items[0]["id"] == "f"
    assert results[0]["status"] == "found"
