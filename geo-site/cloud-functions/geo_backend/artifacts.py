from __future__ import annotations

import hashlib
import re
import uuid

from .errors import ApiError


class ArtifactService:
    def __init__(self, repository: object, master_key: str = "") -> None:
        self.repository = repository
        self.master_key = master_key

    def save_complete(
        self,
        *,
        tenant_id: str,
        batch_id: str,
        task_id: str,
        user_id: str,
        filename: str,
        markdown: str,
        audit_status: str,
    ) -> dict[str, object]:
        content = str(markdown or "").strip()
        if not content:
            raise ApiError(422, "文章正文为空，未保存文件。", "EMPTY_ARTIFACT")
        if audit_status != "accepted":
            raise ApiError(422, "文章未通过审核，未保存文件。", "ARTIFACT_AUDIT_REQUIRED")
        safe_name = re.sub(r"[^\w\-.\u4e00-\u9fff]+", "-", str(filename or "article.md")).strip("-.") or "article.md"
        if not safe_name.lower().endswith(".md"):
            safe_name += ".md"
        payload = content.encode("utf-8")
        row = self.repository.save_article_artifact(
            tenant_id=tenant_id,
            batch_id=batch_id,
            task_id=str(task_id),
            user_id=user_id,
            filename=safe_name,
            markdown=content,
            byte_length=len(payload),
            sha256=hashlib.sha256(payload).hexdigest(),
            status="complete",
            audit_status=audit_status,
            master_key=self.master_key,
        )
        return {
            "id": str(row["id"]),
            "filename": safe_name,
            "byteLength": len(payload),
            "sha256": hashlib.sha256(payload).hexdigest(),
            "status": "complete",
            "auditStatus": audit_status,
        }

    def get(self, tenant_id: str, artifact_id: str, user_id: str) -> dict[str, object]:
        try:
            uuid.UUID(artifact_id)
        except (ValueError, TypeError, AttributeError):
            raise ApiError(404, '文章文件不存在。', 'ARTIFACT_NOT_FOUND')
        row = self.repository.get_article_artifact(tenant_id, artifact_id, self.master_key, user_id=user_id)
        if not row:
            raise ApiError(404, "文章文件不存在或不属于当前工作区。", "ARTIFACT_NOT_FOUND")
        payload = str(row['markdown']).encode('utf-8')
        if len(payload) != row['byteLength'] or hashlib.sha256(payload).hexdigest() != row['sha256'] or row['auditStatus'] != 'accepted':
            raise ApiError(503, '文章文件校验失败，请联系管理员恢复文件。', 'ARTIFACT_INTEGRITY_ERROR')
        return row
