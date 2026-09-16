from __future__ import annotations

import argparse
import asyncio
from contextlib import suppress
import json
import os
import signal
from typing import Callable

from .errors import ApiError


class BatchWorker:
    """One durable phase with a fenced lease. No automatic upstream retries."""

    def __init__(self, repository: object, service_factory: Callable, lease_seconds: int = 90) -> None:
        self.repository = repository
        self.service_factory = service_factory
        self.lease_seconds = lease_seconds

    async def _heartbeat(self, job):
        while True:
            await asyncio.sleep(max(1, self.lease_seconds / 3))
            if not self.repository.heartbeat_job(job['id'], job['leaseToken'], self.lease_seconds):
                return

    async def run_once(self) -> bool:
        job = self.repository.claim_next_job(self.lease_seconds)
        if not job:
            return False
        heartbeat = asyncio.create_task(self._heartbeat(job))
        try:
            service = self.service_factory(job)
            result = await service.advance(job['batchId'], {'seq': int(job['seq'])}, job['userId'])
            self.repository.finish_job(job['id'], str(result['status']), job['leaseToken'], delay_seconds=2 if result.get('pauseRequested') else 0)
        except ApiError as error:
            if error.code in {'STEP_CLAIMED', 'IMA_CACHE_BUSY'}:
                self.repository.finish_job(job['id'], 'queued', job['leaseToken'], delay_seconds=2)
            else:
                self.repository.fail_job(job['id'], error.code, job['leaseToken'])
        except Exception:
            # Leave uncertain claims durable for stale-step reconciliation.
            self.repository.finish_job(job['id'], 'queued', job['leaseToken'], delay_seconds=10)
        finally:
            heartbeat.cancel()
            with suppress(asyncio.CancelledError):
                await heartbeat
        return True


async def run_forever(worker: BatchWorker, interval_seconds: float = 1.0) -> None:
    while True:
        if not await worker.run_once():
            await asyncio.sleep(interval_seconds)


async def run_pool(run_once, stop, *, concurrency=5, poll_seconds=2, on_error=lambda: None):
    """Bounded independent lanes. Shutdown drains each phase without claiming another."""
    if type(concurrency) is not int or not 1 <= concurrency <= 5:
        raise ValueError('Worker concurrency must be between 1 and 5')
    if not 0 < poll_seconds <= 60:
        raise ValueError('Worker poll interval must be between 0 and 60 seconds')

    async def lane():
        while not stop.is_set():
            try:
                worked = await run_once()
            except Exception:
                on_error()  # No credentials, request payloads or provider details in logs.
                worked = False
            if worked:
                await asyncio.sleep(0)  # Fairness even when the step did not await an upstream.
            else:
                try:
                    await asyncio.wait_for(stop.wait(), timeout=poll_seconds)
                except asyncio.TimeoutError:
                    pass
    await asyncio.gather(*(lane() for _ in range(concurrency)))


async def serve(config, *, once=False, poll_seconds=2, concurrency=5):
    from .batches import BatchService
    from .repository import postgres_repository
    from .tenant_access import TenantAccessService

    async def step():
        # Each lane/phase owns a separate connection; never share transactions across batches.
        with postgres_repository(config.database_url, config.geo_master_key) as repository:
            def service(job):
                context = TenantAccessService(repository).context(job['userId'])
                if context is None:
                    raise ApiError(403, 'Account has no workspace', 'TENANT_ACCESS_REQUIRED')
                return BatchService(repository, config.geo_master_key,
                    {'clientId': config.ima_client_id, 'apiKey': config.ima_api_key},
                    tenant_context=context)
            return await BatchWorker(repository, service).run_once()

    def unavailable():
        print(json.dumps({'worker': 'unavailable', 'code': 'WORKER_DATABASE_ERROR'}), flush=True)

    if once:
        try:
            worked = await step()
            print(json.dumps({'worker': 'advanced' if worked else 'idle'}))
            return 0
        except Exception:
            unavailable()
            return 1
    stop = asyncio.Event()
    previous = {signum: signal.signal(signum, lambda *_: stop.set()) for signum in (signal.SIGINT, signal.SIGTERM)}
    try:
        await run_pool(step, stop, concurrency=concurrency, poll_seconds=poll_seconds, on_error=unavailable)
    finally:
        for signum, handler in previous.items():
            signal.signal(signum, handler)
    return 0


def main(argv=None):
    from .config import Settings
    parser = argparse.ArgumentParser(description='Run GEO durable jobs using the existing PostgreSQL database.')
    parser.add_argument('--once', action='store_true', help='Process at most one phase and exit.')
    parser.add_argument('--poll-seconds', type=float, default=2)
    parser.add_argument('--concurrency', type=int, default=5, help='Independent worker lanes (1–5); default 5. --once still runs one phase.')
    args = parser.parse_args(argv)
    if not 0.2 <= args.poll_seconds <= 60:
        parser.error('--poll-seconds must be between 0.2 and 60')
    if not 1 <= args.concurrency <= 5:
        parser.error('--concurrency must be between 1 and 5')
    config = Settings.from_mapping(os.environ)
    if config.missing:
        print(json.dumps({'worker': 'unavailable', 'code': 'SETUP_REQUIRED', 'missing': list(config.missing)}))
        return 2
    return asyncio.run(serve(config, once=args.once, poll_seconds=args.poll_seconds, concurrency=args.concurrency))


if __name__ == '__main__':
    raise SystemExit(main())
