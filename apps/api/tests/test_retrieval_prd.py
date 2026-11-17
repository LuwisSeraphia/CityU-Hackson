"""Validate the executable specification's examples and requirement references."""

import json
import re
from pathlib import Path


DOCUMENT = Path(__file__).resolve().parents[3] / "docs/memory-retrieval-observability-prd.md"


def test_prd_requirement_ids_are_unique_and_examples_are_valid():
    content = DOCUMENT.read_text(encoding="utf-8")
    identifiers = re.findall(r"^### (FR-\d+)\b", content, re.M)
    assert identifiers == [f"FR-{i:02d}" for i in range(1, 16)]
    examples = [json.loads(block) for block in re.findall(r"```json\n(.*?)\n```", content, re.S)]
    assert len(examples) == 2
    retrieval, trace = examples
    assert retrieval["items"] == []
    assert retrieval["diagnostics"]["outcome"] == "no_relevant_memory"
    assert retrieval["diagnostics"]["selected_count"] == len(retrieval["items"])
    assert trace["schema_version"] == 1
    assert trace["usage"]["prompt_tokens"] is None
    assert trace["usage"]["coverage"] == "unknown"


def test_prd_evaluation_query_ranges_cover_thirty_cases_once():
    content = DOCUMENT.read_text(encoding="utf-8")
    cases = []
    for start, end in re.findall(r"\| Q(\d{2})–Q(\d{2})\s*\|", content):
        cases.extend(range(int(start), int(end) + 1))
    assert cases == list(range(1, 31))


def test_revision_requires_constraint_pretrieval_without_preference_classifier():
    content = DOCUMENT.read_text(encoding="utf-8")
    section = content.split("### FR-02", 1)[1].split("## 6.", 1)[0]
    assert "服务端执行一次相关记忆预检索" in section
    assert "不做额外 LLM 分类" in section
    assert "不能伪造成模型发出的 tool_call" in section
    assert "预检索结果也计入" in content
