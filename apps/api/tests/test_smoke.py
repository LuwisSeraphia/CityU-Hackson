import pytest

from app.db import Database, Memory, uid
from app.errors import AppError
from app.smoke import memory_checkpoint


def test_noop_is_not_misreported_as_persistence_failure():
    db = Database("sqlite://", testing=True)
    db.migrate()
    with pytest.raises(AppError) as caught:
        memory_checkpoint(db, "verification-" + uid())
    assert caught.value.code == "SMOKE_MEMORY_EMPTY"
    assert caught.value.stage == "extract"


def test_saved_but_unindexed_fact_is_reported_as_index_failure():
    db = Database("sqlite://", testing=True)
    db.migrate()
    with db.session() as session:
        session.add(Memory(owner="test", kind="fact", title="偏好", content="合成测试偏好"))
    with pytest.raises(AppError) as caught:
        memory_checkpoint(db, "test")
    assert caught.value.code == "SMOKE_MEMORY_INDEX"


def test_checkpoint_requires_fact_current_state_and_vector(tmp_path):
    url = "sqlite:///" + str(tmp_path / "checkpoint.db")
    db = Database(url, testing=True)
    db.migrate()
    with db.session() as session:
        row = Memory(owner="test", kind="fact", title="偏好", content="合成偏好", status="planned")
        session.add(row)
        session.flush()
        identifier = row.id
    with pytest.raises(AppError) as caught:
        memory_checkpoint(db, "test")
    assert caught.value.code == "SMOKE_MEMORY_STATE"
    with db.session() as session:
        row = session.get(Memory, identifier)
        row.status, row.index_status, row.embedding = "current", "READY", [1.0, 0.0, 0.0]
    before = memory_checkpoint(db, "test")
    db.engine.dispose()
    reconnected = Database(url, testing=True)
    assert memory_checkpoint(reconnected, "test") == before == {identifier}
    with pytest.raises(AppError):
        memory_checkpoint(reconnected, "other-owner")
