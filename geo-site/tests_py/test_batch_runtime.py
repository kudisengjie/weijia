import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path


FUNCTIONS_DIR = Path(__file__).resolve().parents[1] / "cloud-functions"
TESTS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(FUNCTIONS_DIR))
sys.path.insert(0, str(TESTS_DIR))

from fakes import FakeRepository


def body():
    return {
        "requestId": "runtime-request-123456",
        "rows": [["品牌名", "GEO知识库", "问句"], ["零雪", "品牌库", "零雪是什么？"]],
        "companies": [{"name": "company.md", "brand": "零雪", "text": "零雪是一家内容服务品牌。"}],
    }


class RuntimeRepository(FakeRepository):
    def __init__(self):
        super().__init__()
        self.reserved = []
        self.snapshots = []
        self.jobs = []
        self.credit_balance = 10

    def reserve_task_credits(self, tenant_id, user_id, batch_id, task_ids):
        self.reserved.append((tenant_id, user_id, batch_id, list(task_ids)))
        return {"reserved": len(task_ids), "balance": self.credit_balance - len(task_ids)}

    def save_model_snapshot(self, **kwargs):
        super().save_model_snapshot(**kwargs)
        self.snapshots.append(kwargs)

    def create_job(self, tenant_id, batch_id, idempotency_key):
        self.jobs.append((tenant_id, batch_id, idempotency_key))


class BatchRuntimeTests(unittest.TestCase):
    def test_batch_creation_records_immutable_model_snapshot_and_job(self):
        from geo_backend.batches import BatchService

        repository = RuntimeRepository()
        repository.ima = {"clientId": "ima-client", "apiKey": "ima-key", "expiresAt": "2099-01-01"}
        from geo_backend.models import SettingsService

        SettingsService(repository, "master").save_model("user-1", "qwen", "primary", "", "model-key", False)
        service = BatchService(
            repository,
            "master",
            {"clientId": "env", "apiKey": "env-key"},
            tenant_context={"tenantId": "tenant-1", "role": "member"},
        )

        created = service.create(body(), "user-1", datetime.now(timezone.utc) + timedelta(days=30))

        self.assertEqual(1, len(repository.reserved))
        self.assertEqual("tenant-1", repository.reserved[0][0])
        self.assertEqual(1, len(repository.snapshots))
        self.assertEqual(created["id"], repository.snapshots[0]["batch_id"])
        self.assertEqual([("tenant-1", created["id"], f"batch:{created['id']}:run")], repository.jobs)

    def test_execution_reads_the_immutable_snapshot_after_settings_change(self):
        from geo_backend.batches import BatchService
        from geo_backend.models import SettingsService

        repository = RuntimeRepository()
        SettingsService(repository, "master").save_model("user-1", "qwen", "primary", "qwen-old", "old-key", False)
        batch = {"id": "batch-1", "model": {"id": "qwen", "modelId": "qwen-old", "label": "old"}}
        repository.save_model_snapshot(
            batch_id="batch-1",
            tenant_id="tenant-1",
            user_id="user-1",
            model={"id": "qwen", "modelId": "qwen-old"},
            api_key="old-key",
            endpoint="https://old.example/v1",
            master_key="master",
        )
        SettingsService(repository, "master").save_model("user-1", "qwen", "primary", "qwen-new", "new-key", False)
        service = BatchService(
            repository,
            "master",
            {"clientId": "ima-client", "apiKey": "ima-key"},
            tenant_context={"tenantId": "tenant-1", "role": "member"},
        )

        model, key = service._execution_model(batch, "user-1")

        self.assertEqual("qwen-old", model["modelId"])
        self.assertEqual("https://old.example/v1", model["endpoint"])
        self.assertEqual("old-key", key)


if __name__ == "__main__":
    unittest.main()
