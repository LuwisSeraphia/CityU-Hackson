from fastapi import APIRouter, Depends, Header, UploadFile, File, Form
from fastapi.responses import FileResponse, Response

from app.domain.knowledge.assets import AssetService

from app.domain.knowledge.schemas import (
    CollectionInput,
    ConnectionInput,
    DecisionInput,
    DeleteInput,
    FeedbackInput,
    ItemInput,
    RevisionInput,
    SearchInput,
)
from app.domain.knowledge.service import KnowledgeService


def router(state, ready, settings, provider):
    api = APIRouter(prefix="/api/v2")

    def service():
        return KnowledgeService(state["db"])

    @api.get("/exports/download")
    def export(owner=Depends(ready)):
        from app.domain.knowledge.backup import export_bundle

        return Response(
            export_bundle(state["db"], settings, owner),
            media_type="application/zip",
            headers={"Content-Disposition": 'attachment; filename="personal-knowledge.zip"'},
        )

    @api.post("/imports/restore")
    async def restore(file: UploadFile = File(...), owner=Depends(ready)):
        from app.domain.knowledge.backup import restore_bundle
        from app.errors import AppError

        data = await file.read(50_000_001)
        if len(data) > 50_000_000:
            raise AppError("FILE_TOO_LARGE", "备份包超过50MB。", 413)
        return restore_bundle(state["db"], settings, owner, data)

    @api.get("/proposals")
    def proposals(owner=Depends(ready)):
        from app.domain.knowledge.models import Proposal

        with state["db"].session() as s:
            return {
                "items": [
                    {"id": p.id, "status": p.status, "payload": p.payload}
                    for p in s.query(Proposal).filter_by(owner=owner, status="pending")
                ]
            }

    @api.post("/patterns/review")
    async def patterns(body: SearchInput, owner=Depends(ready)):
        from app.domain.knowledge.patterns import review_patterns

        return await review_patterns(service(), provider, owner, body.collection_ids)

    @api.post("/assets", status_code=201)
    async def upload(
        collection_id: str = Form(...), file: UploadFile = File(...), owner=Depends(ready)
    ):
        data = await file.read(settings.max_file_bytes + 1)
        return AssetService(state["db"], settings).upload(
            owner, collection_id, file.filename or "file", data
        )

    @api.get("/assets/{identifier}")
    def asset(identifier: str, owner=Depends(ready)):
        return AssetService(state["db"], settings).read(owner, identifier)

    @api.get("/assets/{identifier}/download")
    def download(identifier: str, owner=Depends(ready)):
        path, name = AssetService(state["db"], settings).download(owner, identifier)
        return FileResponse(path, filename=name, media_type="application/octet-stream")

    @api.get("/collections")
    def collections(owner=Depends(ready)):
        return {"items": service().collections(owner)}

    @api.post("/collections", status_code=201)
    def create_collection(
        body: CollectionInput,
        owner=Depends(ready),
        idempotency_key: str = Header(min_length=1, max_length=128),
    ):
        return service().create_collection(owner, body, idempotency_key)

    @api.post("/items", status_code=201)
    def create(
        body: ItemInput,
        owner=Depends(ready),
        idempotency_key: str = Header(min_length=1, max_length=128),
    ):
        return service().create(owner, body, idempotency_key)

    @api.get("/items/{identifier}")
    def get(identifier: str, owner=Depends(ready)):
        return service().get(owner, identifier)

    @api.delete("/items/{identifier}")
    def delete(identifier: str, body: DeleteInput, owner=Depends(ready)):
        return service().delete(owner, identifier, body.base_version_id)

    @api.patch("/items/{identifier}")
    def revise(identifier: str, body: RevisionInput, owner=Depends(ready)):
        return service().revise(owner, identifier, body)

    @api.get("/items/{identifier}/history")
    def history(identifier: str, owner=Depends(ready)):
        return {"items": service().history(owner, identifier)}

    @api.get("/items/{identifier}/connections")
    def connections(identifier: str, owner=Depends(ready)):
        return {"items": service().connections(owner, identifier)}

    @api.post("/connections", status_code=201)
    def connect(
        body: ConnectionInput,
        owner=Depends(ready),
        idempotency_key: str = Header(min_length=1, max_length=128),
    ):
        return service().connect(owner, body, idempotency_key)

    @api.post("/proposals", status_code=201)
    def propose(
        body: ItemInput,
        owner=Depends(ready),
        idempotency_key: str = Header(min_length=1, max_length=128),
    ):
        return service().create(owner, body, idempotency_key, candidate=True)

    @api.post("/proposals/{identifier}/decision")
    def decide(identifier: str, body: DecisionInput, owner=Depends(ready)):
        return service().decide(owner, identifier, body.decision)

    @api.post("/search")
    def search(body: SearchInput, owner=Depends(ready)):
        return service().search(owner, body)

    @api.post("/patterns/{identifier}/feedback", status_code=201)
    def feedback(identifier: str, body: FeedbackInput, owner=Depends(ready)):
        return service().feedback(owner, identifier, body)

    return api
