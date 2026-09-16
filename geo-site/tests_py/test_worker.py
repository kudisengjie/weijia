import sys
import asyncio
import unittest
from pathlib import Path


FUNCTIONS_DIR = Path(__file__).resolve().parents[1] / "cloud-functions"
sys.path.insert(0, str(FUNCTIONS_DIR))


class WorkerRepository:
    def __init__(self):
        self.jobs = [{"id": "job-1", "batchId": "batch-1", "userId": "user-1", "seq": 0, "status": "queued", 'leaseToken': 'lease-1'}]
        self.finished = []

    def claim_next_job(self, _lease_seconds=90):
        for job in self.jobs:
            if job["status"] == "queued":
                job["status"] = "running"
                return dict(job)
        return None

    def finish_job(self, job_id, status, lease_token, delay_seconds=0):
        self.finished.append((job_id, status))

    def fail_job(self, job_id, message, lease_token):
        self.finished.append((job_id, "failed", message))


class WorkerTests(unittest.IsolatedAsyncioTestCase):
    async def test_pool_five_independent_lanes_and_graceful_stop(self):
        from geo_backend.worker import run_pool
        stop, release, all_started = asyncio.Event(), asyncio.Event(), asyncio.Event()
        active = peak = calls = finished = 0
        async def step():
            nonlocal active, peak, calls, finished
            calls += 1
            active += 1
            peak = max(peak, active)
            if active == 5:
                all_started.set()
            await release.wait()
            active -= 1
            finished += 1
            return True
        task = asyncio.create_task(run_pool(step, stop, concurrency=5, poll_seconds=0.01))
        await asyncio.wait_for(all_started.wait(), timeout=2)
        stop.set()
        self.assertFalse(task.done(), 'Stop must drain in-flight work, not cancel it')
        release.set()
        await asyncio.wait_for(task, timeout=2)
        self.assertEqual((5, 5, 5, 0), (peak, calls, finished, active))

    async def test_pool_failure_isolated_and_idle_wakes_on_stop(self):
        from geo_backend.worker import run_pool
        stop = asyncio.Event()
        calls, failures = [], []
        async def step():
            calls.append(len(calls))
            if len(calls) == 1:
                raise RuntimeError('private upstream detail must not be logged')
            stop.set()
            return False
        await asyncio.wait_for(run_pool(step, stop, concurrency=2, poll_seconds=60, on_error=lambda: failures.append(True)), timeout=2)
        self.assertEqual([True], failures)
        self.assertEqual(2, len(calls))

    async def test_pool_rejects_more_than_five_lanes(self):
        from geo_backend.worker import run_pool
        with self.assertRaises(ValueError):
            await run_pool(None, asyncio.Event(), concurrency=6)

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
        from geo_backend.errors import ApiError

        repository = WorkerRepository()

        class Service:
            async def advance(self, _batch_id, _body, _user_id):
                raise ApiError(403, "tenant access revoked", "TENANT_ACCESS_REQUIRED")

        result = await BatchWorker(repository, lambda _job: Service()).run_once()

        self.assertTrue(result)
        self.assertEqual("failed", repository.finished[0][1])
        self.assertEqual("TENANT_ACCESS_REQUIRED", repository.finished[0][2])


if __name__ == "__main__":
    unittest.main()
