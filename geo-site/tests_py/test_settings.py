import sys
import unittest
from pathlib import Path


FUNCTIONS_DIR = Path(__file__).resolve().parents[1] / "cloud-functions"
sys.path.insert(0, str(FUNCTIONS_DIR))

from tests_py.fakes import FakeRepository


class SettingsServiceTests(unittest.TestCase):
    def test_default_model_and_eight_provider_configuration_flags(self):
        from geo_backend.models import MODEL_PROVIDER_IDS, SettingsService

        repository = FakeRepository()
        result = SettingsService(repository, "master-key").public("user-1", {"clientId": "ima", "apiKey": "key"})

        self.assertEqual("deepseek", result["model"]["id"])
        self.assertEqual("primary", result["model"]["slot"])
        self.assertEqual(set(MODEL_PROVIDER_IDS), set(result["providers"]))
        self.assertTrue(result["ima"]["configured"])

    def test_selected_model_and_key_persist_for_the_stable_user(self):
        from geo_backend.models import SettingsService

        repository = FakeRepository()
        service = SettingsService(repository, "master-key")

        service.save_model("user-1", "qwen", "secondary", "custom-qwen", "provider-key", False)
        loaded = service.private("user-1")
        public = service.public("user-1", {"clientId": "", "apiKey": ""})

        self.assertEqual("custom-qwen", loaded["model"]["modelId"])
        self.assertEqual("provider-key", loaded["keys"]["qwen"])
        self.assertTrue(public["providers"]["qwen"]["configured"])
        self.assertNotIn("provider-key", repr(public))

    def test_removing_key_keeps_selection_but_clears_configuration(self):
        from geo_backend.models import SettingsService

        repository = FakeRepository()
        service = SettingsService(repository, "master-key")
        service.save_model("user-1", "kimi", "primary", "", "key", False)

        service.save_model("user-1", "kimi", "primary", "", "", True)

        self.assertNotIn("kimi", service.private("user-1")["keys"])


if __name__ == "__main__":
    unittest.main()
