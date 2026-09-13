from __future__ import annotations

import asyncio
from typing import Callable


class BatchWorker:
    """A single bounded worker tick; the scheduler invokes run_once repeatedly."""

    def __init__(self, repository: object, service_factory: Callable[[dict[str, object]], object], lease_seconds: int = 90) -> None:
        self.repository = repository
        self.service_factory = service_factory
        self.lease_seconds = lease_seconds

    async def run_once(self) -> bool:
        job = self.repository.claim_next_job(self.lease_seconds)
        if not job:
            return False
        try:
            service = self.service_factory(job)
            result = await service.advance(
                str(job["batchId"]),
                {"seq": int(job.get("seq", 0))},
                str(job["userId"]),
            )
            status = str(result.get("status", "running"))
            self.repository.finish_job(str(job["id"]), status if status in {"completed", "failed", "running"} else "running")
        except Exception as error:
            self.repository.fail_job(str(job["id"]), str(error))
        return True


async def run_forever(worker: BatchWorker, interval_seconds: float = 1.0) -> None:
    while True:
        worked = await worker.run_once()
        if not worked:
            await asyncio.sleep(interval_seconds)
