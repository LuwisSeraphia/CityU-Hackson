from typing import Literal

from pydantic import Field, model_validator, field_validator

from app.validation import Strict


class Change(Strict):
    request_id: str = Field(min_length=1, max_length=128)
    expected_revision: int = Field(ge=1)


class PolicyChange(Change):
    mode: Literal["on", "off"]


class Record(Strict):
    request_id: str = Field(min_length=1, max_length=128)
    conversation_id: str
    text: str = Field(min_length=1, max_length=16000)
    timezone: str = "Asia/Shanghai"
    mode: Literal["explicit", "authorized"] = "explicit"

    @field_validator("timezone")
    @classmethod
    def valid_timezone(cls, value):
        from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as error:
            raise ValueError("unknown timezone") from error
        return value


class Extracted(Strict):
    kind: Literal["fact", "episode"]
    title: str = Field(min_length=1, max_length=100)
    content: str = Field(min_length=1, max_length=2000)
    subject: str = Field(min_length=1, max_length=200)
    predicate: str = Field(min_length=1, max_length=200)
    evidence: str = Field(min_length=1, max_length=4000)
    context: dict = Field(default_factory=dict)
    assertion_kind: Literal["explicit", "inferred"] = "explicit"
    temporal_status: Literal["planned", "active", "completed", "cancelled", "uncertain"]
    event_time: str | None = None
    sensitivity: Literal["normal", "private"] = "normal"
    profile_category: (
        Literal["background", "goal", "learning", "lifestyle", "communication", "personality"]
        | None
    ) = None


class Extraction(Strict):
    candidates: list[Extracted] = Field(max_length=50)
    mixed_narrative: bool = False


class Decision(Strict):
    candidate_id: str
    expected_revision: int = Field(ge=1)
    action: Literal["accept", "reject"]
    defer_profile: bool = False
    reason: Literal["change", "correction"] = "change"


class Decisions(Change):
    decisions: list[Decision] = Field(min_length=1, max_length=50)

    @model_validator(mode="after")
    def unique_ids(self):
        if len({x.candidate_id for x in self.decisions}) != len(self.decisions):
            raise ValueError("duplicate candidate IDs")
        return self


class Edit(Change):
    content: str = Field(min_length=1, max_length=4000)


class Revision(Edit):
    reason: Literal["change", "correction"]
    context: dict | None = None


class ProfileDecision(Change):
    action: Literal["accept", "reject"]


class ProfileChange(Change):
    state: Literal["active", "paused"] | None = None
    pinned: bool | None = None


class Target(Strict):
    type: Literal["memory", "source", "message", "profile"]
    id: str
    expected_revision: int = Field(default=1, ge=1)


class Deletion(Strict):
    request_id: str = Field(min_length=1, max_length=128)
    scope: Literal["remove_memory", "erase_records"]
    targets: list[Target] = Field(min_length=1, max_length=100)
