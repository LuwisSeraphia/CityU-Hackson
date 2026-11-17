from sqlalchemy import Boolean, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.infrastructure.db import Base, Entity


class Policy(Entity, Base):
    __tablename__ = "conversation_memory_policies"
    __table_args__ = (UniqueConstraint("owner", "conversation_id"),)
    conversation_id: Mapped[str] = mapped_column(ForeignKey("conversations.id"))
    mode: Mapped[str] = mapped_column(String(8), default="off")
    revision: Mapped[int] = mapped_column(Integer, default=1)


class Batch(Entity, Base):
    __tablename__ = "memory_batches"
    __table_args__ = (UniqueConstraint("owner", "source_id"),)
    source_id: Mapped[str] = mapped_column(ForeignKey("source_records.id"))
    state: Mapped[str] = mapped_column(String(20), default="pending")
    revision: Mapped[int] = mapped_column(Integer, default=1)
    reasons: Mapped[list] = mapped_column(JSON, default=list)


class CandidateRow(Entity, Base):
    __tablename__ = "memory_candidates_v2"
    batch_id: Mapped[str] = mapped_column(ForeignKey("memory_batches.id"), index=True)
    state: Mapped[str] = mapped_column(String(20), default="pending")
    revision: Mapped[int] = mapped_column(Integer, default=1)
    data: Mapped[dict] = mapped_column(JSON)
    memory_id: Mapped[str | None] = mapped_column(String(64), nullable=True)


class Profile(Entity, Base):
    __tablename__ = "profile_items"
    category: Mapped[str] = mapped_column(String(24))
    content: Mapped[str] = mapped_column(Text)
    origin: Mapped[str] = mapped_column(String(24))
    state: Mapped[str] = mapped_column(String(20), default="pending")
    pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    evidence_ids: Mapped[list] = mapped_column(JSON, default=list)
    context: Mapped[dict] = mapped_column(JSON, default=dict)


class MemoryMeta(Entity, Base):
    __tablename__ = "memory_metadata_v2"
    __table_args__ = (UniqueConstraint("owner", "memory_id"),)
    memory_id: Mapped[str] = mapped_column(ForeignKey("memory_versions.id"))
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    revision: Mapped[int] = mapped_column(Integer, default=1)


class Evidence(Entity, Base):
    __tablename__ = "memory_evidence_v2"
    memory_id: Mapped[str] = mapped_column(ForeignKey("memory_versions.id"), index=True)
    source_id: Mapped[str] = mapped_column(ForeignKey("source_records.id"), index=True)
    start: Mapped[int] = mapped_column(Integer)
    end: Mapped[int] = mapped_column(Integer)


class Withdrawal(Entity, Base):
    __tablename__ = "memory_withdrawals"
    __table_args__ = (UniqueConstraint("owner", "source_id"),)
    source_id: Mapped[str] = mapped_column(String(64))


class Tombstone(Entity, Base):
    __tablename__ = "memory_tombstones"
    entity_type: Mapped[str] = mapped_column(String(24))
    original_id: Mapped[str] = mapped_column(String(64), index=True)


class Mutation(Entity, Base):
    __tablename__ = "memory_mutations"
    __table_args__ = (UniqueConstraint("owner", "operation", "request_id"),)
    operation: Mapped[str] = mapped_column(String(160))
    request_id: Mapped[str] = mapped_column(String(128))
    digest: Mapped[str] = mapped_column(String(64))
    result: Mapped[dict] = mapped_column(JSON)


class Transfer(Entity, Base):
    __tablename__ = "memory_transfers"
    kind: Mapped[str] = mapped_column(String(16))
    state: Mapped[str] = mapped_column(String(24))
    epoch: Mapped[int] = mapped_column(Integer)
    report: Mapped[dict] = mapped_column(JSON, default=dict)


class MemoryEpoch(Base):
    __tablename__ = "owner_memory_epochs"
    owner: Mapped[str] = mapped_column(String(128), primary_key=True)
    epoch: Mapped[int] = mapped_column(Integer, default=1)


class ImportIdentity(Entity, Base):
    __tablename__ = "memory_import_identities"
    local_id: Mapped[str] = mapped_column(String(64), index=True)
    original_id: Mapped[str] = mapped_column(String(64), index=True)
    entity_type: Mapped[str] = mapped_column(String(64))


class ResponseSettings(Entity, Base):
    __tablename__ = "response_settings"
    __table_args__ = (UniqueConstraint("owner"),)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    options: Mapped[dict] = mapped_column(JSON, default=dict)


class MemoryUsePolicy(Entity, Base):
    __tablename__ = "memory_use_policies"
    __table_args__ = (UniqueConstraint("owner", "memory_id"),)
    memory_id: Mapped[str] = mapped_column(ForeignKey("memory_versions.id"))
    revision: Mapped[int] = mapped_column(Integer, default=1)
    recall_policy: Mapped[str] = mapped_column(String(32), default="explicit_or_continuation")
    do_not_mention: Mapped[bool] = mapped_column(Boolean, default=True)
    detail_level: Mapped[str] = mapped_column(String(16), default="summary")
    allow_profile_inference: Mapped[bool] = mapped_column(Boolean, default=False)


class FollowupConsent(Entity, Base):
    __tablename__ = "memory_followup_consents"
    memory_id: Mapped[str] = mapped_column(ForeignKey("memory_versions.id"))
    revision: Mapped[int] = mapped_column(Integer, default=1)
    state: Mapped[str] = mapped_column(String(16), default="active")
    data: Mapped[dict] = mapped_column(JSON)


class WorkingState(Entity, Base):
    __tablename__ = "conversation_working_states"
    __table_args__ = (UniqueConstraint("owner", "conversation_id"),)
    conversation_id: Mapped[str] = mapped_column(ForeignKey("conversations.id"))
    revision: Mapped[int] = mapped_column(Integer, default=1)
    valid: Mapped[bool] = mapped_column(Boolean, default=True)
    data: Mapped[dict] = mapped_column(JSON, default=dict)
