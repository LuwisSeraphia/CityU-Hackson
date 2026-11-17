import json
import math
import time
from app.infrastructure.tracing import calls, last_call

import httpx

from app.errors import AppError


class QwenProvider:
    def __init__(self, settings, transport=None):
        self.settings = settings
        self.transport = transport
        self.last_usage = {}

    @property
    def last_usage(self):
        return last_call.get() or getattr(self, "_diagnostic_usage", {})

    @last_usage.setter
    def last_usage(self, value):
        last_call.set(value)
        self._diagnostic_usage = value

    def require(self):
        if not self.settings.dashscope_api_key.get_secret_value():
            raise AppError(
                "MODEL_NOT_CONFIGURED", "请在后端 .env 配置百炼 API Key。", 503, "provider"
            )

    async def request(self, path, payload, *, absolute=False):
        started = time.monotonic()
        purpose = (
            "embed"
            if "embedding" in str(payload.get("model", ""))
            else "rerank"
            if "rerank" in path
            else "search"
            if absolute
            else "structured"
            if payload.get("response_format")
            else "chat"
        )
        metadata = {
            "model": payload.get("model"),
            "purpose": purpose,
            "status": "FAILED",
            "usage": {},
        }
        self.require()
        url = path if absolute else self.settings.qwen_base_url.rstrip("/") + path
        try:
            async with httpx.AsyncClient(
                timeout=45, transport=self.transport, trust_env=False
            ) as client:
                response = await client.post(
                    url,
                    json=payload,
                    headers={
                        "Authorization": "Bearer "
                        + self.settings.dashscope_api_key.get_secret_value()
                    },
                )
            if response.status_code >= 400:
                raise AppError(
                    "MODEL_REQUEST_FAILED",
                    f"模型服务请求失败（HTTP {response.status_code}），请检查地域、模型和权限。",
                    502,
                    "provider",
                    response.status_code >= 429,
                )
            body = response.json()
            self.last_usage = {
                "provider_request_id": body.get("id") or body.get("request_id"),
                "model": payload.get("model"),
                "usage": body.get("usage", {}),
            }
            metadata.update(self.last_usage, status="SUCCEEDED")
            return body
        except (httpx.HTTPError, ValueError) as exc:
            raise AppError(
                "MODEL_UNAVAILABLE", "模型服务连接失败或响应无效。", 502, "provider", True
            ) from exc
        finally:
            metadata["elapsed_ms"] = round((time.monotonic() - started) * 1000)
            recorded = calls.get()
            if recorded is not None:
                recorded.append(metadata)

    async def chat(self, messages, *, tools=None, model=None, json_mode=False, max_tokens=2000):
        payload = {
            "model": model or self.settings.chat_model,
            "messages": messages,
            "max_tokens": max_tokens,
            "enable_thinking": False,
        }
        if tools:
            payload.update(tools=tools, tool_choice="auto", parallel_tool_calls=False)
        if json_mode:
            payload["response_format"] = {"type": "json_object"}
        body = await self.request("/chat/completions", payload)
        try:
            message = body["choices"][0]["message"]
            if not isinstance(message, dict) or message.get("role") != "assistant":
                raise ValueError()
            return message
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise AppError(
                "MODEL_INVALID_RESPONSE", "模型没有返回有效消息。", 502, "provider"
            ) from exc

    async def structured(self, instruction, content):
        message = await self.chat(
            [{"role": "system", "content": instruction}, {"role": "user", "content": content}],
            model=self.settings.extract_model,
            json_mode=True,
        )
        try:
            return json.loads(message.get("content") or "")
        except (ValueError, TypeError) as exc:
            raise AppError(
                "EXTRACTION_INVALID", "模型结构化结果无效，尚未写入事实。", 502, "extract", True
            ) from exc

    async def embed(self, texts):
        if len(texts) > 10:
            vectors = []
            for start in range(0, len(texts), 10):
                vectors.extend(await self.embed(texts[start : start + 10]))
            return vectors
        body = await self.request(
            "/embeddings",
            {
                "model": self.settings.embedding_model,
                "input": texts,
                "dimensions": self.settings.embedding_dimensions,
            },
        )
        try:
            rows = sorted(body["data"], key=lambda item: item["index"])
            vectors = [row["embedding"] for row in rows]
            if len(vectors) != len(texts) or any(
                len(v) != self.settings.embedding_dimensions
                or not all(isinstance(x, (float, int)) and math.isfinite(x) for x in v)
                for v in vectors
            ):
                raise ValueError()
            return vectors
        except (KeyError, ValueError, TypeError) as exc:
            raise AppError(
                "EMBEDDING_INVALID", "向量响应维度或格式错误。", 502, "index", True
            ) from exc

    async def rerank(self, query, documents, *, scored=False):
        result = await self.request(
            self.settings.rerank_url,
            {
                "model": self.settings.rerank_model,
                "input": {"query": query, "documents": documents},
                "parameters": {
                    "top_n": len(documents) if scored else min(6, len(documents)),
                    "return_documents": False,
                },
            },
            absolute=True,
        )
        indices = [item["index"] for item in result.get("output", {}).get("results", [])]
        if not indices or any(
            not isinstance(i, int) or i < 0 or i >= len(documents) for i in indices
        ):
            raise AppError("RERANK_INVALID", "重排结果无效。", 502)
        if scored:
            rows = result.get("output", {}).get("results", [])
            if len(set(indices)) != len(indices) or any(
                not isinstance(r.get("relevance_score"), (int, float))
                or not math.isfinite(r["relevance_score"])
                for r in rows
            ):
                raise AppError("RERANK_INVALID", "重排未返回有效分数。", 502)
            return [{"index": r["index"], "score": r["relevance_score"]} for r in rows]
        return indices

    async def search(self, query):
        result = await self.request(
            self.settings.search_url,
            {
                "model": self.settings.search_model,
                "input": {"messages": [{"role": "user", "content": query}]},
                "parameters": {
                    "enable_search": True,
                    "search_options": {"forced_search": True, "enable_source": True},
                    "max_tokens": 1200,
                    "enable_thinking": False,
                    "result_format": "message",
                },
            },
            absolute=True,
        )
        # Sources must be provider metadata, never URLs invented in generated prose.
        info = result.get("search_info") or result.get("output", {}).get("search_info") or {}
        sources = info.get("search_results") or []
        if not sources:
            raise AppError(
                "SEARCH_SOURCES_UNAVAILABLE",
                "当前联网接口未返回可验证的搜索来源，请核对账户/模型的联网能力。",
                502,
                "search",
            )
        return [
            {
                "url": item["url"],
                "title": item.get("title", item["url"]),
                "snippet": item.get("snippet", "")[:1500],
            }
            for item in sources[:5]
            if isinstance(item, dict) and isinstance(item.get("url"), str)
        ]
