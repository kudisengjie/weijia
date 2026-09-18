from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from contextlib import AbstractContextManager
from typing import Callable
from urllib.parse import quote
from uuid import UUID

from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, PlainTextResponse
from pydantic import BaseModel, ConfigDict
from starlette.datastructures import Headers, MutableHeaders

from .auth import AuthService
from .security import SESSION_TTL
from .artifacts import ArtifactService
from .batches import BatchService
from .config import Settings
from .delivery import DeliveryService
from .errors import ApiError
from .ima import load_ima_credentials, update_ima_credentials
from .models import SettingsService
from .providers import complete
from .repository import postgres_repository
from .tenant_access import TenantAccessService
from .workspaces import WorkspaceService


LOGGER = logging.getLogger("lxue_geo")
SESSION_COOKIE = "lxue_session"
DEFAULT_JSON_LIMIT = 32 * 1024
BATCH_JSON_LIMIT = 4 * 1024 * 1024
LOGIN_JSON_LIMIT = 4 * 1024
RepositoryFactory = Callable[[], AbstractContextManager]


class SecurityHeadersMiddleware:
    """纯 ASGI 中间件：安全响应头 + 来源/格式/体积校验。

    刻意不用 BaseHTTPMiddleware：它在 Mount 之下会破坏 HTTP keep-alive
    连接复用（同一连接第二个请求起路由失配返回 404）。路径判断先剥离
    root_path，兼容挂载在 /api 前缀之下的部署形态。
    """

    def __init__(self, app, config: Settings):
        self.app = app
        self.config = config

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        downstream_receive = receive
        if scope.get("method", "GET") not in {"GET", "HEAD"}:
            downstream_receive = await self._check_request(scope, receive, send)
            if downstream_receive is None:
                return
        await self.app(scope, downstream_receive, self._security_headers(send))

    def _security_headers(self, send):
        async def wrapped(message):
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers["Cache-Control"] = "private, no-store"
                headers["X-Content-Type-Options"] = "nosniff"
                headers["Referrer-Policy"] = "no-referrer"
            await send(message)
        return wrapped

    async def _check_request(self, scope, receive, send):
        """校验非 GET 请求；通过时返回重放请求体的 receive，被拦截时返回 None。"""
        headers = Headers(scope=scope)
        if headers.get("origin") != self.config.app_origin:
            await self._reject(send, 403, "请求来源不匹配，请从本站重新登录。", "ORIGIN_REJECTED")
            return None
        if not headers.get("content-type", "").startswith("application/json"):
            await self._reject(send, 415, "请求格式不支持。", "UNSUPPORTED_MEDIA")
            return None
        path = scope.get("path", "")
        root = scope.get("root_path") or ""
        if root and path.startswith(root):
            path = path[len(root):] or "/"
        large_payload = path == '/batches' or (path.startswith('/workspaces/') and path.endswith('/save'))
        limit = BATCH_JSON_LIMIT if large_payload else LOGIN_JSON_LIMIT if path == "/auth/login" else DEFAULT_JSON_LIMIT
        body = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return None
            body.extend(message.get("body") or b"")
            if len(body) > limit:
                await self._reject(send, 413, "请求内容过大。", "REQUEST_TOO_LARGE")
                return None
            if not message.get("more_body", False):
                break
        replayed = {"type": "http.request", "body": bytes(body), "more_body": False}
        replayed_once = {"done": False}

        async def replay_receive():
            if not replayed_once["done"]:
                replayed_once["done"] = True
                return replayed
            return await receive()

        return replay_receive

    async def _reject(self, send, status: int, error: str, code: str) -> None:
        payload = json.dumps({"error": error, "code": code}, ensure_ascii=False).encode()
        await send({"type": "http.response.start", "status": status, "headers": [
            (b"content-type", b"application/json"),
            (b"content-length", str(len(payload)).encode()),
        ]})
        await send({"type": "http.response.body", "body": payload})


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


class WorkspaceCreateBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    requestId: str


class WorkspaceVersionBody(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    version: int


class WorkspaceSaveBody(WorkspaceVersionBody):
    draft: dict[str, object]


class BatchRunBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    seq: int
    retry: bool = False
    maxSteps: int = 1


class CreditAdjustmentBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    amount: int
    kind: str
    idempotencyKey: str
    note: str = ""
    userId: UUID | None = None


class MemberBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str
    password: str
    role: str = "member"
    startsAt: str
    expiresAt: str


class SubscriptionBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    userId: UUID | None = None
    startsAt: str
    expiresAt: str


class LocalReceiptBody(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    requestId: str
    sha256: str
    byteLength: int


def _epoch_ms(value) -> int:
    return int(value.timestamp() * 1000)


def create_app(
    settings: Settings | None = None,
    repository_factory: RepositoryFactory | None = None,
    *,
    model_complete=complete,
) -> FastAPI:
    config = settings or Settings.from_mapping(os.environ)
    factory = repository_factory or (lambda: postgres_repository(config.database_url, config.geo_master_key))
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

    app.add_middleware(SecurityHeadersMiddleware, config=config)

    def authentication(request: Request, repository: object):
        return AuthService(config, repository).authenticate(
            request.cookies.get(SESSION_COOKIE), request.headers.get("x-csrf-token"), request.method
        )

    def tenant_context(repository: object, user_id: str, *, active: bool = False):
        if not hasattr(repository, "get_tenant_context"):
            return None
        service = TenantAccessService(repository)
        if service.context(user_id) is None and hasattr(repository, 'get_user_login'):
            owner = repository.get_user_login(config.geo_account)
            if owner and str(owner['id']) == user_id:
                repository.ensure_owner_tenant(user_id)
        if service.context(user_id) is None:
            raise ApiError(403, '账号尚未分配工作区，请联系管理员。', 'TENANT_ACCESS_REQUIRED')
        return service.require(user_id) if active else service.context(user_id)

    @staticmethod
    def parse_datetime(value: str) -> datetime:
        try:
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError as error:
            raise ApiError(400, "日期格式不正确，请使用 ISO 8601。", "INVALID_DATE") from error
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)

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
    def login(body: LoginBody, request: Request, response: Response):
        with factory() as repository:
            result = AuthService(config, repository).login(body.account, body.password, previous_cookie=request.cookies.get(SESSION_COOKIE))
        response.set_cookie(
            SESSION_COOKIE,
            result.cookie_token,
            max_age=int(SESSION_TTL.total_seconds()),
            httponly=True,
            secure=not config.local_dev,
            samesite="strict",
            path="/",
        )
        return {
            "authenticated": True,
            "csrf": result.csrf_token,
            "expiresAt": _epoch_ms(result.expires_at),
            "accountScope": result.account_scope,
        }

    @app.get("/auth/session")
    def session(request: Request):
        with factory() as repository:
            current = authentication(request, repository)
        return {
            "authenticated": True,
            "csrf": current.csrf_token,
            "expiresAt": _epoch_ms(current.expires_at),
            "accountScope": current.account_scope,
        }

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
                    result["credits"] = {"balance": repository.credit_balance(str(context["tenantId"]), current.user_id)}
                result['modelLocked'] = repository.has_active_batch(current.user_id)
            return result

    @app.post("/settings/model")
    def settings_model(body: ModelBody, request: Request):
        with factory() as repository:
            current = authentication(request, repository)
            tenant_context(repository, current.user_id, active=True)
            if hasattr(repository, "has_active_batch") and repository.has_active_batch(current.user_id):
                raise ApiError(409, "批次正在运行，完成或停止后才能切换模型。", "MODEL_LOCKED_DURING_BATCH")
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
                TenantAccessService.require_owner(context)
            result = await update_ima_credentials(
                repository,
                config.geo_master_key,
                config.ima_admin_secret,
                body.model_dump(),
            )
            if context:
                repository.record_admin_audit(str(context['tenantId']), current.user_id, 'ima.credentials.update',
                    details={'expiresAt': result['expiresAt']})
            return result

    @app.get("/ima/cache")
    def ima_cache_status(request: Request):
        with factory() as repository:
            current = authentication(request, repository)
            context = tenant_context(repository, current.user_id, active=True)
            if context:
                TenantAccessService.require_owner(context)
            generation = repository.get_ima_cache_generation() if hasattr(repository, "get_ima_cache_generation") else None
            return {"generation": generation}

    @app.post("/ima/cache/clear")
    def ima_cache_clear(request: Request):
        with factory() as repository:
            current = authentication(request, repository)
            context = tenant_context(repository, current.user_id, active=True)
            if context:
                TenantAccessService.require_owner(context)
            with repository.transaction():
                generation = repository.clear_ima_cache_generation(current.user_id)
                if context:
                    repository.record_admin_audit(str(context['tenantId']), current.user_id, 'ima.cache.clear', details={'generation': generation})
            return {"cleared": True, "generation": generation}

    @app.get("/credits")
    def credits_view(request: Request):
        with factory() as repository:
            current = authentication(request, repository)
            context = tenant_context(repository, current.user_id)
            if not context:
                return {"balance": None, "subscription": None}
            return {
                "balance": repository.credit_balance(str(context["tenantId"]), current.user_id) if hasattr(repository, "credit_balance") else None,
                "ledger": repository.list_credit_ledger(str(context['tenantId']), current.user_id),
                "subscription": {
                    "active": bool(context.get("active")),
                    "expiresAt": _epoch_ms(context["expiresAt"]) if context.get("expiresAt") else None,
                    "role": context.get("role"),
                },
            }

    @app.post("/credits/adjust")
    def credits_adjust(body: CreditAdjustmentBody, request: Request):
        with factory() as repository:
            current = authentication(request, repository)
            context = tenant_context(repository, current.user_id, active=True)
            if context:
                TenantAccessService.require_owner(context)
            if not context or not hasattr(repository, "adjust_credits"):
                raise ApiError(503, "积分服务尚未初始化。", "CREDITS_SETUP_REQUIRED")
            try:
                return repository.adjust_credits(
                    str(context["tenantId"]),
                    str(body.userId) if body.userId else current.user_id,
                    body.amount,
                    body.idempotencyKey,
                    body.kind,
                    {"note": body.note[:1000], "actorId": current.user_id},
                )
            except ValueError as error:
                if str(error) == "INSUFFICIENT_CREDITS":
                    raise ApiError(402, "积分余额不足，无法收回。", "INSUFFICIENT_CREDITS") from error
                raise ApiError(400, "积分调整参数不正确。", "INVALID_CREDIT_ADJUSTMENT") from error

    @app.post("/tenant/members")
    def tenant_member_create(body: MemberBody, request: Request):
        with factory() as repository:
            current = authentication(request, repository)
            context = tenant_context(repository, current.user_id, active=True)
            if not context:
                raise ApiError(403, "当前账号没有工作区。", "TENANT_ACCESS_REQUIRED")
            TenantAccessService.require_owner(context)
            with repository.transaction():
                member = TenantAccessService(repository).create_member(
                    context, username=body.username, password=body.password, role=body.role,
                    starts_at=parse_datetime(body.startsAt), expires_at=parse_datetime(body.expiresAt))
                repository.record_admin_audit(str(context['tenantId']), current.user_id, 'member.create', member['id'],
                    {'role': body.role, 'expiresAt': body.expiresAt})
                return member

    @app.get('/tenant/members')
    def tenant_members_list(request: Request):
        with factory() as repository:
            current = authentication(request, repository)
            context = tenant_context(repository, current.user_id)
            TenantAccessService.require_owner(context or {})
            return {'members': repository.list_members(str(context['tenantId']))}

    @app.get('/tenant/members/{user_id}/credits')
    def tenant_member_credits(user_id: UUID, request: Request):
        with factory() as repository:
            current = authentication(request, repository)
            context = tenant_context(repository, current.user_id)
            TenantAccessService.require_owner(context or {})
            tenant_id, target_id = str(context['tenantId']), str(user_id)
            repository.require_member(tenant_id, target_id)
            return {'balance': repository.credit_balance(tenant_id, target_id), 'ledger': repository.list_credit_ledger(tenant_id, target_id)}

    @app.post("/tenant/subscription")
    def tenant_subscription_update(body: SubscriptionBody, request: Request):
        with factory() as repository:
            current = authentication(request, repository)
            context = tenant_context(repository, current.user_id)
            if not context:
                raise ApiError(403, "当前账号没有工作区。", "TENANT_ACCESS_REQUIRED")
            TenantAccessService.require_owner(context)
            if not hasattr(repository, "set_subscription"):
                raise ApiError(503, "订阅服务尚未初始化。", "SUBSCRIPTION_SETUP_REQUIRED")
            starts_at = parse_datetime(body.startsAt)
            expires_at = parse_datetime(body.expiresAt)
            if expires_at <= starts_at:
                raise ApiError(400, "有效期必须晚于开始时间。", "INVALID_MEMBER_EXPIRY")
            return repository.set_subscription(str(context["tenantId"]), str(body.userId) if body.userId else current.user_id, starts_at, expires_at, actor_id=current.user_id)

    def workspace_service(repository, user_id, *, active=False):
        context = tenant_context(repository, user_id, active=active)
        if not context:
            raise ApiError(403, '当前账号没有工作区。', 'TENANT_ACCESS_REQUIRED')
        return WorkspaceService(repository, config.geo_master_key, context, batch_service(repository, context))

    @app.get('/workspaces')
    def workspaces_list(request: Request):
        with factory() as repository:
            current = authentication(request, repository)
            return workspace_service(repository, current.user_id).list(current.user_id)

    @app.post('/workspaces')
    def workspaces_create(body: WorkspaceCreateBody, request: Request):
        with factory() as repository:
            current = authentication(request, repository)
            return workspace_service(repository, current.user_id, active=True).create(body.requestId, current.user_id)

    @app.get('/workspaces/{workspace_id}')
    def workspaces_get(workspace_id: str, request: Request):
        with factory() as repository:
            current = authentication(request, repository)
            return workspace_service(repository, current.user_id).get(workspace_id, current.user_id)

    @app.post('/workspaces/{workspace_id}/save')
    def workspaces_save(workspace_id: str, body: WorkspaceSaveBody, request: Request):
        with factory() as repository:
            current = authentication(request, repository)
            return workspace_service(repository, current.user_id, active=True).save(workspace_id, current.user_id, body.version, body.draft)

    @app.post('/workspaces/{workspace_id}/start')
    def workspaces_start(workspace_id: str, body: WorkspaceVersionBody, request: Request):
        with factory() as repository:
            current = authentication(request, repository)
            service = workspace_service(repository, current.user_id, active=True)
            return service.start(workspace_id, current.user_id, body.version, service.context['expiresAt'])

    @app.post('/workspaces/{workspace_id}/archive')
    def workspaces_archive(workspace_id: str, body: WorkspaceVersionBody, request: Request):
        with factory() as repository:
            current = authentication(request, repository)
            return workspace_service(repository, current.user_id).archive(workspace_id, current.user_id, body.version)

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
            context = tenant_context(repository, current.user_id)
            return await batch_service(repository, context).advance(batch_id, body.model_dump(), current.user_id)

    @app.post("/batches/{batch_id}/run")
    async def batches_run(batch_id: str, body: BatchRunBody, request: Request):
        if body.maxSteps < 1 or body.maxSteps > 8:
            raise ApiError(400, "单次运行步数必须为 1–8。", "INVALID_RUN_BUDGET")
        with factory() as repository:
            current = authentication(request, repository)
            context = tenant_context(repository, current.user_id)
            service = batch_service(repository, context)
            state = {"seq": body.seq, "retry": body.retry}
            result = None
            # One potentially billable upstream phase per HTTP request.
            for index in range(min(body.maxSteps, 1)):
                result = await service.advance(batch_id, state, current.user_id)
                if result.get("status") in {"completed", "failed"}:
                    break
                state = {"seq": int(result["seq"]), "retry": False}
            return {"batch": result, "nextPollMs": 1200 if result and result.get("status") == "ready" else None}

    @app.post('/batches/{batch_id}/cancel')
    def batches_cancel(batch_id: str, request: Request):
        with factory() as repository:
            current = authentication(request, repository)
            return batch_service(repository, tenant_context(repository, current.user_id)).cancel(
                batch_id, current.user_id, discard_pending=True)

    @app.post('/batches/{batch_id}/pause')
    def batches_pause(batch_id: str, request: Request):
        with factory() as repository:
            current = authentication(request, repository)
            return batch_service(repository, tenant_context(repository, current.user_id)).pause(batch_id, current.user_id)

    @app.post('/batches/{batch_id}/resume')
    def batches_resume(batch_id: str, request: Request):
        with factory() as repository:
            current = authentication(request, repository)
            return batch_service(repository, tenant_context(repository, current.user_id)).resume(batch_id, current.user_id)

    def delivery_service(repository: object) -> DeliveryService:
        return DeliveryService(repository)

    @app.get("/artifacts/pending")
    def artifacts_pending(request: Request, limit: int = 20, cursor: str | None = None):
        with factory() as repository:
            current = authentication(request, repository)
            context = tenant_context(repository, current.user_id)
            if not context:
                return {"items": [], "nextCursor": None}
            return delivery_service(repository).pending(
                tenant_id=str(context["tenantId"]), user_id=current.user_id, limit=limit, cursor=cursor)

    @app.get("/artifacts/{artifact_id}/manifest")
    def artifact_manifest(artifact_id: str, request: Request):
        with factory() as repository:
            current = authentication(request, repository)
            context = tenant_context(repository, current.user_id)
            if not context:
                raise ApiError(404, "文章文件不存在或不属于当前账号。", "ARTIFACT_NOT_FOUND")
            return delivery_service(repository).manifest(
                tenant_id=str(context["tenantId"]), user_id=current.user_id, artifact_id=artifact_id)

    @app.post("/artifacts/{artifact_id}/local-receipt")
    def artifact_local_receipt(artifact_id: str, body: LocalReceiptBody, request: Request):
        with factory() as repository:
            current = authentication(request, repository)
            context = tenant_context(repository, current.user_id)
            if not context:
                raise ApiError(404, "文章文件不存在或不属于当前账号。", "ARTIFACT_NOT_FOUND")
            receipt = delivery_service(repository).confirm(
                tenant_id=str(context["tenantId"]), user_id=current.user_id,
                artifact_id=artifact_id, payload=body.model_dump())
            # 交付确认即唤醒批次：单行 → completed，多行 → ready 继续生成。
            # 已取消/已放弃的迟到回执不唤醒（resume_after_delivery 自行判断）。
            resumed = None
            if receipt.get("deliveryState") == "delivered":
                meta = repository.get_article_artifact_meta(
                    str(context["tenantId"]), artifact_id, user_id=current.user_id)
                if meta:
                    resumed = batch_service(repository, context).resume_after_delivery(
                        str(meta["batchId"]), current.user_id)
            return {"receipt": receipt, "batch": resumed}

    @app.get("/artifacts/{artifact_id}")
    def artifact_download(artifact_id: str, request: Request):
        with factory() as repository:
            current = authentication(request, repository)
            context = tenant_context(repository, current.user_id)
            if not context or not hasattr(repository, "get_article_artifact"):
                raise ApiError(404, "文章文件不存在或不属于当前工作区。", "ARTIFACT_NOT_FOUND")
            artifact = ArtifactService(repository, config.geo_master_key).get(str(context["tenantId"]), artifact_id, current.user_id)
            response = PlainTextResponse(str(artifact["markdown"]), media_type="text/markdown; charset=utf-8")
            response.headers['Content-Disposition'] = "attachment; filename=article.md; filename*=UTF-8''" + quote(str(artifact['filename']), safe='')
            response.headers["X-Artifact-SHA256"] = str(artifact["sha256"])
            return response

    return app
