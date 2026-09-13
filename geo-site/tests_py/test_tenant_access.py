import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path


FUNCTIONS_DIR = Path(__file__).resolve().parents[1] / "cloud-functions"
sys.path.insert(0, str(FUNCTIONS_DIR))


class TenantRepository:
    def __init__(self, context):
        self.context = context

    def get_tenant_context(self, user_id, _now):
        return self.context.get(user_id)

    def create_member(self, **kwargs):
        return {"id": "user-2", "username": kwargs["username"], "role": kwargs["role"], "expiresAt": kwargs["expires_at"]}


class TenantAccessTests(unittest.TestCase):
    def test_manager_can_create_a_member_with_a_thirty_day_expiry(self):
        from geo_backend.tenant_access import TenantAccessService

        now = datetime.now(timezone.utc)
        member = TenantAccessService(TenantRepository({})).create_member(
            {"tenantId": "tenant-1", "role": "owner"},
            username="member",
            password="member-secret",
            role="member",
            starts_at=now,
            expires_at=now + timedelta(days=30),
        )

        self.assertEqual("member", member["username"])
        self.assertEqual("member", member["role"])

    def test_member_cannot_create_another_member(self):
        from geo_backend.errors import ApiError
        from geo_backend.tenant_access import TenantAccessService

        with self.assertRaises(ApiError) as rejected:
            TenantAccessService(TenantRepository({})).create_member(
                {"tenantId": "tenant-1", "role": "member"},
                username="member",
                password="member-secret",
                role="member",
                starts_at=datetime.now(timezone.utc),
                expires_at=datetime.now(timezone.utc) + timedelta(days=30),
            )

        self.assertEqual("TENANT_MANAGER_REQUIRED", rejected.exception.code)
    def test_active_member_context_is_returned(self):
        from geo_backend.tenant_access import TenantAccessService

        now = datetime.now(timezone.utc)
        repository = TenantRepository(
            {
                "member-1": {
                    "tenantId": "tenant-1",
                    "role": "member",
                    "expiresAt": now + timedelta(days=30),
                    "active": True,
                }
            }
        )

        context = TenantAccessService(repository).require("member-1", now)

        self.assertEqual("tenant-1", context["tenantId"])
        self.assertEqual("member", context["role"])

    def test_expired_subscription_is_rejected_with_expiry_code(self):
        from geo_backend.errors import ApiError
        from geo_backend.tenant_access import TenantAccessService

        now = datetime.now(timezone.utc)
        repository = TenantRepository(
            {
                "member-1": {
                    "tenantId": "tenant-1",
                    "role": "member",
                    "expiresAt": now - timedelta(seconds=1),
                    "active": False,
                }
            }
        )

        with self.assertRaises(ApiError) as rejected:
            TenantAccessService(repository).require("member-1", now)

        self.assertEqual(403, rejected.exception.status)
        self.assertEqual("SUBSCRIPTION_EXPIRED", rejected.exception.code)

    def test_missing_membership_is_rejected(self):
        from geo_backend.errors import ApiError
        from geo_backend.tenant_access import TenantAccessService

        with self.assertRaises(ApiError) as rejected:
            TenantAccessService(TenantRepository({})).require("unknown", datetime.now(timezone.utc))

        self.assertEqual(403, rejected.exception.status)
        self.assertEqual("TENANT_ACCESS_REQUIRED", rejected.exception.code)


if __name__ == "__main__":
    unittest.main()
