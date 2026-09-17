import hashlib
import sys
import unittest

import httpx
from pathlib import Path


FUNCTIONS_DIR = Path(__file__).resolve().parents[1] / "cloud-functions"
sys.path.insert(0, str(FUNCTIONS_DIR))


def sha(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


BODY = "# 文".encode("utf-8")


class FakeDeliveryRepository:
    """内存实现，与 repository.py 交付事务契约一致。

    真实 SQL 事务（FOR UPDATE、回滚、约束）由 tests_postgres/test_local_delivery.py
    在隔离 PostgreSQL 上验证；这里只固化 DeliveryService 依赖的业务语义。
    """

    def __init__(self):
        self.balance = 10
        self.task_states = {}
        self.artifacts = {}
        self.receipts = {}
        self.batch_modes = {}
        self.batch_owners = {}
        self.batch_seq = {}
        self.failures = set()

    # ---- 夹具 ----
    def add_batch(self, batch_id, user_id, delivery_mode, seq=3):
        self.batch_owners[batch_id] = user_id
        self.batch_modes[batch_id] = delivery_mode
        self.batch_seq[batch_id] = seq

    def add_task(self, batch_id, task_id):
        self.task_states[(batch_id, task_id)] = "reserved"

    def add_artifact(self, artifact_id, *, tenant_id, batch_id, task_id, user_id,
                     filename="001-品牌.md", markdown="# 文", body=None):
        payload = body if body is not None else markdown.encode("utf-8")
        row = {
            "id": artifact_id,
            "tenant_id": tenant_id,
            "batch_id": batch_id,
            "task_id": task_id,
            "user_id": user_id,
            "filename": filename,
            "body": payload,
            "byteLength": len(payload),
            "sha256": sha(payload),
            "deliveryState": "pending",
            "createdAt": "2026-09-16T00:00:00Z",
        }
        self.artifacts[artifact_id] = row
        return row

    # ---- 交付事务契约（真实实现在 repository.confirm_local_delivery）----
    def get_article_artifact_meta(self, tenant_id, artifact_id, *, user_id):
        row = self.artifacts.get(artifact_id)
        if not row or row["tenant_id"] != tenant_id or row["user_id"] != user_id:
            return None
        return {
            "artifactId": artifact_id,
            "batchId": row["batch_id"],
            "taskId": row["task_id"],
            "filename": row["filename"],
            "byteLength": row["byteLength"],
            "sha256": row["sha256"],
            "deliveryState": row["deliveryState"],
            "createdAt": row["createdAt"],
        }

    def confirm_local_delivery(self, *, tenant_id, artifact_id, user_id, request_id, sha256, byte_length):
        if "purge" in self.failures:
            raise RuntimeError("PURGE_FAILED")
        row = self.artifacts.get(artifact_id)
        if not row or row["tenant_id"] != tenant_id or row["user_id"] != user_id:
            raise self._not_found()
        if row["deliveryState"] == "delivered":
            existing = next(r for r in self.receipts.values() if r["artifact_id"] == artifact_id)
            return self._result(row, existing, already=True)
        if row["deliveryState"] == "discarded":
            raise self._conflict("已放弃的文章不能再次确认交付。", "ARTIFACT_DISCARDED")
        if row["sha256"] != sha256 or row["byteLength"] != byte_length:
            raise self._conflict("回执哈希或字节数与服务器记录不一致。", "ARTIFACT_MISMATCH")
        existing = self.receipts.get(request_id)
        if existing and existing["artifact_id"] != artifact_id:
            raise self._conflict("同一 requestId 已用于其他文章。", "REQUEST_ID_CONFLICT")
        row["deliveryState"] = "delivered"
        row["body"] = None
        self.receipts[request_id] = {"artifact_id": artifact_id, "sha256": sha256, "byteLength": byte_length}
        return self._result(row, self.receipts[request_id], already=False)

    def _result(self, row, receipt, *, already):
        key = (row["batch_id"], row["task_id"])
        status = self.task_states.get(key)
        if status == "reserved" and self._row_delivered(row["batch_id"], row["task_id"]):
            settle = self.settle_task_credit(row["tenant_id"], row["batch_id"], row["task_id"], True)
            billing = "settled" if settle["status"] == "complete" else settle["status"]
        elif status in ("refunded", "released"):
            billing = "already_refunded"
        elif status == "complete":
            billing = "settled"
        else:
            billing = "reserved_pending"
        return {
            "artifactId": row["id"],
            "deliveryState": "delivered",
            "onlineBodyCleared": row["body"] is None,
            "billingStatus": billing,
            "batchSeq": self.batch_seq[row["batch_id"]],
            "alreadyConfirmed": already,
        }

    def _row_delivered(self, batch_id, task_id):
        rows = [a for a in self.artifacts.values()
                if a["batch_id"] == batch_id and a["task_id"] == task_id]
        return bool(rows) and all(a["deliveryState"] == "delivered" for a in rows)

    def settle_task_credit(self, tenant_id, batch_id, task_id, complete, *, release=False):
        key = (batch_id, task_id)
        status = self.task_states.get(key)
        if status != "reserved":
            return {"status": status or "missing", "refunded": False}
        if self.batch_modes[batch_id] == "local_confirmed_v1":
            artifact_complete = self._row_delivered(batch_id, task_id)
        else:
            payload = "# 文".encode("utf-8")
            rows = [a for a in self.artifacts.values()
                    if a["batch_id"] == batch_id and a["task_id"] == task_id]
            artifact_complete = (bool(rows) and all(
                a["deliveryState"] == "pending" and a["body"] == payload and a["byteLength"] == len(payload)
                for a in rows))
        if complete and not artifact_complete:
            from geo_backend.errors import ApiError
            raise ApiError(409, "完整文章尚未保存，不能确认扣分。", "ARTIFACT_NOT_PERSISTED")
        final = "complete" if artifact_complete else ("released" if release else "refunded")
        self.task_states[key] = final
        if final != "complete":
            self.balance += 1
        return {"status": final, "refunded": final == "refunded"}

    def list_pending_artifacts(self, tenant_id, user_id, *, limit, cursor):
        rows = [a for a in self.artifacts.values()
                if a["tenant_id"] == tenant_id and a["user_id"] == user_id
                and a["deliveryState"] == "pending"]
        rows.sort(key=lambda r: (r["createdAt"], r["id"]))
        if cursor:
            created, _, filename = str(cursor).partition("|")
            rows = [r for r in rows if (r["createdAt"], r["id"]) > (created, filename)]
        page = rows[:limit]
        items = [{
            "artifactId": aid,
            "batchId": r["batch_id"],
            "taskId": r["task_id"],
            "filename": r["filename"],
            "byteLength": r["byteLength"],
            "sha256": r["sha256"],
            "deliveryState": r["deliveryState"],
            "createdAt": r["createdAt"],
        } for aid, r in ((k, v) for k, v in self.artifacts.items() if v in page)]
        next_cursor = f"{page[-1]['createdAt']}|{page[-1]['id']}" if len(rows) > limit else None
        return {"items": items, "nextCursor": next_cursor}

    @staticmethod
    def _not_found():
        from geo_backend.errors import ApiError
        return ApiError(404, "文章文件不存在或不属于当前账号。", "ARTIFACT_NOT_FOUND")

    @staticmethod
    def _conflict(message, code):
        from geo_backend.errors import ApiError
        return ApiError(409, message, code)


TENANT = "tenant-1"
USER = "11111111-1111-1111-1111-111111111111"
OTHER = "22222222-2222-2222-2222-222222222222"
BATCH = "b" * 32
ARTIFACT = "33333333-3333-3333-3333-333333333333"
REQUEST = "44444444-4444-4444-4444-444444444444"


def build_service(mode="local_confirmed_v1", *, with_task=True):
    from geo_backend.delivery import DeliveryService

    repository = FakeDeliveryRepository()
    repository.add_batch(BATCH, USER, mode)
    if with_task:
        repository.add_task(BATCH, "1")
    repository.add_artifact(ARTIFACT, tenant_id=TENANT, batch_id=BATCH, task_id="1", user_id=USER)
    return DeliveryService(repository), repository


class ReceiptBodyValidationTests(unittest.TestCase):
    def test_rejects_extra_missing_and_mistyped_fields(self):
        service, repository = build_service()
        good = {"requestId": REQUEST, "sha256": sha(BODY), "byteLength": len("# 文".encode())}
        for payload in (
            {**good, "extra": 1},
            {"requestId": REQUEST, "sha256": good["sha256"]},
            {"requestId": REQUEST, "byteLength": good["byteLength"]},
            {},
        ):
            with self.assertRaises(Exception) as rejected:
                service.confirm(tenant_id=TENANT, user_id=USER, artifact_id=ARTIFACT, payload=payload)
            self.assertEqual("INVALID_RECEIPT_BODY", rejected.exception.code)
        self.assertEqual({}, repository.receipts)

    def test_rejects_bad_request_id_sha256_and_byte_length(self):
        service, _ = build_service()
        digest = sha(BODY)
        size = len(BODY)
        cases = [
            {"requestId": "not-a-uuid", "sha256": digest, "byteLength": size},
            {"requestId": "A4444444-4444-4444-4444-444444444444", "sha256": digest, "byteLength": size},
            {"requestId": REQUEST, "sha256": digest.upper(), "byteLength": size},
            {"requestId": REQUEST, "sha256": digest[:-1], "byteLength": size},
            {"requestId": REQUEST, "sha256": digest, "byteLength": 0},
            {"requestId": REQUEST, "sha256": digest, "byteLength": -1},
            {"requestId": REQUEST, "sha256": digest, "byteLength": True},
            {"requestId": REQUEST, "sha256": digest, "byteLength": str(size)},
            {"requestId": REQUEST, "sha256": digest, "byteLength": float(size)},
        ]
        for payload in cases:
            with self.assertRaises(Exception) as rejected:
                service.confirm(tenant_id=TENANT, user_id=USER, artifact_id=ARTIFACT, payload=payload)
            self.assertIn(rejected.exception.code, {"INVALID_REQUEST_ID", "INVALID_SHA256", "INVALID_BYTE_LENGTH"},
                          payload)
        self.assertEqual({}, repository_receipts_probe(service))


def repository_receipts_probe(service):
    return service.repository.receipts


class DeliveryContractTests(unittest.TestCase):
    def test_cross_account_artifact_is_not_found(self):
        service, repository = build_service()
        payload = {"requestId": REQUEST, "sha256": sha(BODY), "byteLength": len(BODY)}

        with self.assertRaises(Exception) as rejected:
            service.confirm(tenant_id=TENANT, user_id=OTHER, artifact_id=ARTIFACT, payload=payload)

        self.assertEqual("ARTIFACT_NOT_FOUND", rejected.exception.code)
        self.assertEqual({}, repository.receipts)

    def test_malformed_artifact_id_is_not_found(self):
        service, _ = build_service()
        payload = {"requestId": REQUEST, "sha256": sha(BODY), "byteLength": len(BODY)}

        with self.assertRaises(Exception) as rejected:
            service.confirm(tenant_id=TENANT, user_id=USER, artifact_id="../escape", payload=payload)

        self.assertEqual("ARTIFACT_NOT_FOUND", rejected.exception.code)

    def test_same_receipt_twice_records_once_and_keeps_semantics(self):
        service, repository = build_service()
        payload = {"requestId": REQUEST, "sha256": sha(BODY), "byteLength": len(BODY)}

        first = service.confirm(tenant_id=TENANT, user_id=USER, artifact_id=ARTIFACT, payload=payload)
        second = service.confirm(tenant_id=TENANT, user_id=USER, artifact_id=ARTIFACT, payload=payload)

        self.assertEqual(1, len(repository.receipts))
        self.assertTrue(first["onlineBodyCleared"])
        self.assertEqual("settled", first["billingStatus"])
        self.assertFalse(first["alreadyConfirmed"])
        self.assertTrue(second["alreadyConfirmed"])
        self.assertEqual("settled", second["billingStatus"])
        self.assertEqual(first["batchSeq"], second["batchSeq"])
        self.assertIsNone(repository.artifacts[ARTIFACT]["body"])

    def test_new_request_id_after_delivered_returns_existing_result(self):
        service, repository = build_service()
        payload = {"requestId": REQUEST, "sha256": sha(BODY), "byteLength": len(BODY)}
        service.confirm(tenant_id=TENANT, user_id=USER, artifact_id=ARTIFACT, payload=payload)
        balance_before = repository.balance

        again = service.confirm(tenant_id=TENANT, user_id=USER, artifact_id=ARTIFACT, payload={
            "requestId": "55555555-5555-5555-5555-555555555555", "sha256": sha(BODY), "byteLength": len(BODY),
        })

        self.assertTrue(again["alreadyConfirmed"])
        self.assertEqual(1, len(repository.receipts))
        self.assertEqual(balance_before, repository.balance)

    def test_same_request_id_for_other_artifact_conflicts(self):
        service, repository = build_service()
        payload = {"requestId": REQUEST, "sha256": sha(BODY), "byteLength": len(BODY)}
        repository.add_artifact("66666666-6666-6666-6666-666666666666",
                                tenant_id=TENANT, batch_id=BATCH, task_id="1", user_id=USER)
        service.confirm(tenant_id=TENANT, user_id=USER, artifact_id=ARTIFACT, payload=payload)
        repository.task_states[(BATCH, "1")] = "reserved"

        with self.assertRaises(Exception) as rejected:
            service.confirm(tenant_id=TENANT, user_id=USER,
                            artifact_id="66666666-6666-6666-6666-666666666666", payload=payload)

        self.assertEqual("REQUEST_ID_CONFLICT", rejected.exception.code)

    def test_hash_or_byte_mismatch_conflicts_and_keeps_pending(self):
        service, repository = build_service()
        cases = [
            {"requestId": REQUEST, "sha256": sha(b"tampered"), "byteLength": len(BODY)},
            {"requestId": REQUEST, "sha256": sha(BODY), "byteLength": len(b"tampered")},
        ]
        for payload in cases:
            with self.assertRaises(Exception) as rejected:
                service.confirm(tenant_id=TENANT, user_id=USER, artifact_id=ARTIFACT, payload=payload)
            self.assertEqual("ARTIFACT_MISMATCH", rejected.exception.code)
        self.assertEqual("pending", repository.artifacts[ARTIFACT]["deliveryState"])
        self.assertIsNotNone(repository.artifacts[ARTIFACT]["body"])
        self.assertEqual({}, repository.receipts)

    def test_discarded_artifact_rejects_receipt(self):
        service, repository = build_service()
        repository.artifacts[ARTIFACT]["deliveryState"] = "discarded"
        payload = {"requestId": REQUEST, "sha256": sha(BODY), "byteLength": len(BODY)}

        with self.assertRaises(Exception) as rejected:
            service.confirm(tenant_id=TENANT, user_id=USER, artifact_id=ARTIFACT, payload=payload)

        self.assertEqual("ARTIFACT_DISCARDED", rejected.exception.code)
        self.assertEqual({}, repository.receipts)

    def test_late_receipt_after_refund_clears_body_without_recharging(self):
        service, repository = build_service()
        repository.task_states[(BATCH, "1")] = "refunded"
        balance_before = repository.balance
        payload = {"requestId": REQUEST, "sha256": sha(BODY), "byteLength": len(BODY)}

        result = service.confirm(tenant_id=TENANT, user_id=USER, artifact_id=ARTIFACT, payload=payload)

        self.assertEqual("already_refunded", result["billingStatus"])
        self.assertTrue(result["onlineBodyCleared"])
        self.assertIsNone(repository.artifacts[ARTIFACT]["body"])
        self.assertEqual(1, len(repository.receipts))
        self.assertEqual("refunded", repository.task_states[(BATCH, "1")])
        self.assertEqual(balance_before, repository.balance)

    def test_purge_failure_leaves_no_partial_state(self):
        service, repository = build_service()
        repository.failures.add("purge")
        balance_before = repository.balance
        payload = {"requestId": REQUEST, "sha256": sha(BODY), "byteLength": len(BODY)}

        with self.assertRaises(RuntimeError):
            service.confirm(tenant_id=TENANT, user_id=USER, artifact_id=ARTIFACT, payload=payload)

        self.assertEqual("pending", repository.artifacts[ARTIFACT]["deliveryState"])
        self.assertIsNotNone(repository.artifacts[ARTIFACT]["body"])
        self.assertEqual({}, repository.receipts)
        self.assertEqual("reserved", repository.task_states[(BATCH, "1")])
        self.assertEqual(balance_before, repository.balance)


class PendingListingTests(unittest.TestCase):
    def test_listing_is_scoped_paginated_and_ordered(self):
        service, repository = build_service()
        for index in range(25):
            repository.add_artifact(f"77777777-0000-0000-0000-{index:012d}",
                                    tenant_id=TENANT, batch_id=BATCH, task_id=f"row-{index}", user_id=USER,
                                    markdown=f"# 文{index}")
        repository.artifacts[ARTIFACT]["deliveryState"] = "delivered"

        first = service.pending(tenant_id=TENANT, user_id=USER, limit=20)
        second = service.pending(tenant_id=TENANT, user_id=USER, limit=20, cursor=first["nextCursor"])

        self.assertEqual(20, len(first["items"]))
        self.assertIsNotNone(first["nextCursor"])
        self.assertEqual(5, len(second["items"]))
        self.assertIsNone(second["nextCursor"])
        self.assertNotIn(ARTIFACT, [item["artifactId"] for item in first["items"] + second["items"]])
        self.assertNotIn(first["items"][0]["artifactId"], [item["artifactId"] for item in second["items"]])

    def test_listing_rejects_invalid_limits(self):
        service, _ = build_service()
        for limit in (0, -1, 101, "20", True, 1.5):
            with self.assertRaises(Exception) as rejected:
                service.pending(tenant_id=TENANT, user_id=USER, limit=limit)
            self.assertEqual("INVALID_PAGINATION", rejected.exception.code, limit)

    def test_manifest_hides_body_and_scopes_to_owner(self):
        service, repository = build_service()
        manifest = service.manifest(tenant_id=TENANT, user_id=USER, artifact_id=ARTIFACT)

        self.assertEqual(sha(BODY), manifest["sha256"])
        self.assertNotIn("body", manifest)
        self.assertNotIn("markdown", manifest)
        with self.assertRaises(Exception) as rejected:
            service.manifest(tenant_id=TENANT, user_id=OTHER, artifact_id=ARTIFACT)
        self.assertEqual("ARTIFACT_NOT_FOUND", rejected.exception.code)
        self.assertIsNotNone(repository.artifacts[ARTIFACT]["body"])


class SettleBranchTests(unittest.TestCase):
    """settle_task_credit 成功定义按 deliveryMode 分支：新模式要交付记录，旧模式保持服务器完整文件判据。"""

    def test_new_mode_cannot_settle_before_local_delivery(self):
        from geo_backend.errors import ApiError
        service, repository = build_service(mode="local_confirmed_v1")
        # 服务器已有完整 artifact（pending），但没有交付回执。
        self.assertIsNotNone(repository.artifacts[ARTIFACT]["body"])

        with self.assertRaises(ApiError) as rejected:
            repository.settle_task_credit(TENANT, BATCH, "1", True)

        self.assertEqual("ARTIFACT_NOT_PERSISTED", rejected.exception.code)
        self.assertEqual("reserved", repository.task_states[(BATCH, "1")])
        self.assertEqual(10, repository.balance)

    def test_new_mode_settles_only_after_delivery(self):
        service, repository = build_service(mode="local_confirmed_v1")
        payload = {"requestId": REQUEST, "sha256": sha(BODY), "byteLength": len(BODY)}

        service.confirm(tenant_id=TENANT, user_id=USER, artifact_id=ARTIFACT, payload=payload)

        self.assertEqual("complete", repository.task_states[(BATCH, "1")])
        self.assertEqual(10, repository.balance)  # 预扣 1 变为实扣，余额不变

    def test_legacy_mode_still_settles_on_server_artifact(self):
        service, repository = build_service(mode="server_legacy")

        result = repository.settle_task_credit(TENANT, BATCH, "1", True)

        self.assertEqual("complete", result["status"])
        self.assertEqual("complete", repository.task_states[(BATCH, "1")])

    def test_legacy_mode_rejects_settle_without_server_artifact(self):
        from geo_backend.errors import ApiError
        service, repository = build_service(mode="server_legacy", with_task=True)
        repository.artifacts.clear()

        with self.assertRaises(ApiError) as rejected:
            repository.settle_task_credit(TENANT, BATCH, "1", True)

        self.assertEqual("ARTIFACT_NOT_PERSISTED", rejected.exception.code)


class DeliveryAppContractTests(unittest.IsolatedAsyncioTestCase):
    """app.py 路由契约：认证门槛、请求体严格性、静态路由优先于动态段。"""

    async def asyncSetUp(self):
        from geo_backend.app import create_app
        from tests_py.fakes import FakeRepository, repository_factory

        self.repository = FakeRepository()
        app = create_app(self._settings(), repository_factory(self.repository))
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="https://geo.example.test")

    @staticmethod
    def _settings():
        import hashlib
        from geo_backend.config import Settings
        salt = "0123456789abcdef0123456789abcdef"
        value = hashlib.scrypt(b"secret", salt=salt.encode(), n=16384, r=8, p=1, dklen=64).hex()
        return Settings.from_mapping({
            "APP_ORIGIN": "https://geo.example.test",
            "GEO_ACCOUNT": "owner",
            "GEO_PASSWORD_HASH": f"scrypt:{salt}:{value}",
            "GEO_MASTER_KEY": "c" * 64,
            "DATABASE_URL": "postgresql://u:p@db.example.test/geo?sslmode=require",
        })

    async def asyncTearDown(self):
        await self.client.aclose()

    async def _login(self):
        response = await self.client.post(
            "/auth/login", headers={"Origin": "https://geo.example.test"},
            json={"account": "owner", "password": "secret"})
        self.assertEqual(200, response.status_code)
        return response.json()["csrf"]

    async def test_delivery_routes_require_authentication(self):
        pending = await self.client.get("/artifacts/pending")
        self.assertEqual(401, pending.status_code)
        receipt = await self.client.post(
            f"/artifacts/{ARTIFACT}/local-receipt",
            headers={"Origin": "https://geo.example.test"}, json={"requestId": REQUEST, "sha256": sha(BODY), "byteLength": len(BODY)})
        self.assertEqual(401, receipt.status_code)

    async def test_receipt_rejects_wrong_origin_and_extra_fields(self):
        csrf = await self._login()
        wrong_origin = await self.client.post(
            f"/artifacts/{ARTIFACT}/local-receipt", headers={"Origin": "https://evil.example"},
            json={"requestId": REQUEST, "sha256": sha(BODY), "byteLength": len(BODY)})
        self.assertEqual(403, wrong_origin.status_code)

        extra = await self.client.post(
            f"/artifacts/{ARTIFACT}/local-receipt",
            headers={"Origin": "https://geo.example.test", "x-csrf-token": csrf},
            json={"requestId": REQUEST, "sha256": sha(BODY), "byteLength": len(BODY), "extra": 1})
        self.assertEqual(400, extra.status_code)

    async def test_pending_route_wins_over_dynamic_segment_and_manifest_scopes(self):
        csrf = await self._login()
        pending = await self.client.get("/artifacts/pending")
        self.assertEqual(200, pending.status_code)
        self.assertEqual({"items": [], "nextCursor": None}, pending.json())

        manifest = await self.client.get(
            f"/artifacts/{ARTIFACT}/manifest", headers={"x-csrf-token": csrf})
        self.assertEqual(404, manifest.status_code)
        self.assertEqual("ARTIFACT_NOT_FOUND", manifest.json()["code"])


if __name__ == "__main__":
    unittest.main()
