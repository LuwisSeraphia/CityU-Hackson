"""Deleting chat history must not erase saved personal memory."""

import pytest
from fastapi.testclient import TestClient
from app.config import Settings
from app.db import Database, Conversation, Message, Memory, Source, Run, owned
from app.errors import AppError
from app.main import create_app
from app.application.conversations import delete_conversation
from test_memory import FakeProvider


def test_delete_conversation_is_owner_scoped_idempotent_and_preserves_memory():
    db = Database("sqlite://", testing=True)
    settings = Settings(
        api_token="test", owner_id="a", worker_enabled=False, memory_v2_enabled=True, _env_file=None
    )
    with TestClient(
        create_app(settings, database=db, provider=FakeProvider()),
        headers={"Authorization": "Bearer test"},
    ) as client:
        cid = client.post("/api/v1/conversations", json={}).json()["id"]
        with db.session() as session:
            message = Message(owner="a", conversation_id=cid, role="user", content="偏好安静")
            session.add(message)
            session.flush()
            source = Source(
                owner="a",
                conversation_id=cid,
                message_id=message.id,
                request_key="source",
                content="偏好安静",
            )
            session.add(source)
            session.flush()
            session.add(
                Memory(
                    owner="a", kind="fact", title="偏好", content="偏好安静", source_ids=[source.id]
                )
            )
        with pytest.raises(AppError):
            delete_conversation(db, "other", cid)
        assert client.delete(f"/api/v1/conversations/{cid}").status_code == 200
        assert client.delete(f"/api/v1/conversations/{cid}").status_code == 200
        assert client.get("/api/v1/workspace").json()["conversations"] == []
        assert client.get(f"/api/v1/conversations/{cid}").status_code == 404
        with db.session() as session:
            assert session.query(Message).one().content == ""
            assert session.query(Memory).one().content == "偏好安静"
            assert session.query(Source).one().content == "偏好安静"
            with pytest.raises(AppError):
                owned(session, Conversation, cid, "a")


def test_running_conversation_cannot_be_deleted():
    db = Database("sqlite://", testing=True)
    db.migrate()
    with db.session() as session:
        conv = Conversation(owner="a")
        session.add(conv)
        session.flush()
        cid = conv.id
        session.add(Run(owner="a", conversation_id=cid, request_key="run", status="RUNNING"))
    with pytest.raises(AppError) as error:
        delete_conversation(db, "a", cid)
    assert error.value.code == "CONVERSATION_BUSY"
    with db.session() as session:
        assert owned(session, Conversation, cid, "a")
