from __future__ import annotations

from datetime import datetime, timezone

from .errors import ApiError


class TenantAccessService:
    def __init__(self, repository: object) -> None:
        self.repository = repository

    def context(self, user_id: str, now: datetime | None = None) -> dict[str, object] | None:
        current = now or datetime.now(timezone.utc)
        context = self.repository.get_tenant_context(user_id, current)
        return dict(context) if context else None

    def require(self, user_id: str, now: datetime | None = None) -> dict[str, object]:
        current = now or datetime.now(timezone.utc)
        context = self.context(user_id, current)
        if not context:
            raise ApiError(403, "当前账号没有可用的工作区。", "TENANT_ACCESS_REQUIRED")
        expires_at = context.get("expiresAt")
        active = bool(context.get("active"))
        if not active or expires_at is not None and expires_at <= current:
            raise ApiError(403, "工作区服务已到期，请联系管理员续期。", "SUBSCRIPTION_EXPIRED")
        return context

    @staticmethod
    def can_manage(context: dict[str, object]) -> bool:
        return str(context.get("role", "")) in {"owner", "admin"}

    @staticmethod
    def require_manager(context: dict[str, object]) -> None:
        if not TenantAccessService.can_manage(context):
            raise ApiError(403, "只有工作区管理员可以执行此操作。", "TENANT_MANAGER_REQUIRED")
