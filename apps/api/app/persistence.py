"""Read-only verification of an isolated live acceptance owner's persisted data."""

import argparse
import hashlib
import json
import re
from pathlib import Path

from sqlalchemy import select, text

from app.infrastructure.db import Base, Database
from app.errors import AppError
from app.domain.knowledge import models as knowledge_models  # noqa: F401
from app.domain.memory import models as memory_v2_models  # noqa: F401

OWNER_PATTERN = re.compile(r"verification-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}")
REQUIRED_TABLES = {
    "conversations",
    "chat_messages",
    "source_records",
    "atomic_facts",
    "memory_versions",
    "processing_jobs",
    "agent_runs",
    "tool_executions",
    "conversation_summaries",
    "uploaded_files",
    "file_chunks",
}


def validate_owner(owner):
    if not isinstance(owner, str) or not OWNER_PATTERN.fullmatch(owner):
        raise AppError("PERSISTENCE_OWNER", "持久化验收仅允许独立 verification owner。")


def snapshot(db, owner):
    """Fingerprint contents without exporting text, vectors, file data or credentials."""
    validate_owner(owner)
    tables = {}
    with db.engine.connect() as conn, conn.begin():
        if conn.dialect.name == "postgresql":
            conn.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ"))
            conn.execute(text("SET TRANSACTION READ ONLY"))
            conn.execute(text("SET LOCAL statement_timeout = '10s'"))
        for name, table in sorted(Base.metadata.tables.items()):
            rows = conn.execute(
                select(table).where(table.c.owner == owner).order_by(*table.primary_key.columns)
            ).mappings()
            digest, count = hashlib.sha256(), 0
            for row in rows:
                # pgvector returns numpy arrays on PostgreSQL, JSON lists in isolated unit tests.
                record = {
                    key: value.tolist() if hasattr(value, "tolist") else value
                    for key, value in row.items()
                }
                digest.update(
                    json.dumps(
                        record,
                        ensure_ascii=False,
                        sort_keys=True,
                        separators=(",", ":"),
                        allow_nan=False,
                    ).encode("utf-8")
                )
                digest.update(b"\n")
                count += 1
            tables[name] = {"count": count, "sha256": digest.hexdigest()}
    return {"version": 1, "owner": owner, "tables": tables}


def validate_manifest(manifest):
    if not isinstance(manifest, dict) or manifest.get("version") != 1:
        raise AppError("PERSISTENCE_REPORT", "验收报告格式或版本无效。")
    validate_owner(manifest.get("owner"))
    tables = manifest.get("tables")
    if not isinstance(tables, dict) or set(tables) != set(Base.metadata.tables):
        raise AppError("PERSISTENCE_REPORT", "验收报告的数据表与当前版本不匹配。")
    for name, entry in tables.items():
        if (
            not isinstance(entry, dict)
            or type(entry.get("count")) is not int
            or entry["count"] < (1 if name in REQUIRED_TABLES else 0)
            or not isinstance(entry.get("sha256"), str)
            or not re.fullmatch(r"[0-9a-f]{64}", entry["sha256"])
        ):
            raise AppError("PERSISTENCE_REPORT", "验收报告缺少完整的成功场景数据。")


def verify_snapshot(db, manifest):
    validate_manifest(manifest)
    actual = snapshot(db, manifest["owner"])
    changed = [
        name for name, expected in manifest["tables"].items() if actual["tables"][name] != expected
    ]
    return {
        "verified": not changed,
        "verification_owner": manifest["owner"],
        "changed_tables": changed,
        "table_counts": {name: entry["count"] for name, entry in actual["tables"].items()},
        "message": "新进程读到的持久化记录与验收快照一致。"
        if not changed
        else "持久化记录缺失或发生变化；请核对是否切换数据库或修改验收数据。",
    }


def main():
    parser = argparse.ArgumentParser(
        description="只读核对真实验收报告，不调用云端模型，不写入数据库。"
    )
    parser.add_argument("--report", required=True, type=Path)
    args = parser.parse_args()
    db = None
    try:
        from app.infrastructure.config import Settings

        if args.report.stat().st_size > 1_000_000:
            raise AppError("PERSISTENCE_REPORT", "验收报告过大。")
        report = json.loads(args.report.read_text(encoding="utf-8"))
        if not isinstance(report, dict) or report.get("verified") is not True:
            raise AppError("PERSISTENCE_REPORT", "需要已经成功完成真实模型验收的报告。")
        manifest = report.get("persistence_snapshot")
        validate_manifest(manifest)
        db = Database(Settings().database_url)
        result = verify_snapshot(db, manifest)
    except AppError as error:
        result = {"verified": False, "error": error.body()["error"]}
    except Exception:
        result = {"verified": False, "error": "无法读取报告或数据库；请核对报告路径与数据库服务。"}
    finally:
        if db is not None:
            db.engine.dispose()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["verified"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
