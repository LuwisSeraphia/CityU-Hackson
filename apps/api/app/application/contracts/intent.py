"""Versioned information planning contracts. No execution privileges."""

from typing import Literal
from uuid import uuid4
from datetime import datetime
from pydantic import Field, model_validator
from app.validation import Strict


class InformationNeed(Strict):
    need_id: str = Field(min_length=1, max_length=64)
    source: Literal["profile", "memory", "file", "web"]
    purpose: Literal[
        "background", "preference", "goal", "constraint", "event", "evidence", "current_information"
    ]
    query: str = Field(min_length=1, max_length=500)
    topics: list[str] = Field(default_factory=list, max_length=8)
    time_scope: Literal["current", "recent", "history", "range", "unspecified"] = "unspecified"
    start_at: datetime | None = None
    end_at: datetime | None = None
    depends_on: list[str] = Field(default_factory=list, max_length=6)
    priority: Literal["required", "useful", "optional"] = "useful"


class IntentPlan(Strict):
    schema_version: Literal[1] = 1
    task: Literal[
        "answer", "advise", "recall", "review", "transform", "action_request", "clarify"
    ] = "answer"
    subject: Literal["self", "external", "document", "mixed", "unknown"] = "unknown"
    needs: list[InformationNeed] = Field(default_factory=list, max_length=6)
    response_style: Literal["explain", "listen", "plan", "troubleshoot", "celebrate"] = "explain"
    clarification: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def unique_needs(self):
        if len({n.need_id for n in self.needs}) != len(self.needs):
            raise ValueError("duplicate need IDs")
        lookup = {n.need_id: n for n in self.needs}

        def visit(identifier, stack):
            if identifier in stack:
                raise ValueError("cyclic dependencies")
            if identifier not in lookup:
                raise ValueError("unknown dependency")
            for dependency in lookup[identifier].depends_on:
                visit(dependency, stack | {identifier})

        for need in self.needs:
            visit(need.need_id, set())
            if need.time_scope == "range" and (
                not need.start_at or not need.end_at or need.start_at > need.end_at
            ):
                raise ValueError("invalid time range")
        return self


class PlannedIntent(Strict):
    plan_id: str = Field(default_factory=lambda: str(uuid4()))
    origin: Literal["rule", "model", "fallback"]
    degraded_reason: str | None = None
    plan: IntentPlan
