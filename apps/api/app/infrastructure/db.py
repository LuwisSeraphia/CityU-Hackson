from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from threading import Lock
from uuid import uuid4

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    JSON,
    Boolean,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    create_engine,
    text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker
from sqlalchemy.pool import StaticPool

from app.errors import AppError


def uid():
    return str(uuid4())


_clock_lock = Lock()
_last_time = datetime.min.replace(tzinfo=timezone.utc)


def now():
    # A single local API process is enforced by the worker advisory lock. Windows'
    # wall clock can repeat within a flush, so preserve insertion order at microsecond precision.
    global _last_time
    with _clock_lock:
        _last_time = max(datetime.now(timezone.utc), _last_time + timedelta(microseconds=1))
        return _last_time.isoformat()


class Base(DeclarativeBase):
    pass


class Entity:
    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=uid)
    owner: Mapped[str] = mapped_column(String(128), index=True)
    created: Mapped[str] = mapped_column(String(40), default=now)


class Conversation(Entity, Base):
    __tablename__ = "conversations"
    title: Mapped[str] = mapped_column(Text, default="新的对话")
    project: Mapped[str] = mapped_column(String(128), default="default")
    updated: Mapped[str] = mapped_column(String(40), default=now)


class Message(Entity, Base):
    __tablename__ = "chat_messages"
    conversation_id: Mapped[str] = mapped_column(ForeignKey("conversations.id"), index=True)
    role: Mapped[str] = mapped_column(String(16))
    content: Mapped[str] = mapped_column(Text)
    data: Mapped[dict] = mapped_column(JSON, default=dict)


class Preference(Base):
    __tablename__ = "user_memory_settings"
    owner: Mapped[str] = mapped_column(String(128), primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    epoch: Mapped[int] = mapped_column(Integer, default=1)


class Source(Entity, Base):
    __tablename__ = "source_records"
    __table_args__ = (UniqueConstraint("owner", "request_key"),)
    content: Mapped[str] = mapped_column(Text)
    project: Mapped[str] = mapped_column(String(128), default="default")
    request_key: Mapped[str] = mapped_column(String(128))
    conversation_id: Mapped[str] = mapped_column(ForeignKey("conversations.id"))
    message_id: Mapped[str | None] = mapped_column(String(64), nullable=True)


class Fact(Entity, Base):
    __tablename__ = "atomic_facts"
    project: Mapped[str] = mapped_column(String(128), default="default")
    claim_key: Mapped[str] = mapped_column(Text)
    current_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    deleted: Mapped[bool] = mapped_column(Boolean, default=False)


class Memory(Entity, Base):
    __tablename__ = "memory_versions"
    __table_args__ = (UniqueConstraint("fact_id", "version"),)
    project: Mapped[str] = mapped_column(String(128), default="default")
    fact_id: Mapped[str | None] = mapped_column(
        ForeignKey("atomic_facts.id"), nullable=True, index=True
    )
    kind: Mapped[str] = mapped_column(String(16))
    title: Mapped[str] = mapped_column(Text)
    content: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(24), default="current", index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    source_ids: Mapped[list] = mapped_column(JSON, default=list)
    event_time: Mapped[str | None] = mapped_column(String(64), nullable=True)
    index_status: Mapped[str] = mapped_column(String(16), default="PENDING")
    embedding_model: Mapped[str | None] = mapped_column(String(128), nullable=True)
    embedding: Mapped[list | None] = mapped_column(
        Vector().with_variant(JSON(), "sqlite"), nullable=True
    )


class Proposal(Entity, Base):
    __tablename__ = "memory_proposals"
    fact_id: Mapped[str] = mapped_column(ForeignKey("atomic_facts.id"), index=True)
    source_id: Mapped[str] = mapped_column(ForeignKey("source_records.id"))
    message_id: Mapped[str] = mapped_column(ForeignKey("chat_messages.id"))
    base_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    before: Mapped[str] = mapped_column(Text, default="")
    content: Mapped[str] = mapped_column(Text)
    reason: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(24), default="pending")
    details: Mapped[dict] = mapped_column(JSON, default=dict)


class Job(Entity, Base):
    __tablename__ = "processing_jobs"
    source_id: Mapped[str | None] = mapped_column(ForeignKey("source_records.id"), nullable=True)
    message_id: Mapped[str | None] = mapped_column(ForeignKey("chat_messages.id"), nullable=True)
    kind: Mapped[str] = mapped_column(String(24), default="memory")
    state: Mapped[str] = mapped_column(String(24), default="QUEUED", index=True)
    stage: Mapped[str] = mapped_column(String(24), default="RECEIVED")
    automatic: Mapped[bool] = mapped_column(Boolean, default=False)
    epoch: Mapped[int] = mapped_column(Integer, default=1)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    error: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    updated: Mapped[str] = mapped_column(String(40), default=now)


class Suppression(Entity, Base):
    __tablename__ = "memory_suppressions"
    claim_key: Mapped[str] = mapped_column(Text)
    source_ids: Mapped[list] = mapped_column(JSON, default=list)


class Run(Entity, Base):
    __tablename__ = "agent_runs"
    __table_args__ = (UniqueConstraint("owner", "request_key"),)
    conversation_id: Mapped[str] = mapped_column(ForeignKey("conversations.id"), index=True)
    request_key: Mapped[str] = mapped_column(String(128))
    status: Mapped[str] = mapped_column(String(24), default="RUNNING")
    message_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_message_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    data: Mapped[dict] = mapped_column(JSON, default=dict)


class ToolExecution(Entity, Base):
    __tablename__ = "tool_executions"
    __table_args__ = (UniqueConstraint("run_id", "call_id"),)
    run_id: Mapped[str] = mapped_column(ForeignKey("agent_runs.id"), index=True)
    call_id: Mapped[str] = mapped_column(String(128))
    name: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(24), default="RUNNING")
    result: Mapped[dict] = mapped_column(JSON, default=dict)
    elapsed: Mapped[float] = mapped_column(Float, default=0)


class Summary(Entity, Base):
    __tablename__ = "conversation_summaries"
    conversation_id: Mapped[str] = mapped_column(ForeignKey("conversations.id"), index=True)
    content: Mapped[str] = mapped_column(Text)
    message_ids: Mapped[list] = mapped_column(JSON)
    valid: Mapped[bool] = mapped_column(Boolean, default=True)


class File(Entity, Base):
    __tablename__ = "uploaded_files"
    conversation_id: Mapped[str] = mapped_column(ForeignKey("conversations.id"), index=True)
    name: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(24), default="READY")
    digest: Mapped[str] = mapped_column(String(64))
    size: Mapped[int] = mapped_column(Integer)


class Chunk(Entity, Base):
    __tablename__ = "file_chunks"
    file_id: Mapped[str] = mapped_column(ForeignKey("uploaded_files.id"), index=True)
    content: Mapped[str] = mapped_column(Text)
    locator: Mapped[str] = mapped_column(String(128))
    embedding: Mapped[list | None] = mapped_column(
        Vector().with_variant(JSON(), "sqlite"), nullable=True
    )


class Database:
    def __init__(self, url, *, testing=False):
        if not url:
            raise AppError("DATABASE_NOT_CONFIGURED", "请先配置 PostgreSQL DATABASE_URL。", 503)
        if not testing and not url.startswith("postgresql"):
            raise AppError("DATABASE_UNSUPPORTED", "正式模式必须使用 PostgreSQL + pgvector。", 503)
        options = {"pool_pre_ping": True}
        if url.startswith("postgresql"):
            options["connect_args"] = {"connect_timeout": 5}
        if url == "sqlite://":
            options.update(poolclass=StaticPool, connect_args={"check_same_thread": False})
        self.engine = create_engine(url, **options)
        self.sessions = sessionmaker(self.engine, expire_on_commit=False)

    def migrate(self):
        from app.domain.knowledge import models  # noqa: F401
        from app.domain.memory import models as memory_v2_models  # noqa: F401

        with self.engine.begin() as conn:
            if conn.dialect.name == "postgresql":
                conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
                conn.execute(text("SELECT pg_advisory_xact_lock(717731)"))
            conn.execute(
                text("CREATE TABLE IF NOT EXISTS schema_revisions (version INTEGER PRIMARY KEY)")
            )
            version = conn.execute(text("SELECT max(version) FROM schema_revisions")).scalar()
            if version not in (None, 1, 2, 3, 4, 5):
                raise RuntimeError("Unsupported schema revision")
            if version == 1:
                conn.execute(
                    text(
                        "ALTER TABLE memory_proposals ADD COLUMN details JSON NOT NULL DEFAULT '{}'"
                    )
                )
            Base.metadata.create_all(conn)
            if version != 5:
                conn.execute(text("INSERT INTO schema_revisions(version) VALUES (5)"))

    @contextmanager
    def session(self):
        with self.sessions() as session:
            with session.begin():
                yield session


def owned(session, model, identifier, owner, *, lock=False):
    query = session.query(model).filter_by(id=identifier, owner=owner)
    item = query.with_for_update().first() if lock else query.first()
    if model is Conversation and item is not None:
        from app.domain.memory.models import Tombstone

        if (
            session.query(Tombstone)
            .filter_by(owner=owner, entity_type="conversation", original_id=identifier)
            .first()
        ):
            item = None
    if item is None:
        raise AppError("NOT_FOUND", "内容不存在或无权访问。", 404)
    return item


def preference(session, owner):
    row = session.get(Preference, owner)
    if row is None:
        row = Preference(owner=owner, enabled=True, epoch=1)
        session.add(row)
        session.flush()
    return row
