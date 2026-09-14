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
            self.repository.finish_job(job['id'], str(result['status']), job['leaseToken'])
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


async def serve(config, *, once=False, poll_seconds=2):
    from .batches import BatchService
    from .repository import postgres_repository
    from .tenant_access import TenantAccessService

    stop = asyncio.Event()
    for signum in (signal.SIGINT, signal.SIGTERM):
        signal.signal(signum, lambda *_: stop.set())
    while not stop.is_set():
        try:
            with postgres_repository(config.database_url) as repository:
                def service(job):
                    context = TenantAccessService(repository).context(job['userId'])
                    if context is None:
                        raise ApiError(403, 'Account has no workspace', 'TENANT_ACCESS_REQUIRED')
                    return BatchService(repository, config.geo_master_key,
                        {'clientId': config.ima_client_id, 'apiKey': config.ima_api_key},
                        tenant_context=context)
                worked = await BatchWorker(repository, service).run_once()
            if once:
                print(json.dumps({'worker': 'advanced' if worked else 'idle'}))
                return 0
        except Exception:
            print(json.dumps({'worker': 'unavailable', 'code': 'WORKER_DATABASE_ERROR'}), flush=True)
            if once:
                return 1
        try:
            await asyncio.wait_for(stop.wait(), timeout=poll_seconds)
        except asyncio.TimeoutError:
            pass
    return 0


def main(argv=None):
    from .config import Settings
    parser = argparse.ArgumentParser(description='Run GEO durable jobs using the existing PostgreSQL database.')
    parser.add_argument('--once', action='store_true', help='Process at most one phase and exit.')
    parser.add_argument('--poll-seconds', type=float, default=2)
    args = parser.parse_args(argv)
    if not 0.2 <= args.poll_seconds <= 60:
        parser.error('--poll-seconds must be between 0.2 and 60')
    config = Settings.from_mapping(os.environ)
    if config.missing:
        print(json.dumps({'worker': 'unavailable', 'code': 'SETUP_REQUIRED', 'missing': list(config.missing)}))
        return 2
    return asyncio.run(serve(config, once=args.once, poll_seconds=args.poll_seconds))


if __name__ == '__main__':
    raise SystemExit(main())
