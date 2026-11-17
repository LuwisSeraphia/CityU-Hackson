"""Shared input validation."""

import re
from pydantic import BaseModel, ConfigDict
from app.errors import AppError


def validate_text(value, limit=16000):
    if not value.strip() or len(value) > limit:
        raise AppError("INVALID_TEXT", f"请输入 1–{limit} 字的内容。")
    if re.search(
        r"-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----|\bsk-[a-zA-Z0-9_-]{20,}|(?:api[_ -]?key|password|密码|密钥)\s*[:：=]\s*\S{6,}",
        value,
        re.I,
    ):
        raise AppError("SECRET_DETECTED", "检测到疑似凭据，请移除后提交。")
    return value.strip()


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")
