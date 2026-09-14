from __future__ import annotations

from datetime import datetime, timezone

from .errors import ApiError
from .security import hash_password


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

    @staticmethod
    def require_owner(context: dict[str, object]) -> None:
        if context.get('role') != 'owner':
            raise ApiError(403, '只有站点所有者可以执行此操作。', 'OWNER_REQUIRED')

    def create_member(
        self,
        context: dict[str, object],
        *,
        username: str,
        password: str,
        role: str,
        starts_at: datetime,
        expires_at: datetime,
    ) -> dict[str, object]:
        self.require_manager(context)
        account = str(username or "").strip()
        if not 3 <= len(account) <= 128 or any(char.isspace() for char in account):
            raise ApiError(400, "子账号格式不正确。", "INVALID_MEMBER_ACCOUNT")
        if role not in {"member", "admin"}:
            raise ApiError(400, "子账号角色不正确。", "INVALID_MEMBER_ROLE")
        if expires_at <= starts_at:
            raise ApiError(400, "子账号有效期必须晚于开始时间。", "INVALID_MEMBER_EXPIRY")
        try:
            password_hash = hash_password(password)
        except ValueError as error:
            raise ApiError(400, "子账号密码长度必须为 8–128 个字符。", "INVALID_MEMBER_PASSWORD") from error
        try:
            return self.repository.create_member(
                tenant_id=str(context["tenantId"]),
                username=account,
                password_hash=password_hash,
                role=role,
                starts_at=starts_at,
                expires_at=expires_at,
            )
        except ValueError as error:
            if str(error) == "ACCOUNT_EXISTS":
                raise ApiError(409, "子账号已经存在。", "ACCOUNT_EXISTS") from error
            raise
