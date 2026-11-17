"""Validated memory archives. No executable payloads or caller-controlled paths."""

import hashlib
import io
import json
import zipfile
from datetime import datetime, timezone

from app.infrastructure.db import Conversation, Fact, File, Chunk, Memory, Message, Source, Suppression, Job
from app.infrastructure.db import owned, uid
from app.domain.memory.service import memory_epoch
from app.errors import AppError
from app.domain.memory.models import (
    Batch,
    CandidateRow,
    Evidence,
    MemoryMeta,
    Policy,
    Profile,
    Tombstone,
    Withdrawal,
)
from app.domain.memory.models import Transfer
from app.domain.memory.models import ImportIdentity
from app.domain.memory.models import ResponseSettings, MemoryUsePolicy, FollowupConsent


TABLES = [
    Conversation,
    Message,
    Source,
    Fact,
    Memory,
    File,
    Chunk,
    Policy,
    Batch,
    CandidateRow,
    Evidence,
    MemoryMeta,
    Profile,
    Suppression,
    Withdrawal,
    Tombstone,
    ImportIdentity,
    ResponseSettings,
    MemoryUsePolicy,
    FollowupConsent,
]


def export_archive(db, owner):
    tables = {}
    with db.session() as session:
        if db.engine.dialect.name == "postgresql":
            from sqlalchemy import text

            session.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ"))
        epoch = memory_epoch(session, owner).epoch
        for model in TABLES:
            rows = []
            for row in session.query(model).filter_by(owner=owner):
                value = {
                    c.name: getattr(row, c.name)
                    for c in model.__table__.columns
                    if c.name not in ("owner", "embedding")
                }
                if model is Memory and value["status"] != "deleted":
                    value["index_status"] = "PENDING"
                    value["embedding_model"] = None
                rows.append(value)
            tables[model.__tablename__] = rows
    output = io.BytesIO()
    manifest = {
        "format_version": "personal-agent-memory/2.1",
        "owner_epoch": epoch,
        "files": {},
        "scope": "personal-memory-and-chat-files",
    }
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for table, rows in tables.items():
            name = "records/" + table + ".jsonl"
            data = "\n".join(json.dumps(r, ensure_ascii=False) for r in rows).encode("utf-8")
            archive.writestr(name, data)
            manifest["files"][name] = {
                "sha256": hashlib.sha256(data).hexdigest(),
                "count": len(rows),
            }
        archive.writestr("manifest.json", json.dumps(manifest))
    return output.getvalue(), epoch


def validate_archive(data):
    try:
        if len(data) > 200 * 1024 * 1024:
            raise ValueError("archive too large")
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            entries = archive.infolist()
            names = [i.filename for i in entries]
            manifest = json.loads(archive.read("manifest.json"))
            version = manifest["format_version"]
            if version not in ("personal-agent-memory/2.0", "personal-agent-memory/2.1"):
                raise ValueError("unsupported version")
            expected = {"manifest.json"} | {"records/" + m.__tablename__ + ".jsonl" for m in TABLES}
            if version == "personal-agent-memory/2.0":
                expected -= {
                    "records/" + m.__tablename__ + ".jsonl"
                    for m in (ResponseSettings, MemoryUsePolicy, FollowupConsent)
                }
            if set(names) != expected or len(names) != len(expected):
                raise ValueError("unexpected/duplicate path")
            if sum(i.file_size for i in entries) > 1024**3:
                raise ValueError("expanded archive too large")
            if any((i.external_attr >> 16) & 0o170000 == 0o120000 for i in entries):
                raise ValueError("symlink")
            if set(manifest["files"]) != expected - {"manifest.json"}:
                raise ValueError("invalid manifest")
            tables = {}
            from uuid import UUID

            for model in TABLES:
                name = "records/" + model.__tablename__ + ".jsonl"
                if name not in expected:
                    tables[model.__tablename__] = []
                    continue
                payload = archive.read(name)
                if hashlib.sha256(payload).hexdigest() != manifest["files"][name]["sha256"]:
                    raise ValueError("checksum")
                rows = [json.loads(line) for line in payload.decode("utf-8").splitlines()]
                if len(rows) != manifest["files"][name]["count"]:
                    raise ValueError("count")
                columns = {c.name for c in model.__table__.columns} - {"owner", "embedding"}
                ids = set()
                for row in rows:
                    if set(row) != columns or row["id"] in ids:
                        raise ValueError("invalid columns or duplicate ID")
                    UUID(row["id"])
                    ids.add(row["id"])
                tables[model.__tablename__] = rows
            ids = {name: {row["id"] for row in rows} for name, rows in tables.items()}
            for model in TABLES:
                for row in tables[model.__tablename__]:
                    for column in model.__table__.columns:
                        for fk in column.foreign_keys:
                            if (
                                row.get(column.name) is not None
                                and row[column.name] not in ids[fk.column.table.name]
                            ):
                                raise ValueError("missing reference")
            memory_ids = ids[Memory.__tablename__]
            source_ids = ids[Source.__tablename__]
            for row in tables[Memory.__tablename__]:
                if not set(row["source_ids"]) <= source_ids:
                    raise ValueError("missing memory evidence")
            for row in tables[Profile.__tablename__]:
                if not set(row["evidence_ids"]) <= memory_ids:
                    raise ValueError("missing profile evidence")
            for row in tables[Fact.__tablename__]:
                if row["current_id"] is not None and row["current_id"] not in memory_ids:
                    raise ValueError("missing current memory")
            return tables
    except Exception as exc:
        raise AppError("IMPORT_INTEGRITY_FAILED", "备份格式、校验和或关联无效。", 422) from exc


class Portability:
    def __init__(self, db, settings):
        self.db, self.settings = db, settings

    def path(self, identifier):
        from uuid import UUID

        UUID(identifier)
        return self.settings.storage / "memory-transfers" / (identifier + ".zip")

    def create(self, owner, kind, data=None):
        if kind == "export":
            data, epoch = export_archive(self.db, owner)
            report = {
                "scope": "personal-memory-and-chat-files",
                "knowledge_library": "Use existing knowledge export separately.",
            }
        else:
            tables = validate_archive(data)
            report = {"counts": {name: len(rows) for name, rows in tables.items()}}
            with self.db.session() as session:
                epoch = memory_epoch(session, owner).epoch
                report["conflicts"] = self.conflicts(session, owner, tables)
        identifier = uid()
        path = self.path(identifier)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        try:
            with self.db.session() as session:
                if memory_epoch(session, owner).epoch != epoch:
                    raise AppError("VERSION_CONFLICT", "数据已变化，请重试。", 409)
                session.add(
                    Transfer(
                        id=identifier,
                        owner=owner,
                        kind=kind,
                        state="ready",
                        epoch=epoch,
                        report=report,
                    )
                )
        except Exception:
            path.unlink(missing_ok=True)
            raise
        return {"job_id": identifier, "state": "ready", "report": report}

    def read(self, owner, identifier, *, download=False):
        with self.db.session() as session:
            row = owned(session, Transfer, identifier, owner)
            expired = (
                datetime.now(timezone.utc) - datetime.fromisoformat(row.created)
            ).total_seconds() > 86400
            if (
                expired
                or row.state == "invalidated"
                or memory_epoch(session, owner).epoch != row.epoch
            ):
                self.path(identifier).unlink(missing_ok=True)
                raise AppError("TRANSFER_EXPIRED", "文件已过期或数据发生变化，请重新生成。", 410)
            if download:
                if row.kind != "export":
                    raise AppError("NOT_FOUND", "下载不存在。", 404)
                return self.path(identifier).read_bytes()
            return {
                "job_id": row.id,
                "kind": row.kind,
                "state": row.state,
                "epoch": row.epoch,
                "report": row.report,
            }

    @staticmethod
    def conflicts(session, owner, tables):
        identities = {
            r.original_id: r.local_id for r in session.query(ImportIdentity).filter_by(owner=owner)
        }
        conflicts = []
        for model in TABLES:
            for row in tables[model.__tablename__]:
                local_id = identities.get(row["id"], row["id"])
                local = session.query(model).filter_by(owner=owner, id=local_id).first()
                if local:
                    conflicts.append(
                        {
                            "conflict_id": row["id"],
                            "table": model.__tablename__,
                            "local_id": local_id,
                            "local_preview": str(next((getattr(local, k, None) for k in ("content", "text", "title", "name") if getattr(local, k, None)), ""))[:500],
                            "import_preview": str(next((row.get(k) for k in ("content", "text", "title", "name") if row.get(k)), ""))[:500],
                        }
                    )
        return conflicts

    def restore(self, owner, identifier, expected_epoch, *, mode="restore", resolutions=None):
        status = self.read(owner, identifier)
        if status["kind"] == "import" and status["state"] == "completed":
            return {"state": "completed", "index_status": "pending"}
        tables = validate_archive(self.path(identifier).read_bytes())
        with self.db.session() as session:
            transfer = owned(session, Transfer, identifier, owner, lock=True)
            if transfer.kind != "import":
                raise AppError("IMPORT_INVALID", "不是导入任务。", 409)
            if transfer.state == "completed":
                return {"state": "completed"}
            pref = memory_epoch(session, owner)
            if pref.epoch != expected_epoch:
                raise AppError("VERSION_CONFLICT", "目标数据已变化。", 409)
            if mode == "restore" and any(
                session.query(m).filter_by(owner=owner).first()
                for m in TABLES
                if m is not Tombstone
            ):
                raise AppError("IMPORT_TARGET_NOT_EMPTY", "恢复必须使用空的目标记忆空间。", 409)
            tombstones = {t.original_id for t in session.query(Tombstone).filter_by(owner=owner)}
            incoming_ids = {row["id"] for rows in tables.values() for row in rows}
            if tombstones & incoming_ids:
                raise AppError("IMPORT_DELETED_CONTENT", "备份包含已删除内容，禁止恢复。", 409)
            # Remap IDs to avoid collisions with another owner's database objects.
            mapping = {old: uid() for old in incoming_ids}
            conflicts = self.conflicts(session, owner, tables) if mode == "merge" else []
            actions = {r["conflict_id"]: r["action"] for r in (resolutions or [])}
            if {r["conflict_id"] for r in conflicts} != set(actions):
                raise AppError("IMPORT_CONFLICTS", "必须明确处理所有导入冲突。", 409)
            for conflict in conflicts:
                mapping[conflict["conflict_id"]] = conflict["local_id"]
            conflict_ids = {r["conflict_id"] for r in conflicts}

            def remap(value):
                if isinstance(value, list):
                    return [remap(v) for v in value]
                if isinstance(value, dict):
                    return {k: remap(v) for k, v in value.items()}
                return mapping.get(value, value) if isinstance(value, str) else value

            for model in TABLES:
                for row in tables[model.__tablename__]:
                    if row["id"] in conflict_ids and actions[row["id"]] == "keep_local":
                        continue
                    value = remap(row)
                    if model in (Tombstone, ImportIdentity):
                        value["original_id"] = row["original_id"]
                    if model is Policy:
                        value["mode"] = "off"
                    if model is FollowupConsent:
                        value["state"] = "paused"
                    if model is Memory and value["status"] != "deleted":
                        value["index_status"], value["embedding_model"] = "PENDING", None
                    if row["id"] in conflict_ids:
                        local = owned(session, model, value["id"], owner, lock=True)
                        for key, entry in value.items():
                            if key != "id":
                                setattr(local, key, entry)
                        if hasattr(local, "embedding"):
                            local.embedding = None
                    else:
                        session.add(model(**value, owner=owner))
                    if model not in (Tombstone, ImportIdentity):
                        session.add(
                            ImportIdentity(
                                owner=owner,
                                local_id=value["id"],
                                original_id=row["id"],
                                entity_type=model.__tablename__,
                            )
                        )
                session.flush()
            for memory in session.query(Memory).filter_by(owner=owner):
                if memory.status != "deleted" and memory.source_ids:
                    session.add(
                        Job(
                            owner=owner,
                            source_id=memory.source_ids[0],
                            kind="index",
                            stage="INDEXING",
                            payload={"memory_ids": [memory.id]},
                        )
                    )
            pref.epoch += 1
            transfer.state, transfer.epoch = "completed", pref.epoch
        self.path(identifier).unlink(missing_ok=True)
        return {"state": "completed", "index_status": "pending"}
