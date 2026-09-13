from __future__ import annotations

from .errors import ApiError


class CreditService:
    def __init__(self, repository: object) -> None:
        self.repository = repository

    def reserve(self, tenant_id: str, user_id: str, batch_id: str, task_ids: list[str]) -> dict[str, object]:
        normalized = []
        seen = set()
        for task_id in task_ids:
            value = str(task_id).strip()
            if value and value not in seen:
                normalized.append(value)
                seen.add(value)
        if not normalized:
            raise ApiError(400, "没有可计费的任务。", "NO_TASKS")
        try:
            return self.repository.reserve_task_credits(tenant_id, user_id, batch_id, normalized)
        except ValueError as error:
            if str(error) == "INSUFFICIENT_CREDITS":
                raise ApiError(402, "积分不足，请联系管理员。", "INSUFFICIENT_CREDITS") from error
            raise

    def finalize(self, tenant_id: str, batch_id: str, task_id: str, *, complete: bool) -> dict[str, object]:
        return self.repository.settle_task_credit(tenant_id, batch_id, str(task_id), bool(complete))

    def release_unstarted(self, tenant_id: str, batch_id: str, task_ids: list[str]) -> dict[str, object]:
        return self.repository.release_unstarted_credits(tenant_id, batch_id, [str(value) for value in task_ids])

    def refund_batch(self, tenant_id: str, batch_id: str) -> dict[str, object]:
        return self.repository.settle_batch_incomplete(tenant_id, batch_id)

    def reopen_batch(self, tenant_id: str, user_id: str, batch_id: str) -> dict[str, object]:
        try:
            return self.repository.reopen_batch_credits(tenant_id, user_id, batch_id)
        except ValueError as error:
            if str(error) == "INSUFFICIENT_CREDITS":
                raise ApiError(402, "积分不足，无法重试该批次。", "INSUFFICIENT_CREDITS") from error
            raise
