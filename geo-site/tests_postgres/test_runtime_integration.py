"""Real PostgreSQL checks. Only the isolated loopback test database is allowed."""
import asyncio
import json
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import os
from pathlib import Path
import sys
import unittest
import uuid

import psycopg
import httpx
from psycopg import sql

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'cloud-functions'))
from geo_backend.batches import BatchService
from geo_backend.database import ensure_schema
from geo_backend.models import SettingsService
from geo_backend.repository import PostgresRepository
from geo_backend.security import hash_password


TEST_URL = 'postgresql://geo_test@127.0.0.1:55483/postgres?connect_timeout=5'
MASTER = 'a' * 64


class PostgresRuntimeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.schema = 'geo_test_' + uuid.uuid4().hex
        with psycopg.connect(TEST_URL, autocommit=True) as conn:
            conn.execute('CREATE EXTENSION IF NOT EXISTS pgcrypto')
            conn.execute(sql.SQL('CREATE SCHEMA {}').format(sql.Identifier(cls.schema)))
        with cls.connect() as conn:
            ensure_schema(conn, MASTER)
            ensure_schema(conn, MASTER)  # A deployment restart must be safe.

    @classmethod
    def connect(cls):
        return psycopg.connect(TEST_URL, autocommit=True, options=f'-c search_path={cls.schema},public')

    @classmethod
    def tearDownClass(cls):
        if not cls.schema.startswith('geo_test_'):
            raise AssertionError('Unsafe test schema')
        with psycopg.connect(TEST_URL, autocommit=True) as conn:
            conn.execute(sql.SQL('DROP SCHEMA {} CASCADE').format(sql.Identifier(cls.schema)))

    def setUp(self):
        self.conn = self.connect()
        self.addCleanup(self.conn.close)
        self.repo = PostgresRepository(self.conn, MASTER)
        self.owner = self.repo.upsert_configured_user('owner-' + uuid.uuid4().hex, hash_password('test-password'))['id']
        self.tenant = self.repo.ensure_owner_tenant(self.owner, 'tenant-' + uuid.uuid4().hex)['tenantId']
        self.context = self.repo.get_tenant_context(self.owner, datetime.now(timezone.utc))
        SettingsService(self.repo, MASTER).save_model(self.owner, 'qwen', 'primary', '', 'test-model-key', False)

    def service(self, **options):
        return BatchService(self.repo, MASTER, {'clientId': 'test-client', 'apiKey': 'test-ima-key'}, tenant_context=self.context, **options)

    def config(self):
        from geo_backend.config import Settings
        account = self.conn.execute('SELECT username FROM users WHERE id = %s', (self.owner,)).fetchone()[0]
        return Settings.from_mapping({'APP_ORIGIN': 'http://localhost', 'GEO_LOCAL_DEV': '1',
            'GEO_ACCOUNT': account, 'GEO_PASSWORD_HASH': hash_password('test-password'),
            'GEO_MASTER_KEY': MASTER, 'DATABASE_URL': TEST_URL,
            'IMA_OPENAPI_CLIENTID': 'test-client', 'IMA_OPENAPI_APIKEY': 'test-ima'})

    def http_client(self):
        from geo_backend.app import create_app
        @contextmanager
        def factory():
            with self.connect() as conn:
                yield PostgresRepository(conn, MASTER)
        return httpx.AsyncClient(transport=httpx.ASGITransport(app=create_app(self.config(), factory)),
            base_url='http://localhost', headers={'origin': 'http://localhost'})

    def save_artifact(self, batch_id):
        from geo_backend.artifacts import ArtifactService
        return ArtifactService(self.repo, MASTER).save_complete(tenant_id=self.tenant,
            user_id=self.owner, batch_id=batch_id, task_id='1', filename='1-零雪.md',
            markdown='# 完整文章\n零雪内容服务。', audit_status='accepted')

    def test_http_download_preserves_chinese_filename(self):
        batch = self.prepared_batch(1)
        artifact = self.save_artifact(batch['id'])
        async def run():
            async with self.http_client() as client:
                response = await client.post('/auth/login', json={'account': self.config().geo_account, 'password': 'test-password'})
                self.assertEqual(200, response.status_code)
                return await client.get('/artifacts/' + artifact['id'])
        response = asyncio.run(run())
        self.assertEqual(200, response.status_code)
        self.assertIn('零雪内容服务', response.text)
        self.assertIn("filename*=UTF-8''", response.headers['content-disposition'])

    def test_auth_caps_legacy_sessions_and_rotates_browser_cookie(self):
        from geo_backend.auth import AuthService
        from geo_backend.security import digest
        auth = AuthService(self.config(), self.repo)
        old = auth.login(self.config().geo_account, 'test-password')
        self.conn.execute("UPDATE sessions SET created_at = NOW() - INTERVAL '9 hours', expires_at = NOW() + INTERVAL '6 days' WHERE token_hash = %s", (digest(old.cookie_token),))
        self.assertIsNone(self.repo.get_session(digest(old.cookie_token)))
        async def run():
            async with self.http_client() as client:
                await client.post('/auth/login', json={'account': self.config().geo_account, 'password': 'test-password'})
                previous = client.cookies.get('lxue_session')
                again = await client.post('/auth/login', json={'account': self.config().geo_account, 'password': 'test-password'})
                self.assertIn('Max-Age=28800', again.headers['set-cookie'])
                expired = await client.get('/auth/session', headers={'Cookie': f'lxue_session={previous}'})
                self.assertEqual(401, expired.status_code)
                self.assertEqual(200, (await client.get('/auth/session')).status_code)
        asyncio.run(run())

    def test_legacy_session_public_expiry_matches_eight_hour_cap(self):
        from geo_backend.auth import AuthService
        from geo_backend.security import digest
        auth = AuthService(self.config(), self.repo)
        session = auth.login(self.config().geo_account, 'test-password')
        self.conn.execute("UPDATE sessions SET created_at = NOW() - INTERVAL '7 hours', expires_at = NOW() + INTERVAL '6 days' WHERE token_hash = %s", (digest(session.cookie_token),))
        restored = auth.authenticate(session.cookie_token, None, 'GET')
        self.assertLess((restored.expires_at - datetime.now(timezone.utc)).total_seconds(), 3601)

    def test_http_member_cannot_download_other_members_artifact(self):
        batch = self.prepared_batch(1)
        artifact = self.save_artifact(batch['id'])
        now = datetime.now(timezone.utc)
        member = self.repo.create_member(tenant_id=self.tenant, username='m-' + uuid.uuid4().hex,
            password_hash=hash_password('member-password'), role='member', starts_at=now, expires_at=now + timedelta(days=30))
        async def run():
            async with self.http_client() as client:
                await client.post('/auth/login', json={'account': member['username'], 'password': 'member-password'})
                return await client.get('/artifacts/' + artifact['id'])
        self.assertEqual(404, asyncio.run(run()).status_code)

    def test_complete_artifact_is_immutable(self):
        from geo_backend.artifacts import ArtifactService
        from geo_backend.errors import ApiError
        batch = self.prepared_batch(1)
        first = self.save_artifact(batch['id'])
        self.assertEqual(first['id'], self.save_artifact(batch['id'])['id'])
        with self.assertRaises(ApiError):
            ArtifactService(self.repo, MASTER).save_complete(tenant_id=self.tenant, user_id=self.owner,
                batch_id=batch['id'], task_id='1', filename='覆盖.md', markdown='不一样的正文', audit_status='accepted')

    def test_old_owner_login_initializes_tenant_and_rejects_replaced_password(self):
        from dataclasses import replace
        from geo_backend.auth import AuthService
        from geo_backend.errors import ApiError
        user = self.repo.upsert_configured_user('old-' + uuid.uuid4().hex, hash_password('old-password'))
        config = replace(self.config(), geo_account=user['username'], geo_password_hash=hash_password('old-password'))
        AuthService(config, self.repo).login(user['username'], 'old-password')
        self.assertIsNotNone(self.repo.get_tenant_context(user['id'], datetime.now(timezone.utc)))
        config = replace(config, geo_password_hash=hash_password('new-password'))
        with self.assertRaises(ApiError):
            AuthService(config, self.repo).login(user['username'], 'old-password')

    def test_renewal_uses_latest_subscription_not_longest_old_one(self):
        now = datetime.now(timezone.utc)
        member = self.repo.create_member(tenant_id=self.tenant, username='m-' + uuid.uuid4().hex,
            password_hash=hash_password('member-password'), role='member', starts_at=now, expires_at=now + timedelta(days=30))
        expires = now + timedelta(days=2)
        self.repo.set_subscription(self.tenant, member['id'], now, expires)
        context = self.repo.get_tenant_context(member['id'], now)
        self.assertTrue(context['active'])
        self.assertEqual(expires, context['expiresAt'])

    def test_http_owner_assigns_credits_to_selected_member_only(self):
        now = datetime.now(timezone.utc)
        member = self.repo.create_member(tenant_id=self.tenant, username='m-' + uuid.uuid4().hex,
            password_hash=hash_password('member-password'), role='member', starts_at=now, expires_at=now + timedelta(days=30))
        self.fund(amount=10)
        async def run():
            async with self.http_client() as client:
                login = await client.post('/auth/login', json={'account': self.config().geo_account, 'password': 'test-password'})
                client.headers['x-csrf-token'] = login.json()['csrf']
                body = {'userId': member['id'], 'amount': 3, 'kind': 'grant', 'idempotencyKey': str(uuid.uuid4())}
                first = await client.post('/credits/adjust', json=body)
                self.assertEqual(200, first.status_code, first.text)
                replay = await client.post('/credits/adjust', json=body)
                self.assertFalse(replay.json()['applied'])
                await client.post('/auth/login', json={'account': member['username'], 'password': 'member-password'})
                return await client.get('/settings')
        response = asyncio.run(run())
        self.assertEqual(3, response.json()['credits']['balance'])
        self.assertEqual(10, self.repo.credit_balance(self.tenant, self.owner))

    def test_http_admin_cannot_mint_credits_or_clear_shared_ima(self):
        now = datetime.now(timezone.utc)
        admin = self.repo.create_member(tenant_id=self.tenant, username='admin-' + uuid.uuid4().hex,
            password_hash=hash_password('member-password'), role='admin', starts_at=now, expires_at=now + timedelta(days=30))
        async def run():
            async with self.http_client() as client:
                login = await client.post('/auth/login', json={'account': admin['username'], 'password': 'member-password'})
                client.headers['x-csrf-token'] = login.json()['csrf']
                for path, body in [('/credits/adjust', {'amount': 3, 'kind': 'grant', 'idempotencyKey': str(uuid.uuid4())}), ('/ima/cache/clear', {})]:
                    response = await client.post(path, json=body)
                    self.assertEqual(403, response.status_code, path)
        asyncio.run(run())

    def test_http_owner_lists_members_and_renews_only_own_member_with_audit(self):
        now = datetime.now(timezone.utc)
        member = self.repo.create_member(tenant_id=self.tenant, username='managed-' + uuid.uuid4().hex,
            password_hash=hash_password('member-password'), role='member', starts_at=now, expires_at=now + timedelta(days=30))
        stranger = self.repo.upsert_configured_user('foreign-' + uuid.uuid4().hex, hash_password('test-password'))
        self.fund(member['id'], 4)
        async def run():
            async with self.http_client() as client:
                login = await client.post('/auth/login', json={'account': self.config().geo_account, 'password': 'test-password'})
                client.headers['x-csrf-token'] = login.json()['csrf']
                listing = await client.get('/tenant/members')
                self.assertEqual(200, listing.status_code, listing.text)
                record = next(row for row in listing.json()['members'] if row['id'] == member['id'])
                self.assertEqual(4, record['balance'])
                self.assertNotIn('password', listing.text)
                body = {'userId': stranger['id'], 'startsAt': now.isoformat(), 'expiresAt': (now + timedelta(days=60)).isoformat()}
                rejected = await client.post('/tenant/subscription', json=body)
                self.assertEqual(404, rejected.status_code, rejected.text)
                body['userId'] = member['id']
                first = await client.post('/tenant/subscription', json=body)
                again = await client.post('/tenant/subscription', json=body)
                self.assertEqual(200, first.status_code, first.text)
                self.assertEqual(first.json()['id'], again.json()['id'])
                ledger = await client.get('/tenant/members/' + member['id'] + '/credits')
                self.assertEqual(4, ledger.json()['balance'])
                self.assertEqual(1, len(ledger.json()['ledger']))
                await client.post('/auth/login', json={'account': member['username'], 'password': 'member-password'})
                self.assertEqual(403, (await client.get('/tenant/members')).status_code)
        asyncio.run(run())
        self.assertEqual(1, self.conn.execute("SELECT COUNT(*) FROM admin_audit WHERE tenant_id = %s AND action = 'subscription.update'", (self.tenant,)).fetchone()[0])

    def test_existing_owner_session_initializes_saas_without_password_reentry(self):
        from geo_backend.security import new_session_material
        material = new_session_material(MASTER, datetime.now(timezone.utc))
        self.repo.create_session(self.owner, material.stored)
        self.conn.execute('DELETE FROM tenant_members WHERE user_id = %s', (self.owner,))
        async def run():
            async with self.http_client() as client:
                client.cookies.set('lxue_session', material.cookie_token)
                return await client.get('/settings')
        result = asyncio.run(run())
        self.assertEqual(200, result.status_code, result.text)
        self.assertEqual('owner', result.json().get('subscription', {}).get('role'))

    def test_orphan_account_cannot_use_legacy_path_to_clear_shared_cache(self):
        orphan = self.repo.upsert_configured_user('orphan-' + uuid.uuid4().hex, hash_password('test-password'))
        generation = self.repo.get_ima_cache_generation()
        async def run():
            async with self.http_client() as client:
                login = await client.post('/auth/login', json={'account': orphan['username'], 'password': 'test-password'})
                client.headers['x-csrf-token'] = login.json()['csrf']
                return await client.post('/ima/cache/clear', json={})
        result = asyncio.run(run())
        self.assertEqual(403, result.status_code)
        self.assertEqual(generation, self.repo.get_ima_cache_generation())

    def test_running_batch_blocks_model_change_and_second_batch(self):
        from geo_backend.errors import ApiError
        self.prepared_batch(1)
        with self.assertRaises(ApiError):
            SettingsService(self.repo, MASTER).save_model(self.owner, 'deepseek', 'primary', '', 'new-key', False)
        with self.assertRaises(ApiError):
            self.service().create(self.body(1), self.owner, datetime.now(timezone.utc) + timedelta(days=30))

    def test_expired_member_stops_before_any_provider_call(self):
        from geo_backend.errors import ApiError
        batch = self.prepared_batch(1)
        now = datetime.now(timezone.utc)
        self.repo.set_subscription(self.tenant, self.owner, now - timedelta(days=3), now - timedelta(days=1))
        calls = []
        async def model(*args, **kwargs):
            calls.append(True)
            return '# body'
        with self.assertRaises(ApiError):
            asyncio.run(self.service(model_complete=model).advance(batch['id'], {'seq': 0}, self.owner))
        self.assertEqual([], calls)

        self.assertEqual(10, self.repo.credit_balance(self.tenant, self.owner))
        self.assertEqual('cancelled', self.repo.get_batch(self.owner, batch['id'])['status'])

    def test_concurrent_create_and_refund_are_exactly_once(self):
        from concurrent.futures import ThreadPoolExecutor
        self.fund()
        body = self.body()
        def create(_):
            with self.connect() as conn:
                return BatchService(PostgresRepository(conn, MASTER), MASTER, {'clientId': 'test-client', 'apiKey': 'test-key'},
                    tenant_context=self.context).create(body, self.owner, datetime.now(timezone.utc) + timedelta(days=30))['id']
        with ThreadPoolExecutor(max_workers=2) as pool:
            ids = list(pool.map(create, range(2)))
        self.assertEqual(ids[0], ids[1])
        self.assertEqual(5, self.repo.credit_balance(self.tenant, self.owner))
        def refund(_):
            with self.connect() as conn:
                return PostgresRepository(conn, MASTER).settle_batch_incomplete(self.tenant, ids[0])
        with ThreadPoolExecutor(max_workers=2) as pool:
            list(pool.map(refund, range(2)))
        self.assertEqual(10, self.repo.credit_balance(self.tenant, self.owner))
        self.assertEqual(5, self.conn.execute("SELECT COUNT(*) FROM credit_ledger WHERE batch_id = %s AND kind = 'refund'", (ids[0],)).fetchone()[0])

    def test_stale_claim_refunds_uncertain_task_without_repeating_provider(self):
        batch = self.prepared_batch(2)
        self.repo.claim_step(batch['id'], batch['seq'])
        self.conn.execute("UPDATE batch_claims SET claimed_at = NOW() - INTERVAL '200 seconds' WHERE batch_id = %s", (batch['id'],))
        calls = []
        async def model(*args, **kwargs):
            calls.append(True)
            return '# body'
        result = asyncio.run(self.service(model_complete=model).advance(batch['id'], {'seq': 0}, self.owner))
        self.assertEqual([], calls)
        self.assertEqual('ready', result['status'])
        self.assertEqual(1, len(result['failedTasks']))
        self.assertEqual(9, self.repo.credit_balance(self.tenant, self.owner))

    def test_cancellation_refunds_unfinished_tasks_and_unlocks_model(self):
        batch = self.prepared_batch(2)
        self.service().cancel(batch['id'], self.owner)
        self.service().cancel(batch['id'], self.owner)
        self.assertEqual(10, self.repo.credit_balance(self.tenant, self.owner))
        self.assertFalse(self.repo.has_active_batch(self.owner))
        SettingsService(self.repo, MASTER).save_model(self.owner, 'deepseek', 'primary', '', 'new-key', False)

    def test_pause_and_resume_preserve_credits_snapshot_and_do_not_run_while_paused(self):
        batch = self.prepared_batch(1)
        service = self.service()
        paused = service.pause(batch['id'], self.owner)
        self.assertEqual('paused', paused['status'])
        self.assertEqual(9, self.repo.credit_balance(self.tenant, self.owner))
        self.assertTrue(self.repo.has_active_batch(self.owner))
        async def forbidden(*args, **kwargs): self.fail('Paused batch called model')
        result = asyncio.run(self.service(model_complete=forbidden).advance(batch['id'], {'seq': paused['seq']}, self.owner))
        self.assertEqual('paused', result['status'])
        resumed = service.resume(batch['id'], self.owner)
        self.assertEqual('ready', resumed['status'])
        self.assertEqual(resumed, service.resume(batch['id'], self.owner))
        self.assertEqual(9, self.repo.credit_balance(self.tenant, self.owner))

    def test_pause_during_model_call_commits_current_step_then_stops(self):
        batch = self.prepared_batch(1)
        async def model(*args, **kwargs):
            with self.connect() as other:
                service = BatchService(PostgresRepository(other, MASTER), MASTER, {}, tenant_context=self.context)
                requested = service.pause(batch['id'], self.owner)
                self.assertTrue(requested['pauseRequested'])
            return '# 完整正文\n当前调用结果不得丢失。'
        result = asyncio.run(self.service(model_complete=model).advance(batch['id'], {'seq': 0}, self.owner))
        self.assertEqual('paused', result['status'])
        self.assertEqual('audit', result['phase'])
        self.assertIn('当前调用结果不得丢失', self.repo.get_batch(self.owner, batch['id'])['draft'])
        self.assertEqual(9, self.repo.credit_balance(self.tenant, self.owner))

    def test_worker_expiry_refunds_reservation_and_finishes_job(self):
        from geo_backend.worker import BatchWorker
        batch = self.prepared_batch(1)
        self.conn.execute("UPDATE jobs SET next_run_at = NOW() + INTERVAL '1 day' WHERE batch_id <> %s", (batch['id'],))
        now = datetime.now(timezone.utc)
        self.repo.set_subscription(self.tenant, self.owner, now - timedelta(days=3), now - timedelta(days=1))
        asyncio.run(BatchWorker(self.repo, lambda job: self.service()).run_once())
        self.assertEqual(10, self.repo.credit_balance(self.tenant, self.owner))
        self.assertEqual('cancelled', self.conn.execute('SELECT status FROM jobs WHERE batch_id = %s', (batch['id'],)).fetchone()[0])

    def test_worker_stale_lease_cannot_finish_new_claim(self):
        batch = self.prepared_batch(1)
        self.conn.execute("UPDATE jobs SET next_run_at = NOW() + INTERVAL '1 day' WHERE batch_id <> %s", (batch['id'],))
        old = self.repo.claim_next_job(90)
        self.assertEqual(batch['id'], old['batchId'])
        self.conn.execute("UPDATE jobs SET lease_until = NOW() - INTERVAL '1 second' WHERE id = %s", (old['id'],))
        fresh = self.repo.claim_next_job(90)
        self.assertNotEqual(old['leaseToken'], fresh['leaseToken'])
        self.assertFalse(self.repo.finish_job(old['id'], 'completed', old['leaseToken']))
        self.assertTrue(self.repo.heartbeat_job(fresh['id'], fresh['leaseToken'], 90))
        self.assertTrue(self.repo.finish_job(fresh['id'], 'completed', fresh['leaseToken']))

    def test_worker_busy_http_step_is_requeued_not_failed(self):
        from geo_backend.worker import BatchWorker
        batch = self.prepared_batch(1)
        self.conn.execute("UPDATE jobs SET next_run_at = NOW() + INTERVAL '1 day' WHERE batch_id <> %s", (batch['id'],))
        self.repo.claim_step(batch['id'], batch['seq'])
        asyncio.run(BatchWorker(self.repo, lambda job: self.service()).run_once())
        self.assertEqual('queued', self.conn.execute('SELECT status FROM jobs WHERE batch_id = %s', (batch['id'],)).fetchone()[0])

    def test_worker_cli_once_is_executable_without_browser(self):
        import subprocess
        self.conn.execute("UPDATE jobs SET next_run_at = NOW() + INTERVAL '1 day'")
        cfg = self.config()
        env = {**os.environ, 'GEO_LOCAL_DEV': '1', 'APP_ORIGIN': cfg.app_origin,
               'GEO_ACCOUNT': cfg.geo_account, 'GEO_PASSWORD_HASH': cfg.geo_password_hash,
               'GEO_MASTER_KEY': MASTER, 'DATABASE_URL': TEST_URL,
               'PYTHONPATH': str(Path(__file__).resolve().parents[1] / 'cloud-functions'),
               'PGOPTIONS': f'-c search_path={self.schema},public'}
        result = subprocess.run([sys.executable, '-m', 'geo_backend.worker', '--once'],
            env=env, capture_output=True, text=True, timeout=15)
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertIn('idle', result.stdout)

    def test_worker_finishes_articles_without_http_driving(self):
        from geo_backend.worker import BatchWorker
        batch = self.prepared_batch(2)
        self.conn.execute("UPDATE jobs SET next_run_at = NOW() + INTERVAL '1 day' WHERE batch_id <> %s", (batch['id'],))
        async def model(model, key, messages, **kwargs):
            payload = json.loads(messages[-1]['content'])
            return '{"passed": true, "issues": []}' if 'draft' in payload else '# 零雪\n完整文章。'
        async def run():
            worker = BatchWorker(self.repo, lambda job: self.service(model_complete=model))
            for _ in range(4):
                self.assertTrue(await worker.run_once())
        asyncio.run(run())
        result = self.service().get(batch['id'], self.owner)
        self.assertEqual('completed', result['status'])
        self.assertEqual(2, len(result['articles']))
        self.assertEqual(8, self.repo.credit_balance(self.tenant, self.owner))
        self.assertEqual('completed', self.conn.execute('SELECT status FROM jobs WHERE batch_id = %s', (batch['id'],)).fetchone()[0])

    def body(self, count=5):
        return {
            'requestId': str(uuid.uuid4()),
            'rows': [['品牌名', 'GEO知识库', '问句']] + [['零雪', '品牌库', '零雪是什么？'] for _ in range(count)],
            'companies': [{'name': 'company.md', 'brand': '零雪', 'text': '零雪内容服务。'}],
        }

    def fund(self, user_id=None, amount=10):
        return self.repo.adjust_credits(self.tenant, user_id or self.owner, amount, str(uuid.uuid4()), 'grant')

    def test_batch_encryption_removes_all_plaintext_copies_and_roundtrips(self):
        batch = self.prepared_batch(1)
        batch.update(draft='仅用于加密回归的草稿', audit={'issues': ['测试审核意见']})
        self.assertTrue(self.repo.save_batch(self.owner, batch['id'], batch, batch['seq']))
        plain = self.conn.execute('SELECT state FROM batches WHERE id = %s', (batch['id'],)).fetchone()[0]
        self.assertEqual({}, plain, 'No company, evidence, rule, draft, or article copy may remain in plaintext')
        cipher = self.conn.execute('SELECT state_cipher FROM batches WHERE id = %s', (batch['id'],)).fetchone()[0]
        self.assertGreater(len(cipher), 0)
        for field in ('companies', 'rules', 'sources', 'evidenceCache', 'draft', 'audit'):
            self.assertEqual(batch[field], self.repo.get_batch(self.owner, batch['id'])[field])
        self.assertEqual(batch['id'], self.repo.list_batches(self.owner)[0]['id'])
        request_hash = self.conn.execute('SELECT request_id_hash FROM batches WHERE id = %s', (batch['id'],)).fetchone()[0]
        self.assertEqual(batch['draft'], self.repo.get_request_batch(self.owner, request_hash)['draft'])

    def test_batch_encryption_creation_does_not_persist_plaintext(self):
        self.fund()
        result = self.service().create(self.body(1), self.owner, datetime.now(timezone.utc) + timedelta(days=30))
        self.assertEqual({}, self.conn.execute('SELECT state FROM batches WHERE id = %s', (result['id'],)).fetchone()[0])

    def test_batch_encryption_old_writer_is_rejected(self):
        from psycopg.types.json import Jsonb
        batch = self.prepared_batch(1)
        with self.assertRaises(psycopg.errors.CheckViolation):
            with self.conn.transaction():
                self.conn.execute('UPDATE batches SET state = %s WHERE id = %s', (Jsonb(batch), batch['id']))
        self.assertEqual(batch['companies'], self.repo.get_batch(self.owner, batch['id'])['companies'])

    def test_batch_encryption_migrates_old_progress_once_without_losing_files(self):
        from psycopg.types.json import Jsonb
        batch = self.prepared_batch(1)
        batch['seq'] = 7
        batch['articles'] = [{'markdown': '# 历史完整文件\n必须保留', 'title': '历史输出'}]
        batch.update(status='completed', phase='done')
        with self.conn.transaction():
            # Simulate the old storage layout in this disposable schema only.
            self.conn.execute('ALTER TABLE batches DROP CONSTRAINT batches_no_plaintext_state')
            self.conn.execute('ALTER TABLE batches ALTER COLUMN state_cipher DROP NOT NULL')
            self.conn.execute('DELETE FROM schema_migrations WHERE version = 3')
            self.conn.execute("UPDATE batches SET state = %s, state_cipher = NULL, seq = 7, status = 'completed' WHERE id = %s",
                (Jsonb(batch), batch['id']))
            balance = self.repo.credit_balance(self.tenant, self.owner)
            ensure_schema(self.conn, MASTER)
            cipher = self.conn.execute('SELECT state_cipher FROM batches WHERE id = %s', (batch['id'],)).fetchone()[0]
            ensure_schema(self.conn, MASTER)
            self.assertEqual(cipher, self.conn.execute('SELECT state_cipher FROM batches WHERE id = %s', (batch['id'],)).fetchone()[0])
            self.assertEqual({}, self.conn.execute('SELECT state FROM batches WHERE id = %s', (batch['id'],)).fetchone()[0])
            restored = self.repo.get_batch(self.owner, batch['id'])
            self.assertEqual(batch, restored)
            self.assertEqual(balance, self.repo.credit_balance(self.tenant, self.owner))
            self.assertEqual(3, self.repo.health()['schemaVersion'])

    def test_batch_encryption_rejects_cross_account_and_swapped_ciphertext(self):
        from geo_backend.errors import ApiError
        batch = self.prepared_batch(1)
        other = self.repo.upsert_configured_user('other-' + uuid.uuid4().hex, hash_password('test-password'))['id']
        self.assertIsNone(self.repo.get_batch(other, batch['id']))
        self.assertEqual([], self.repo.list_batches(other))
        with self.conn.transaction():
            self.conn.execute('UPDATE batches SET user_id = %s WHERE id = %s', (other, batch['id']))
            with self.assertRaises(ApiError) as raised:
                self.repo.get_batch(other, batch['id'])
            self.assertEqual('BATCH_STATE_INVALID', raised.exception.code)

    def test_batch_encryption_wrong_key_does_not_return_plaintext_or_change_progress(self):
        batch = self.prepared_batch(1)
        with self.assertRaises(psycopg.errors.ExternalRoutineInvocationException):
            PostgresRepository(self.conn, 'b' * 64).get_batch(self.owner, batch['id'])
        self.assertEqual(batch, self.repo.get_batch(self.owner, batch['id']))
        self.assertEqual(9, self.repo.credit_balance(self.tenant, self.owner))

    def test_batch_encryption_stale_save_preserves_ciphertext_and_progress(self):
        batch = self.prepared_batch(1)
        before = self.conn.execute('SELECT state_cipher FROM batches WHERE id = %s', (batch['id'],)).fetchone()[0]
        batch['draft'] = '不应保存的过期草稿'
        self.assertFalse(self.repo.save_batch(self.owner, batch['id'], batch, batch['seq'] + 1))
        self.assertEqual(before, self.conn.execute('SELECT state_cipher FROM batches WHERE id = %s', (batch['id'],)).fetchone()[0])
        self.assertNotIn('不应保存', self.repo.get_batch(self.owner, batch['id']).get('draft', ''))

    def test_batch_encryption_default_http_factory_uses_configured_master_key(self):
        from dataclasses import replace
        from geo_backend.app import create_app
        batch = self.prepared_batch(1)
        config = replace(self.config(), database_url=TEST_URL + '&options=-csearch_path%3D' + self.schema + '%2Cpublic')
        async def run():
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=create_app(config)),
                    base_url='http://localhost', headers={'origin': 'http://localhost'}) as client:
                health = await client.get('/health')
                self.assertEqual(3, health.json()['schemaVersion'])
                self.assertTrue(health.json()['ready'])
                login = await client.post('/auth/login', json={'account': config.geo_account, 'password': 'test-password'})
                self.assertEqual(200, login.status_code)
                response = await client.get('/batches/' + batch['id'])
                self.assertEqual(200, response.status_code)
                self.assertEqual(batch['id'], response.json()['id'])
                for private_field in ('companies', 'rules', 'sources', 'evidenceCache', 'state_cipher'):
                    self.assertNotIn(private_field, response.json())
        asyncio.run(run())

    def test_legacy_unbilled_batch_can_be_cancelled_without_losing_old_articles(self):
        from geo_backend.errors import ApiError
        batch = self.prepared_batch(1)
        # v1 had no tenant, reservations, or frozen model key. Its output remains readable.
        self.repo.settle_batch_incomplete(self.tenant, batch['id'])
        self.conn.execute('DELETE FROM credit_task_states WHERE batch_id = %s', (batch['id'],))
        self.conn.execute('DELETE FROM batch_model_snapshots WHERE batch_id = %s', (batch['id'],))
        self.conn.execute('UPDATE batches SET tenant_id = NULL WHERE id = %s', (batch['id'],))
        batch.pop('tenantId', None)
        batch.pop('creditTaskIds', None)
        batch['articles'] = [{'markdown': '# v1 已完成文件', 'title': '保留旧文章'}]
        self.repo.save_batch(self.owner, batch['id'], batch, batch['seq'])
        async def forbidden(*args, **kwargs): self.fail('Legacy batch must not use mutable model credentials')
        with self.assertRaises(ApiError) as raised:
            asyncio.run(self.service(model_complete=forbidden).advance(batch['id'], {'seq': batch['seq']}, self.owner))
        self.assertEqual('LEGACY_BATCH_READONLY', raised.exception.code)
        self.service().pause(batch['id'], self.owner)
        with self.assertRaises(ApiError) as raised:
            self.service().resume(batch['id'], self.owner)
        self.assertEqual('LEGACY_BATCH_READONLY', raised.exception.code)
        result = self.service().cancel(batch['id'], self.owner)
        self.assertEqual('cancelled', result['status'])
        self.assertEqual(batch['articles'], self.service().get(batch['id'], self.owner)['articles'])
        self.assertEqual(10, self.repo.credit_balance(self.tenant, self.owner))
        self.assertFalse(self.repo.has_active_batch(self.owner))

    def test_create_reserves_credits_after_batch_exists(self):
        self.fund()
        body = self.body()
        result = self.service().create(body, self.owner, datetime.now(timezone.utc) + timedelta(days=30))
        self.assertEqual(5, self.conn.execute('SELECT COUNT(*) FROM credit_task_states WHERE batch_id = %s', (result['id'],)).fetchone()[0])
        self.assertEqual(1, self.conn.execute('SELECT COUNT(*) FROM jobs WHERE batch_id = %s', (result['id'],)).fetchone()[0])
        self.service().create(body, self.owner, datetime.now(timezone.utc) + timedelta(days=30))
        self.assertEqual(5, self.conn.execute('SELECT COUNT(*) FROM credit_ledger WHERE batch_id = %s', (result['id'],)).fetchone()[0])

    def test_members_have_separate_balances_and_debits(self):
        now = datetime.now(timezone.utc)
        member = self.repo.create_member(tenant_id=self.tenant, username='member-' + uuid.uuid4().hex, password_hash=hash_password('test-password'), role='member', starts_at=now, expires_at=now + timedelta(days=30))
        self.fund(self.owner, 10)
        self.fund(member['id'], 3)
        self.assertEqual(10, self.repo.credit_balance(self.tenant, self.owner))
        self.assertEqual(3, self.repo.credit_balance(self.tenant, member['id']))

    def test_failed_create_leaves_no_batch_job_or_charge(self):
        from geo_backend.errors import ApiError
        with self.assertRaises(ApiError):
            self.service().create(self.body(), self.owner, datetime.now(timezone.utc) + timedelta(days=30))
        self.assertEqual(0, self.conn.execute('SELECT COUNT(*) FROM batches WHERE user_id = %s', (self.owner,)).fetchone()[0])

    def test_refund_after_explicit_retry_is_a_new_balanced_ledger_transition(self):
        self.fund()
        batch = self.service().create(self.body(1), self.owner, datetime.now(timezone.utc) + timedelta(days=30))
        for _ in range(2):
            self.repo.settle_batch_incomplete(self.tenant, batch['id'])
            self.repo.settle_batch_incomplete(self.tenant, batch['id'])
            self.repo.reopen_batch_credits(self.tenant, self.owner, batch['id'])
        self.repo.settle_batch_incomplete(self.tenant, batch['id'])
        self.assertEqual(0, self.conn.execute('SELECT SUM(amount) FROM credit_ledger WHERE batch_id = %s', (batch['id'],)).fetchone()[0])

    def test_revoke_credits_uses_existing_balance(self):
        self.fund(amount=10)
        result = self.repo.adjust_credits(self.tenant, self.owner, 3, str(uuid.uuid4()), 'revoke')
        self.assertEqual(7, result['balance'])

    def test_long_ima_query_is_cached_without_database_length_error(self):
        from geo_backend.ima import ImaCache
        calls = []
        async def upstream():
            calls.append(True)
            return {'text': 'cached evidence'}
        async def run():
            cache = ImaCache(self.repo, MASTER)
            query = {'knowledgeBaseId': 'KB-AbC', 'query': '查询资料 ' * 180}
            await cache.get_or_fetch('search', query, upstream)
            return await cache.get_or_fetch('search', query, upstream)
        self.assertEqual({'text': 'cached evidence'}, asyncio.run(run()))
        self.assertEqual(1, len(calls))

    def test_pinned_cache_survives_explicit_clear_and_new_generation_write(self):
        from geo_backend.ima import ImaCache
        async def run():
            generation = self.repo.get_ima_cache_generation()
            pinned = ImaCache(self.repo, MASTER, generation=generation)
            request = {'mediaId': uuid.uuid4().hex}
            async def old(): return {'text': 'old'}
            async def new(): return {'text': 'new'}
            async def forbidden(): self.fail('A running batch must retain its pinned cache')
            await pinned.get_or_fetch('media', request, old)
            self.repo.clear_ima_cache_generation(self.owner)
            await ImaCache(self.repo, MASTER).get_or_fetch('media', request, new)
            self.assertEqual({'text': 'old'}, await pinned.get_or_fetch('media', request, forbidden))
        asyncio.run(run())

    def test_full_ima_pipeline_shares_cache_but_uses_each_members_own_model_key(self):
        now = datetime.now(timezone.utc)
        member = self.repo.create_member(tenant_id=self.tenant, username='cache-' + uuid.uuid4().hex,
            password_hash=hash_password('member-password'), role='member', starts_at=now, expires_at=now + timedelta(days=30))
        SettingsService(self.repo, MASTER).save_model(member['id'], 'qwen', 'primary', '', 'member-model-key', False)
        self.fund(amount=3)
        self.fund(member['id'], 3)
        # Unique generation avoids fixture data from other tests without changing production data.
        self.repo.clear_ima_cache_generation(self.owner)
        upstream, model_keys = [], []
        def handler(request):
            upstream.append(str(request.url))
            if request.method == 'GET':
                self.assertNotIn('ima-openapi-apikey', request.headers)
                return httpx.Response(200, text='# 完整资料\n零雪提供内容服务。')
            self.assertEqual('ima.qq.com', request.url.host)
            payload = json.loads(request.content)
            path = request.url.path.rsplit('/', 1)[-1]
            if path == 'search_knowledge_base':
                self.assertEqual({'query', 'cursor', 'limit'}, set(payload))
                data = {'info_list': [{'id': 'KB-Copilot', 'name': 'copilot'}, {'id': 'KB-Brand', 'name': '品牌库'}], 'is_end': True}
            elif path == 'get_knowledge_list':
                self.assertEqual('KB-Copilot', payload['knowledge_base_id'])
                folder = payload.get('folder_id', '')
                files = {
                    '': [{'folder_id': 'folder_gen', 'name': 'geo-content-generator'},
                         {'media_id': 'folder_audit', 'title': 'geo-audit'},
                         {'folder_id': 'folder_unused', 'name': '不相关资料'},
                         {'media_id': 'memory', 'title': '零雪AI_记忆库完整档案.md'}],
                    'folder_gen': [{'media_id': 'gen', 'title': '生成规则.md'}],
                    'folder_audit': [{'media_id': 'audit', 'title': '审核规则.md'}],
                }
                self.assertIn(folder, files, 'Unrelated folders must not be fetched')
                data = {'knowledge_list': files[folder], 'is_end': True}
            elif path == 'search_knowledge':
                self.assertEqual({'knowledge_base_id', 'query', 'cursor'}, set(payload))
                self.assertEqual('KB-Brand', payload['knowledge_base_id'])
                data = {'info_list': [{'media_id': 'evidence', 'title': '品牌证据.md'}], 'is_end': True}
            elif path == 'get_media_info':
                self.assertIn(payload['media_id'], {'memory', 'gen', 'audit', 'evidence'})
                data = {'media_type': 1, 'url_info': {'url': 'https://test.cos.ap-guangzhou.myqcloud.com/' + payload['media_id'] + '.md'}}
            else:
                self.fail('Unexpected IMA call ' + path)
            return httpx.Response(200, json={'code': 0, 'data': data})
        async def model(model, key, messages, **kwargs):
            model_keys.append(key)
            payload = json.loads(messages[-1]['content'])
            self.assertTrue(payload['knowledgeEvidence'])
            return '{"passed":true,"issues":[]}' if 'draft' in payload else '# 零雪完整文章\n有依据的完整正文。'
        async def run():
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
                for user in (self.owner, member['id']):
                    before = len(upstream)
                    context = self.repo.get_tenant_context(user, now)
                    service = BatchService(self.repo, MASTER, {'clientId': 'test-client', 'apiKey': 'test-ima'},
                        tenant_context=context, client=client, model_complete=model)
                    result = service.create(self.body(1), user, now + timedelta(days=30))
                    for _ in range(30):
                        if result['status'] != 'ready': break
                        result = await service.advance(result['id'], {'seq': result['seq']}, user)
                    self.assertEqual('completed', result['status'], result)
                    self.assertEqual(1, result['completed'], result)
                    self.assertEqual([], result['failedTasks'])
                    if user == member['id']:
                        self.assertEqual(before, len(upstream), 'Second user must reuse site-wide IMA data')
                    self.assertEqual(2, self.repo.credit_balance(self.tenant, user))
                    self.assertEqual(1, self.conn.execute('SELECT COUNT(*) FROM article_artifacts WHERE batch_id = %s', (result['id'],)).fetchone()[0])
        asyncio.run(run())
        self.assertEqual(['test-model-key'] * 2 + ['member-model-key'] * 2, model_keys)

    def test_cache_contention_does_not_fail_or_refund_task(self):
        from geo_backend.errors import ApiError
        from unittest.mock import patch
        batch = self.prepared_batch(1)
        batch.update(phase='search', sourceCandidates=[], cursor='')
        batch['tasks'][0]['kbId'] = 'KB-Brand'
        self.repo.save_batch(self.owner, batch['id'], batch, batch['seq'])
        async def busy(*args, **kwargs):
            raise ApiError(503, 'Cache is being filled by another task', 'IMA_CACHE_BUSY')
        with patch('geo_backend.ima.ImaCache.get_or_fetch', busy):
            result = asyncio.run(self.service().advance(batch['id'], {'seq': 0}, self.owner))
        self.assertEqual('ready', result['status'])
        self.assertEqual('search', result['phase'])
        self.assertEqual([], result['failedTasks'])
        self.assertEqual(9, self.repo.credit_balance(self.tenant, self.owner))

    def prepared_batch(self, count=5):
        self.fund()
        body = self.body(count)
        for index, row in enumerate(body['rows'][1:]):
            row[2] = f'问题{index + 1}'
        result = self.service().create(body, self.owner, datetime.now(timezone.utc) + timedelta(days=30))
        batch = self.repo.get_batch(self.owner, result['id'])
        batch['phase'] = 'generate'
        batch['rules'] = {'generation': ['写完整文章'], 'audit': ['检查事实'], 'memory': ['零雪']}
        batch['sources'] = [{'title': '已缓存证据', 'text': '零雪内容服务'}]
        batch['evidenceCache'] = {'品牌库|' + task['question']: batch['sources'] for task in batch['tasks']}
        self.repo.save_batch(self.owner, batch['id'], batch, batch['seq'])
        return batch

    def test_one_excel_row_multiple_articles_reserves_one_credit(self):
        self.fund()
        body = self.body(2)
        body['rows'][0].append('篇数')
        body['rows'][1].append(3)
        body['rows'][2].append(1)
        result = self.service().create(body, self.owner, datetime.now(timezone.utc) + timedelta(days=30))
        self.assertEqual(4, result['total'])
        self.assertEqual(8, self.repo.credit_balance(self.tenant, self.owner))

    def test_middle_failure_finishes_remaining_rows_and_refunds_one(self):
        from geo_backend.errors import ApiError
        batch = self.prepared_batch()
        calls = []
        async def model(model, key, messages, **kwargs):
            payload = json.loads(messages[-1]['content'])
            calls.append(payload['task']['question'])
            if payload['task']['question'] == '问题2':
                raise ApiError(502, '测试供应商失败')
            return '{"passed": true, "issues": []}' if 'draft' in payload else '# 完整正文\n零雪内容服务。'
        async def run():
            service = self.service(model_complete=model)
            result = batch
            for _ in range(20):
                if result['status'] != 'ready':
                    break
                result = await service.advance(batch['id'], {'seq': result['seq']}, self.owner)
            return result
        result = asyncio.run(run())
        self.assertEqual('completed', result['status'])
        self.assertEqual(4, result['completed'])
        self.assertEqual(1, len(result['failedTasks']))
        self.assertEqual(6, self.repo.credit_balance(self.tenant, self.owner))
        self.assertEqual(1, calls.count('问题2'))
        self.assertEqual(4, self.conn.execute('SELECT COUNT(*) FROM article_artifacts WHERE batch_id = %s', (batch['id'],)).fetchone()[0])

    def test_artifact_and_state_commit_together(self):
        from geo_backend.errors import ApiError
        batch = self.prepared_batch(1)
        batch.update(phase='audit', draft='# 完整正文\n正文')
        self.repo.save_batch(self.owner, batch['id'], batch, batch['seq'])
        async def model(*args, **kwargs):
            return '{"passed": true, "issues": []}'
        self.repo.save_batch = lambda *args: False
        with self.assertRaises(ApiError):
            asyncio.run(self.service(model_complete=model).advance(batch['id'], {'seq': batch['seq']}, self.owner))
        self.assertEqual(0, self.conn.execute('SELECT COUNT(*) FROM article_artifacts WHERE batch_id = %s', (batch['id'],)).fetchone()[0])
        self.assertEqual('reserved', self.repo.task_credit_outcomes(self.tenant, batch['id'])[0]['status'])


if __name__ == '__main__':
    unittest.main()
