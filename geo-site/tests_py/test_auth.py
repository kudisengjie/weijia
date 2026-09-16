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
    def test_sessions_are_limited_to_eight_hours(self):
        from geo_backend.security import SESSION_TTL
        self.assertEqual(timedelta(hours=8), SESSION_TTL)

    def test_successful_reauthentication_revokes_only_presented_cookie(self):
        from geo_backend.auth import AuthService
        from geo_backend.errors import ApiError
        repository = FakeRepository()
        service = AuthService(settings(), repository)
        first = service.login("owner", "secret")
        other = service.login("owner", "secret")
        fresh = service.login("owner", "secret", previous_cookie=first.cookie_token)
        with self.assertRaises(ApiError):
            service.authenticate(first.cookie_token, None, "GET")
        self.assertEqual("user-1", service.authenticate(fresh.cookie_token, None, "GET").user_id)
        self.assertEqual("user-1", service.authenticate(other.cookie_token, None, "GET").user_id)

    def test_bad_or_empty_password_does_not_revoke_existing_cookie(self):
        from geo_backend.auth import AuthService
        from geo_backend.errors import ApiError
        service = AuthService(settings(), FakeRepository())
        first = service.login("owner", "secret")
        for password in ("wrong", ""):
            with self.assertRaises(ApiError):
                service.login("owner", password, previous_cookie=first.cookie_token)
        self.assertEqual("user-1", service.authenticate(first.cookie_token, None, "GET").user_id)

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


class AccountScopeTests(unittest.TestCase):
    """本地交付的账号上下文：稳定、非秘密、按账号隔离（2026-09-16 交接方案 §6.2）。"""

    def test_account_scope_is_derived_from_master_key_and_user_id(self):
        import hashlib
        import hmac as hmac_module

        from geo_backend.security import account_scope

        key = bytes.fromhex("c" * 64)
        expected = hmac_module.new(
            key, b"lxue-account-scope-v1:user-1", hashlib.sha256
        ).hexdigest()[:32]
        self.assertEqual(expected, account_scope("user-1", "c" * 64))
        # 主密钥不同则派生值不同；同一密钥同一用户稳定。
        self.assertNotEqual(account_scope("user-1", "d" * 64), expected)
        self.assertEqual(expected, account_scope("user-1", "c" * 64))

    def test_login_result_carries_stable_opaque_scope(self):
        from geo_backend.auth import AuthService

        repository = FakeRepository()
        service = AuthService(settings(), repository)
        first = service.login("owner", "secret")
        again = service.login("owner", "secret")

        self.assertTrue(first.account_scope)
        self.assertRegex(first.account_scope, r"^[0-9a-f]{32}$")
        self.assertEqual(first.account_scope, again.account_scope)
        self.assertNotIn("user-1", first.account_scope)
        self.assertNotIn("owner", first.account_scope)

    def test_session_scope_matches_login_scope_and_isolates_accounts(self):
        from geo_backend.auth import AuthService
        from geo_backend.security import hash_password

        repository = FakeRepository()
        repository.users["member"] = {
            "id": "user-2",
            "username": "member",
            "password_hash": hash_password("member-secret"),
        }
        service = AuthService(settings(), repository)
        owner = service.login("owner", "secret")
        member = service.login("member", "member-secret")

        self.assertNotEqual(owner.account_scope, member.account_scope)
        restored = service.authenticate(owner.cookie_token, None, "GET")
        self.assertEqual(owner.account_scope, restored.account_scope)
        member_restored = service.authenticate(member.cookie_token, None, "GET")
        self.assertEqual(member.account_scope, member_restored.account_scope)


if __name__ == "__main__":
    unittest.main()
