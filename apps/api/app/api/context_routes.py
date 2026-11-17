from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import model_validator

from app.infrastructure.db import Conversation, Memory, owned
from app.errors import AppError
from app.api.schemas import ResponseOptions
from app.domain.memory.schemas import Change
from app.domain.memory.models import ResponseSettings, MemoryUsePolicy, FollowupConsent, WorkingState
from app.domain.memory.service import check_revision, invalidate, serialize
from app.application.context.plan import working_state_view


class SettingsChange(Change, ResponseOptions):
    pass


class UsePolicyChange(Change):
    recall_policy: Literal["explicit_only", "explicit_or_continuation"] = "explicit_or_continuation"
    do_not_mention: bool = True
    detail_level: Literal["summary", "detail"] = "summary"
    allow_profile_inference: bool = False


class ConsentChange(Change):
    scope: str
    not_before: datetime
    expires_at: datetime
    channel: Literal["conversation"] = "conversation"

    @model_validator(mode="after")
    def window(self):
        if (
            not self.not_before.tzinfo
            or not self.expires_at.tzinfo
            or self.expires_at <= self.not_before
        ):
            raise ValueError("invalid time window")
        if not self.scope.strip() or len(self.scope) > 500:
            raise ValueError("invalid scope")
        return self


def router(state, ready, settings):
    routes = APIRouter(prefix="/api/v2")

    def auth(owner=Depends(ready)):
        if not settings.memory_v2_enabled:
            raise AppError("FEATURE_DISABLED", "V2尚未启用。", 409)
        return owner

    @routes.get("/settings/response")
    def get_settings(owner=Depends(auth)):
        with state["db"].session() as session:
            row = session.query(ResponseSettings).filter_by(owner=owner).first()
            return {
                "revision": row.revision if row else 1,
                "options": ResponseOptions.model_validate(row.options if row else {}).model_dump(),
                "limits": {
                    "memory_budget_max": settings.memory_budget_max,
                    "retrieval_rounds_max": settings.retrieval_rounds_max,
                },
                "count_method": "conservative_utf8_estimate",
                "native_reasoning_supported": False,
            }

    @routes.patch("/settings/response")
    def patch_settings(body: SettingsChange, owner=Depends(auth)):
        with state["db"].session() as session:

            def apply():
                row = (
                    session.query(ResponseSettings).filter_by(owner=owner).with_for_update().first()
                )
                if not row:
                    row = ResponseSettings(owner=owner, revision=1, options={})
                    session.add(row)
                check_revision(row, body.expected_revision)
                updates = body.model_dump(
                    exclude_unset=True, exclude={"request_id", "expected_revision"}
                )
                row.options = ResponseOptions.model_validate(
                    {**row.options, **updates}
                ).model_dump()
                row.revision += 1
                return {"revision": row.revision, "options": row.options}

            return state["memory_v2"].mutation(
                session, owner, "response-settings", body.model_dump(), apply
            )

    @routes.get("/memory/items/{identifier}/use-policy")
    def get_policy(identifier: str, owner=Depends(auth)):
        with state["db"].session() as session:
            owned(session, Memory, identifier, owner)
            row = (
                session.query(MemoryUsePolicy).filter_by(owner=owner, memory_id=identifier).first()
            )
            return (
                serialize(row)
                if row
                else {
                    "revision": 1,
                    "recall_policy": "explicit_or_continuation",
                    "do_not_mention": True,
                    "detail_level": "summary",
                    "allow_profile_inference": False,
                }
            )

    @routes.patch("/memory/items/{identifier}/use-policy")
    def patch_policy(identifier: str, body: UsePolicyChange, owner=Depends(auth)):
        with state["db"].session() as session:

            def apply():
                owned(session, Memory, identifier, owner, lock=True)
                row = (
                    session.query(MemoryUsePolicy)
                    .filter_by(owner=owner, memory_id=identifier)
                    .first()
                )
                if not row:
                    row = MemoryUsePolicy(owner=owner, memory_id=identifier, revision=1)
                    session.add(row)
                check_revision(row, body.expected_revision)
                for key, value in body.model_dump(
                    exclude={"request_id", "expected_revision"}
                ).items():
                    setattr(row, key, value)
                row.revision += 1
                if row.do_not_mention:
                    session.query(FollowupConsent).filter_by(
                        owner=owner, memory_id=identifier
                    ).update({"state": "revoked"})
                invalidate(session, owner)
                return {"revision": row.revision, "memory_id": identifier}

            return state["memory_v2"].mutation(
                session, owner, "use-policy:" + identifier, body.model_dump(), apply
            )

    @routes.post("/memory/items/{identifier}/followups")
    def followup(identifier: str, body: ConsentChange, owner=Depends(auth)):
        with state["db"].session() as session:

            def apply():
                memory = owned(session, Memory, identifier, owner, lock=True)
                if memory.status == "deleted":
                    raise AppError("MEMORY_UNAVAILABLE", "记忆已删除。", 409)
                policy = (
                    session.query(MemoryUsePolicy)
                    .filter_by(owner=owner, memory_id=identifier)
                    .first()
                )
                if body.expected_revision != (policy.revision if policy else 1):
                    raise AppError("VERSION_CONFLICT", "许可版本已变化。", 409)
                row = FollowupConsent(
                    owner=owner,
                    memory_id=identifier,
                    data=body.model_dump(mode="json"),
                    state="active",
                )
                session.add(row)
                session.flush()
                return {"id": row.id, "revision": row.revision, "delivery_supported": False}

            return state["memory_v2"].mutation(
                session, owner, "followup:" + identifier, body.model_dump(mode="json"), apply
            )

    @routes.post("/followups/{identifier}/revoke")
    def revoke(identifier: str, body: Change, owner=Depends(auth)):
        with state["db"].session() as session:

            def apply():
                row = owned(session, FollowupConsent, identifier, owner, lock=True)
                check_revision(row, body.expected_revision)
                row.state, row.revision = "revoked", row.revision + 1
                return {"id": row.id, "revision": row.revision, "state": row.state}

            return state["memory_v2"].mutation(
                session, owner, "revoke:" + identifier, body.model_dump(), apply
            )

    @routes.get("/conversations/{identifier}/working-state")
    def working(identifier: str, owner=Depends(auth)):
        with state["db"].session() as session:
            owned(session, Conversation, identifier, owner)
            row = (
                session.query(WorkingState)
                .filter_by(owner=owner, conversation_id=identifier)
                .first()
            )
            return {
                "revision": row.revision if row else 0,
                "data": working_state_view(row, settings) if row else {},
            }

    return routes
