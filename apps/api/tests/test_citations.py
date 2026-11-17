from app.application.context.citations import normalize_citations
from app.application.context.plan import register_profile_evidence


def test_exact_known_aliases_only():
    evidence = {"profile:abc:1": {"id": "abc"}}
    assert normalize_citations("内容[来源：profile:abc:1]", evidence) == "内容[profile:abc:1]"
    assert normalize_citations("[profile:unknown:1]", evidence) == "[profile:unknown:1]"
    assert normalize_citations("[来源 1]", evidence) == "[来源 1]"


def test_profile_ids_retain_readable_citation_target():
    evidence = {}
    register_profile_evidence(evidence, [{"id": "p", "material_id": "profile:p:1", "evidence_ids": ["m"], "content": "偏好"}])
    for key in ("p", "profile:p:1"):
        assert evidence[key]["citation_id"] == "m"
    assert "m" not in evidence  # Evidence IDs are not automatically treated as supplied text.
