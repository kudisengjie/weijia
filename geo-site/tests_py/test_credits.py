import sys
import unittest
from pathlib import Path


FUNCTIONS_DIR = Path(__file__).resolve().parents[1] / "cloud-functions"
sys.path.insert(0, str(FUNCTIONS_DIR))


class CreditRepository:
    def __init__(self):
        self.balance = {"tenant-1": 5}
        self.states = {}
        self.ledger = []

    def reserve_task_credits(self, tenant_id, user_id, batch_id, task_ids):
        new_ids = [task_id for task_id in task_ids if (batch_id, task_id) not in self.states]
        if self.balance.get(tenant_id, 0) < len(new_ids):
            raise ValueError("INSUFFICIENT_CREDITS")
        self.balance[tenant_id] = self.balance.get(tenant_id, 0) - len(new_ids)
        for task_id in new_ids:
            self.states[(batch_id, task_id)] = "reserved"
            self.ledger.append((tenant_id, batch_id, task_id, "reserve", -1))
        return {"reserved": len(new_ids), "balance": self.balance[tenant_id]}

    def settle_task_credit(self, tenant_id, batch_id, task_id, complete):
        key = (batch_id, task_id)
        status = self.states.get(key)
        if status != "reserved":
            return {"status": status or "missing", "refunded": False}
        if complete:
            self.states[key] = "complete"
            return {"status": "complete", "refunded": False}
        self.states[key] = "refunded"
        self.balance[tenant_id] += 1
        self.ledger.append((tenant_id, batch_id, task_id, "refund", 1))
        return {"status": "refunded", "refunded": True}

    def release_unstarted_credits(self, tenant_id, batch_id, task_ids):
        released = 0
        for task_id in task_ids:
            key = (batch_id, task_id)
            if self.states.get(key) == "reserved":
                self.states[key] = "released"
                self.balance[tenant_id] += 1
                self.ledger.append((tenant_id, batch_id, task_id, "release", 1))
                released += 1
        return {"released": released, "balance": self.balance[tenant_id]}

    def settle_batch_incomplete(self, tenant_id, batch_id):
        refunded = 0
        for (stored_batch, task_id), status in list(self.states.items()):
            if stored_batch == batch_id and status == "reserved":
                self.states[(stored_batch, task_id)] = "refunded"
                self.balance[tenant_id] += 1
                refunded += 1
        return {"refunded": refunded, "balance": self.balance[tenant_id]}

    def reopen_batch_credits(self, tenant_id, _user_id, batch_id):
        reopened = 0
        for (stored_batch, task_id), status in list(self.states.items()):
            if stored_batch == batch_id and status == "refunded":
                if self.balance[tenant_id] < 1:
                    raise ValueError("INSUFFICIENT_CREDITS")
                self.states[(stored_batch, task_id)] = "reserved"
                self.balance[tenant_id] -= 1
                reopened += 1
        return {"reopened": reopened, "balance": self.balance[tenant_id]}


class CreditServiceTests(unittest.TestCase):
    def test_reserves_once_and_refunds_an_incomplete_task_once(self):
        from geo_backend.credits import CreditService

        repository = CreditRepository()
        service = CreditService(repository)

        reserved = service.reserve("tenant-1", "user-1", "batch-1", ["1", "2", "3", "4", "5"])
        first = service.finalize("tenant-1", "batch-1", "1", complete=False)
        repeated = service.finalize("tenant-1", "batch-1", "1", complete=False)

        self.assertEqual(5, reserved["reserved"])
        self.assertTrue(first["refunded"])
        self.assertFalse(repeated["refunded"])
        self.assertEqual(1, repository.balance["tenant-1"])

    def test_insufficient_balance_rejects_before_reserving_any_task(self):
        from geo_backend.errors import ApiError
        from geo_backend.credits import CreditService

        repository = CreditRepository()
        repository.balance["tenant-1"] = 2

        with self.assertRaises(ApiError) as rejected:
            CreditService(repository).reserve("tenant-1", "user-1", "batch-1", ["1", "2", "3"])

        self.assertEqual("INSUFFICIENT_CREDITS", rejected.exception.code)
        self.assertEqual({}, repository.states)
        self.assertEqual(2, repository.balance["tenant-1"])

    def test_unstarted_tasks_are_released(self):
        from geo_backend.credits import CreditService

        repository = CreditRepository()
        service = CreditService(repository)
        service.reserve("tenant-1", "user-1", "batch-1", ["1", "2"])

        result = service.release_unstarted("tenant-1", "batch-1", ["2"])

        self.assertEqual(1, result["released"])
        self.assertEqual(4, repository.balance["tenant-1"])

    def test_failed_batch_refunds_all_incomplete_tasks_and_retry_reopens_them(self):
        from geo_backend.credits import CreditService

        repository = CreditRepository()
        service = CreditService(repository)
        service.reserve("tenant-1", "user-1", "batch-1", ["1", "2"])

        failed = service.refund_batch("tenant-1", "batch-1")
        reopened = service.reopen_batch("tenant-1", "user-1", "batch-1")

        self.assertEqual(2, failed["refunded"])
        self.assertEqual(2, reopened["reopened"])
        self.assertEqual(3, repository.balance["tenant-1"])


if __name__ == "__main__":
    unittest.main()
