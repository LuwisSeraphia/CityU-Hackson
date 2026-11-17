import hashlib

from app.infrastructure.db import owned, uid
from app.errors import AppError
from app.domain.knowledge.models import Asset, AssetChunk, Collection
from app.domain.knowledge.parsers import parse_document


class AssetService:
    def __init__(self, db, settings):
        self.db, self.settings = db, settings
        self.root = settings.storage / "knowledge-originals"

    def upload(self, owner, collection_id, name, data):
        if len(data) > self.settings.max_file_bytes:
            raise AppError("FILE_TOO_LARGE", "文件超过 20 MB。", 413)
        name = name.replace("\\", "/").split("/")[-1][:180]
        with self.db.session() as s:
            owned(s, Collection, collection_id, owner)
        chunks, warnings = parse_document(name, data)
        identifier = uid()
        self.root.mkdir(parents=True, exist_ok=True)
        target = self.root / identifier
        target.write_bytes(data)
        try:
            with self.db.session() as s:
                row = Asset(
                    id=identifier,
                    owner=owner,
                    collection_id=collection_id,
                    name=name,
                    digest=hashlib.sha256(data).hexdigest(),
                    status="PARTIAL" if warnings else "READY",
                    warnings=warnings,
                )
                s.add(row)
                s.flush()
                for ordinal, (locator, content) in enumerate(chunks):
                    s.add(
                        AssetChunk(
                            owner=owner,
                            asset_id=row.id,
                            ordinal=ordinal,
                            locator=locator,
                            content=content,
                        )
                    )
                return {"id": identifier, "name": name, "status": row.status, "warnings": warnings}
        except Exception:
            target.unlink(missing_ok=True)
            raise

    def read(self, owner, identifier):
        with self.db.session() as s:
            row = owned(s, Asset, identifier, owner)
            return {
                "id": row.id,
                "name": row.name,
                "status": row.status,
                "warnings": row.warnings,
                "chunks": [
                    {"id": c.id, "locator": c.locator, "content": c.content}
                    for c in s.query(AssetChunk)
                    .filter_by(owner=owner, asset_id=identifier)
                    .order_by(AssetChunk.ordinal)
                ],
            }

    def download(self, owner, identifier):
        with self.db.session() as s:
            row = owned(s, Asset, identifier, owner)
            target = self.root / row.id
            if (
                not target.is_file()
                or hashlib.sha256(target.read_bytes()).hexdigest() != row.digest
            ):
                raise AppError("ASSET_ORIGINAL_MISSING", "原文件缺失或完整性校验失败。", 404)
            return target, row.name
