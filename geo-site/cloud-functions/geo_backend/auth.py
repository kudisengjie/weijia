from __future__ import annotations

import hmac
from dataclasses import dataclass
from datetime import datetime, timezone

from .config import Settings
from .errors import ApiError
from .security import csrf_for_session, digest, new_session_material, verify_password


@dataclass(frozen=True)
class LoginResult:
    authenticated: bool
    cookie_token: str
    csrf_token: str
    expires_at: datetime


@dataclass(frozen=True)
class AuthenticatedSession:
    user_id: str
    csrf_hash: str
    csrf_token: str
    expires_at: datetime


class AuthService:
    def __init__(self, settings: Settings, repository: object) -> None:
        self.settings = settings
        self.repository = repository

    def require_configuration(self) -> None:
        if self.settings.missing:
            raise ApiError(503, "服务端配置尚未完成，请管理员检查 EdgeOne 环境变量。", "SETUP_REQUIRED")

    def login(self, account: object, password: object) -> LoginResult:
        self.require_configuration()
        account_text = account if isinstance(account, str) else ""
        scope_hash = digest(f"login:{account_text.casefold()}")
        now = datetime.now(timezone.utc)
        if self.repository.login_blocked(scope_hash, now):
            raise ApiError(429, "登录尝试过多，请 15 分钟后再试。", "LOGIN_THROTTLED")
        if not verify_password(password, self.settings.geo_password_hash) or not hmac.compare_digest(
            account_text, self.settings.geo_account
        ):
            self.repository.record_login_failure(scope_hash, now)
            raise ApiError(401, "账号或密码不正确。", "LOGIN_FAILED")
        self.repository.clear_login_failures(scope_hash)
        user = self.repository.upsert_configured_user(self.settings.geo_account, self.settings.geo_password_hash)
        material = new_session_material(self.settings.geo_master_key, now)
        self.repository.create_session(str(user["id"]), material.stored)
        return LoginResult(True, material.cookie_token, material.csrf_token, material.expires_at)

    def authenticate(self, cookie_token: str | None, csrf_token: str | None, method: str) -> AuthenticatedSession:
        self.require_configuration()
        if not cookie_token or len(cookie_token) > 256:
            raise ApiError(401, "请先登录。", "LOGIN_REQUIRED")
        row = self.repository.get_session(digest(cookie_token))
        if not row:
            raise ApiError(401, "请先登录。", "LOGIN_REQUIRED")
        stored_csrf_hash = str(row["csrf_hash"])
        session_csrf = csrf_for_session(cookie_token, self.settings.geo_master_key)
        if not hmac.compare_digest(digest(session_csrf), stored_csrf_hash):
            raise ApiError(401, "请先登录。", "LOGIN_REQUIRED")
        if method.upper() not in {"GET", "HEAD"}:
            actual = digest(csrf_token or "")
            if not hmac.compare_digest(actual, stored_csrf_hash):
                raise ApiError(403, "会话校验失败，请重新登录。", "CSRF_REJECTED")
        return AuthenticatedSession(str(row["user_id"]), stored_csrf_hash, session_csrf, row["expires_at"])

    def logout(self, cookie_token: str) -> None:
        if cookie_token:
            self.repository.revoke_session(digest(cookie_token))
