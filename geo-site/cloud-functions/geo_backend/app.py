from __future__ import annotations

import logging
import os
from contextlib import AbstractContextManager
from typing import Callable

from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict

from .auth import AuthService
from .batches import BatchService
from .config import Settings
from .errors import ApiError
from .ima import load_ima_credentials, update_ima_credentials
from .models import SettingsService
from .providers import complete
from .repository import postgres_repository
from .tenant_access import TenantAccessService


LOGGER = logging.getLogger("lxue_geo")
SESSION_COOKIE = "lxue_session"
DEFAULT_JSON_LIMIT = 32 * 1024
BATCH_JSON_LIMIT = 4 * 1024 * 1024
LOGIN_JSON_LIMIT = 4 * 1024
RepositoryFactory = Callable[[], AbstractContextManager]


class LoginBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    account: str
    password: str


class ModelBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider: str
    slot: str
    modelId: str = ""
    apiKey: str = ""
    removeKey: bool = False


class ImaBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    clientId: str
    apiKey: str
    expiresAt: str
    adminSecret: str


class BatchBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    requestId: str
    rows: list[list[object]]
    companies: list[dict[str, object]]


class BatchStepBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    seq: int
    retry: bool = False


def _epoch_ms(value) -> int:
    return int(value.timestamp() * 1000)


def create_app(
    settings: Settings | None = None,
    repository_factory: RepositoryFactory | None = None,
    *,
    model_complete=complete,
) -> FastAPI:
    config = settings or Settings.from_mapping(os.environ)
    factory = repository_factory or (lambda: postgres_repository(config.database_url))
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    @app.exception_handler(ApiError)
    async def api_error_handler(_request: Request, error: ApiError):
        return JSONResponse({"error": str(error), "code": error.code}, status_code=error.status)

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(_request: Request, _error: RequestValidationError):
        return JSONResponse({"error": "请求内容无效。", "code": "INVALID_REQUEST"}, status_code=400)

    @app.exception_handler(Exception)
    async def unexpected_error_handler(request: Request, error: Exception):
        LOGGER.exception("api_request_failed", extra={"path": request.url.path, "method": request.method})
        return JSONResponse(
            {"error": "服务暂不可用，请检查 Python Cloud Functions 与 PostgreSQL 配置。", "code": "SERVER_ERROR"},
            status_code=503,
        )

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        if request.method not in {"GET", "HEAD"}:
            if request.headers.get("origin") != config.app_origin:
                response = JSONResponse({"error": "请求来源不匹配，请从本站重新登录。", "code": "ORIGIN_REJECTED"}, status_code=403)
            elif not request.headers.get("content-type", "").startswith("application/json"):
                response = JSONResponse({"error": "请求格式不支持。", "code": "UNSUPPORTED_MEDIA"}, status_code=415)
            else:
                limit = BATCH_JSON_LIMIT if request.url.path == "/batches" else LOGIN_JSON_LIMIT if request.url.path == "/auth/login" else DEFAULT_JSON_LIMIT
                body = await request.body()
                if len(body) > limit:
                    response = JSONResponse(
                        {"error": "请求内容过大。", "code": "REQUEST_TOO_LARGE"},
                        status_code=413,
                    )
                else:
                    response = await call_next(request)
        else:
            response = await call_next(request)
        response.headers["Cache-Control"] = "private, no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        return response

    def authentication(request: Request, repository: object):
        return AuthService(config, repository).authenticate(
            request.cookies.get(SESSION_COOKIE), request.headers.get("x-csrf-token"), request.method
        )

    def tenant_context(repository: object, user_id: str, *, active: bool = False):
        if not hasattr(repository, "get_tenant_context"):
            return None
        service = TenantAccessService(repository)
        return service.require(user_id) if active else service.context(user_id)

    def batch_service(repository: object, context: dict[str, object] | None = None) -> BatchService:
        return BatchService(
            repository,
            config.geo_master_key,
            {"clientId": config.ima_client_id, "apiKey": config.ima_api_key},
            model_complete=model_complete,
            tenant_context=context,
        )

    @app.get("/health")
    def health():
        if config.missing:
            raise ApiError(503, "服务端配置尚未完成。", "SETUP_REQUIRED")
        with factory() as repository:
            result = repository.health()
        return {"service": "available", **result}

    @app.post("/auth/login")
    def login(body: LoginBody, response: Response):
        with factory() as repository:
            result = AuthService(config, repository).login(body.account, body.password)
        response.set_cookie(
            SESSION_COOKIE,
            result.cookie_token,
            max_age=604800,
            httponly=True,
            secure=not config.local_dev,
            samesite="strict",
            path="/",
        )
        return {"authenticated": True, "csrf": result.csrf_token, "expiresAt": _epoch_ms(result.expires_at)}

    @app.get("/auth/session")
    def session(request: Request):
        with factory() as repository:
            current = authentication(request, repository)
        return {"authenticated": True, "csrf": current.csrf_token, "expiresAt": _epoch_ms(current.expires_at)}

    @app.post("/auth/logout")
    def logout(request: Request, response: Response):
        cookie = request.cookies.get(SESSION_COOKIE, "")
        with factory() as repository:
            authentication(request, repository)
            AuthService(config, repository).logout(cookie)
        response.delete_cookie(SESSION_COOKIE, path="/", secure=not config.local_dev, httponly=True, samesite="strict")
        return {"loggedOut": True}

    @app.get("/settings")
    def settings_view(request: Request):
        with factory() as repository:
            current = authentication(request, repository)
            ima = load_ima_credentials(repository, config.geo_master_key, config.ima_client_id, config.ima_api_key)
            result = SettingsService(repository, config.geo_master_key).public(
                current.user_id, ima, _epoch_ms(current.expires_at)
            )
            context = tenant_context(repository, current.user_id)
            if context:
                result["subscription"] = {
                    "active": bool(context.get("active")),
                    "expiresAt": _epoch_ms(context["expiresAt"]) if context.get("expiresAt") else None,
                    "role": context.get("role"),
                }
                if hasattr(repository, "credit_balance"):
                    result["credits"] = {"balance": repository.credit_balance(str(context["tenantId"]))}
            return result

    @app.post("/settings/model")
    def settings_model(body: ModelBody, request: Request):
        with factory() as repository:
            current = authentication(request, repository)
            tenant_context(repository, current.user_id, active=True)
            return SettingsService(repository, config.geo_master_key).save_model(
                current.user_id,
                body.provider,
                body.slot,
                body.modelId,
                body.apiKey,
                body.removeKey,
            )

    @app.post("/models/test")
    async def test_model(request: Request):
        with factory() as repository:
            current = authentication(request, repository)
            tenant_context(repository, current.user_id, active=True)
            private = SettingsService(repository, config.geo_master_key).private(current.user_id)
            model = private["model"]
            key = private["keys"].get(model["id"])
            await model_complete(model, key, [{"role": "user", "content": "Reply only: OK"}], test=True)
            return {"ok": True, "model": model["label"]}

    @app.post("/ima/update")
    async def ima_update(body: ImaBody, request: Request):
        with factory() as repository:
            current = authentication(request, repository)
            context = tenant_context(repository, current.user_id, active=True)
            if context:
                TenantAccessService.require_manager(context)
            return await update_ima_credentials(
                repository,
                config.geo_master_key,
                config.ima_admin_secret,
                body.model_dump(),
            )

    @app.get("/batches")
    def batches_list(request: Request):
        with factory() as repository:
            current = authentication(request, repository)
            return {"batches": batch_service(repository, tenant_context(repository, current.user_id)).list(current.user_id)}

    @app.post("/batches")
    def batches_create(body: BatchBody, request: Request):
        with factory() as repository:
            current = authentication(request, repository)
            context = tenant_context(repository, current.user_id, active=True)
            expires_at = context["expiresAt"] if context and context.get("expiresAt") else current.expires_at
            return batch_service(repository, context).create(body.model_dump(), current.user_id, expires_at)

    @app.get("/batches/{batch_id}")
    def batches_get(batch_id: str, request: Request):
        with factory() as repository:
            current = authentication(request, repository)
            return batch_service(repository, tenant_context(repository, current.user_id)).get(batch_id, current.user_id)

    @app.post("/batches/{batch_id}/step")
    async def batches_step(batch_id: str, body: BatchStepBody, request: Request):
        with factory() as repository:
            current = authentication(request, repository)
            context = tenant_context(repository, current.user_id, active=True)
            return await batch_service(repository, context).advance(batch_id, body.model_dump(), current.user_id)

    return app
