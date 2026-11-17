from app.infrastructure.db import Memory, Message, Proposal, Source, owned


def message_view(session, message):
    data = dict(message.data)
    if (
        proposal := session.query(Proposal)
        .filter_by(message_id=message.id, owner=message.owner)
        .first()
    ):
        receipt = dict(data.get("receipt", {}))
        receipt["proposal"] = {
            "id": proposal.id,
            "baseVersionId": proposal.base_id or "",
            "before": proposal.before,
            "after": proposal.content,
            "status": proposal.status,
            "reason": proposal.reason,
            "factId": proposal.fact_id,
            "createdAt": proposal.created,
        }
        data["receipt"] = receipt
    return {
        "id": message.id,
        "role": message.role,
        "text": message.content,
        "createdAt": message.created,
        **data,
    }


def conversation_view(session, conversation):
    messages = (
        session.query(Message)
        .filter_by(owner=conversation.owner, conversation_id=conversation.id)
        .order_by(Message.created, Message.id)
        .all()
    )
    return {
        "id": conversation.id,
        "title": conversation.title,
        "updatedAt": conversation.updated,
        "messages": [message_view(session, m) for m in messages],
    }


def memory_view(session, memory, detail=False):
    result = {
        "id": memory.id,
        "factId": memory.fact_id if memory.kind == "fact" else None,
        "title": memory.title,
        "text": memory.content,
        "kind": memory.kind,
        "status": memory.status,
        "version": memory.version,
        "createdAt": memory.created,
        "eventTime": memory.event_time,
    }
    if detail and memory.status != "deleted":
        result["originalRecords"] = [
            {"id": row.id, "text": row.content, "createdAt": row.created}
            for row in session.query(Source)
            .filter(Source.owner == memory.owner, Source.id.in_(memory.source_ids))
            .all()
        ]
        if memory.fact_id:
            versions = (
                session.query(Memory)
                .filter_by(owner=memory.owner, fact_id=memory.fact_id)
                .filter(Memory.status.in_(["current", "historical", "planned", "corrected"]))
                .all()
            )
            result["versions"] = [memory_view(session, row) for row in versions]
    return result


def evidence_view(session, identifier, owner):
    if identifier.startswith("raw:"):
        row = owned(session, Source, identifier[4:], owner)
        return {
            "id": identifier,
            "title": "原始记录",
            "text": row.content,
            "kind": "source",
            "status": "current",
            "version": 1,
            "createdAt": row.created,
        }
    return memory_view(session, owned(session, Memory, identifier, owner), True)
