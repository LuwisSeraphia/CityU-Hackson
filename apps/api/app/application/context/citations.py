"""Normalize citation syntax only when the exact ID was provided this turn."""
import re


def normalize_citations(text, evidence):
    def replace(match):
        original = match.group(1)
        if original in evidence:
            return match.group(0)
        candidate = re.sub(r"^(?:来源|证据|source|evidence)\s*[:：]\s*", "", original.strip(), flags=re.I).strip()
        if candidate in evidence:
            return "[" + candidate + "]"
        return match.group(0)
    return re.sub(r"\[([^\[\]\n]+)\]", replace, text)
