import sys
import unittest
from pathlib import Path


FUNCTIONS_DIR = Path(__file__).resolve().parents[1] / "cloud-functions"
sys.path.insert(0, str(FUNCTIONS_DIR))


class SchemaTests(unittest.TestCase):
    def test_schema_v7_contains_saas_runtime_tables(self):
        from geo_backend.schema import SCHEMA_SQL, SCHEMA_VERSION

        self.assertEqual(7, SCHEMA_VERSION)
        for table in (
            "tenants",
            "tenant_members",
            "subscriptions",
            "credit_accounts",
            "credit_ledger",
            "credit_task_states",
            "ima_cache_meta",
            "ima_knowledge_bases",
            "ima_rule_documents",
            "ima_search_cache",
            "ima_media_cache",
            "ima_cache_locks",
            "batch_model_snapshots",
            "article_artifacts",
            "jobs",
            "workspaces",
            "question_reports",
        ):
            self.assertIn(f"CREATE TABLE IF NOT EXISTS {table}", SCHEMA_SQL)

    def test_schema_v2_has_credit_and_artifact_invariants(self):
        from geo_backend.schema import SCHEMA_SQL

        self.assertIn("UNIQUE (tenant_id, idempotency_key)", SCHEMA_SQL)
        self.assertIn("CHECK (amount <> 0)", SCHEMA_SQL)
        self.assertIn("CHECK (byte_length > 0)", SCHEMA_SQL)
        self.assertIn("CHECK (expires_at > starts_at)", SCHEMA_SQL)

    def test_schema_contains_durable_runtime_tables(self):
        from geo_backend.schema import SCHEMA_SQL

        for table in (
            "schema_migrations",
            "users",
            "sessions",
            "login_attempts",
            "model_settings",
            "ima_settings",
            "batches",
            "batch_claims",
        ):
            self.assertIn(f"CREATE TABLE IF NOT EXISTS {table}", SCHEMA_SQL)

    def test_schema_enforces_batch_idempotency_and_encrypted_secrets(self):
        from geo_backend.schema import SCHEMA_SQL

        self.assertIn("PRIMARY KEY (batch_id, seq)", SCHEMA_SQL)
        self.assertIn("api_key_cipher BYTEA", SCHEMA_SQL)
        self.assertIn("credentials_cipher BYTEA", SCHEMA_SQL)
        self.assertNotIn("api_key TEXT", SCHEMA_SQL)

    def test_schema_v5_contains_local_delivery_structure(self):
        from geo_backend.schema import SCHEMA_SQL

        # 交付回执：唯一 artifact + user+request 幂等。
        self.assertIn("CREATE TABLE IF NOT EXISTS article_delivery_receipts", SCHEMA_SQL)
        self.assertIn("UNIQUE (tenant_id, user_id, request_id)", SCHEMA_SQL)
        # 正文一致性：pending 必须有密文，delivered/discarded 必须已清密文。
        self.assertIn("article_artifacts_body_state_check", SCHEMA_SQL)
        self.assertIn("delivery_state = 'pending' AND content_cipher IS NOT NULL", SCHEMA_SQL)
        self.assertIn("ALTER TABLE article_artifacts ALTER COLUMN content_cipher DROP NOT NULL", SCHEMA_SQL)
        # 批次交付模式 + Worker 等待本地保存状态 + 待交付索引。
        self.assertIn("delivery_mode VARCHAR(32) NOT NULL DEFAULT 'server_legacy'", SCHEMA_SQL)
        self.assertIn("'waiting_local'", SCHEMA_SQL)
        self.assertIn("article_artifacts_pending_idx", SCHEMA_SQL)

    def test_schema_v7_question_reports_are_encrypted(self):
        from geo_backend.schema import SCHEMA_SQL

        # 问句存储：内容必须走 pgp 加密存储，不允许明文落库。
        self.assertIn("CREATE TABLE IF NOT EXISTS question_reports", SCHEMA_SQL)
        self.assertIn("payload_cipher BYTEA NOT NULL", SCHEMA_SQL)
        self.assertNotIn("payload TEXT", SCHEMA_SQL)


if __name__ == "__main__":
    unittest.main()
