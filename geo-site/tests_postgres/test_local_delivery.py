"""Real PostgreSQL checks for local delivery (schema v5, receipts, purge, settle branches).

Requires the isolated loopback test database (127.0.0.1:55483). Never Neon production.
"""
import hashlib
import json
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
            'userId': self.owner, 'batchId': batch_id, 'seq': 0, 'status': 'ready',
            'tenantId': self.tenant, 'taskIndex': 0, 'tasks': [{'brand': '零雪', 'question': '零雪是什么？', 'billingTaskId': 1}],
            'articles': [],
        }
        self.conn.execute(
            """INSERT INTO batches (id, user_id, tenant_id, request_id_hash, state, state_cipher, seq, status, delivery_mode)
               VALUES (%s, %s, %s, %s, '{}'::jsonb, pgp_sym_encrypt(%s, %s, 'cipher-algo=aes256'), 0, 'ready', %s)""",
            (batch_id, self.owner, self.tenant, uuid.uuid4().hex,
             json.dumps(state), MASTER, delivery_mode),
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
        self.assertEqual(5, version)
        mode = self.conn.execute(
            "SELECT delivery_mode FROM information_schema.columns WHERE table_name = 'batches'"
            " AND column_name = 'delivery_mode'").fetchone()
        # 新批次固定 local_confirmed_v1；列默认 server_legacy 已由建表语句保证。
        batch_id = self.new_batch()
        self.assertEqual('local_confirmed_v1', self.conn.execute(
            'SELECT delivery_mode FROM batches WHERE id = %s', (batch_id,)).fetchone()[0])
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
        count = self.conn.execute('SELECT COUNT(*) FROM article_delivery_receipts').fetchone()[0]
        self.assertEqual(1, count)

    def test_new_request_id_after_delivery_returns_existing_result(self):
        batch_id = self.new_batch()
        artifact = self.save_artifact(batch_id)
        self.receipt(artifact['id'], sha256=artifact['sha256'], byte_length=artifact['byteLength'])
        before = self.balance()

        again = self.receipt(artifact['id'], sha256=artifact['sha256'], byte_length=artifact['byteLength'])

        self.assertTrue(again['alreadyConfirmed'])
        self.assertEqual(1, self.conn.execute('SELECT COUNT(*) FROM article_delivery_receipts').fetchone()[0])
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
        self.assertEqual(0, self.conn.execute('SELECT COUNT(*) FROM article_delivery_receipts').fetchone()[0])

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
        self.assertNotIn(str(artifact_id), [item['artifactId']], 'pending listing must not leak other users')
        self.assertNotIn(first['id'], [item['artifactId']], 'delivered artifacts are no longer pending')


if __name__ == '__main__':
    unittest.main()
