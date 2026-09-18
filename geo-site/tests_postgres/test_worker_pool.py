"""No browser and no /run requests: durable job pool owns all five workspaces."""
import asyncio
from collections import Counter
from contextlib import contextmanager
import json
from pathlib import Path
import sys
import signal
import unittest
from unittest.mock import patch
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_runtime_integration as fixtures
from geo_backend.artifacts import ArtifactService
from geo_backend.batches import BatchService
from geo_backend.errors import ApiError
from geo_backend.repository import PostgresRepository
from geo_backend.worker import serve
from geo_backend.workspaces import WorkspaceService


class WorkerPoolTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        fixtures.PostgresRuntimeTests.setUpClass()

    @classmethod
    def tearDownClass(cls):
        fixtures.PostgresRuntimeTests.tearDownClass()

    def test_five_workspaces_without_browser_four_artifacts_one_refund(self):
        fx = fixtures.PostgresRuntimeTests()
        fx.setUp()
        self.addCleanup(fx.doCleanups)
        fx.fund(amount=10)
        service = WorkspaceService(fx.repo, fixtures.MASTER, fx.context, fx.service())
        ids = []
        for i in range(5):
            w = service.create(str(uuid.uuid4()), fx.owner)
            body = fx.body(1)
            body['rows'][1][2] = 'Worker问题' + str(i)
            w = service.save(w['id'], fx.owner, 0, {'title': 'Worker工作区'+str(i), 'rows': body['rows'], 'companies': body['companies'], 'model': {'id': 'qwen', 'slot': 'primary'}})
            w = service.start(w['id'], fx.owner, w['version'], fx.context['expiresAt'])
            # Legacy finalize-on-persist coverage; new-mode receipt flow lives in test_local_delivery.
            fx.conn.execute("UPDATE batches SET delivery_mode = 'server_legacy' WHERE id = %s", (w['batchId'],))
            ids.append(w['batchId'])
            # Evidence/rules already persisted, as when a user resumes after IMA cache retrieval.
            b = fx.repo.get_batch(fx.owner, w['batchId'])
            b.update(phase='generate', rules={'generation':['完整生成'], 'audit':['检查事实'], 'memory':['零雪']}, sources=[{'title':'证据','text':'零雪内容服务'}])
            b['evidenceCache'] = {'GEO优化知识库|' + b['tasks'][0]['question']: b['sources']}
            fx.repo.save_batch(fx.owner, b['id'], b, b['seq'])

        calls, connections = Counter(), set()
        peak = active = 0
        async def run():
            all_started = asyncio.Event()
            async def model(_model, _key, messages, **_kwargs):
                nonlocal peak, active
                payload = json.loads(messages[-1]['content'])
                question = payload['task']['question']
                calls[(question, 'audit' if 'draft' in payload else 'generate')] += 1
                active += 1
                peak = max(peak, active)
                if active == 5:
                    all_started.set()
                try:
                    await asyncio.wait_for(all_started.wait(), timeout=5)
                    if question == 'Worker问题4':
                        raise ApiError(502, 'fixture model rejected')
                    return '{"passed":true,"issues":[]}' if 'draft' in payload else '# '+question+'\n完整测试正文。'
                finally:
                    active -= 1

            @contextmanager
            def repository(_url, _master):
                with fx.connect() as conn:
                    connections.add(conn.info.backend_pid)
                    repo = PostgresRepository(conn, fixtures.MASTER)
                    yield repo
            def service(*args, **kwargs):
                return BatchService(*args, **kwargs, model_complete=model)
            async def stop_when_complete():
                while True:
                    states = [fx.repo.get_batch(fx.owner, batch_id)['status'] for batch_id in ids]
                    if all(state == 'completed' for state in states):
                        signal.getsignal(signal.SIGTERM)(signal.SIGTERM, None)
                        return
                    await asyncio.sleep(0.01)
            previous = signal.getsignal(signal.SIGTERM)
            with patch('geo_backend.repository.postgres_repository', repository), patch('geo_backend.batches.BatchService', service):
                monitor = asyncio.create_task(stop_when_complete())
                try:
                    self.assertEqual(0, await asyncio.wait_for(serve(fx.config(), poll_seconds=0.01, concurrency=5), timeout=20))
                    await monitor
                finally:
                    monitor.cancel()
            self.assertEqual(previous, signal.getsignal(signal.SIGTERM))
        asyncio.run(run())
        self.assertEqual(5, peak)
        self.assertGreaterEqual(len(connections), 5)
        self.assertTrue(all(n == 1 for n in calls.values()), 'No duplicate model phase requests')
        self.assertEqual(9, sum(calls.values()), '5 generation attempts and 4 audits')
        self.assertEqual(6, fx.repo.credit_balance(fx.tenant, fx.owner))
        for i, batch_id in enumerate(ids):
            result = fx.service().get(batch_id, fx.owner)
            self.assertEqual('completed', result['status'])
            if i == 4:
                self.assertEqual((0,1), (result['completed'],result['billing']['refunded']))
            else:
                artifact = ArtifactService(fx.repo, fixtures.MASTER).get(fx.tenant, result['articles'][0]['artifactId'], fx.owner)
                self.assertIn('Worker问题'+str(i), artifact['markdown'])
        self.assertEqual(0, service.list(fx.owner)['occupied'])
