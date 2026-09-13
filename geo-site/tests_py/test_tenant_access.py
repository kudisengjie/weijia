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


class TenantAccessTests(unittest.TestCase):
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
