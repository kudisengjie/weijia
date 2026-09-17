from __future__ import annotations

import re
import uuid

from .errors import ApiError


_SHA256_RE = re.compile(r"[0-9a-f]{64}")
_RECEIPT_FIELDS = {"requestId", "sha256", "byteLength"}
DEFAULT_PENDING_LIMIT = 20
MAX_PENDING_LIMIT = 100


def _invalid(message: str, code: str) -> ApiError:
    return ApiError(422, message, code)


class DeliveryService:
    """本地交付业务：回执校验、幂等确认、待交付清单与 manifest。

    事务边界在 repository.confirm_local_delivery：幂等回执 → 清在线正文 →
    按 deliveryMode 结算对应 Excel 行。本服务不持有数据库连接。
    """

    def __init__(self, repository: object) -> None:
        self.repository = repository

    def confirm(self, *, tenant_id: str, user_id: str, artifact_id: str, payload: object) -> dict[str, object]:
        request_id, sha256, byte_length = self._validate_receipt(payload)
        artifact_id = self._require_uuid(artifact_id)
        return dict(self.repository.confirm_local_delivery(
            tenant_id=str(tenant_id),
            artifact_id=artifact_id,
            user_id=str(user_id),
            request_id=request_id,
            sha256=sha256,
            byte_length=byte_length,
        ))

    def manifest(self, *, tenant_id: str, user_id: str, artifact_id: str) -> dict[str, object]:
        artifact_id = self._require_uuid(artifact_id)
        row = self.repository.get_article_artifact_meta(str(tenant_id), artifact_id, user_id=str(user_id))
        if not row:
            raise ApiError(404, "文章文件不存在或不属于当前账号。", "ARTIFACT_NOT_FOUND")
        return dict(row)

    def pending(self, *, tenant_id: str, user_id: str, limit: object = DEFAULT_PENDING_LIMIT,
                cursor: object = None) -> dict[str, object]:
        if isinstance(limit, bool) or not isinstance(limit, int) or limit <= 0 or limit > MAX_PENDING_LIMIT:
            raise _invalid("分页参数非法。", "INVALID_PAGINATION")
        if cursor is not None and not isinstance(cursor, str):
            raise _invalid("分页参数非法。", "INVALID_PAGINATION")
        return dict(self.repository.list_pending_artifacts(
            str(tenant_id), str(user_id), limit=int(limit), cursor=cursor))

    # ---- 输入校验 ----

    def _validate_receipt(self, payload: object) -> tuple[str, str, int]:
        if not isinstance(payload, dict) or set(payload.keys()) != _RECEIPT_FIELDS:
            raise _invalid("回执字段必须且仅为 requestId、sha256、byteLength。", "INVALID_RECEIPT_BODY")
        request_id = payload["requestId"]
        if not isinstance(request_id, str):
            raise _invalid("requestId 必须是规范 UUID。", "INVALID_REQUEST_ID")
        try:
            normalized = str(uuid.UUID(request_id))
        except (ValueError, AttributeError, TypeError):
            raise _invalid("requestId 必须是规范 UUID。", "INVALID_REQUEST_ID") from None
        if normalized != request_id:
            raise _invalid("requestId 必须是小写规范 UUID 形式。", "INVALID_REQUEST_ID")
        sha256 = payload["sha256"]
        if not isinstance(sha256, str) or not _SHA256_RE.fullmatch(sha256):
            raise _invalid("sha256 必须是 64 位小写十六进制。", "INVALID_SHA256")
        byte_length = payload["byteLength"]
        if isinstance(byte_length, bool) or not isinstance(byte_length, int) or byte_length <= 0:
            raise _invalid("byteLength 必须是正整数。", "INVALID_BYTE_LENGTH")
        return request_id, sha256, int(byte_length)

    @staticmethod
    def _require_uuid(artifact_id: object) -> str:
        if isinstance(artifact_id, str):
            try:
                return str(uuid.UUID(artifact_id))
            except (ValueError, AttributeError, TypeError):
                pass
        raise ApiError(404, "文章文件不存在或不属于当前账号。", "ARTIFACT_NOT_FOUND")
