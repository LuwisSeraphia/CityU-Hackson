"""Explicit local integration mode. Never selected as a fallback by the cloud app."""

import asyncio
import json
import os
from pathlib import Path

from app.api.server import create_app
from app.errors import AppError
from app.infrastructure.config import Settings
from app.infrastructure.db import Database


class LocalDemoProvider:
    """Deterministic replies for exercising HTTP, tools, storage and cancellation."""

    last_usage = {}

    def require(self):
        return None

    async def chat(self, messages, **kwargs):
        if kwargs.get("json_mode"):
            raise AppError(
                "DEMO_FEATURE_UNAVAILABLE",
                "本地联调模式不支持 AI 分类，请使用本地建议或切换云模型模式。",
                503,
            )
        await asyncio.sleep(0.8)
        user = next((m["content"] for m in reversed(messages) if m["role"] == "user"), "")
        prefix = "【本地联调模式 · 非云端 AI 回答】\n\n"
        if messages[-1]["role"] == "tool":
            items = json.loads(messages[-1]["content"]).get("items", [])
            text = "\n\n".join(
                f"{item.get('text', item.get('content', ''))[:600]} [{item['id']}]"
                for item in items[:3]
            )
            return {
                "role": "assistant",
                "content": prefix
                + (
                    "后端已检索到你附上的资料：\n\n" + text
                    if text
                    else "附上的资料未命中本次问题。你可以换个问题再次尝试。"
                ),
            }
        system = messages[0]["content"]
        try:
            files = json.loads(system.split("\n会话文件：", 1)[1].split("\n", 1)[0])
        except (ValueError, IndexError):
            files = []
        if files and kwargs.get("tools"):
            return {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {
                        "id": "local-file-search",
                        "type": "function",
                        "function": {
                            "name": "search_files",
                            "arguments": json.dumps({"query": user[:500]}, ensure_ascii=False),
                        },
                    }
                ],
            }
        if any(word in user for word in ("流程", "步骤", "规划", "复盘")):
            template = "流程规划模板（固定规则）：\n1. 明确目标、截止时间和需要交付的结果。\n2. 拆分准备、执行、复核三个阶段，为每个阶段指定负责人。\n3. 检查结果、记录问题，并确认下一步行动。"
        elif any(word in user for word in ("归档", "文件", "目录")):
            template = "文件归档模板（固定规则）：\n1. 建立 01_原始资料、02_处理中、03_成果、04_归档 四个目录。\n2. 用 日期_主题_版本 命名文件，保留原始资料。\n3. 人工确认分类后再移动文件。此处只提供方案，不操作磁盘。"
        elif any(word in user for word in ("网页", "来源", "摘要")):
            template = "网页资料整理模板（固定规则）：\n1. 在知识书墙导入正文或粘贴资料，并记录来源。\n2. 勾选附上书墙资料，再用资料中的关键词提问。\n3. 查看回答下的来源，核对原文。仅保存网址不会自动读取网页。"
        else:
            template = "可演示：知识片段检索与来源查看、流程规划模板、文件归档方案。模板使用固定规则，不代表模型理解。"
        return {
            "role": "assistant",
            "content": prefix
            + f"后端已收到：{user[:1000]}\n\n{template}\n\n会话与结果已通过后端保存。此模式不调用模型或执行真实桌面任务。",
        }

    async def structured(self, instruction, content):
        if "回答证据审校器" in instruction:
            # Exercise the guard protocol without claiming semantic validation by a model.
            return {"answer": json.loads(content)["draft"] + "\n\n（联调模式不执行模型语义审校。）"}
        raise AppError(
            "DEMO_FEATURE_UNAVAILABLE", "本地联调模式不支持模型提取或审校，请使用云模型模式。", 503
        )

    async def embed(self, texts):
        raise AppError("DEMO_FEATURE_UNAVAILABLE", "本地联调模式不生成向量。", 503)


def create_local_demo(database_path, token):
    if not token:
        raise RuntimeError(
            "Local demo requires a backend API token; use scripts/dev_local.py --demo"
        )
    path = Path(database_path).resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    settings = Settings(
        _env_file=None,
        runtime_mode="local_demo",
        api_token=token,
        worker_enabled=False,
        storage_dir=str(path.parent / "files"),
    )
    return create_app(
        settings,
        database=Database("sqlite:///" + str(path), testing=True),
        provider=LocalDemoProvider(),
    )


def app_factory():
    return create_local_demo(os.environ["LOCAL_DEMO_DB"], os.environ.get("API_TOKEN", ""))
