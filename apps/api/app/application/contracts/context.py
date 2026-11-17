from typing import Literal
from pydantic import Field
from app.validation import Strict


class ResponseOptions(Strict):
    mode: Literal["auto", "fast", "personalized", "deep"] = "auto"
    memory_budget_tokens: int | None = Field(default=None, ge=0, le=6400)
    history_scope: Literal["recent", "current_stage", "all"] = "current_stage"
    retrieval_rounds: int | None = Field(default=None, ge=1, le=3)
