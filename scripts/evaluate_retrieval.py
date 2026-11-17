"""Isolated synthetic retrieval comparison. --live explicitly permits paid cloud calls."""

import argparse
import asyncio
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps/api"))
from app.config import Settings
from app.db import Database, Memory
from app.providers import QwenProvider
from app.retrieval import Retriever


async def evaluate(live, split=None, vector_min=None, rerank_min=None):
    fixture = json.loads(
        (ROOT / "apps/api/tests/fixtures/retrieval_eval.json").read_text(
            encoding="utf-8"
        )
    )
    if not live:
        assert len(fixture["queries"]) == 30
        identifiers = {m["id"] for m in fixture["memories"]}
        assert all(set(q["required"]) <= identifiers for q in fixture["queries"])
        print(
            json.dumps(
                {
                    "fixture_valid": True,
                    "queries": 30,
                    "business_evaluation": "not_executed; use --live",
                }
            )
        )
        return
    settings = Settings()
    if vector_min is not None:
        settings.memory_vector_min = vector_min
    if rerank_min is not None:
        settings.memory_rerank_min = rerank_min
    provider = QwenProvider(settings)
    vectors = await provider.embed([r["content"] for r in fixture["memories"]])
    db = Database("sqlite://", testing=True)
    db.migrate()
    with db.session() as session:
        for row, vector in zip(fixture["memories"], vectors):
            session.add(
                Memory(
                    **row,
                    project="default",
                    title=row["id"],
                    embedding=vector,
                    embedding_model=settings.embedding_model,
                    index_status="READY",
                )
            )
    semaphore = asyncio.Semaphore(3)

    async def one(q):
        async with semaphore:
            results = {"id": q["id"], "split": q["split"], "required": q["required"]}
            for policy in ["legacy", "v2"]:
                config = settings.model_copy(update={"memory_retrieval_policy": policy})
                start = time.monotonic()
                response = await Retriever(db, provider, config).search(
                    "eval", "default", q["query"]
                )
                ids = [r["id"] for r in response["items"]]
                results[policy] = {
                    "warnings": response.get("warnings", []),
                    "diagnostics": response.get("diagnostics"),
                    "selected": ids,
                    "required_hit": len(set(ids) & set(q["required"])),
                    "irrelevant": len(set(ids) - set(q["required"])),
                    "elapsed_ms": round((time.monotonic() - start) * 1000),
                }
            return results

    rows = await asyncio.gather(
        *(one(q) for q in fixture["queries"] if split is None or q["split"] == split)
    )
    print(
        json.dumps(
            {
                "environment": "isolated SQLite; real cloud vectors/rerank; not PostgreSQL performance",
                "models": [settings.embedding_model, settings.rerank_model],
                "results": rows,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--live", action="store_true")
    parser.add_argument("--split", choices=["dev", "test"])
    parser.add_argument("--vector-min", type=float)
    parser.add_argument("--rerank-min", type=float)
    args = parser.parse_args()
    asyncio.run(evaluate(args.live, args.split, args.vector_min, args.rerank_min))
