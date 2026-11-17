import json
from typing import Literal

from pydantic import Field, field_validator

from app.validation import Strict, validate_text

Kind = Literal[
    "note",
    "claim",
    "experience",
    "thought",
    "question",
    "decision",
    "preference",
    "state",
    "pattern",
]


class CollectionInput(Strict):
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=4000)
    tags: list[str] = Field(default_factory=list, max_length=32)


class ItemInput(Strict):
    text: str = Field(min_length=1, max_length=16000)
    title: str = Field(default="", max_length=200)
    kind: Kind = "note"
    collection_ids: list[str] = Field(min_length=1, max_length=32)
    modality: Literal["asserted", "hypothetical", "planned", "uncertain"] = "asserted"
    attributes: dict = Field(default_factory=dict)
    evidence_ids: list[str] = Field(default_factory=list, max_length=32)

    @field_validator("text")
    @classmethod
    def safe(cls, value):
        return validate_text(value)

    @field_validator("attributes")
    @classmethod
    def bounded(cls, value):
        def check(node, depth=0):
            if depth > 3:
                raise ValueError("属性嵌套过深")
            if isinstance(node, dict):
                if len(node) > 32 or {"owner", "approved", "review_status"} & node.keys():
                    raise ValueError("属性包含保留字段或过多字段")
                for child in node.values():
                    check(child, depth + 1)
            elif isinstance(node, list):
                for child in node:
                    check(child, depth + 1)

        check(value)
        if len(json.dumps(value, ensure_ascii=False).encode()) > 16384:
            raise ValueError("属性过大")
        return value


class RevisionInput(ItemInput):
    base_version_id: str


class ConnectionInput(Strict):
    from_id: str
    to_id: str
    from_version_id: str
    to_version_id: str
    explanation_raw: str = Field(min_length=1, max_length=8000)

    @field_validator("explanation_raw")
    @classmethod
    def safe(cls, value):
        return validate_text(value, 8000)


class SearchInput(Strict):
    query: str = Field(min_length=1, max_length=500)
    collection_ids: list[str] = Field(min_length=1, max_length=32)
    limit: int = Field(default=20, ge=1, le=100)


class DecisionInput(Strict):
    decision: Literal["approve", "reject"]


class DeleteInput(Strict):
    base_version_id: str


class FeedbackInput(Strict):
    kind: Literal["helpful", "unhelpful", "correction", "override"]
    text: str = Field(min_length=1, max_length=4000)
