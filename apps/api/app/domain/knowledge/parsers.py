import io
import re
import zipfile
from xml.etree import ElementTree as ET

from app.errors import AppError
from app.domain.files import parse_file


def parse_document(name, data):
    if not name.lower().endswith(".pptx"):
        return parse_file(name, data), []
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            if (
                len(archive.infolist()) > 2000
                or sum(x.file_size for x in archive.infolist()) > 50_000_000
            ):
                raise AppError("FILE_TOO_COMPLEX", "PPTX 展开后过大。")
            slides = sorted(
                (n for n in archive.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)),
                key=lambda n: int(re.search(r"slide(\d+)", n).group(1)),
            )
            if len(slides) > 200:
                raise AppError("FILE_TOO_COMPLEX", "PPTX 超过 200 页。")
            chunks, warnings = [], ["仅提取幻灯片文字与表格；图片、图表和备注尚未解析。"]
            for ordinal, name in enumerate(slides, 1):
                xml = archive.read(name)
                if b"<!DOCTYPE" in xml or b"<!ENTITY" in xml:
                    raise AppError("FILE_PARSE_FAILED", "不支持带外部实体的文档。")
                root = ET.fromstring(xml)
                text = "\n".join(n.text or "" for n in root.iter() if n.tag.endswith("}t"))
                for start in range(0, len(text), 1600):
                    chunks.append(
                        (f"第 {ordinal} 张幻灯片 · 字符 {start + 1}", text[start : start + 1800])
                    )
            if not chunks:
                warnings.append("文件没有可提取的文本；请提供文本版资料。")
            return chunks, warnings
    except AppError:
        raise
    except Exception as exc:
        raise AppError("FILE_PARSE_FAILED", "无法解析 PPTX。", 422) from exc
