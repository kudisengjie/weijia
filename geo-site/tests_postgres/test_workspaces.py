"""Workspace contracts against the existing disposable loopback PostgreSQL fixture."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sys
import threading
import unittest
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_runtime_integration as fixtures
MASTER = fixtures.MASTER
from geo_backend.errors import ApiError
from geo_backend.models import SettingsService
from geo_backend.repository import PostgresRepository
from geo_backend.workspaces import WorkspaceService


class WorkspaceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        fixtures.PostgresRuntimeTests.setUpClass()

    @classmethod
    def tearDownClass(cls):
        fixtures.PostgresRuntimeTests.tearDownClass()

    def setUp(self):
        self.fx = fixtures.PostgresRuntimeTests()
        self.fx.setUp()
        self.addCleanup(self.fx.doCleanups)
        self.owner, self.repo = self.fx.owner, self.fx.repo
        self.service = WorkspaceService(self.repo, MASTER, self.fx.context, self.fx.service())

    def create(self):
        return self.service.create(str(uuid.uuid4()), self.owner)

    def draft(self, provider='qwen'):
        body = self.fx.body(1)
        return {'title': '独立工作区', 'taskFileName': '任务.xlsx', 'sheetName': '任务',
                'rows': body['rows'], 'companies': body['companies'],
                'model': {'id': provider, 'slot': 'primary', 'modelId': ''}}

    def test_concurrent_limit_idempotency_and_other_account(self):
        gate = threading.Barrier(8)
        ids = [str(uuid.uuid4()) for _ in range(8)]
        def create(request_id):
            with self.fx.connect() as conn:
                repo = PostgresRepository(conn, MASTER)
                service = WorkspaceService(repo, MASTER, self.fx.context, None)
                gate.wait(timeout=10)
                try:
                    return service.create(request_id, self.owner)
                except ApiError as error:
                    return error.code
        with ThreadPoolExecutor(max_workers=8) as executor:
            result = list(executor.map(create, ids))
        # 草稿不占名额：8 个并发创建全部成功，幂等由 request_id 保证。
        self.assertEqual(8, sum(isinstance(row, dict) for row in result))
        self.assertEqual(0, result.count('WORKSPACE_LIMIT_REACHED'))
        index = next(i for i, row in enumerate(result) if isinstance(row, dict))
        self.assertEqual(result[index]['id'], self.service.create(ids[index], self.owner)['id'])
        other = self.repo.upsert_configured_user('other-' + uuid.uuid4().hex, 'unused-test-hash')['id']
        context = self.repo.ensure_owner_tenant(other, 't-' + uuid.uuid4().hex)
        context = self.repo.get_tenant_context(other, datetime.now(timezone.utc))
        self.assertIsNotNone(WorkspaceService(self.repo, MASTER, context, None).create(str(uuid.uuid4()), other))

    def test_encrypted_draft_version_and_owner_isolation(self):
        w = self.create()
        saved = self.service.save(w['id'], self.owner, 0, self.draft())
        self.assertEqual(1, saved['version'])
        self.assertEqual(self.draft()['companies'], saved['draft']['companies'])
        with self.assertRaises(ApiError) as stale:
            self.service.save(w['id'], self.owner, 0, self.draft())
        self.assertEqual('WORKSPACE_VERSION_CONFLICT', stale.exception.code)
        with self.assertRaises(ApiError) as denied:
            self.service.get(w['id'], str(uuid.uuid4()))
        self.assertEqual(404, denied.exception.status)
        raw = self.fx.conn.execute('SELECT state_cipher FROM workspaces WHERE id = %s', (w['id'],)).fetchone()[0]
        self.assertNotIn('零雪内容服务'.encode(), bytes(raw))
        second = self.create()
        self.fx.conn.execute('UPDATE workspaces SET state_cipher = %s WHERE id = %s', (raw, second['id']))
        with self.assertRaises(ApiError) as swapped:
            self.service.get(second['id'], self.owner)
        self.assertEqual('WORKSPACE_STATE_INVALID', swapped.exception.code)

    def test_five_starts_snapshot_credits_and_cancel_release(self):
        self.fx.fund(amount=10)
        SettingsService(self.repo, MASTER).save_model(self.owner, 'deepseek', 'primary', '', 'second-test-key', False)
        drafts = []
        for i in range(5):
            w = self.create()
            drafts.append(self.service.save(w['id'], self.owner, 0, self.draft('qwen' if i % 2 else 'deepseek')))
        gate = threading.Barrier(5)
        def start(w):
            from geo_backend.batches import BatchService
            with self.fx.connect() as conn:
                repo = PostgresRepository(conn, MASTER)
                batch_service = BatchService(repo, MASTER, {'clientId':'test-client', 'apiKey':'test-ima'}, tenant_context=self.fx.context)
                service = WorkspaceService(repo, MASTER, self.fx.context, batch_service)
                gate.wait(timeout=10)
                return service.start(w['id'], self.owner, w['version'], self.fx.context['expiresAt'])
        with ThreadPoolExecutor(max_workers=5) as executor:
            started = list(executor.map(start, drafts))
        self.assertEqual(5, self.repo.credit_balance(self.fx.tenant, self.owner))
        self.assertEqual(5, len({w['batch']['id'] for w in started}))
        for i, w in enumerate(started):
            again = self.service.start(w['id'], self.owner, drafts[i]['version'], self.fx.context['expiresAt'])
            self.assertEqual(w['batch']['id'], again['batch']['id'])
            snapshot = self.repo.get_model_snapshot(batch_id=w['batch']['id'], tenant_id=self.fx.tenant, user_id=self.owner, master_key=MASTER)
            self.assertEqual('qwen' if i % 2 else 'deepseek', snapshot['provider'])
            with self.assertRaises(ApiError) as locked:
                self.service.save(w['id'], self.owner, w['version'], self.draft())
            self.assertEqual('WORKSPACE_LOCKED', locked.exception.code)
        # 草稿不占名额：可以继续建草稿，但同时进行的任务最多 5 个
        sixth = self.service.save(self.create()['id'], self.owner, 0, self.draft())
        self.assertEqual(5, self.service.list(self.owner)['occupied'])
        with self.assertRaises(ApiError) as full:
            self.service.start(sixth['id'], self.owner, sixth['version'], self.fx.context['expiresAt'])
        self.assertEqual('WORKSPACE_LIMIT_REACHED', full.exception.code)
        # 旧版直连入口同样不能绕过“同时进行 5 个任务”的限制
        with self.assertRaises(ApiError) as legacy:
            self.fx.service().create(self.fx.body(1), self.owner, self.fx.context['expiresAt'])
        self.assertEqual('WORKSPACE_LIMIT_REACHED', legacy.exception.code)
        self.fx.service().cancel(started[0]['batch']['id'], self.owner)
        self.assertEqual(6, self.repo.credit_balance(self.fx.tenant, self.owner))
        self.assertEqual(4, self.service.list(self.owner)['occupied'])
        self.service.start(sixth['id'], self.owner, sixth['version'], self.fx.context['expiresAt'])
        self.assertEqual(5, self.service.list(self.owner)['occupied'])

    def test_failed_start_rolls_back_and_archive_releases_draft(self):
        w = self.create()
        w = self.service.save(w['id'], self.owner, w['version'], self.draft())
        with self.assertRaises(ApiError) as poor:
            self.service.start(w['id'], self.owner, w['version'], self.fx.context['expiresAt'])
        self.assertEqual('INSUFFICIENT_CREDITS', poor.exception.code)
        self.assertEqual([], self.repo.list_batches(self.owner))
        self.assertEqual('draft', self.service.get(w['id'], self.owner)['status'])
        self.service.archive(w['id'], self.owner, w['version'])
        self.assertEqual(0, self.service.list(self.owner)['occupied'])

    def test_parallel_batch_outputs_and_one_failure_are_isolated(self):
        from geo_backend.batches import BatchService
        self.fx.fund(amount=10)
        batch_ids = []
        for i in range(5):
            w, draft = self.create(), self.draft()
            draft['rows'][1][2] = f'工作区{i}'
            w = self.service.save(w['id'], self.owner, 0, draft)
            started = self.service.start(w['id'], self.owner, w['version'], self.fx.context['expiresAt'])
            # Legacy finalize-on-persist coverage; new-mode receipt flow lives in test_local_delivery.
            self.fx.conn.execute("UPDATE batches SET delivery_mode = 'server_legacy' WHERE id = %s", (started['batch']['id'],))
            batch = self.repo.get_batch(self.owner, started['batch']['id'])
            batch.update(phase='generate', rules={'generation':['完整输出'], 'audit':['检查事实'], 'memory':[]},
                         webSources=[{'title': '行业联网证据', 'url': 'https://example.com/geo',
                                      'site': 'example.com', 'snippet': '零雪内容服务'}])
            batch['webCache'] = {batch['tasks'][0]['question']: batch['webSources']}
            self.repo.save_batch(self.owner, batch['id'], batch, batch['seq'])
            batch_ids.append(batch['id'])
        active, peak, calls = 0, 0, []
        async def model(_model, key, messages, **_kwargs):
            nonlocal active, peak
            payload = json.loads(messages[-1]['content'])
            question = payload['task']['question']
            self.assertEqual('test-model-key', key)
            active += 1
            peak = max(peak, active)
            calls.append(question)
            try:
                await asyncio.sleep(0.05)
                if question == '工作区2':
                    raise ApiError(502, '固定测试：单工作区供应商失败')
                return '{"passed":true,"issues":[]}' if 'draft' in payload else '# ' + question + '\n完整测试输出。'
            finally:
                active -= 1
        async def run(batch_id):
            with self.fx.connect() as conn:
                repo = PostgresRepository(conn, MASTER)
                service = BatchService(repo, MASTER, {}, tenant_context=self.fx.context, model_complete=model)
                result = service.get(batch_id, self.owner)
                for _ in range(6):
                    if result['status'] != 'ready':
                        break
                    result = await service.advance(batch_id, {'seq':result['seq']}, self.owner)
                return service.get(batch_id, self.owner)
        async def all_batches():
            return await asyncio.gather(*(run(batch_id) for batch_id in batch_ids))
        results = asyncio.run(all_batches())
        self.assertEqual(5, peak)
        self.assertTrue(all(b['status'] == 'completed' for b in results))
        self.assertEqual([1,1,0,1,1], [b['completed'] for b in results])
        self.assertEqual(1, calls.count('工作区2'), 'failed model call is not repeated')
        self.assertEqual(6, self.repo.credit_balance(self.fx.tenant, self.owner))
        from geo_backend.artifacts import ArtifactService
        for i, result in enumerate(results):
            if i == 2:
                self.assertEqual(1, result['billing']['refunded'])
                continue
            article = result['articles'][0]
            artifact = ArtifactService(self.repo, MASTER).get(self.fx.tenant, article['artifactId'], self.owner)
            self.assertIn('工作区' + str(i), artifact['markdown'])
        self.assertEqual(0, self.service.list(self.owner)['occupied'])

    def test_legacy_entry_checks_running_limit_and_start_checks_version(self):
        self.fx.fund(amount=10)
        drafts = [self.create() for _ in range(5)]
        # 草稿不占名额：无进行中任务时，旧版直连入口可正常创建批次
        legacy = self.fx.service().create(self.fx.body(1), self.owner, self.fx.context['expiresAt'])
        self.assertIsNotNone(legacy)
        self.fx.service().cancel(legacy['id'], self.owner)
        w = self.service.save(drafts[0]['id'], self.owner, 0, self.draft())
        with self.assertRaises(ApiError) as stale:
            self.service.start(w['id'], self.owner, 0, self.fx.context['expiresAt'])
        self.assertEqual('WORKSPACE_VERSION_CONFLICT', stale.exception.code)
        self.assertEqual(10, self.repo.credit_balance(self.fx.tenant, self.owner))
        first = self.service.start(w['id'], self.owner, 1, self.fx.context['expiresAt'])
        with self.assertRaises(ApiError) as locked:
            self.service.archive(w['id'], self.owner, first['version'])
        self.assertEqual('WORKSPACE_LOCKED', locked.exception.code)
        self.assertEqual(9, self.repo.credit_balance(self.fx.tenant, self.owner))

    def test_expired_subscription_can_read_but_not_save_or_start(self):
        w = self.create()
        w = self.service.save(w['id'], self.owner, 0, self.draft())
        now = datetime.now(timezone.utc)
        self.repo.set_subscription(self.fx.tenant, self.owner, now-timedelta(days=32), now-timedelta(days=2))
        self.assertEqual(w['id'], self.service.get(w['id'], self.owner)['id'])
        for operation in [lambda:self.create(), lambda:self.service.save(w['id'], self.owner, 1, self.draft()),
                          lambda:self.service.start(w['id'], self.owner, 1, self.fx.context['expiresAt'])]:
            with self.assertRaises(ApiError) as expired:
                operation()
            self.assertEqual('SUBSCRIPTION_EXPIRED', expired.exception.code)

    def test_http_contract_and_csrf(self):
        async def run():
            async with self.fx.http_client() as client:
                self.assertEqual(401, (await client.get('/workspaces')).status_code)
                login = await client.post('/auth/login', json={'account': self.fx.config().geo_account, 'password': 'test-password'})
                self.assertEqual(403, (await client.post('/workspaces', json={'requestId': str(uuid.uuid4())})).status_code)
                client.headers['x-csrf-token'] = login.json()['csrf']
                response = await client.post('/workspaces', json={'requestId': str(uuid.uuid4())})
                self.assertEqual(200, response.status_code, response.text)
                w = response.json()
                saved = await client.post('/workspaces/'+w['id']+'/save', json={'version': 0, 'draft': self.draft()})
                self.assertEqual(200, saved.status_code, saved.text)
                # 草稿不占名额：occupied 只统计未结束的批次。
                self.assertEqual(0, (await client.get('/workspaces')).json()['occupied'])
                invalid = await client.post('/workspaces/'+w['id']+'/save', json={'version': 1, 'draft': {**self.draft(), 'apiKey':'should-not-be-accepted'}})
                self.assertEqual(400, invalid.status_code)
                self.assertNotIn('should-not-be-accepted', invalid.text)
        asyncio.run(run())
