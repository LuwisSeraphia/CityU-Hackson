"""Versioned archive with validated paths and owner rebinding on empty-library restore."""

import hashlib
import io
import json
import zipfile

from app.errors import AppError
from app.domain.knowledge.models import (
    Asset,
    AssetChunk,
    Collection,
    Connection,
    Feedback,
    Item,
    Membership,
    Proposal,
    Version,
)

TABLES = [Collection, Item, Version, Membership, Asset, AssetChunk, Proposal, Connection, Feedback]


def export_bundle(db, settings, owner):
    result = io.BytesIO()
    with db.session() as s, zipfile.ZipFile(result, "w", zipfile.ZIP_DEFLATED) as archive:
        tables = {}
        for model in TABLES:
            tables[model.__tablename__] = [
                {c.name: getattr(row, c.name) for c in model.__table__.columns}
                for row in s.query(model).filter_by(owner=owner)
            ]
        manifest = {"schema_version": 1, "tables": tables, "files": {}}
        for asset in s.query(Asset).filter_by(owner=owner):
            path = settings.storage / "knowledge-originals" / asset.id
            if not path.is_file():
                raise AppError("ASSET_ORIGINAL_MISSING", "备份中有原文件缺失。", 409)
            data = path.read_bytes()
            if hashlib.sha256(data).hexdigest() != asset.digest:
                raise AppError("IMPORT_INTEGRITY_FAILED", "原文件校验失败。", 409)
            name = "originals/" + asset.id
            archive.writestr(name, data)
            manifest["files"][name] = asset.digest
        archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False))
    return result.getvalue()


def restore_bundle(db, settings, owner, data):
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
        entries = archive.infolist()
        if len(entries) > 10000 or sum(i.file_size for i in entries) > 200_000_000:
            raise ValueError("归档过大")
        if len({i.filename for i in entries}) != len(entries):
            raise ValueError("重复文件")
        manifest = json.loads(archive.read("manifest.json"))
        if manifest["schema_version"] != 1:
            raise ValueError("不支持的版本")
        tables = manifest["tables"]
        if set(tables) != {m.__tablename__ for m in TABLES}:
            raise ValueError("表清单无效")
        from uuid import UUID

        for rows in tables.values():
            for row in rows:
                if "id" in row:
                    UUID(row["id"])
        assets = tables[Asset.__tablename__]
        expected = {"originals/" + a["id"]: a["digest"] for a in assets}
        if manifest["files"] != expected or set(archive.namelist()) != {"manifest.json", *expected}:
            raise ValueError("文件清单无效")
        originals = {name: archive.read(name) for name in expected}
        if any(hashlib.sha256(originals[n]).hexdigest() != h for n, h in expected.items()):
            raise ValueError("文件校验失败")
        ids = {m.__tablename__: {r.get("id") for r in tables[m.__tablename__]} for m in TABLES}
        # Validate all FK targets even under SQLite's test configuration.
        for model in TABLES:
            for row in tables[model.__tablename__]:
                for column in model.__table__.columns:
                    for fk in column.foreign_keys:
                        if row.get(column.name) not in ids[fk.column.table.name]:
                            raise ValueError("引用丢失")
        for item in tables[Item.__tablename__]:
            version = next(
                (v for v in tables[Version.__tablename__] if v["id"] == item["current_version_id"]),
                None,
            )
            if version is None or version["item_id"] != item["id"]:
                raise ValueError("当前版本无效")
    except Exception as exc:
        raise AppError("IMPORT_INTEGRITY_FAILED", "备份格式、引用或完整性校验失败。", 422) from exc
    written = []
    try:
        with db.session() as s:
            if any(s.query(model).first() is not None for model in TABLES):
                raise AppError("IMPORT_TARGET_NOT_EMPTY", "仅支持恢复到空知识库。", 409)
            root = settings.storage / "knowledge-originals"
            root.mkdir(parents=True, exist_ok=True)
            for asset in assets:
                path = root / asset["id"]
                # Never overwrite an untracked original left by a previous process.
                with path.open("xb") as stream:
                    written.append(path)
                    stream.write(originals["originals/" + asset["id"]])
            for model in TABLES:
                for row in tables[model.__tablename__]:
                    s.add(model(**{**row, "owner": owner}))
                s.flush()
        return {"restored": True, "items": len(tables[Item.__tablename__])}
    except Exception:
        for path in written:
            path.unlink(missing_ok=True)
        raise
