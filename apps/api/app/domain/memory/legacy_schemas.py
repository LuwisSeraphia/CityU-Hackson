"""Structured output for the legacy memory extractor."""

from typing import Literal
from pydantic import Field
from app.validation import Strict


class Candidate(Strict):
    kind: Literal["fact", "episode"]
    title: str = Field(min_length=1, max_length=100)
    content: str = Field(min_length=1, max_length=2000)
    claim_key: str = Field(min_length=1, max_length=200)
    evidence: str = Field(min_length=1, max_length=4000)
    modality: Literal["confirmed", "planned", "uncertain"]
    attribution: Literal["user", "third_party"]
    important: bool
    event_time: str | None = None


class Extraction(Strict):
    candidates: list[Candidate] = Field(max_length=20)
