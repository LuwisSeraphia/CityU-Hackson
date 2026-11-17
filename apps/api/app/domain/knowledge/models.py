from sqlalchemy import JSON, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.infrastructure.db import Base, Entity


class Collection(Entity, Base):
    __tablename__ = "knowledge_collections"
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    tags: Mapped[list] = mapped_column(JSON, default=list)


class Item(Entity, Base):
    __tablename__ = "knowledge_items"
    kind: Mapped[str] = mapped_column(String(30))
    current_version_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    usage_status: Mapped[str] = mapped_column(String(24), default="ready")
    lifecycle: Mapped[str] = mapped_column(String(24), default="active")


class Version(Entity, Base):
    __tablename__ = "knowledge_versions"
    __table_args__ = (UniqueConstraint("item_id", "version"),)
    item_id: Mapped[str] = mapped_column(ForeignKey("knowledge_items.id"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text)
    data: Mapped[dict] = mapped_column(JSON)


class Membership(Base):
    __tablename__ = "knowledge_memberships"
    item_id: Mapped[str] = mapped_column(ForeignKey("knowledge_items.id"), primary_key=True)
    collection_id: Mapped[str] = mapped_column(
        ForeignKey("knowledge_collections.id"), primary_key=True
    )
    owner: Mapped[str] = mapped_column(String(128), index=True)


class Proposal(Entity, Base):
    __tablename__ = "knowledge_proposals"
    payload: Mapped[dict] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(24), default="pending")
    evidence_ids: Mapped[list] = mapped_column(JSON)
    epoch: Mapped[int] = mapped_column(Integer)


class Connection(Entity, Base):
    __tablename__ = "knowledge_connections"
    from_id: Mapped[str] = mapped_column(ForeignKey("knowledge_items.id"), index=True)
    to_id: Mapped[str] = mapped_column(ForeignKey("knowledge_items.id"), index=True)
    from_version_id: Mapped[str] = mapped_column(ForeignKey("knowledge_versions.id"))
    to_version_id: Mapped[str] = mapped_column(ForeignKey("knowledge_versions.id"))
    explanation_raw: Mapped[str] = mapped_column(Text)
    usage_status: Mapped[str] = mapped_column(String(24), default="ready")


class Receipt(Entity, Base):
    __tablename__ = "knowledge_requests"
    __table_args__ = (UniqueConstraint("owner", "request_key"),)
    request_key: Mapped[str] = mapped_column(String(200))
    digest: Mapped[str] = mapped_column(String(64))
    result: Mapped[dict] = mapped_column(JSON)


class Feedback(Entity, Base):
    __tablename__ = "knowledge_feedback"
    item_id: Mapped[str] = mapped_column(ForeignKey("knowledge_items.id"))
    kind: Mapped[str] = mapped_column(String(24))
    text: Mapped[str] = mapped_column(Text)


class Asset(Entity, Base):
    __tablename__ = "knowledge_assets"
    collection_id: Mapped[str] = mapped_column(ForeignKey("knowledge_collections.id"), index=True)
    name: Mapped[str] = mapped_column(Text)
    digest: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(24), default="STORED")
    warnings: Mapped[list] = mapped_column(JSON, default=list)


class AssetChunk(Entity, Base):
    __tablename__ = "knowledge_asset_chunks"
    asset_id: Mapped[str] = mapped_column(ForeignKey("knowledge_assets.id"), index=True)
    ordinal: Mapped[int] = mapped_column(Integer)
    locator: Mapped[str] = mapped_column(Text)
    content: Mapped[str] = mapped_column(Text)
