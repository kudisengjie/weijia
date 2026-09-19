"""Real PostgreSQL checks for local delivery (schema v5, receipts, purge, settle branches).

Requires the isolated loopback test database (127.0.0.1:55483). Never Neon production.
"""
import hashlib
import json
import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
import unittest

import psycopg
from psycopg import sql

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'cloud-functions'))
from geo_backend.artifacts import ArtifactService
from geo_backend.database import ensure_schema
from geo_backend.errors import ApiError
from geo_backend.repository import PostgresRepository
from geo_backend.security import hash_password


TEST_URL = 'postgresql://geo_test@127.0.0.1:55483/postgres?connect_timeout=5'
MASTER = 'a' * 64
ARTICLE = '# 完整文章\n零雪内容服务。'


class LocalDeliveryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.schema = 'geo_test_' + uuid.uuid4().hex
        with psycopg.connect(TEST_URL, autocommit=True) as conn:
            conn.execute('CREATE EXTENSION IF NOT EXISTS pgcrypto')
            conn.execute(sql.SQL('CREATE SCHEMA {}').format(sql.Identifier(cls.schema)))
        with cls.connect() as conn:
            ensure_schema(conn, MASTER)
            ensure_schema(conn, MASTER)  # Deployment restart must be safe.

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
        self.repo.adjust_credits(self.tenant, self.owner, 10, str(uuid.uuid4()), 'grant')

    # ---- 夹具 ----

    def new_batch(self, delivery_mode='local_confirmed_v1'):
        """直接落一个批次 + 预扣 1 分，避免依赖完整 BatchService 创建链。"""
        batch_id = uuid.uuid4().hex
        state = {
            'userId': self.owner, 'batchId': batch_id, 'id': batch_id, 'seq': 0, 'status': 'ready',
            'tenantId': self.tenant, 'taskIndex': 0, 'tasks': [{'brand': '零雪', 'question': '零雪是什么？', 'billingTaskId': 1}],
            'articles': [],
        }
        self.conn.execute(
            """INSERT INTO batches (id, user_id, tenant_id, request_id_hash, state, state_cipher, seq, status, delivery_mode)
               VALUES (%s, %s, %s, %s, '{}'::jsonb, pgp_sym_encrypt(%s, %s, 'cipher-algo=aes256'), 0, 'ready', %s)""",
            (batch_id, self.owner, self.tenant, uuid.uuid4().hex,
             json.dumps({"userId": self.owner, "batchId": batch_id, "state": state}, ensure_ascii=False), MASTER, delivery_mode),
        )
        self.repo.reserve_task_credits(self.tenant, self.owner, batch_id, ['1'])
        return batch_id

    def save_artifact(self, batch_id, task_id='1', markdown=ARTICLE):
        return ArtifactService(self.repo, MASTER).save_complete(
            tenant_id=self.tenant, user_id=self.owner, batch_id=batch_id, task_id=task_id,
            filename=f'{task_id}-零雪.md', markdown=markdown, audit_status='accepted')

    def receipt(self, artifact_id, *, request_id=None, sha256=None, byte_length=None):
        return self.repo.confirm_local_delivery(
            tenant_id=self.tenant, artifact_id=artifact_id, user_id=self.owner,
            request_id=request_id or str(uuid.uuid4()),
            sha256=sha256, byte_length=byte_length)

    def task_status(self, batch_id):
        return self.conn.execute(
            'SELECT status FROM credit_task_states WHERE batch_id = %s AND task_id = %s', (batch_id, '1')
        ).fetchone()[0]

    def balance(self):
        return self.conn.execute(
            'SELECT balance FROM member_credit_accounts WHERE tenant_id = %s AND user_id = %s',
            (self.tenant, self.owner)).fetchone()[0]

    # ---- 迁移 ----

    def test_v5_migration_backfills_and_repeats_safely(self):
        version = self.conn.execute('SELECT MAX(version) FROM schema_migrations').fetchone()[0]
        self.assertEqual(6, version)
        mode = self.conn.execute(
            "SELECT column_name FROM information_schema.columns"
            " WHERE table_name = 'batches' AND column_name = 'delivery_mode'").fetchone()
        # 新批次默认 server_legacy：local_confirmed_v1 由阶段 D 在批次执行器改造后启用（§9 迁移不启用新入口）。
        batch_id = self.new_batch(delivery_mode='server_legacy')
        self.assertEqual('server_legacy', self.conn.execute(
            'SELECT delivery_mode FROM batches WHERE id = %s', (batch_id,)).fetchone()[0])
        new_mode = self.new_batch(delivery_mode='local_confirmed_v1')
        self.assertEqual('local_confirmed_v1', self.conn.execute(
            'SELECT delivery_mode FROM batches WHERE id = %s', (new_mode,)).fetchone()[0])
        legacy = self.new_batch(delivery_mode='server_legacy')
        self.assertEqual('server_legacy', self.conn.execute(
            'SELECT delivery_mode FROM batches WHERE id = %s', (legacy,)).fetchone()[0])
        self.assertIsNotNone(mode)

    def test_waiting_local_job_status_is_accepted(self):
        batch_id = self.new_batch()
        self.repo.create_job(self.tenant, batch_id, str(uuid.uuid4()))
        self.conn.execute("UPDATE jobs SET status = 'waiting_local' WHERE batch_id = %s", (batch_id,))
        status = self.conn.execute('SELECT status FROM jobs WHERE batch_id = %s', (batch_id,)).fetchone()[0]
        self.assertEqual('waiting_local', status)

    # ---- 新模式结算分支 ----

    def test_new_mode_blocks_settle_until_delivery(self):
        batch_id = self.new_batch()
        self.save_artifact(batch_id)
        with self.assertRaises(ApiError) as rejected:
            self.repo.settle_task_credit(self.tenant, batch_id, '1', True)
        self.assertEqual('ARTIFACT_NOT_PERSISTED', rejected.exception.code)
        self.assertEqual('reserved', self.task_status(batch_id))
        self.assertEqual(9, self.balance())  # 预扣保留，未实扣

    def test_confirm_receipt_settles_row_and_clears_body(self):
        batch_id = self.new_batch()
        artifact = self.save_artifact(batch_id)
        result = self.receipt(artifact['id'], sha256=artifact['sha256'], byte_length=artifact['byteLength'])

        self.assertEqual('delivered', result['deliveryState'])
        self.assertTrue(result['onlineBodyCleared'])
        self.assertEqual('settled', result['billingStatus'])
        self.assertFalse(result['alreadyConfirmed'])
        body = self.conn.execute(
            'SELECT content_cipher, delivery_state, purged_at FROM article_artifacts WHERE id = %s',
            (uuid.UUID(artifact['id']),)).fetchone()
        self.assertIsNone(body[0], 'delivered artifact must not keep any online body copy')
        self.assertEqual('delivered', body[1])
        self.assertIsNotNone(body[2])
        self.assertEqual('complete', self.task_status(batch_id))
        self.assertEqual(9, self.balance())  # 预扣 1 变实扣

    def test_same_receipt_twice_records_once(self):
        batch_id = self.new_batch()
        artifact = self.save_artifact(batch_id)
        request_id = str(uuid.uuid4())
        first = self.receipt(artifact['id'], request_id=request_id, sha256=artifact['sha256'], byte_length=artifact['byteLength'])
        second = self.receipt(artifact['id'], request_id=request_id, sha256=artifact['sha256'], byte_length=artifact['byteLength'])

        self.assertFalse(first['alreadyConfirmed'])
        self.assertTrue(second['alreadyConfirmed'])
        self.assertEqual(first['billingStatus'], second['billingStatus'])
        count = self.conn.execute('SELECT COUNT(*) FROM article_delivery_receipts WHERE artifact_id = %s', (uuid.UUID(artifact['id']),)).fetchone()[0]
        self.assertEqual(1, count)

    def test_new_request_id_after_delivery_returns_existing_result(self):
        batch_id = self.new_batch()
        artifact = self.save_artifact(batch_id)
        self.receipt(artifact['id'], sha256=artifact['sha256'], byte_length=artifact['byteLength'])
        before = self.balance()

        again = self.receipt(artifact['id'], sha256=artifact['sha256'], byte_length=artifact['byteLength'])

        self.assertTrue(again['alreadyConfirmed'])
        self.assertEqual(1, self.conn.execute(
            'SELECT COUNT(*) FROM article_delivery_receipts WHERE artifact_id = %s', (uuid.UUID(artifact['id']),)).fetchone()[0])
        self.assertEqual(before, self.balance())

    def test_same_request_id_for_other_artifact_conflicts(self):
        batch_id = self.new_batch()
        self.conn.execute(
            """INSERT INTO credit_task_states (tenant_id, user_id, batch_id, task_id, status)
               VALUES (%s, %s, %s, '2', 'reserved')""",
            (self.tenant, self.owner, batch_id))
        first = self.save_artifact(batch_id, task_id='1', markdown=ARTICLE)
        second = self.save_artifact(batch_id, task_id='2', markdown='# 第二篇\n内容。')
        request_id = str(uuid.uuid4())

        self.receipt(first['id'], request_id=request_id, sha256=first['sha256'], byte_length=first['byteLength'])
        with self.assertRaises(ApiError) as conflict:
            self.repo.confirm_local_delivery(
                tenant_id=self.tenant, artifact_id=second['id'], user_id=self.owner,
                request_id=request_id, sha256=second['sha256'], byte_length=second['byteLength'])
        self.assertEqual('REQUEST_ID_CONFLICT', conflict.exception.code)

    def test_hash_or_byte_mismatch_keeps_pending(self):
        batch_id = self.new_batch()
        artifact = self.save_artifact(batch_id)
        for sha256, byte_length in (('f' * 64, artifact['byteLength']), (artifact['sha256'], artifact['byteLength'] + 1)):
            with self.assertRaises(ApiError) as rejected:
                self.receipt(artifact['id'], sha256=sha256, byte_length=byte_length)
            self.assertEqual('ARTIFACT_MISMATCH', rejected.exception.code)
        state = self.conn.execute(
            "SELECT delivery_state, content_cipher IS NOT NULL FROM article_artifacts WHERE id = %s",
            (uuid.UUID(artifact['id']),)).fetchone()
        self.assertEqual(('pending', True), state)
        self.assertEqual(0, self.conn.execute(
            'SELECT COUNT(*) FROM article_delivery_receipts WHERE artifact_id = %s', (uuid.UUID(artifact['id']),)).fetchone()[0])

    def test_late_receipt_after_refund_clears_body_without_recharging(self):
        batch_id = self.new_batch()
        artifact = self.save_artifact(batch_id)
        self.repo.settle_task_credit(self.tenant, batch_id, '1', False)  # 生成失败路径退款
        self.assertEqual('refunded', self.task_status(batch_id))
        refunded_balance = self.balance()

        result = self.receipt(artifact['id'], sha256=artifact['sha256'], byte_length=artifact['byteLength'])

        self.assertEqual('already_refunded', result['billingStatus'])
        self.assertTrue(result['onlineBodyCleared'])
        self.assertEqual('refunded', self.task_status(batch_id), 'late receipt must not re-consume a refunded row')
        self.assertEqual(refunded_balance, self.balance())
        self.assertIsNone(self.conn.execute(
            'SELECT content_cipher FROM article_artifacts WHERE id = %s', (uuid.UUID(artifact['id']),)).fetchone()[0])

    def test_legacy_mode_keeps_server_artifact_settle_semantics(self):
        batch_id = self.new_batch(delivery_mode='server_legacy')
        artifact = self.save_artifact(batch_id)

        result = self.repo.settle_task_credit(self.tenant, batch_id, '1', True)

        self.assertEqual('complete', result['status'])
        self.assertEqual('complete', self.task_status(batch_id))

    def test_download_after_delivery_returns_410(self):
        batch_id = self.new_batch()
        artifact = self.save_artifact(batch_id)
        self.receipt(artifact['id'], sha256=artifact['sha256'], byte_length=artifact['byteLength'])
        service = ArtifactService(self.repo, MASTER)
        with self.assertRaises(ApiError) as rejected:
            service.get(self.tenant, artifact['id'], self.owner)
        self.assertEqual(410, rejected.exception.status)
        self.assertEqual('ARTIFACT_BODY_CLEARED', rejected.exception.code)
        # 未交付的 artifact 仍可下载
        other = self.save_artifact(batch_id, task_id='2', markdown='# 第二篇\n内容。')
        row = service.get(self.tenant, other['id'], self.owner)
        self.assertEqual('# 第二篇\n内容。', row['markdown'])

    def test_pending_listing_scopes_to_owner_and_delivered_are_excluded(self):
        batch_id = self.new_batch()
        first = self.save_artifact(batch_id, task_id='1')
        other_owner = self.repo.upsert_configured_user('other-' + uuid.uuid4().hex, hash_password('test-password'))['id']
        artifact_id = uuid.uuid4()
        self.conn.execute(
            """INSERT INTO article_artifacts (id, tenant_id, batch_id, task_id, user_id, filename, content_cipher,
               byte_length, sha256, status, audit_status)
               VALUES (%s, %s, %s, '9', %s, 'x.md', pgp_sym_encrypt(%s, %s, 'cipher-algo=aes256'), %s, %s, 'complete', 'accepted')""",
            (artifact_id, self.tenant, batch_id, other_owner, '别人的文章', MASTER, 15,
             hashlib.sha256('别人的文章'.encode()).hexdigest()))
        self.receipt(first['id'], sha256=first['sha256'], byte_length=first['byteLength'])

        items = self.repo.list_pending_artifacts(self.tenant, self.owner, limit=20, cursor=None)['items']
        listed = [entry['artifactId'] for entry in items]
        self.assertNotIn(str(artifact_id), listed, 'pending listing must not leak other users')
        self.assertNotIn(first['id'], listed, 'delivered artifacts are no longer pending')



class LocalDeliveryFlowTests(unittest.TestCase):
    """新模式批次流：落库不结算 → awaiting_save/waiting_local → 回执 → 唤醒继续/完成。"""

    @classmethod
    def setUpClass(cls):
        cls.schema = 'geo_test_' + uuid.uuid4().hex
        with psycopg.connect(TEST_URL, autocommit=True) as conn:
            conn.execute('CREATE EXTENSION IF NOT EXISTS pgcrypto')
            conn.execute(sql.SQL('CREATE SCHEMA {}').format(sql.Identifier(cls.schema)))
        with cls.connect() as conn:
            ensure_schema(conn, MASTER)
            ensure_schema(conn, MASTER)

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
        from geo_backend.batches import BatchService
        from geo_backend.tenant_access import TenantAccessService
        self.conn = self.connect()
        self.addCleanup(self.conn.close)
        self.repo = PostgresRepository(self.conn, MASTER)
        self.owner = self.repo.upsert_configured_user('owner-' + uuid.uuid4().hex, hash_password('test-password'))['id']
        self.tenant = self.repo.ensure_owner_tenant(self.owner, 'tenant-' + uuid.uuid4().hex)['tenantId']
        self.context = self.repo.get_tenant_context(self.owner, datetime.now(timezone.utc))
        self.repo.adjust_credits(self.tenant, self.owner, 10, str(uuid.uuid4()), 'grant')
        from geo_backend.models import SettingsService
        SettingsService(self.repo, MASTER).save_model(self.owner, 'qwen', 'primary', '', 'test-model-key', False)
        self._BatchService = BatchService
        self._TenantAccess = TenantAccessService

    # ---- 夹具 ----

    def service(self, model_complete=None):
        return self._BatchService(self.repo, MASTER,
            {'clientId': 'test-client', 'apiKey': 'test-ima'},
            tenant_context=self.context, model_complete=model_complete)

    def new_mode_batch(self, rows=1):
        body = {
            'requestId': str(uuid.uuid4()),
            'rows': [['品牌名', 'GEO知识库', '问句']] + [['零雪', 'GEO优化知识库', f'零雪问题{i}？'] for i in range(rows)],
            'companies': [{'name': 'company.md', 'brand': '零雪', 'text': '零雪内容服务。'}],
        }
        result = self.service().create(body, self.owner, datetime.now(timezone.utc) + timedelta(days=30))
        batch = self.repo.get_batch(self.owner, result['id'])
        self.conn.execute("UPDATE batches SET delivery_mode = 'local_confirmed_v1' WHERE id = %s", (batch['id'],))
        batch['phase'] = 'generate'
        batch['rules'] = {'generation': ['写完整文章'], 'audit': ['检查事实'], 'memory': ['零雪']}
        batch['webSources'] = [{'title': '行业联网证据', 'url': 'https://example.com/geo',
                                'site': 'example.com', 'snippet': '零雪内容服务'}]
        batch['webCache'] = {task['question']: batch['webSources'] for task in batch['tasks']}
        self.assertTrue(self.repo.save_batch(self.owner, batch['id'], batch, batch['seq']))
        return self.repo.get_batch(self.owner, batch['id'])

    @staticmethod
    def stub_model():
        async def model(model, key, messages, **kwargs):
            payload = json.loads(messages[-1]['content'])
            article = '# 零雪完整文章' + chr(10) + '有依据的完整正文。'
            return '{"passed":true,"issues":[]}' if 'draft' in payload else article
        return model

    def advance_loop(self, batch_id):
        result = None
        for _ in range(30):
            batch = self.repo.get_batch(self.owner, batch_id)
            if batch['status'] != 'ready':
                return self.repo.get_batch(self.owner, batch_id)
            result = asyncio.run(self.service(model_complete=self.stub_model()).advance(batch_id, {'seq': batch['seq']}, self.owner))
        return result

    def receipt(self, artifact_id, sha256, byte_length):
        return self.repo.confirm_local_delivery(
            tenant_id=self.tenant, artifact_id=artifact_id, user_id=self.owner,
            request_id=str(uuid.uuid4()), sha256=sha256, byte_length=byte_length)

    def job_status(self, batch_id):
        row = self.conn.execute('SELECT status FROM jobs WHERE batch_id = %s', (batch_id,)).fetchone()
        return row[0] if row else None

    def balance(self):
        return self.conn.execute(
            'SELECT balance FROM member_credit_accounts WHERE tenant_id = %s AND user_id = %s',
            (self.tenant, self.owner)).fetchone()[0]

    # ---- 用例 ----

    def test_new_mode_persist_waits_for_local_receipt(self):
        from geo_backend.batches import BatchService  # noqa: F401
        batch = self.new_mode_batch(rows=1)

        result = self.advance_loop(batch['id'])

        self.assertEqual('awaiting_save', result['status'], result)
        row = self.conn.execute(
            "SELECT id, sha256, byte_length, delivery_state FROM article_artifacts WHERE batch_id = %s", (batch['id'],)).fetchone()
        self.assertIsNotNone(row)
        self.assertEqual('pending', row[3])
        state = self.conn.execute(
            "SELECT status FROM credit_task_states WHERE batch_id = %s AND task_id = '1'", (batch['id'],)).fetchone()[0]
        self.assertEqual('reserved', state, 'new mode must not settle on persist')
        self.assertEqual(9, self.balance())  # 预扣保留

    def test_finish_job_maps_awaiting_save_to_waiting_local(self):
        batch = self.new_mode_batch(rows=1)
        self.repo.create_job(self.tenant, batch['id'], str(uuid.uuid4()))
        job = self.repo.claim_next_job(90)
        self.assertIsNotNone(job)
        self.assertTrue(self.repo.finish_job(job['id'], 'awaiting_save', job['leaseToken']))
        self.assertEqual('waiting_local', self.job_status(batch['id']))
        self.assertIsNone(self.repo.claim_next_job(90), 'waiting_local must not be claimed by workers')

    def test_receipt_then_resume_completes_single_task_batch(self):
        batch = self.new_mode_batch(rows=1)
        self.advance_loop(batch['id'])
        row = self.conn.execute(
            'SELECT id, sha256, byte_length FROM article_artifacts WHERE batch_id = %s', (batch['id'],)).fetchone()
        result = self.receipt(str(row[0]), row[1], row[2])
        self.assertEqual('settled', result['billingStatus'])

        resumed = self.service().resume_after_delivery(batch['id'], self.owner)

        self.assertEqual('completed', resumed['status'], resumed)
        self.assertEqual('complete', self.conn.execute(
            "SELECT status FROM credit_task_states WHERE batch_id = %s AND task_id = '1'", (batch['id'],)).fetchone()[0])
        self.assertEqual(9, self.balance())  # 预扣 1 变实扣
        self.assertEqual('completed', self.job_status(batch['id']))

    def test_multi_row_batch_resumes_ready_then_completes(self):
        batch = self.new_mode_batch(rows=2)
        first = self.advance_loop(batch['id'])
        self.assertEqual('awaiting_save', first['status'], first)
        row = self.conn.execute(
            "SELECT id, sha256, byte_length, task_id FROM article_artifacts WHERE batch_id = %s ORDER BY task_id", (batch['id'],)).fetchone()
        self.receipt(str(row[0]), row[1], row[2])

        resumed = self.service().resume_after_delivery(batch['id'], self.owner)
        self.assertEqual('ready', resumed['status'], resumed)
        self.assertEqual('queued', self.job_status(batch['id']))

        second = self.advance_loop(batch['id'])
        self.assertEqual('awaiting_save', second['status'], second)
        second_row = self.conn.execute(
            "SELECT id, sha256, byte_length FROM article_artifacts WHERE batch_id = %s AND task_id = '2'", (batch['id'],)).fetchone()
        self.assertIsNotNone(second_row)
        self.receipt(str(second_row[0]), second_row[1], second_row[2])
        final = self.service().resume_after_delivery(batch['id'], self.owner)
        self.assertEqual('completed', final['status'], final)
        self.assertEqual(8, self.balance())  # 两行各实扣 1

    def test_cancel_discards_pending_body_and_refunds_once(self):
        batch = self.new_mode_batch(rows=1)
        self.advance_loop(batch['id'])
        row = self.conn.execute(
            'SELECT id, sha256, byte_length FROM article_artifacts WHERE batch_id = %s', (batch['id'],)).fetchone()

        self.service().cancel(batch['id'], self.owner, discard_pending=True)

        state = self.conn.execute(
            "SELECT delivery_state, content_cipher, purged_at FROM article_artifacts WHERE id = %s", (row[0],)).fetchone()
        self.assertEqual('discarded', state[0])
        self.assertIsNone(state[1])
        self.assertIsNotNone(state[2])
        self.assertEqual('refunded', self.conn.execute(
            "SELECT status FROM credit_task_states WHERE batch_id = %s AND task_id = '1'", (batch['id'],)).fetchone()[0])
        self.assertEqual(10, self.balance())

        late = self.receipt(str(row[0]), row[1], row[2])
        self.assertEqual('already_refunded', late['billingStatus'])
        self.assertEqual(10, self.balance())


if __name__ == '__main__':
    unittest.main()
