"""Permission checks shared by retrieval, tools, and profile inference."""

import re
from contextvars import ContextVar

from sqlalchemy import or_

from app.infrastructure.db import Memory
from app.domain.memory.models import MemoryMeta, MemoryUsePolicy

request_context = ContextVar("personal_context", default=None)
SENSITIVE = re.compile("分手|前任|恋爱|感情|亲密|住址|病史|账户|性经历")


def allowed(session, owner, memory, text, *, detail=False, inference=False):
    meta = session.query(MemoryMeta).filter_by(owner=owner, memory_id=memory.id).first()
    policy = session.query(MemoryUsePolicy).filter_by(owner=owner, memory_id=memory.id).first()
    sensitive = bool(
        policy
        or (meta and meta.data.get("sensitivity") == "private")
        or SENSITIVE.search(memory.content)
    )
    if not sensitive:
        return True
    if inference:
        return bool(policy and policy.allow_profile_inference)
    # A low-confidence mood match never grants access. Explicit matching topic is required.
    matches = set(SENSITIVE.findall(memory.content)) & set(SENSITIVE.findall(text))
    if not matches:
        return False
    explicit = bool(re.search("记得|回忆|上次|之前|当时|那段|告诉过|详细|具体", text))
    if policy and policy.recall_policy == "explicit_only" and not explicit:
        return False
    if detail and not (explicit and re.search("详细|具体|原文", text)):
        return bool(policy and policy.detail_level == "detail")
    return True


def filter_query(session, query, owner, settings):
    """Applied BEFORE vectors and cloud reranking. Unknown context denies sensitive data."""
    if not settings.memory_v2_enabled:
        return query
    ctx = request_context.get()
    text = ctx["text"] if ctx and ctx["owner"] == owner else ""
    private_ids = session.query(MemoryUsePolicy.memory_id).filter_by(owner=owner)
    meta_ids = session.query(MemoryMeta.memory_id).filter(
        MemoryMeta.owner == owner, MemoryMeta.data["sensitivity"].as_string() == "private"
    )
    conditions = [Memory.id.in_(private_ids), Memory.id.in_(meta_ids)]
    conditions += [Memory.content.contains(word) for word in SENSITIVE.pattern.split("|")]
    candidates = query.filter(or_(*conditions)).all()
    blocked = [m.id for m in candidates if not allowed(session, owner, m, text)]
    return query.filter(~Memory.id.in_(blocked)) if blocked else query


def source_materials(session, owner, memory, text):
    """Return verified evidence spans, never unrelated text from a shared source."""
    from app.domain.memory.models import Evidence, Withdrawal
    from app.infrastructure.db import Source

    if not allowed(session, owner, memory, text, detail=True):
        return []
    rows = session.query(Evidence).filter_by(owner=owner, memory_id=memory.id).all()
    materials = []
    for evidence in rows:
        source = session.get(Source, evidence.source_id)
        if not source or source.owner != owner or source.project != memory.project:
            continue
        if session.query(Withdrawal).filter_by(owner=owner, source_id=source.id).first():
            continue
        if not 0 <= evidence.start < evidence.end <= len(source.content):
            continue
        identifier = f"source:{source.id}:{evidence.start}:{evidence.end}"
        materials.append(
            {
                "id": identifier,
                "material_id": identifier,
                "memory_id": memory.id,
                "source_id": source.id,
                "start": evidence.start,
                "end": evidence.end,
                "offset_unit": "unicode_codepoint",
                "version": memory.version,
                "content": source.content[evidence.start : evidence.end],
                "created_at": source.created,
            }
        )
    return materials
