"""Opt-in, bounded live planning evaluation. Never writes personal database records."""

import asyncio, json, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps/api"))
from app.infrastructure.config import Settings
from app.infrastructure.providers import QwenProvider
from app.application.intent.planner import IntentPlanner


async def main():
    settings = Settings(_env_file=ROOT / "apps/api/.env")
    settings.extract_model = "qwen-flash"
    paraphrase = "--paraphrases" in sys.argv
    output_name = (
        "intent-live-paraphrases.json" if paraphrase else "intent-live-evaluation.json"
    )
    cases = json.loads(
        (ROOT / "apps/api/tests/fixtures/intent_cases.json").read_text(encoding="utf-8")
    )
    results = []
    for case in cases:
        provider = QwenProvider(settings)
        started = time.monotonic()
        result = await IntentPlanner(provider).plan(
            case["paraphrase"] if paraphrase else case["text"],
            case["recent_turns"],
            available_sources=["profile", "memory", "file", "web"],
            now="2026-11-06T00:00:00+08:00",
        )
        actual = {n.source for n in result.plan.needs}
        results.append(
            {
                "id": case["id"],
                "origin": result.origin,
                "passed": set(case["required_sources"]) <= actual,
                "sources": sorted(actual),
                "elapsed": round(time.monotonic() - started, 2),
                "usage": provider.last_usage,
                "plan": result.model_dump(mode="json"),
            }
        )
        (ROOT / "docs" / output_name).write_text(
            json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(case["id"], result.origin, results[-1]["passed"], flush=True)
    print("passed", sum(r["passed"] for r in results), "of", len(results))


if __name__ == "__main__":
    asyncio.run(main())
