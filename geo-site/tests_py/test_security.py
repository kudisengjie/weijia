import hashlib
import sys
import unittest
from pathlib import Path


FUNCTIONS_DIR = Path(__file__).resolve().parents[1] / "cloud-functions"
sys.path.insert(0, str(FUNCTIONS_DIR))


class SecurityTests(unittest.TestCase):
    def test_password_hash_round_trips_for_subaccount_creation(self):
        from geo_backend.security import hash_password, verify_password

        encoded = hash_password("member-secret")

        self.assertTrue(encoded.startswith("scrypt:"))
        self.assertTrue(verify_password("member-secret", encoded))
        self.assertFalse(verify_password("wrong", encoded))

    def test_node_scrypt_hash_is_verified_by_python(self):
        from geo_backend.security import verify_password

        salt = "0123456789abcdef0123456789abcdef"
        digest = hashlib.scrypt(b"secret", salt=salt.encode(), n=16384, r=8, p=1, dklen=64).hex()
        encoded = f"scrypt:{salt}:{digest}"

        self.assertTrue(verify_password("secret", encoded))
        self.assertFalse(verify_password("wrong", encoded))

    def test_password_parser_rejects_malformed_or_oversized_values(self):
        from geo_backend.security import verify_password

        self.assertFalse(verify_password("x", "not-a-hash"))
        self.assertFalse(verify_password("x" * 129, f"scrypt:{'a' * 32}:{'b' * 128}"))

    def test_session_material_keeps_only_digests_for_storage(self):
        from geo_backend.security import new_session_material

        material = new_session_material()

        self.assertNotEqual(material.cookie_token, material.cookie_digest)
        self.assertNotEqual(material.csrf_token, material.csrf_digest)
        self.assertEqual(64, len(material.cookie_digest))
        self.assertEqual(64, len(material.csrf_digest))
        self.assertNotIn(material.cookie_token, repr(material.stored))
        self.assertNotIn(material.csrf_token, repr(material.stored))


if __name__ == "__main__":
    unittest.main()
