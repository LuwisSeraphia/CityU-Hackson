"""Real-provider smoke test against isolated SQLite, never the user's database."""

import json, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps/api"))
from fastapi.testclient import TestClient
from pydantic import SecretStr
from app.infrastructure.config import Settings
from app.infrastructure.db import Database, Memory, Run
from app.infrastructure.providers import QwenProvider
from app.domain.memory.models import Profile
from app.main import create_app

settings = Settings(_env_file=ROOT / "apps/api/.env")
settings.worker_enabled = False
settings.memory_v2_enabled = settings.intent_planner_enabled = True
settings.owner_id = "intent-eval-isolated"
settings.api_token = SecretStr("isolated-evaluation-token")
settings.max_rounds = 2
settings.max_tools = 4
settings.extract_model = "qwen-flash"
db = Database("sqlite://", testing=True)
app = create_app(settings, database=db, provider=QwenProvider(settings))
with TestClient(
    app, headers={"Authorization": "Bearer isolated-evaluation-token"}
) as client:
    cid = client.post("/api/v1/conversations", json={}).json()["id"]
    with db.session() as session:
        for category, content in [
            ("goal", "目标是在两周内完成一个数据库课程演示"),
            ("learning", "已经练习 SQL 查询，希望继续学习索引"),
        ]:
            memory = Memory(
                owner=settings.owner_id,
                project="default",
                kind="fact",
                title=category,
                content=content,
                status="current",
            )
            session.add(memory)
            session.flush()
            session.add(
                Profile(
                    owner=settings.owner_id,
                    category=category,
                    content=content,
                    origin="self_report",
                    state="active",
                    evidence_ids=[memory.id],
                )
            )
    rid = client.post(
        "/api/v1/agent/runs",
        json={
            "conversation_id": cid,
            "text": "根据我的目标和学习经历建议下一步，只用已有个人记录，不需要联网。",
            "request_id": "live-intent",
            "memory_policy_override": "skip",
        },
    ).json()["run_id"]
    for _ in range(150):
        result = client.get(f"/api/v1/agent/runs/{rid}").json()
        if result["status"] != "RUNNING":
            break
        time.sleep(1)
    trace = client.get(f"/api/v1/agent/runs/{rid}/trace").json()
    report = {"status": result["status"], "error": result.get("error"), "trace": trace}
    (ROOT / "docs/intent-live-runtime.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(
        json.dumps(
            {
                "status": result["status"],
                "origin": trace.get("intent", {}).get("origin"),
                "information": trace.get("information"),
                "injected_count": len(trace.get("injected", [])),
            },
            ensure_ascii=True,
        )
    )
