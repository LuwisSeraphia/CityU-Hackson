import hashlib
import json

from sqlalchemy import or_

from app.infrastructure.db import owned, preference
from app.errors import AppError
from app.domain.retrieval.service import terms
from app.domain.knowledge.models import (
    Asset,
    AssetChunk,
    Collection,
    Connection,
    Feedback,
    Item,
    Membership,
    Proposal,
    Receipt,
    Version,
)
from app.domain.knowledge.schemas import ItemInput


class KnowledgeService:
    def __init__(self, db):
        self.db = db

    def transact(self, owner, key, payload, action):
        digest = hashlib.sha256(
            json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()
        ).hexdigest()
        with self.db.session() as s:
            old = s.query(Receipt).filter_by(owner=owner, request_key=key).first()
            if old:
                if old.digest != digest:
                    raise AppError("IDEMPOTENCY_CONFLICT", "请求编号已用于不同内容。", 409)
                return old.result
            result = action(s)
            s.add(Receipt(owner=owner, request_key=key, digest=digest, result=result))
            return result

    def collections(self, owner):
        with self.db.session() as s:
            return [
                {"id": r.id, "name": r.name, "description": r.description, "tags": r.tags}
                for r in s.query(Collection).filter_by(owner=owner).order_by(Collection.created)
            ]

    def create_collection(self, owner, body, key):
        def action(s):
            row = Collection(owner=owner, **body.model_dump())
            s.add(row)
            s.flush()
            return {"id": row.id, **body.model_dump()}

        return self.transact(owner, "collection:" + key, body.model_dump(), action)

    def scope(self, s, owner, ids):
        for identifier in set(ids):
            owned(s, Collection, identifier, owner)

    def active(self, s, owner, identifier):
        row = owned(s, Item, identifier, owner, lock=True)
        if row.lifecycle != "active":
            raise AppError("EVIDENCE_UNAVAILABLE", "条目已撤回或删除。", 404)
        return row

    def validate_evidence(self, s, owner, ids):
        for identifier in ids:
            version = owned(s, Version, identifier, owner)
            item = self.active(s, owner, version.item_id)
            if item.current_version_id != version.id or item.usage_status != "ready":
                raise AppError("EVIDENCE_UNAVAILABLE", "依据已变化，需要重新审核。", 409)

    def view(self, s, item, version=None):
        version = version or s.get(Version, item.current_version_id)
        return {
            "id": item.id,
            "kind": item.kind,
            "version_id": version.id,
            "version": version.version,
            "text": version.body,
            "title": version.title,
            "usage_status": item.usage_status,
            "lifecycle": item.lifecycle,
            "created_at": version.created,
            **version.data,
        }

    def write(self, s, owner, body, item=None):
        self.scope(s, owner, body.collection_ids)
        self.validate_evidence(s, owner, body.evidence_ids)
        if item is None:
            item = Item(owner=owner, kind=body.kind)
            s.add(item)
            s.flush()
            number = 1
        else:
            if body.kind != item.kind:
                raise AppError("KIND_IMMUTABLE", "修订不能改变条目类型。")
            number = s.get(Version, item.current_version_id).version + 1
        version = Version(
            owner=owner,
            item_id=item.id,
            version=number,
            title=body.title or body.text[:60],
            body=body.text,
            data={
                "modality": body.modality,
                "attributes": body.attributes,
                "evidence_ids": body.evidence_ids,
                "review_status": "approved",
            },
        )
        s.add(version)
        s.flush()
        item.current_version_id = version.id
        item.usage_status = "ready"
        s.query(Membership).filter_by(item_id=item.id, owner=owner).delete()
        for collection_id in set(body.collection_ids):
            s.add(Membership(item_id=item.id, collection_id=collection_id, owner=owner))
        return self.view(s, item, version)

    def create(self, owner, body, key, candidate=False):
        def action(s):
            self.scope(s, owner, body.collection_ids)
            self.validate_evidence(s, owner, body.evidence_ids)
            if candidate:
                policy = preference(s, owner)
                if not policy.enabled:
                    raise AppError("MEMORY_POLICY", "智能记忆已关闭。", 409)
                if not body.evidence_ids:
                    raise AppError("SOURCE_REQUIRED", "自动提炼必须提供已保存依据。")
                p = Proposal(
                    owner=owner,
                    payload=body.model_dump(),
                    evidence_ids=body.evidence_ids,
                    epoch=policy.epoch,
                )
                s.add(p)
                s.flush()
                return {"id": p.id, "status": "pending"}
            return self.write(s, owner, body)

        return self.transact(
            owner, ("proposal:" if candidate else "item:") + key, body.model_dump(), action
        )

    def decide(self, owner, identifier, decision):
        with self.db.session() as s:
            p = owned(s, Proposal, identifier, owner, lock=True)
            if p.status != "pending":
                raise AppError("PROPOSAL_NOT_PENDING", "候选已处理。", 409)
            if decision == "reject":
                p.status = "rejected"
                return {"status": p.status}
            policy = preference(s, owner)
            if not policy.enabled or policy.epoch != p.epoch:
                raise AppError("MEMORY_POLICY", "记忆策略已变化，请重新提交候选。", 409)
            result = self.write(s, owner, ItemInput.model_validate(p.payload))
            p.status = "approved"
            return result

    def get(self, owner, identifier):
        with self.db.session() as s:
            return self.view(s, self.active(s, owner, identifier))

    def invalidate(self, s, owner, identifier, old_version):
        s.query(Connection).filter(
            Connection.owner == owner,
            or_(Connection.from_id == identifier, Connection.to_id == identifier),
        ).update({"usage_status": "needs_review"})
        for item in s.query(Item).filter_by(owner=owner, lifecycle="active"):
            if item.current_version_id:
                version = s.get(Version, item.current_version_id)
                if old_version in version.data.get("evidence_ids", []):
                    item.usage_status = "needs_review"

    def revise(self, owner, identifier, body):
        with self.db.session() as s:
            item = self.active(s, owner, identifier)
            if item.current_version_id != body.base_version_id:
                raise AppError("KNOWLEDGE_VERSION_CONFLICT", "版本已变化。", 409)
            self.invalidate(s, owner, item.id, item.current_version_id)
            return self.write(s, owner, body, item)

    def history(self, owner, identifier):
        with self.db.session() as s:
            item = self.active(s, owner, identifier)
            return [
                self.view(s, item, v)
                for v in s.query(Version)
                .filter_by(owner=owner, item_id=identifier)
                .order_by(Version.version)
            ]

    def connect(self, owner, body, key):
        def action(s):
            for identifier, version_id in [
                (body.from_id, body.from_version_id),
                (body.to_id, body.to_version_id),
            ]:
                if self.active(s, owner, identifier).current_version_id != version_id:
                    raise AppError("KNOWLEDGE_VERSION_CONFLICT", "连接端点已变化。", 409)
            row = Connection(owner=owner, **body.model_dump())
            s.add(row)
            s.flush()
            return {"id": row.id, "usage_status": row.usage_status, **body.model_dump()}

        return self.transact(owner, "connection:" + key, body.model_dump(), action)

    def connections(self, owner, identifier):
        with self.db.session() as s:
            self.active(s, owner, identifier)
            rows = (
                s.query(Connection)
                .filter(
                    Connection.owner == owner,
                    or_(Connection.from_id == identifier, Connection.to_id == identifier),
                )
                .all()
            )
            return [
                {
                    "id": r.id,
                    "from_id": r.from_id,
                    "to_id": r.to_id,
                    "explanation_raw": r.explanation_raw,
                    "usage_status": r.usage_status,
                }
                for r in rows
                if r.usage_status != "deleted"
            ]

    def search(self, owner, body):
        from sqlalchemy import func

        with self.db.session() as s:
            self.scope(s, owner, body.collection_ids)
            tokens = terms(body.query)
            query = (
                s.query(Item, Version)
                .join(Version, Item.current_version_id == Version.id)
                .join(Membership, Membership.item_id == Item.id)
                .filter(
                    Item.owner == owner,
                    Item.lifecycle == "active",
                    Item.usage_status == "ready",
                    Membership.collection_id.in_(body.collection_ids),
                )
            )
            if tokens:
                query = query.filter(
                    or_(*[func.lower(Version.body).contains(t, autoescape=True) for t in tokens])
                )
            rows = query.distinct().all()
            rows.sort(key=lambda pair: len(tokens & terms(pair[1].body)), reverse=True)
            hits = [(len(tokens & terms(v.body)), self.view(s, i, v)) for i, v in rows]
            assets = (
                s.query(AssetChunk, Asset)
                .join(Asset, AssetChunk.asset_id == Asset.id)
                .filter(Asset.owner == owner, Asset.collection_id.in_(body.collection_ids))
            )
            if tokens:
                assets = assets.filter(
                    or_(
                        *[
                            func.lower(AssetChunk.content).contains(t, autoescape=True)
                            for t in tokens
                        ]
                    )
                )
            for chunk, asset in assets:
                hits.append(
                    (
                        len(tokens & terms(chunk.content)),
                        {
                            "id": chunk.id,
                            "kind": "asset",
                            "text": chunk.content,
                            "title": asset.name,
                            "asset_id": asset.id,
                            "locator": chunk.locator,
                            "warnings": asset.warnings,
                        },
                    )
                )
            hits.sort(key=lambda hit: hit[0], reverse=True)
            return {
                "items": [item for _, item in hits[: body.limit]],
                "warnings": ["当前知识查询使用关键词匹配，语义索引尚未接入。"],
            }

    def applicable_patterns(self, owner, collection_ids, text):
        if not collection_ids:
            return []
        with self.db.session() as s:
            self.scope(s, owner, collection_ids)
            rows = (
                s.query(Item, Version)
                .join(Version, Item.current_version_id == Version.id)
                .join(Membership, Membership.item_id == Item.id)
                .filter(
                    Item.owner == owner,
                    Item.kind.in_(["pattern", "preference"]),
                    Item.lifecycle == "active",
                    Item.usage_status == "ready",
                    Membership.collection_id.in_(collection_ids),
                )
                .distinct()
                .all()
            )
            result, size = [], 0
            for item, version in rows:
                conditions = version.data.get("attributes", {}).get("when_applicable", [])
                if not isinstance(conditions, list) or not conditions:
                    continue
                if not any(isinstance(c, str) and c and c in text for c in conditions):
                    continue
                try:
                    self.validate_evidence(s, owner, version.data.get("evidence_ids", []))
                except AppError:
                    continue
                if size + len(version.body) > 2000:
                    continue
                result.append({"id": item.id, "version_id": version.id, "text": version.body})
                size += len(version.body)
                if len(result) == 3:
                    break
            return result

    def delete(self, owner, identifier, base_version_id):
        from app.infrastructure.db import Summary

        with self.db.session() as s:
            item = self.active(s, owner, identifier)
            if item.current_version_id != base_version_id:
                raise AppError("KNOWLEDGE_VERSION_CONFLICT", "版本已变化。", 409)
            self.invalidate(s, owner, identifier, item.current_version_id)
            item.lifecycle = "deleted"
            # Expand transitively before clearing evidence; derived text can contain deleted material.
            affected = {identifier}
            changed = True
            while changed:
                changed = False
                affected_versions = {
                    v.id
                    for v in s.query(Version).filter(
                        Version.owner == owner, Version.item_id.in_(affected)
                    )
                }
                for version in s.query(Version).filter_by(owner=owner):
                    if version.item_id not in affected and affected_versions.intersection(
                        version.data.get("evidence_ids", [])
                    ):
                        affected.add(version.item_id)
                        changed = True
            for target in s.query(Item).filter(Item.owner == owner, Item.id.in_(affected)):
                target.lifecycle = "deleted"
            for target in s.query(Version).filter(
                Version.owner == owner, Version.item_id.in_(affected)
            ):
                target.body, target.title, target.data = "", "已删除", {}
            for version in s.query(Version).filter_by(owner=owner, item_id=identifier):
                version.body, version.title, version.data = "", "已删除", {}
            for connection in s.query(Connection).filter(
                Connection.owner == owner,
                or_(Connection.from_id.in_(affected), Connection.to_id.in_(affected)),
            ):
                connection.explanation_raw, connection.usage_status = "", "deleted"
            # Derived content can quote its source; erase rather than merely hide it.
            version_ids = {
                v.id
                for v in s.query(Version).filter(
                    Version.owner == owner, Version.item_id.in_(affected)
                )
            }
            for p in s.query(Proposal).filter_by(owner=owner):
                if version_ids.intersection(p.evidence_ids):
                    p.payload, p.evidence_ids, p.status = {}, [], "rejected"
            s.query(Feedback).filter(
                Feedback.owner == owner, Feedback.item_id.in_(affected)
            ).delete(synchronize_session=False)
            # Successful request replay must not return a deleted body.
            s.query(Receipt).filter_by(owner=owner).delete()
            s.query(Summary).filter_by(owner=owner).update({"valid": False})
            return {"id": identifier, "lifecycle": "deleted", "affected_ids": sorted(affected)}

    def feedback(self, owner, identifier, body):
        with self.db.session() as s:
            item = self.active(s, owner, identifier)
            if item.kind != "pattern":
                raise AppError("PATTERN_REQUIRED", "请选择思考模式。")
            if body.kind == "correction":
                item.usage_status = "suspended"
            s.add(Feedback(owner=owner, item_id=item.id, **body.model_dump()))
            return {"id": item.id, "usage_status": item.usage_status}
