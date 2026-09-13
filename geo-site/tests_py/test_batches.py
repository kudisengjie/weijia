import copy
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx


FUNCTIONS_DIR = Path(__file__).resolve().parents[1] / "cloud-functions"
sys.path.insert(0, str(FUNCTIONS_DIR))

from tests_py.fakes import FakeRepository


def batch_body(request_id="request-id-123456"):
    return {
        "requestId": request_id,
        "rows": [["品牌名", "GEO知识库", "问句"], ["零雪", "品牌库", "零雪是什么？"]],
        "companies": [{"name": "company.md", "brand": "零雪", "text": "零雪是一家内容服务品牌。"}],
    }


class BatchTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        from geo_backend.batches import BatchService
        from geo_backend.models import SettingsService

        self.repository = FakeRepository()
        SettingsService(self.repository, "master").save_model("user-1", "qwen", "primary", "", "model-key", False)
        self.repository.ima = {"clientId": "ima-client", "apiKey": "ima-key", "expiresAt": "2099-01-01", "updatedAt": None}
        self.ima_calls = 0

        def ima_handler(request):
            self.ima_calls += 1
            return httpx.Response(
                200,
                request=request,
                json={
                    "code": 0,
                    "data": {
                        "info_list": [
                            {"name": "copilot", "id": "kb-copilot"},
                            {"name": "品牌库", "id": "kb-brand"},
                        ],
                        "is_end": True,
                    },
                },
            )

        self.client = httpx.AsyncClient(transport=httpx.MockTransport(ima_handler))
        self.model_calls = 0

        async def model_complete(*_args, **_kwargs):
            self.model_calls += 1
            return "OK"

        self.service = BatchService(
            self.repository,
            "master",
            {"clientId": "env", "apiKey": "env-key"},
            client=self.client,
            model_complete=model_complete,
        )

    async def asyncTearDown(self):
        await self.client.aclose()

    async def test_create_is_idempotent_and_owned_by_stable_user(self):
        expires = datetime.now(timezone.utc) + timedelta(days=7)

        first = self.service.create(batch_body(), "user-1", expires)
        second = self.service.create(batch_body(), "user-1", expires)

        self.assertEqual(first["id"], second["id"])
        self.assertEqual(1, len(self.repository.batches))
        self.assertEqual("user-1", next(iter(self.repository.batches.values()))["user_id"])

    async def test_repeated_sequence_never_repeats_the_external_step(self):
        expires = datetime.now(timezone.utc) + timedelta(days=7)
        created = self.service.create(batch_body(), "user-1", expires)

        first = await self.service.advance(created["id"], {"seq": 0}, "user-1")
        repeated = await self.service.advance(created["id"], {"seq": 0}, "user-1")

        self.assertEqual(1, first["seq"])
        self.assertEqual(first, repeated)
        self.assertEqual(1, self.ima_calls)
        self.assertEqual(0, self.model_calls)

    async def test_failed_step_is_saved_and_recovery_advances_without_external_call(self):
        from geo_backend.errors import ApiError

        expires = datetime.now(timezone.utc) + timedelta(days=7)
        created = self.service.create(batch_body(), "user-1", expires)
        state = self.repository.batches[created["id"]]["state"]
        state["phase"] = "generate"
        state["bases"] = []
        state["sources"] = []

        async def failing_model(*_args, **_kwargs):
            self.model_calls += 1
            raise ApiError(502, "模型失败", "MODEL_ERROR")

        self.service.model_complete = failing_model
        failed = await self.service.advance(created["id"], {"seq": 0}, "user-1")
        calls_before_recovery = self.model_calls
        recovered = await self.service.advance(created["id"], {"seq": failed["seq"], "retry": True}, "user-1")

        self.assertEqual("failed", failed["status"])
        self.assertEqual("ready", recovered["status"])
        self.assertEqual(failed["seq"] + 1, recovered["seq"])
        self.assertEqual(calls_before_recovery, self.model_calls)

    async def test_batch_details_and_history_never_cross_user_boundary(self):
        from geo_backend.errors import ApiError

        expires = datetime.now(timezone.utc) + timedelta(days=7)
        created = self.service.create(batch_body(), "user-1", expires)

        self.assertEqual(1, len(self.service.list("user-1")))
        with self.assertRaises(ApiError) as rejected:
            self.service.get(created["id"], "user-2")
        self.assertEqual(404, rejected.exception.status)


if __name__ == "__main__":
    unittest.main()
