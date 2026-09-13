import sys
import unittest
from pathlib import Path


FUNCTIONS_DIR = Path(__file__).resolve().parents[1] / "cloud-functions"
sys.path.insert(0, str(FUNCTIONS_DIR))


class WorkerRepository:
    def __init__(self):
        self.jobs = [{"id": "job-1", "batchId": "batch-1", "userId": "user-1", "seq": 0, "status": "queued"}]
        self.finished = []

    def claim_next_job(self, _lease_seconds=90):
        for job in self.jobs:
            if job["status"] == "queued":
                job["status"] = "running"
                return dict(job)
        return None

    def finish_job(self, job_id, status):
        self.finished.append((job_id, status))

    def fail_job(self, job_id, message):
        self.finished.append((job_id, "failed", message))


class WorkerTests(unittest.IsolatedAsyncioTestCase):
    async def test_worker_claims_once_and_finishes_completed_batch(self):
        from geo_backend.worker import BatchWorker

        repository = WorkerRepository()
        calls = []

        class Service:
            async def advance(self, batch_id, body, user_id):
                calls.append((batch_id, body, user_id))
                return {"status": "completed"}

        result = await BatchWorker(repository, lambda _job: Service()).run_once()
        second = await BatchWorker(repository, lambda _job: Service()).run_once()

        self.assertTrue(result)
        self.assertFalse(second)
        self.assertEqual([("batch-1", {"seq": 0}, "user-1")], calls)
        self.assertEqual([("job-1", "completed")], repository.finished)

    async def test_worker_marks_failed_job_without_retrying_external_call(self):
        from geo_backend.worker import BatchWorker

        repository = WorkerRepository()

        class Service:
            async def advance(self, _batch_id, _body, _user_id):
                raise RuntimeError("provider down")

        result = await BatchWorker(repository, lambda _job: Service()).run_once()

        self.assertTrue(result)
        self.assertEqual("failed", repository.finished[0][1])
        self.assertIn("provider down", repository.finished[0][2])


if __name__ == "__main__":
    unittest.main()
