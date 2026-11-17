"""Explicit local diagnostics; cloud probes run only with --live and use synthetic text."""

import argparse
import asyncio
import hmac
import json
from pathlib import Path
from urllib.parse import urlsplit

from dotenv import dotenv_values
from sqlalchemy import text

from app.infrastructure.db import Base, Database
from app.errors import AppError
from app.infrastructure.providers import QwenProvider


def check(name, status, message, **details):
    return {"name": name, "status": status, "message": message, **details}


def configuration_checks(settings, root):
    token = settings.api_token.get_secret_value()
    results = [
        check(
            "api_token",
            "passed" if token else "failed",
            "本机 API 凭据已配置。" if token else "请运行 setup-local.ps1 生成本机配置。",
        ),
        check(
            "cloud_key",
            "passed" if settings.dashscope_api_key.get_secret_value() else "failed",
            "仅确认 Key 已填写，尚未验证权限。"
            if settings.dashscope_api_key.get_secret_value()
            else "请在 apps/api/.env 填入 DASHSCOPE_API_KEY；不要发送到聊天。",
        ),
    ]
    urls = [settings.qwen_base_url, settings.search_url, settings.rerank_url]
    try:
        valid = all(
            (parsed := urlsplit(url)).scheme == "https"
            and parsed.hostname
            and not parsed.username
            and not parsed.password
            and not parsed.query
            and not parsed.fragment
            for url in urls
        )
    except ValueError:
        valid = False
    results.append(
        check(
            "provider_endpoints",
            "passed" if valid else "failed",
            "三个云端地址格式有效；地域、工作空间及权限仍需真实调用验证。"
            if valid
            else "请核对三个模型地址：使用 HTTPS，不在 URL 中放凭据或查询参数。",
        )
    )
    models = (
        settings.chat_model,
        settings.extract_model,
        settings.embedding_model,
        settings.rerank_model,
        settings.search_model,
    )
    valid_models = all(model.strip() for model in models) and settings.embedding_dimensions > 0
    results.append(
        check(
            "model_settings",
            "passed" if valid_models else "failed",
            "模型名称及向量维度已填写；可用性仍需真实调用验证。"
            if valid_models
            else "五个模型名称不能为空，EMBEDDING_DIMENSIONS 必须为正整数。",
        )
    )
    # The former Next.js proxy has been removed. Never expose its server token to Vite.
    if not (root / "apps/web").is_dir():
        results.append(check("frontend_token", "skipped", "当前为知乎 Vite 前端，尚未对接后端；无 Next.js 服务端代理凭据。"))
        return results
    try:
        path = root / "apps/web/.env.local"
        values = dotenv_values(path, interpolate=False) if path.is_file() else {}
        frontend_token = values.get("AGENT_API_TOKEN") or ""
        matched = bool(token and frontend_token) and hmac.compare_digest(
            token.encode(), frontend_token.encode()
        )
        results.append(
            check(
                "frontend_token",
                "passed" if matched else "failed",
                "前端配置文件中的服务端凭据与后端一致；改动后需重启服务。"
                if matched
                else "请核对 apps/web/.env.local 的 AGENT_API_TOKEN 与后端 API_TOKEN。",
            )
        )
    except Exception:
        results.append(check("frontend_token", "failed", "无法读取前端本机配置文件。"))
    return results


def database_checks(settings):
    """Read-only SQL, no schema creation, migrations, memory reads or writes."""
    db = None
    results = []
    try:
        db = Database(settings.database_url)
        with db.engine.connect() as conn, conn.begin():
            conn.execute(text("SET TRANSACTION READ ONLY"))
            conn.execute(text("SET LOCAL statement_timeout = '5s'"))
            conn.execute(text("SELECT 1"))
            results.append(check("database", "passed", "已真实连接 PostgreSQL。"))
            extension = conn.execute(
                text("SELECT extversion FROM pg_extension WHERE extname = 'vector'")
            ).scalar()
            if not extension:
                results.append(
                    check(
                        "pgvector", "failed", "缺少 vector 扩展；请启动后端迁移或联系数据库管理员。"
                    )
                )
            else:
                distance = conn.execute(
                    text("SELECT CAST('[1,0,0]' AS vector) <=> CAST('[1,0,0]' AS vector)")
                ).scalar()
                results.append(
                    check(
                        "pgvector",
                        "passed" if abs(distance) < 1e-6 else "failed",
                        "已实际执行向量距离计算。",
                    )
                )
            names = ["schema_revisions", *Base.metadata.tables]
            missing = [
                name
                for name in names
                if conn.execute(text("SELECT to_regclass(:name)"), {"name": name}).scalar() is None
            ]
            version = (
                conn.execute(text("SELECT max(version) FROM schema_revisions")).scalar()
                if "schema_revisions" not in missing
                else None
            )
            results.append(
                check(
                    "schema",
                    "passed" if not missing and version == 2 else "failed",
                    "当前数据表与 schema revision 已就绪。"
                    if not missing and version == 2
                    else "数据表或 schema revision 未就绪；请启动后端执行迁移。",
                )
            )
    except Exception:
        # Never print driver exceptions: they may contain URLs, usernames and passwords.
        results.append(
            check(
                "database_query" if results else "database",
                "failed",
                "数据库检查未完成；请核对 PostgreSQL 服务、DATABASE_URL、扩展及账号权限。",
            )
        )
    finally:
        if db is not None:
            db.engine.dispose()
    return results


async def cloud_checks(settings, provider):
    results = []

    async def probe(name, operation):
        try:
            evidence = await operation()
            request_id = provider.last_usage.get("provider_request_id")
            if not isinstance(request_id, str) or not request_id:
                raise AppError("PROBE_NO_REQUEST_ID", "响应没有模型调用凭据。")
            results.append(check(name, "passed", "实际云端调用与响应检查通过。", **evidence))
        except AppError as error:
            results.append(check(name, "failed", error.message, code=error.code))
        except Exception:
            results.append(check(name, "failed", "响应不满足该能力的协议要求。"))

    async def tool_calling():
        name, marker = "diagnostic_echo", "personal-agent-check"
        messages = [
            {
                "role": "system",
                "content": "这是工具协议测试。必须先调用诊断工具，再回答工具返回的 marker。",
            },
            {"role": "user", "content": f"调用 {name}，marker 参数为 {marker}。"},
        ]
        schema = {
            "type": "function",
            "function": {
                "name": name,
                "description": "仅回显合成诊断标记，不读写用户数据。",
                "parameters": {
                    "type": "object",
                    "properties": {"marker": {"type": "string", "enum": [marker]}},
                    "required": ["marker"],
                    "additionalProperties": False,
                },
            },
        }
        first = await provider.chat(messages, tools=[schema], max_tokens=160)
        calls = first.get("tool_calls") or []
        if len(calls) != 1 or not calls[0].get("id"):
            raise AppError("PROBE_TOOL_NOT_CALLED", "对话模型没有返回要求的单个工具调用。")
        call = calls[0]
        if call["function"]["name"] != name or json.loads(call["function"]["arguments"]) != {
            "marker": marker
        }:
            raise AppError("PROBE_TOOL_ARGUMENTS", "对话模型返回了不符合 Schema 的工具参数。")
        first_id = provider.last_usage.get("provider_request_id")
        messages.extend(
            [
                first,
                {
                    "role": "tool",
                    "tool_call_id": call["id"],
                    "content": json.dumps({"marker": marker}),
                },
            ]
        )
        final = await provider.chat(messages, max_tokens=160)
        if not first_id or marker not in (final.get("content") or "") or final.get("tool_calls"):
            raise AppError("PROBE_TOOL_RESULT", "工具结果回传后的回答未通过检查。")
        return {"provider_request_ids": [first_id, provider.last_usage.get("provider_request_id")]}

    async def extraction():
        payload = await provider.structured(
            '返回 JSON 对象，唯一字段 preference 的值为字符串 "简洁回答"。',
            "合成测试资料：我偏好简洁回答。",
        )
        if payload != {"preference": "简洁回答"}:
            raise AppError("PROBE_JSON", "提取模型未返回要求的 JSON 对象。")
        return {"provider_request_id": provider.last_usage.get("provider_request_id")}

    async def embedding():
        vectors = await provider.embed(["合成测试资料：偏好简洁回答。"])
        if not vectors or not any(vectors[0]):
            raise AppError("PROBE_EMBEDDING", "向量响应为空或为零向量。")
        return {
            "provider_request_id": provider.last_usage.get("provider_request_id"),
            "dimensions": len(vectors[0]),
        }

    async def reranking():
        await provider.rerank("数据库", ["PostgreSQL 是数据库。", "今天散步。"])
        return {"provider_request_id": provider.last_usage.get("provider_request_id")}

    async def search():
        sources = await provider.search("PostgreSQL 官方文档 pgvector")
        valid = [s for s in sources if urlsplit(s["url"]).scheme in {"http", "https"}]
        if not valid:
            raise AppError("PROBE_SEARCH_SOURCES", "联网响应没有有效 HTTP(S) 来源。")
        return {
            "provider_request_id": provider.last_usage.get("provider_request_id"),
            "source_count": len(valid),
        }

    for name, operation in (
        ("tool_calling", tool_calling),
        ("structured_extraction", extraction),
        ("embedding", embedding),
        ("rerank", reranking),
        ("web_search", search),
    ):
        await probe(name, operation)
    return results


async def diagnose(settings, root, *, live=False, provider=None, database_probe=database_checks):
    results = configuration_checks(settings, root)
    results.extend(await asyncio.to_thread(database_probe, settings))
    cloud_prerequisites = {"cloud_key", "provider_endpoints", "model_settings"}
    eligible = all(r["status"] == "passed" for r in results if r["name"] in cloud_prerequisites)
    if live and eligible:
        results.extend(await cloud_checks(settings, provider or QwenProvider(settings)))
    else:
        results.append(
            check(
                "cloud_capabilities",
                "skipped",
                "未调用云端模型；先补齐云端配置，再用 -Live 显式执行付费能力检查。",
            )
        )
    cloud_names = {"tool_calling", "structured_extraction", "embedding", "rerank", "web_search"}
    return {
        "ok": all(r["status"] != "failed" for r in results),
        "cloud_verified": live
        and eligible
        and all(r["status"] == "passed" for r in results if r["name"] in cloud_names),
        "checks": results,
        "not_checked": ["业务完整闭环、数据库写入权限、独立进程重启持久化：运行 verify-live.ps1。"],
    }


def main():
    parser = argparse.ArgumentParser(
        description="默认只读诊断；--live 使用合成资料调用百炼，消耗额度。"
    )
    parser.add_argument("--live", action="store_true")
    args = parser.parse_args()
    try:
        from app.infrastructure.config import Settings

        result = asyncio.run(
            diagnose(Settings(), Path(__file__).resolve().parents[3], live=args.live)
        )
    except Exception:
        result = {
            "ok": False,
            "cloud_verified": False,
            "error": "本机配置无法读取，请核对 .env 字段格式。",
        }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
