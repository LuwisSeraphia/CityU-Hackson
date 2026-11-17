import io
import zipfile

import pytest
from pydantic import ValidationError

from app.config import Settings
from app.db import Database
from app.errors import AppError
from app.knowledge.assets import AssetService
from app.knowledge.schemas import (
    CollectionInput,
    ConnectionInput,
    FeedbackInput,
    ItemInput,
    RevisionInput,
    SearchInput,
)
from app.knowledge.service import KnowledgeService


@pytest.fixture
def setup():
    db = Database("sqlite://", testing=True)
    db.migrate()
    service = KnowledgeService(db)
    collection = service.create_collection("a", CollectionInput(name="自由积累"), "1")["id"]
    return db, service, collection


def test_general_memory_versions_scope_and_idempotency(setup):
    db, service, collection = setup
    body = ItemInput(
        text="也许旅行应当留些空白",
        kind="thought",
        modality="hypothetical",
        collection_ids=[collection],
        attributes={"未知场景": "旅行"},
    )
    first = service.create("a", body, "1")
    assert service.create("a", body, "1") == first
    assert first["modality"] == "hypothetical"
    with pytest.raises(AppError):
        service.create("a", body.model_copy(update={"text": "不同"}), "1")
    with pytest.raises(AppError):
        service.get("b", first["id"])
    revised = service.revise(
        "a",
        first["id"],
        RevisionInput(
            **{**body.model_dump(), "text": "旅行也需要计划"}, base_version_id=first["version_id"]
        ),
    )
    assert revised["version"] == 2
    assert len(service.history("a", first["id"])) == 2
    with pytest.raises(AppError):
        service.revise(
            "a",
            first["id"],
            RevisionInput(**body.model_dump(), base_version_id=first["version_id"]),
        )


def test_pending_not_searchable_and_evidence_rechecked(setup):
    _, service, collection = setup
    original = service.create(
        "a", ItemInput(text="阅读先看例子", collection_ids=[collection]), "source"
    )
    body = ItemInput(
        text="阅读模式",
        kind="pattern",
        collection_ids=[collection],
        evidence_ids=[original["version_id"]],
    )
    pending = service.create("a", body, "candidate", candidate=True)
    result = service.search("a", SearchInput(query="模式", collection_ids=[collection]))
    assert result["items"] == []
    approved = service.decide("a", pending["id"], "approve")
    assert service.search("a", SearchInput(query="模式", collection_ids=[collection]))["items"]
    service.feedback("a", approved["id"], FeedbackInput(kind="correction", text="不是这样"))
    assert not service.search("a", SearchInput(query="模式", collection_ids=[collection]))["items"]


def test_connections_invalidated_by_revision(setup):
    _, service, collection = setup
    body = ItemInput(text="先试再完善", collection_ids=[collection])
    a = service.create("a", body, "a")
    b = service.create("a", body, "b")
    service.connect(
        "a",
        ConnectionInput(
            from_id=a["id"],
            to_id=b["id"],
            from_version_id=a["version_id"],
            to_version_id=b["version_id"],
            explanation_raw="两次经历都可以先尝试",
        ),
        "link",
    )
    service.revise(
        "a", a["id"], RevisionInput(**body.model_dump(), base_version_id=a["version_id"])
    )
    assert service.connections("a", a["id"])[0]["usage_status"] == "needs_review"


def test_reserved_attributes():
    with pytest.raises(ValidationError):
        ItemInput(text="test", collection_ids=["a"], attributes={"nested": {"approved": True}})


def test_pptx_original_and_slide_locator(setup, tmp_path):
    db, _, collection = setup
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as z:
        z.writestr("ppt/slides/slide1.xml", '<p xmlns:a="urn:a"><a:t>课程内容</a:t></p>')
    assets = AssetService(db, Settings(storage_dir=str(tmp_path), _env_file=None))
    row = assets.upload("a", collection, "course.pptx", buffer.getvalue())
    assert assets.read("a", row["id"])["chunks"][0]["locator"].startswith("第 1 张幻灯片")
    path, _ = assets.download("a", row["id"])
    assert path.read_bytes() == buffer.getvalue()
    with pytest.raises(AppError):
        assets.download("b", row["id"])
    path.write_bytes(b"corrupt")
    with pytest.raises(AppError):
        assets.download("a", row["id"])


def test_backup_restore_and_reject_nonempty(setup, tmp_path):
    from app.knowledge.backup import export_bundle, restore_bundle

    db, service, collection = setup
    original = service.create(
        "a", ItemInput(text="我的独立思考", collection_ids=[collection]), "backup"
    )
    settings = Settings(storage_dir=str(tmp_path), _env_file=None)
    blob = export_bundle(db, settings, "a")
    with pytest.raises(AppError, match="空知识库"):
        restore_bundle(db, settings, "a", blob)
    restored = Database("sqlite://", testing=True)
    restored.migrate()
    restore_bundle(restored, settings, "b", blob)
    assert KnowledgeService(restored).get("b", original["id"])["text"] == "我的独立思考"
    with pytest.raises(AppError):
        KnowledgeService(restored).get("a", original["id"])


def test_pattern_context_and_delete_derived(setup):
    _, service, collection = setup
    a = service.create(
        "a", ItemInput(text="先整理写作思路", collection_ids=[collection]), "evidence"
    )
    p = service.create(
        "a",
        ItemInput(
            text="写作时先归纳",
            kind="pattern",
            collection_ids=[collection],
            evidence_ids=[a["version_id"]],
            attributes={"when_applicable": ["写作"]},
        ),
        "pattern",
    )
    assert service.applicable_patterns("a", [collection], "写作卡住了")
    assert not service.applicable_patterns("a", [collection], "我要旅行")
    service.delete("a", a["id"], a["version_id"])
    with pytest.raises(AppError):
        service.get("a", p["id"])
    assert not service.applicable_patterns("a", [collection], "写作卡住了")


def test_api_and_agent_search_tool(setup):
    import asyncio
    import json
    from fastapi.testclient import TestClient
    from app.main import create_app
    from test_memory import FakeProvider

    db, _, _ = setup
    app = create_app(
        Settings(api_token="test", worker_enabled=False, _env_file=None),
        database=db,
        provider=FakeProvider(),
    )
    with TestClient(app, headers={"Authorization": "Bearer test"}) as client:
        response = client.post(
            "/api/v2/collections", json={"name": "阅读"}, headers={"Idempotency-Key": "col"}
        )
        assert response.status_code == 201, response.text
        cid = response.json()["id"]
        response = client.post(
            "/api/v2/items",
            json={"text": "阅读引发新的思想", "collection_ids": [cid]},
            headers={"Idempotency-Key": "entry"},
        )
        assert response.status_code == 201, response.text
        item = response.json()
        from app.tools import ToolController

        tool = ToolController(db, None, None, None, None)
        result = asyncio.run(
            tool.execute(
                "search_knowledge",
                json.dumps({"query": "阅读"}),
                {
                    "owner": "local-user",
                    "conversation_id": "unused",
                    "knowledge_collection_ids": [cid],
                },
            )
        )
        assert result["items"][0]["content"] == "阅读引发新的思想"
        citation = result["items"][0]["id"]
        assert client.get("/api/v1/evidence/" + citation).json()["text"] == "阅读引发新的思想"
        assert (
            client.request(
                "DELETE",
                "/api/v2/items/" + item["id"],
                json={"base_version_id": item["version_id"]},
            ).status_code
            == 200
        )
        assert client.get("/api/v1/evidence/" + citation).status_code == 404
