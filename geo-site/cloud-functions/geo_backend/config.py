from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Mapping
from urllib.parse import parse_qs, urlparse


_SCRYPT_RE = re.compile(r"^scrypt:[0-9a-f]{32}:[0-9a-f]{128}$")
_MASTER_KEY_RE = re.compile(r"^[0-9a-f]{64}$")


@dataclass(frozen=True)
class Settings:
    app_origin: str
    geo_account: str
    geo_password_hash: str
    geo_master_key: str
    ima_admin_secret: str
    ima_client_id: str
    ima_api_key: str
    database_url: str
    local_dev: bool
    missing: tuple[str, ...]

    @classmethod
    def from_mapping(cls, values: Mapping[str, str]) -> "Settings":
        app_origin = str(values.get("APP_ORIGIN", "")).rstrip("/")
        geo_account = str(values.get("GEO_ACCOUNT", ""))
        password_hash = str(values.get("GEO_PASSWORD_HASH", "")).lower()
        master_key = str(values.get("GEO_MASTER_KEY", "")).lower()
        database_url = str(values.get("DATABASE_URL", ""))
        local_dev = str(values.get("GEO_LOCAL_DEV", "")) == "1"
        missing: list[str] = []

        if not _valid_origin(app_origin, local_dev):
            missing.append("APP_ORIGIN")
        if not geo_account:
            missing.append("GEO_ACCOUNT")
        if not _SCRYPT_RE.fullmatch(password_hash):
            missing.append("GEO_PASSWORD_HASH")
        if not _MASTER_KEY_RE.fullmatch(master_key):
            missing.append("GEO_MASTER_KEY")
        if not _valid_database_url(database_url, local_dev):
            missing.append("DATABASE_URL")

        return cls(
            app_origin=app_origin,
            geo_account=geo_account,
            geo_password_hash=password_hash,
            geo_master_key=master_key,
            ima_admin_secret=str(values.get("IMA_ADMIN_SECRET", "")),
            ima_client_id=str(values.get("IMA_OPENAPI_CLIENTID", "")),
            ima_api_key=str(values.get("IMA_OPENAPI_APIKEY", "")),
            database_url=database_url,
            local_dev=local_dev,
            missing=tuple(missing),
        )


def _valid_origin(value: str, local_dev: bool) -> bool:
    try:
        parsed = urlparse(value)
    except ValueError:
        return False
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        return False
    if parsed.scheme == "https" and parsed.netloc and parsed.path in ("", "/"):
        return True
    return bool(local_dev and parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost"})


def _valid_database_url(value: str, local_dev: bool) -> bool:
    try:
        parsed = urlparse(value)
    except ValueError:
        return False
    if parsed.scheme not in {"postgresql", "postgres"} or not parsed.hostname or not parsed.path.strip("/"):
        return False
    if local_dev:
        return True
    return parse_qs(parsed.query).get("sslmode", [""])[0] in {"require", "verify-ca", "verify-full"}
