import hashlib
import io
import zipfile
from pathlib import PurePath

from docx import Document
from pypdf import PdfReader

from app.infrastructure.db import Chunk, Conversation, File, owned
from app.errors import AppError
from app.domain.retrieval.service import terms
from app.validation import validate_text


def parse_file(name, data):
    suffix = PurePath(name).suffix.casefold()
    try:
        if suffix in (".txt", ".md"):
            text = data.decode("utf-8-sig")
            if "\x00" in text:
                raise ValueError()
            pages = [("文本", text)]
        elif suffix == ".pdf":
            pdf = PdfReader(io.BytesIO(data))
            if pdf.is_encrypted or len(pdf.pages) > 200:
                raise AppError("PDF_UNSUPPORTED", "请上传未加密且不超过 200 页的文本 PDF。")
            pages = [
                (f"第 {index + 1} 页", page.extract_text() or "")
                for index, page in enumerate(pdf.pages)
            ]
        elif suffix == ".docx":
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                if (
                    sum(f.file_size for f in archive.infolist()) > 50_000_000
                    or len(archive.infolist()) > 2000
                ):
                    raise AppError("FILE_TOO_COMPLEX", "文档展开后过大。")
            doc = Document(io.BytesIO(data))
            pages = [
                (f"段落 {i + 1}", paragraph.text) for i, paragraph in enumerate(doc.paragraphs)
            ]
            pages += [
                (
                    f"表格 {i + 1}",
                    "\n".join(" | ".join(c.text for c in r.cells) for r in table.rows),
                )
                for i, table in enumerate(doc.tables)
            ]
        else:
            raise AppError("FILE_TYPE_UNSUPPORTED", "支持 UTF-8 TXT、MD、文本 PDF 和 DOCX。")
    except AppError:
        raise
    except Exception as exc:
        raise AppError("FILE_PARSE_FAILED", "无法读取此文档，请检查文件格式。", 422) from exc
    if sum(len(text) for _, text in pages) > 500_000:
        raise AppError("FILE_TOO_LARGE", "文档文本超过 50 万字，请拆分上传。", 413)
    chunks = []
    for locator, text in pages:
        if not text.strip():
            continue
        validate_text(text, 500_000)
        for start in range(0, len(text), 1600):
            chunks.append(
                (
                    f"{locator} · 字符 {start + 1}–{min(start + 1800, len(text))}",
                    text[start : start + 1800],
                )
            )
    if not chunks:
        raise AppError("FILE_NO_TEXT", "文件没有可读取文本；扫描图片暂不支持 OCR。", 422)
    return chunks


class FileService:
    def __init__(self, db, settings):
        self.db, self.settings = db, settings

    def upload(self, owner, conversation_id, name, data):
        if len(data) > self.settings.max_file_bytes:
            raise AppError("FILE_TOO_LARGE", "文件不能超过 20 MB。", 413)
        with self.db.session() as session:
            owned(session, Conversation, conversation_id, owner)
        name = name.replace("\\", "/").split("/")[-1][:180]
        chunks = parse_file(name, data)
        digest = hashlib.sha256(data).hexdigest()
        with self.db.session() as session:
            existing = (
                session.query(File)
                .filter_by(owner=owner, conversation_id=conversation_id, digest=digest)
                .first()
            )
            if existing:
                return {"id": existing.id, "name": existing.name, "status": existing.status}
            row = File(
                owner=owner,
                conversation_id=conversation_id,
                name=name,
                digest=digest,
                size=len(data),
            )
            session.add(row)
            session.flush()
            for locator, content in chunks:
                session.add(Chunk(owner=owner, file_id=row.id, locator=locator, content=content))
            return {"id": row.id, "name": name, "status": "READY"}

    def list(self, owner, conversation_id):
        with self.db.session() as session:
            owned(session, Conversation, conversation_id, owner)
            return [
                {"id": r.id, "name": r.name, "status": r.status}
                for r in session.query(File).filter_by(owner=owner, conversation_id=conversation_id)
            ]

    def search(self, owner, conversation_id, query, file_id=None):
        with self.db.session() as session:
            owned(session, Conversation, conversation_id, owner)
            files = session.query(File).filter_by(owner=owner, conversation_id=conversation_id)
            if file_id:
                row = owned(session, File, file_id, owner)
                if row.conversation_id != conversation_id:
                    raise AppError("FILE_SCOPE", "文件不属于当前会话。", 404)
                files = files.filter(File.id == file_id)
            names = {r.id: r.name for r in files}
            rows = session.query(Chunk).filter(Chunk.owner == owner, Chunk.file_id.in_(names)).all()
            tokens = terms(query)
            rows.sort(key=lambda r: len(tokens & terms(r.content)), reverse=True)
            return [
                {
                    "id": "file:" + r.id,
                    "file_id": r.file_id,
                    "title": names[r.file_id],
                    "locator": r.locator,
                    "content": r.content,
                }
                for r in rows[:6]
                if not query or tokens & terms(r.content)
            ]

    def read(self, owner, conversation_id, chunk_id):
        with self.db.session() as session:
            chunk = owned(session, Chunk, chunk_id.removeprefix("file:"), owner)
            file = owned(session, File, chunk.file_id, owner)
            if file.conversation_id != conversation_id:
                raise AppError("FILE_SCOPE", "文件不属于当前会话。", 404)
            return {
                "id": "file:" + chunk.id,
                "title": file.name,
                "locator": chunk.locator,
                "content": chunk.content,
            }

    def read_sections(self, owner, conversation_id, identifier, offset=0):
        if identifier.startswith("file:"):
            return {"items": [self.read(owner, conversation_id, identifier)]}
        with self.db.session() as session:
            file = owned(session, File, identifier, owner)
            if file.conversation_id != conversation_id:
                raise AppError("FILE_SCOPE", "文件不属于当前会话。", 404)
            query = (
                session.query(Chunk)
                .filter_by(owner=owner, file_id=file.id)
                .order_by(Chunk.created, Chunk.id)
            )
            total = query.count()
            rows = query.offset(offset).limit(4).all()
            return {
                "items": [
                    {
                        "id": "file:" + r.id,
                        "title": file.name,
                        "locator": r.locator,
                        "content": r.content,
                    }
                    for r in rows
                ],
                "total_chunks": total,
                "next_offset": offset + len(rows) if offset + len(rows) < total else None,
            }
