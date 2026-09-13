import sys
import unittest
from pathlib import Path


FUNCTIONS_DIR = Path(__file__).resolve().parents[1] / "cloud-functions"
sys.path.insert(0, str(FUNCTIONS_DIR))


class SettingsTests(unittest.TestCase):
    def test_required_configuration_includes_database_url(self):
        from geo_backend.config import Settings

        settings = Settings.from_mapping({})

        self.assertIn("DATABASE_URL", settings.missing)

    def test_existing_edgeone_variables_remain_compatible(self):
        from geo_backend.config import Settings

        settings = Settings.from_mapping(
            {
                "APP_ORIGIN": "https://geo.example.test",
                "GEO_ACCOUNT": "owner",
                "GEO_PASSWORD_HASH": f"scrypt:{'a' * 32}:{'b' * 128}",
                "GEO_MASTER_KEY": "c" * 64,
                "IMA_ADMIN_SECRET": "d" * 32,
                "IMA_OPENAPI_CLIENTID": "client",
                "IMA_OPENAPI_APIKEY": "key",
                "DATABASE_URL": "postgresql://user:pass@db.example.test/geo?sslmode=require",
            }
        )

        self.assertEqual((), settings.missing)
        self.assertEqual("owner", settings.geo_account)
        self.assertEqual("client", settings.ima_client_id)


if __name__ == "__main__":
    unittest.main()
