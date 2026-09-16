from __future__ import annotations

import hashlib
import hmac
import secrets
from base64 import urlsafe_b64encode
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone


SESSION_TTL = timedelta(hours=8)


def digest(value: str) -> str:
    return hashlib.sha256(str(value).encode("utf-8")).hexdigest()


def verify_password(password: object, encoded: object) -> bool:
    if not isinstance(password, str) or len(password) > 128:
        return False
    parts = str(encoded).split(":")
    if len(parts) != 3 or parts[0] != "scrypt":
        return False
    salt, expected_hex = parts[1:]
    if len(salt) != 32 or len(expected_hex) != 128:
        return False
    try:
        if bytes.fromhex(salt).hex() != salt or bytes.fromhex(expected_hex).hex() != expected_hex:
            return False
        actual = hashlib.scrypt(
            password.encode("utf-8"),
            salt=salt.encode("ascii"),
            n=16384,
            r=8,
            p=1,
            dklen=64,
        )
    except (TypeError, ValueError, UnicodeError):
        return False
    return hmac.compare_digest(actual, bytes.fromhex(expected_hex))


def hash_password(password: str) -> str:
    if not isinstance(password, str) or not 8 <= len(password) <= 128:
        raise ValueError("INVALID_PASSWORD")
    salt = secrets.token_hex(16)
    value = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt.encode("ascii"),
        n=16384,
        r=8,
        p=1,
        dklen=64,
    ).hex()
    return f"scrypt:{salt}:{value}"


@dataclass(frozen=True)
class SessionMaterial:
    cookie_token: str
    cookie_digest: str
    csrf_token: str
    csrf_digest: str
    expires_at: datetime

    @property
    def stored(self) -> dict[str, object]:
        return {
            "token_hash": self.cookie_digest,
            "csrf_hash": self.csrf_digest,
            "expires_at": self.expires_at,
        }


def csrf_for_session(cookie_token: str, master_key: str) -> str:
    key = bytes.fromhex(master_key)
    value = hmac.new(key, f"lxue-csrf-v1:{cookie_token}".encode("utf-8"), hashlib.sha256).digest()
    return urlsafe_b64encode(value).decode("ascii").rstrip("=")


def account_scope(user_id: str, master_key: str) -> str:
    """稳定、非秘密、按账号隔离的本地命名标识（交接方案 §6.2）。

    由服务端 user ID 与主密钥派生的 HMAC 截断值：不可逆推用户身份，
    只用于浏览器端 IndexedDB 命名隔离，不能作为服务端授权凭证。
    """
    key = bytes.fromhex(master_key)
    value = hmac.new(key, f"lxue-account-scope-v1:{user_id}".encode("utf-8"), hashlib.sha256).hexdigest()
    return value[:32]


def new_session_material(master_key: str | None = None, now: datetime | None = None) -> SessionMaterial:
    current = now or datetime.now(timezone.utc)
    cookie_token = secrets.token_urlsafe(32)
    csrf_token = csrf_for_session(cookie_token, master_key) if master_key else secrets.token_urlsafe(32)
    return SessionMaterial(
        cookie_token=cookie_token,
        cookie_digest=digest(cookie_token),
        csrf_token=csrf_token,
        csrf_digest=digest(csrf_token),
        expires_at=current + SESSION_TTL,
    )
