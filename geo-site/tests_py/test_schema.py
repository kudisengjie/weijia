import sys
import unittest
from pathlib import Path


FUNCTIONS_DIR = Path(__file__).resolve().parents[1] / "cloud-functions"
sys.path.insert(0, str(FUNCTIONS_DIR))


class SchemaTests(unittest.TestCase):
    def test_schema_v2_contains_saas_runtime_tables(self):
        from geo_backend.schema import SCHEMA_SQL, SCHEMA_VERSION

        self.assertEqual(2, SCHEMA_VERSION)
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


if __name__ == "__main__":
    unittest.main()
