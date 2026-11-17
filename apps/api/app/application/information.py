"""Information acquisition orchestration; retrieval algorithms remain in domain."""

import hashlib
import json
import time
from app.errors import AppError


class InformationCoordinator:
    def __init__(self, retriever, controller=None):
        self.retriever, self.controller = retriever, controller

    async def prefetch(self, intent, context, plan):
        results, items, seen, completed = [], [], {}, {}
        remaining = plan.options["retrieval_rounds"]
        tools_left = context.get("max_tools", 12)
        lookup = {need.need_id: need for need in intent.plan.needs}
        ordered = []

        def order(need):
            for identifier in need.depends_on:
                order(lookup[identifier])
            if need not in ordered:
                ordered.append(need)

        for need in sorted(
            intent.plan.needs, key=lambda n: {"required": 0, "useful": 1, "optional": 2}[n.priority]
        ):
            order(need)
        for need in ordered:
            result = {"need_id": need.need_id, "source": need.source, "status": "not_requested"}
            results.append(result)
            completed[need.need_id] = result
            if need.source in ("profile", "memory") and (
                not context.get("personal_allowed", False)
                or plan.options["memory_budget_tokens"] == 0
            ):
                result["status"] = "blocked"
                continue
            if need.source == "profile":
                result["reason"] = "context_selection"
                continue
            if any(
                completed[d]["status"] in ("blocked", "failed", "budget_excluded")
                for d in need.depends_on
            ):
                result.update(status="blocked", reason="dependency_unavailable")
                continue
            key = (need.source, need.query, need.time_scope, str(need.start_at), str(need.end_at))
            result["query_hash"] = hashlib.sha256(json.dumps(key).encode()).hexdigest()
            if key in seen:
                result.update(
                    status=seen[key]["status"],
                    reason="reused_query",
                    selected_count=seen[key].get("selected_count", 0),
                )
                continue
            if tools_left <= 0 or (need.source == "memory" and remaining <= 0):
                result["status"] = "budget_excluded"
                continue
            if need.source != "memory" and self.controller is None:
                result.update(status="failed", reason="tool_controller_unavailable")
                continue
            tools_left -= 1
            result["tool"] = {
                "memory": "search_memory",
                "file": "search_files",
                "web": "web_search",
            }[need.source]
            started = time.monotonic()
            try:
                if need.source == "memory":
                    remaining -= 1
                    found = await self.retriever.search(
                        context["owner"],
                        context["project"],
                        need.query,
                        history=need.time_scope in ("history", "range"),
                    )
                else:
                    found = await self.controller.execute(
                        result["tool"], json.dumps({"query": need.query}), context
                    )
                candidates = found["items"]
                if need.time_scope == "range":
                    candidates = [
                        item
                        for item in candidates
                        if item.get("event_time")
                        and need.start_at.date().isoformat()
                        <= item["event_time"][:10]
                        <= need.end_at.date().isoformat()
                    ]
                if need.source == "memory":
                    selected = plan.select(candidates, plan.options["memory_budget_tokens"] // 2)
                else:
                    selected = [
                        {**item, "content": str(item.get("content", ""))[:5000]}
                        for item in candidates[:6]
                    ]
                items.extend(selected)
                if need.source == "memory" and need.time_scope not in ("history", "range"):
                    context.setdefault("prefetched_queries", {})[need.query] = [
                        item["id"] for item in selected
                    ]
                result.update(
                    status="found" if selected else "budget_excluded" if candidates else "empty",
                    candidate_count=len(candidates),
                    selected_count=len(selected),
                    material_ids=[item["id"] for item in selected],
                )
            except AppError as error:
                result.update(status="failed", error_code=error.code)
            finally:
                result["elapsed_ms"] = round((time.monotonic() - started) * 1000)
            seen[key] = result
        plan.report["retrieval_rounds"] = plan.options["retrieval_rounds"] - remaining
        plan.report["prefetch_tool_count"] = context.get("max_tools", 12) - tools_left
        return items, results
