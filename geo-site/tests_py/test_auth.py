import hashlib
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path


FUNCTIONS_DIR = Path(__file__).resolve().parents[1] / "cloud-functions"
sys.path.insert(0, str(FUNCTIONS_DIR))

from tests_py.fakes import FakeRepository


def settings():
    from geo_backend.config import Settings

    salt = "0123456789abcdef0123456789abcdef"
    value = hashlib.scrypt(b"secret", salt=salt.encode(), n=16384, r=8, p=1, dklen=64).hex()
    return Settings.from_mapping(
        {
            "APP_ORIGIN": "https://geo.example.test",
            "GEO_ACCOUNT": "owner",
            "GEO_PASSWORD_HASH": f"scrypt:{salt}:{value}",
            "GEO_MASTER_KEY": "c" * 64,
            "DATABASE_URL": "postgresql://u:p@db.example.test/geo?sslmode=require",
        }
    )


class AuthServiceTests(unittest.TestCase):
    def test_successful_login_creates_durable_session(self):
        from geo_backend.auth import AuthService

        repository = FakeRepository()
        result = AuthService(settings(), repository).login("owner", "secret")

        self.assertTrue(result.authenticated)
        self.assertEqual(1, len(repository.sessions))
        self.assertNotIn(result.cookie_token, repository.sessions)

    def test_configured_subaccount_can_login_with_its_own_password(self):
        from geo_backend.auth import AuthService
        from geo_backend.security import hash_password

        repository = FakeRepository()
        repository.users["member"] = {"id": "user-2", "username": "member", "password_hash": hash_password("member-secret")}

        result = AuthService(settings(), repository).login("member", "member-secret")

        self.assertTrue(result.authenticated)
        session = AuthService(settings(), repository).authenticate(result.cookie_token, result.csrf_token, "GET")
        self.assertEqual("user-2", session.user_id)

    def test_five_bad_passwords_block_the_next_attempt(self):
        from geo_backend.auth import AuthService
        from geo_backend.errors import ApiError

        repository = FakeRepository()
        service = AuthService(settings(), repository)
        for _ in range(5):
            with self.assertRaisesRegex(ApiError, "账号或密码不正确"):
                service.login("owner", "wrong")

        with self.assertRaises(ApiError) as blocked:
            service.login("owner", "secret")
        self.assertEqual(429, blocked.exception.status)
        self.assertEqual("LOGIN_THROTTLED", blocked.exception.code)

    def test_session_requires_matching_csrf_for_mutation_and_can_be_revoked(self):
        from geo_backend.auth import AuthService
        from geo_backend.errors import ApiError

        repository = FakeRepository()
        service = AuthService(settings(), repository)
        login = service.login("owner", "secret")

        with self.assertRaises(ApiError) as rejected:
            service.authenticate(login.cookie_token, "wrong", "POST")
        self.assertEqual("CSRF_REJECTED", rejected.exception.code)

        session = service.authenticate(login.cookie_token, login.csrf_token, "POST")
        self.assertEqual("user-1", session.user_id)
        service.logout(login.cookie_token)
        with self.assertRaises(ApiError):
            service.authenticate(login.cookie_token, None, "GET")

    def test_expired_session_is_rejected(self):
        from geo_backend.auth import AuthService
        from geo_backend.errors import ApiError

        repository = FakeRepository()
        service = AuthService(settings(), repository)
        login = service.login("owner", "secret")
        row = next(iter(repository.sessions.values()))
        row["expires_at"] = datetime.now(timezone.utc) - timedelta(seconds=1)

        with self.assertRaises(ApiError) as rejected:
            service.authenticate(login.cookie_token, None, "GET")
        self.assertEqual("LOGIN_REQUIRED", rejected.exception.code)


if __name__ == "__main__":
    unittest.main()
