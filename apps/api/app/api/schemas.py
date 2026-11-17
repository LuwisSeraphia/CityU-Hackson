from app.application.contracts.context import ResponseOptions as ResponseOptions
from typing import Literal

from pydantic import Field, field_validator

from app.validation import Strict as Strict, validate_text as validate_text
from app.domain.memory.legacy_schemas import Candidate as Candidate, Extraction as Extraction


class ChatInput(Strict):
    response_options: ResponseOptions | None = None
    knowledge_collection_ids: list[str] = Field(default_factory=list, max_length=32)
    conversation_id: str
    text: str = Field(min_length=1, max_length=16000)
    request_id: str = Field(min_length=1, max_length=128)
    file_ids: list[str] = Field(default_factory=list, max_length=10)
    retry_message_id: str | None = None
    memory_policy_override: Literal["default", "skip"] = "default"

    @field_validator("text")
    @classmethod
    def safe(cls, value):
        return validate_text(value)


class RecordInput(Strict):
    conversation_id: str
    text: str = Field(min_length=1, max_length=16000)
    client_timezone: str = "Asia/Shanghai"


class Revision(Strict):
    base_version_id: str | None = None
    text: str = Field(min_length=1, max_length=4000)
