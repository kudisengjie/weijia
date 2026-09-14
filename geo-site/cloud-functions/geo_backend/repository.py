from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime
from threading import Lock
from typing import Iterator
import json

from .database import connection, database_health, ensure_schema


class PostgresRepository:
    def __init__(self, conn: object) -> None:
        self.conn = conn

    def transaction(self):
        return self.conn.transaction()

    def lock_user(self, user_id: str) -> None:
        self.conn.execute('SELECT id FROM users WHERE id = %s FOR UPDATE', (user_id,))

    def get_request_batch(self, user_id: str, request_hash: str):
        row = self.conn.execute('SELECT state FROM batches WHERE user_id = %s AND request_id_hash = %s', (user_id, request_hash)).fetchone()
        return row[0] if row else None

    def health(self) -> dict[str, object]:
        return database_health(self.conn)

    def login_blocked(self, scope_hash: str, now: datetime) -> bool:
        row = self.conn.execute(
            """
            SELECT failures >= 5 AND window_started > %s - INTERVAL '15 minutes'
            FROM login_attempts WHERE scope_hash = %s
            """,
            (now, scope_hash),
        ).fetchone()
        return bool(row and row[0])

    def record_login_failure(self, scope_hash: str, now: datetime) -> None:
        self.conn.execute(
            """
            INSERT INTO login_attempts (scope_hash, window_started, failures)
            VALUES (%s, %s, 1)
            ON CONFLICT (scope_hash) DO UPDATE SET
                failures = CASE
                    WHEN login_attempts.window_started <= EXCLUDED.window_started - INTERVAL '15 minutes' THEN 1
                    ELSE login_attempts.failures + 1
                END,
                window_started = CASE
                    WHEN login_attempts.window_started <= EXCLUDED.window_started - INTERVAL '15 minutes' THEN EXCLUDED.window_started
                    ELSE login_attempts.window_started
                END
            """,
            (scope_hash, now),
        )

    def clear_login_failures(self, scope_hash: str) -> None:
        self.conn.execute("DELETE FROM login_attempts WHERE scope_hash = %s", (scope_hash,))

    def upsert_configured_user(self, username: str, password_hash: str) -> dict[str, object]:
        row = self.conn.execute(
            """
            INSERT INTO users (username, password_hash)
            VALUES (%s, %s)
            ON CONFLICT (LOWER(username)) DO UPDATE SET
                password_hash = EXCLUDED.password_hash,
                updated_at = NOW()
            RETURNING id, username
            """,
            (username, password_hash),
        ).fetchone()
        return {"id": str(row[0]), "username": row[1]}

    def get_user_login(self, username: str) -> dict[str, object] | None:
        row = self.conn.execute(
            "SELECT id, username, password_hash FROM users WHERE LOWER(username) = LOWER(%s)",
            (username,),
        ).fetchone()
        if not row:
            return None
        return {"id": str(row[0]), "username": row[1], "password_hash": row[2]}

    def create_member(
        self,
        *,
        tenant_id: str,
        username: str,
        password_hash: str,
        role: str,
        starts_at: datetime,
        expires_at: datetime,
    ) -> dict[str, object]:
        with self.conn.transaction():
            existing = self.conn.execute(
                "SELECT id FROM users WHERE LOWER(username) = LOWER(%s)",
                (username,),
            ).fetchone()
            if existing:
                raise ValueError("ACCOUNT_EXISTS")
            row = self.conn.execute(
                "INSERT INTO users (username, password_hash) VALUES (%s, %s) RETURNING id, username",
                (username, password_hash),
            ).fetchone()
            user_id = str(row[0])
            self.conn.execute(
                "INSERT INTO tenant_members (tenant_id, user_id, role) VALUES (%s, %s, %s)",
                (tenant_id, user_id, role),
            )
            self.conn.execute(
                "INSERT INTO subscriptions (tenant_id, user_id, starts_at, expires_at) VALUES (%s, %s, %s, %s)",
                (tenant_id, user_id, starts_at, expires_at),
            )
            self.conn.execute(
                "INSERT INTO credit_accounts (tenant_id, balance) VALUES (%s, 0) ON CONFLICT (tenant_id) DO NOTHING",
                (tenant_id,),
            )
        return {"id": user_id, "username": row[1], "role": role, "expiresAt": expires_at}

    def set_subscription(
        self, tenant_id: str, user_id: str | None, starts_at: datetime, expires_at: datetime, *, actor_id: str | None = None
    ) -> dict[str, object]:
        with self.conn.transaction():
            if user_id is not None:
                self.require_member(tenant_id, user_id)
                self.lock_user(user_id)
            previous = self.conn.execute(
                """SELECT id, starts_at, expires_at, status FROM subscriptions
                   WHERE tenant_id = %s AND user_id IS NOT DISTINCT FROM %s
                   ORDER BY created_at DESC, id DESC LIMIT 1""", (tenant_id, user_id)
            ).fetchone()
            if previous and previous[1:] == (starts_at, expires_at, 'active'):
                return {'id': str(previous[0]), 'expiresAt': previous[2]}
            self.conn.execute(
                "UPDATE subscriptions SET status = 'revoked' WHERE tenant_id = %s AND user_id IS NOT DISTINCT FROM %s AND status = 'active'",
                (tenant_id, user_id),
            )
            row = self.conn.execute(
                "INSERT INTO subscriptions (tenant_id, user_id, starts_at, expires_at, status) VALUES (%s, %s, %s, %s, 'active') RETURNING id, expires_at",
                (tenant_id, user_id, starts_at, expires_at),
            ).fetchone()
            if actor_id:
                self.record_admin_audit(tenant_id, actor_id, 'subscription.update', user_id,
                    {'startsAt': starts_at.isoformat(), 'expiresAt': expires_at.isoformat()})
        return {"id": str(row[0]), "expiresAt": row[1]}

    def require_member(self, tenant_id, user_id):
        from .errors import ApiError
        if not self.conn.execute('SELECT 1 FROM tenant_members WHERE tenant_id = %s AND user_id = %s', (tenant_id, user_id)).fetchone():
            raise ApiError(404, '子账号不存在或不属于当前工作区。', 'MEMBER_NOT_FOUND')

    def record_admin_audit(self, tenant_id, actor_id, action, target_user_id=None, details=None):
        from psycopg.types.json import Jsonb
        self.conn.execute('INSERT INTO admin_audit (tenant_id, actor_id, target_user_id, action, details) VALUES (%s, %s, %s, %s, %s)',
            (tenant_id, actor_id, target_user_id, action, Jsonb(details or {})))

    def list_members(self, tenant_id):
        rows = self.conn.execute('''
            SELECT u.id, u.username, tm.role, COALESCE(c.balance, 0), s.starts_at, s.expires_at,
                   COALESCE(s.status = 'active' AND s.starts_at <= NOW() AND s.expires_at > NOW(), FALSE)
            FROM tenant_members tm JOIN users u ON u.id = tm.user_id
            LEFT JOIN member_credit_accounts c ON c.tenant_id = tm.tenant_id AND c.user_id = tm.user_id
            LEFT JOIN LATERAL (
                SELECT starts_at, expires_at, status FROM subscriptions
                WHERE tenant_id = tm.tenant_id AND (user_id = tm.user_id OR user_id IS NULL)
                ORDER BY CASE WHEN user_id = tm.user_id THEN 0 ELSE 1 END, created_at DESC, id DESC LIMIT 1
            ) s ON TRUE
            WHERE tm.tenant_id = %s ORDER BY u.created_at, u.id
        ''', (tenant_id,)).fetchall()
        return [dict(zip(('id', 'username', 'role', 'balance', 'startsAt', 'expiresAt', 'active'),
            (str(r[0]), r[1], r[2], int(r[3]), r[4].isoformat() if r[4] else None, r[5].isoformat() if r[5] else None, r[6]))) for r in rows]

    def ensure_owner_tenant(self, user_id: str, slug: str = "owner") -> dict[str, object]:
        with self.conn.transaction():
            existing = self.conn.execute(
                "SELECT id, slug, name FROM tenants WHERE owner_user_id = %s ORDER BY created_at LIMIT 1", (user_id,)
            ).fetchone()
            if existing:
                self.conn.execute("INSERT INTO tenant_members (tenant_id, user_id, role) VALUES (%s, %s, 'owner') ON CONFLICT (tenant_id, user_id) DO NOTHING", (existing[0], user_id))
                return {"tenantId": str(existing[0]), "slug": existing[1], "name": existing[2], "role": "owner"}
            tenant = self.conn.execute(
                """
                INSERT INTO tenants (slug, name, owner_user_id)
                VALUES (%s, %s, %s)
                ON CONFLICT (slug) DO UPDATE SET owner_user_id = COALESCE(tenants.owner_user_id, EXCLUDED.owner_user_id)
                RETURNING id, slug, name
                """,
                (slug, "零雪 GEO", user_id),
            ).fetchone()
            tenant_id = str(tenant[0])
            self.conn.execute(
                """
                INSERT INTO tenant_members (tenant_id, user_id, role)
                VALUES (%s, %s, 'owner')
                ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = 'owner'
                """,
                (tenant_id, user_id),
            )
            self.conn.execute(
                """
                INSERT INTO subscriptions (tenant_id, user_id, starts_at, expires_at)
                SELECT %s, %s, NOW(), NOW() + INTERVAL '30 days'
                WHERE NOT EXISTS (
                    SELECT 1 FROM subscriptions
                    WHERE tenant_id = %s AND user_id = %s AND status = 'active' AND expires_at > NOW()
                )
                """,
                (tenant_id, user_id, tenant_id, user_id),
            )
            self.conn.execute(
                """
                INSERT INTO credit_accounts (tenant_id, balance)
                VALUES (%s, 0)
                ON CONFLICT (tenant_id) DO NOTHING
                """,
                (tenant_id,),
            )
        return {"tenantId": tenant_id, "slug": tenant[1], "name": tenant[2], "role": "owner"}

    def get_tenant_context(self, user_id: str, now: datetime) -> dict[str, object] | None:
        row = self.conn.execute(
            """
            SELECT t.id, tm.role, s.starts_at, s.expires_at,
                   (s.status = 'active' AND s.starts_at <= %s AND s.expires_at > %s) AS active
            FROM tenant_members tm
            JOIN tenants t ON t.id = tm.tenant_id
            LEFT JOIN LATERAL (
                SELECT user_id, starts_at, expires_at, status
                FROM subscriptions
                WHERE tenant_id = t.id AND (user_id = tm.user_id OR user_id IS NULL)
                ORDER BY CASE WHEN user_id = tm.user_id THEN 0 ELSE 1 END,
                         created_at DESC, id DESC
                LIMIT 1
            ) s ON TRUE
            WHERE tm.user_id = %s
            ORDER BY CASE tm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
                     s.expires_at DESC NULLS LAST
            LIMIT 1
            """,
            (now, now, user_id),
        ).fetchone()
        if not row:
            return None
        return {
            "tenantId": str(row[0]),
            "role": row[1],
            "startsAt": row[2],
            "expiresAt": row[3],
            "active": bool(row[4]),
        }

    def _credit_account(self, tenant_id: str, user_id: str) -> int:
        from .errors import ApiError
        member = self.conn.execute(
            "SELECT 1 FROM tenant_members WHERE tenant_id = %s AND user_id = %s", (tenant_id, user_id)
        ).fetchone()
        if not member:
            raise ApiError(404, "子账号不存在或不属于当前工作区。", "MEMBER_NOT_FOUND")
        self.conn.execute(
            "INSERT INTO member_credit_accounts (tenant_id, user_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
            (tenant_id, user_id),
        )
        return int(self.conn.execute(
            "SELECT balance FROM member_credit_accounts WHERE tenant_id = %s AND user_id = %s FOR UPDATE",
            (tenant_id, user_id),
        ).fetchone()[0])

    def _credit_delta(self, tenant_id, user_id, amount):
        self.conn.execute(
            "UPDATE member_credit_accounts SET balance = balance + %s, updated_at = NOW() WHERE tenant_id = %s AND user_id = %s",
            (amount, tenant_id, user_id),
        )

    def _credit_entry(self, tenant_id, user_id, batch_id, task_id, kind, amount, key, metadata=None):
        from psycopg.types.json import Jsonb
        self.conn.execute(
            """INSERT INTO credit_ledger (tenant_id, user_id, batch_id, task_id, kind, amount, idempotency_key, metadata)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
            (tenant_id, user_id, batch_id, task_id, kind, amount, key, Jsonb(metadata or {})),
        )

    def _batch_owner(self, tenant_id, batch_id):
        from .errors import ApiError
        row = self.conn.execute("SELECT user_id FROM batches WHERE tenant_id = %s AND id = %s", (tenant_id, batch_id)).fetchone()
        if not row:
            raise ApiError(404, "批次不存在。", "BATCH_NOT_FOUND")
        return str(row[0])

    def reserve_task_credits(self, tenant_id, user_id, batch_id, task_ids):
        with self.conn.transaction():
            if self._batch_owner(tenant_id, batch_id) != user_id:
                raise ValueError("BATCH_OWNER_MISMATCH")
            balance = self._credit_account(tenant_id, user_id)
            existing = {row[0] for row in self.conn.execute(
                "SELECT task_id FROM credit_task_states WHERE tenant_id = %s AND batch_id = %s", (tenant_id, batch_id)
            ).fetchall()}
            new_ids = list(dict.fromkeys(str(t) for t in task_ids if str(t) not in existing))
            if balance < len(new_ids):
                raise ValueError("INSUFFICIENT_CREDITS")
            for task_id in new_ids:
                self.conn.execute(
                    """INSERT INTO credit_task_states (tenant_id, user_id, batch_id, task_id, status)
                       VALUES (%s, %s, %s, %s, 'reserved')""", (tenant_id, user_id, batch_id, task_id)
                )
                self._credit_entry(tenant_id, user_id, batch_id, task_id, 'reserve', -1, f"{batch_id}:{task_id}:reserve:0")
            self._credit_delta(tenant_id, user_id, -len(new_ids))
            return {"reserved": len(new_ids), "balance": balance - len(new_ids)}

    def _task_artifacts_complete(self, tenant_id, batch_id, task_id):
        row = self.conn.execute("SELECT state FROM batches WHERE tenant_id = %s AND id = %s", (tenant_id, batch_id)).fetchone()
        if not row:
            return False
        expected = [str(i + 1) for i, task in enumerate(row[0]["tasks"]) if str(task.get("billingTaskId", i + 1)) == task_id]
        if not expected:
            return False
        found = self.conn.execute(
            """SELECT COUNT(*) FROM article_artifacts WHERE tenant_id = %s AND batch_id = %s
               AND task_id = ANY(%s) AND status = 'complete' AND audit_status = 'accepted' AND byte_length > 0""",
            (tenant_id, batch_id, expected),
        ).fetchone()[0]
        return found == len(expected)

    def settle_task_credit(self, tenant_id, batch_id, task_id, complete, *, release=False):
        from .errors import ApiError
        with self.conn.transaction():
            user_id = self._batch_owner(tenant_id, batch_id)
            self._credit_account(tenant_id, user_id)
            row = self.conn.execute(
                "SELECT status, attempt FROM credit_task_states WHERE tenant_id = %s AND batch_id = %s AND task_id = %s FOR UPDATE",
                (tenant_id, batch_id, task_id),
            ).fetchone()
            if not row or row[0] != 'reserved':
                return {"status": row[0] if row else "missing", "refunded": False}
            artifact_complete = self._task_artifacts_complete(tenant_id, batch_id, task_id)
            if complete and not artifact_complete:
                raise ApiError(409, "完整文章尚未保存，不能确认扣分。", "ARTIFACT_NOT_PERSISTED")
            final_status = "complete" if artifact_complete else "released" if release else "refunded"
            self.conn.execute(
                "UPDATE credit_task_states SET status = %s, updated_at = NOW() WHERE batch_id = %s AND task_id = %s",
                (final_status, batch_id, task_id),
            )
            if final_status != 'complete':
                kind = 'release' if release else 'refund'
                self._credit_entry(tenant_id, user_id, batch_id, task_id, kind, 1, f"{batch_id}:{task_id}:{kind}:{row[1]}")
                self._credit_delta(tenant_id, user_id, 1)
            return {"status": final_status, "refunded": final_status == 'refunded'}

    def release_unstarted_credits(self, tenant_id, batch_id, task_ids):
        with self.conn.transaction():
            user_id = self._batch_owner(tenant_id, batch_id)
            self._credit_account(tenant_id, user_id)
            released = 0
            for task_id in task_ids:
                before = self.conn.execute("SELECT status FROM credit_task_states WHERE batch_id = %s AND task_id = %s", (batch_id, task_id)).fetchone()
                result = self.settle_task_credit(tenant_id, batch_id, str(task_id), False, release=True)
                released += int(bool(before and before[0] == 'reserved' and result['status'] == 'released'))
            return {"released": released, "balance": self.credit_balance(tenant_id, user_id)}

    def settle_batch_incomplete(self, tenant_id, batch_id):
        with self.conn.transaction():
            user_id = self._batch_owner(tenant_id, batch_id)
            self._credit_account(tenant_id, user_id)
            tasks = self.conn.execute(
                "SELECT task_id FROM credit_task_states WHERE tenant_id = %s AND batch_id = %s AND status = 'reserved'",
                (tenant_id, batch_id),
            ).fetchall()
            refunded = sum(int(self.settle_task_credit(tenant_id, batch_id, task_id, False)['refunded']) for (task_id,) in tasks)
            return {"refunded": refunded, "balance": self.credit_balance(tenant_id, user_id)}

    def reopen_batch_credits(self, tenant_id, user_id, batch_id):
        with self.conn.transaction():
            if self._batch_owner(tenant_id, batch_id) != user_id:
                raise ValueError("BATCH_OWNER_MISMATCH")
            balance = self._credit_account(tenant_id, user_id)
            rows = self.conn.execute(
                "SELECT task_id, attempt FROM credit_task_states WHERE tenant_id = %s AND batch_id = %s AND status IN ('refunded', 'released') FOR UPDATE",
                (tenant_id, batch_id),
            ).fetchall()
            if balance < len(rows):
                raise ValueError("INSUFFICIENT_CREDITS")
            for task_id, attempt in rows:
                self.conn.execute(
                    "UPDATE credit_task_states SET status = 'reserved', attempt = attempt + 1, updated_at = NOW() WHERE batch_id = %s AND task_id = %s",
                    (batch_id, task_id),
                )
                self._credit_entry(tenant_id, user_id, batch_id, task_id, 'reserve', -1, f"{batch_id}:{task_id}:reserve:{attempt + 1}")
            self._credit_delta(tenant_id, user_id, -len(rows))
            return {"reopened": len(rows), "balance": balance - len(rows)}

    def credit_balance(self, tenant_id, user_id=None):
        if user_id is None:
            row = self.conn.execute("SELECT COALESCE(SUM(balance), 0) FROM member_credit_accounts WHERE tenant_id = %s", (tenant_id,)).fetchone()
        else:
            row = self.conn.execute("SELECT balance FROM member_credit_accounts WHERE tenant_id = %s AND user_id = %s", (tenant_id, user_id)).fetchone()
        return int(row[0]) if row else 0

    def adjust_credits(self, tenant_id, user_id, amount, idempotency_key, kind, metadata=None):
        from .errors import ApiError
        if isinstance(amount, bool) or not isinstance(amount, int) or not 1 <= amount <= 1000000 or kind not in {'grant', 'revoke'}:
            raise ValueError("INVALID_CREDIT_ADJUSTMENT")
        if not 16 <= len(idempotency_key) <= 200:
            raise ValueError("INVALID_CREDIT_ADJUSTMENT")
        signed = amount if kind == 'grant' else -amount
        with self.conn.transaction():
            balance = self._credit_account(tenant_id, user_id)
            existing = self.conn.execute(
                "SELECT user_id, amount, kind FROM credit_ledger WHERE tenant_id = %s AND idempotency_key = %s",
                (tenant_id, idempotency_key),
            ).fetchone()
            if existing:
                if (str(existing[0]), int(existing[1]), existing[2]) != (user_id, signed, kind):
                    raise ApiError(409, "该调整编号已用于其他操作。", "IDEMPOTENCY_CONFLICT")
                return {"applied": False, "amount": signed, "balance": balance}
            if balance + signed < 0:
                raise ValueError("INSUFFICIENT_CREDITS")
            self._credit_entry(tenant_id, user_id, None, None, kind, signed, idempotency_key, metadata)
            self._credit_delta(tenant_id, user_id, signed)
            if metadata and metadata.get('actorId'):
                self.record_admin_audit(tenant_id, metadata['actorId'], 'credits.' + kind, user_id,
                    {'amount': signed, 'note': metadata.get('note', ''), 'idempotencyKey': idempotency_key})
            return {"applied": True, "amount": signed, "balance": balance + signed}

    def list_credit_ledger(self, tenant_id, user_id=None, limit=100):
        rows = self.conn.execute(
            """SELECT id, user_id, batch_id, task_id, kind, amount, created_at FROM credit_ledger
               WHERE tenant_id = %s AND (%s::uuid IS NULL OR user_id = %s::uuid)
               ORDER BY created_at DESC, id DESC LIMIT %s""", (tenant_id, user_id, user_id, min(limit, 200))
        ).fetchall()
        return [dict(zip(('id', 'userId', 'batchId', 'taskId', 'kind', 'amount', 'createdAt'),
                        (str(r[0]), str(r[1]), r[2], r[3], r[4], r[5], r[6].isoformat()))) for r in rows]

    def task_credit_outcomes(self, tenant_id, batch_id):
        rows = self.conn.execute(
            "SELECT task_id, status FROM credit_task_states WHERE tenant_id = %s AND batch_id = %s ORDER BY task_id",
            (tenant_id, batch_id),
        ).fetchall()
        return [{"taskId": r[0], "status": r[1]} for r in rows]

    def get_ima_cache_generation(self) -> int:
        row = self.conn.execute("SELECT generation FROM ima_cache_meta WHERE singleton").fetchone()
        return int(row[0]) if row else 1

    def clear_ima_cache_generation(self, user_id: str | None = None) -> int:
        row = self.conn.execute(
            """
            INSERT INTO ima_cache_meta (singleton, generation, updated_by)
            VALUES (TRUE, 2, %s)
            ON CONFLICT (singleton) DO UPDATE SET generation = ima_cache_meta.generation + 1,
                                                  updated_by = EXCLUDED.updated_by,
                                                  updated_at = NOW()
            RETURNING generation
            """,
            (user_id,),
        ).fetchone()
        return int(row[0])

    def acquire_ima_cache_lock(self, cache_key: str, generation: int, owner_token: str, lock_seconds: int = 150) -> bool:
        with self.conn.transaction():
            row = self.conn.execute(
                """
                INSERT INTO ima_cache_locks (cache_key, generation, locked_until, owner_token)
                VALUES (%s, %s, NOW() + (%s || ' seconds')::INTERVAL, %s)
                ON CONFLICT (cache_key) DO UPDATE SET locked_until = EXCLUDED.locked_until,
                    owner_token = EXCLUDED.owner_token, generation = EXCLUDED.generation
                WHERE ima_cache_locks.locked_until <= NOW()
                RETURNING cache_key
                """,
                (cache_key, generation, lock_seconds, owner_token),
            ).fetchone()
            return bool(row)

    def release_ima_cache_lock(self, cache_key: str, owner_token: str) -> None:
        self.conn.execute(
            "DELETE FROM ima_cache_locks WHERE cache_key = %s AND owner_token = %s",
            (cache_key, owner_token),
        )

    def get_ima_cache(self, kind: str, cache_key: str, generation: int, master_key: str) -> object | None:
        table = {"search": "ima_search_cache", "media": "ima_media_cache", "rules": "ima_search_cache"}.get(kind)
        if not table:
            raise ValueError("INVALID_IMA_CACHE_KIND")
        row = self.conn.execute(
            f"SELECT pgp_sym_decrypt(payload_cipher, %s)::TEXT FROM {table} WHERE cache_key = %s AND generation = %s AND (expires_at IS NULL OR expires_at > NOW())",
            (master_key, cache_key, generation),
        ).fetchone()
        if not row:
            return None
        self.conn.execute(f"UPDATE {table} SET hit_count = hit_count + 1 WHERE cache_key = %s", (cache_key,))
        return json.loads(row[0])

    def put_ima_cache(
        self,
        kind: str,
        cache_key: str,
        generation: int,
        value: object,
        metadata: dict[str, object],
        master_key: str,
    ) -> None:
        from psycopg.types.json import Jsonb

        table = {"search": "ima_search_cache", "media": "ima_media_cache", "rules": "ima_search_cache"}.get(kind)
        if not table:
            raise ValueError("INVALID_IMA_CACHE_KIND")
        external_id = str(metadata.get("knowledgeBaseId") or metadata.get("knowledge_base_id") or "unknown")
        with self.conn.transaction():
            kb = self.conn.execute(
                """
                INSERT INTO ima_knowledge_bases (external_id, name)
                VALUES (%s, %s)
                ON CONFLICT (external_id) DO UPDATE SET updated_at = NOW()
                RETURNING id
                """,
                (external_id, external_id),
            ).fetchone()
            payload = json.dumps(value, ensure_ascii=False)
            if table == "ima_media_cache":
                self.conn.execute(
                    """
                    INSERT INTO ima_media_cache (cache_key, generation, knowledge_base_id, media_id, payload_cipher)
                    VALUES (%s, %s, %s, %s, pgp_sym_encrypt(%s, %s, 'cipher-algo=aes256'))
                    ON CONFLICT (cache_key) DO UPDATE SET generation = EXCLUDED.generation,
                        payload_cipher = EXCLUDED.payload_cipher, content_version = EXCLUDED.content_version
                    """,
                    (cache_key, generation, str(kb[0]), str(metadata.get("mediaId") or metadata.get("media_id") or cache_key), payload, master_key),
                )
            else:
                request_key = cache_key
                self.conn.execute(
                    """
                    INSERT INTO ima_search_cache (cache_key, generation, knowledge_base_id, request_key, payload_cipher)
                    VALUES (%s, %s, %s, %s, pgp_sym_encrypt(%s, %s, 'cipher-algo=aes256'))
                    ON CONFLICT (cache_key) DO UPDATE SET generation = EXCLUDED.generation,
                        payload_cipher = EXCLUDED.payload_cipher, request_key = EXCLUDED.request_key
                    """,
                    (cache_key, generation, str(kb[0]), request_key, payload, master_key),
                )

    def save_article_artifact(self, **kwargs: object) -> dict[str, object]:
        from .errors import ApiError
        if self._batch_owner(str(kwargs['tenant_id']), str(kwargs['batch_id'])) != kwargs['user_id']:
            raise ApiError(404, '批次不存在。', 'BATCH_NOT_FOUND')
        row = self.conn.execute(
            """
            INSERT INTO article_artifacts (
                tenant_id, batch_id, task_id, user_id, filename, content_cipher,
                byte_length, sha256, status, audit_status
            )
            VALUES (%s, %s, %s, %s, %s, pgp_sym_encrypt(%s, %s, 'cipher-algo=aes256'), %s, %s, %s, %s)
            ON CONFLICT (batch_id, task_id) DO UPDATE SET id = article_artifacts.id
            WHERE article_artifacts.sha256 = EXCLUDED.sha256
              AND article_artifacts.filename = EXCLUDED.filename
              AND article_artifacts.byte_length = EXCLUDED.byte_length
              AND article_artifacts.status = 'complete' AND article_artifacts.audit_status = 'accepted'
              AND article_artifacts.tenant_id = EXCLUDED.tenant_id AND article_artifacts.user_id = EXCLUDED.user_id
            RETURNING id, filename, byte_length, sha256, status, audit_status
            """,
            (
                kwargs["tenant_id"],
                kwargs["batch_id"],
                kwargs["task_id"],
                kwargs["user_id"],
                kwargs["filename"],
                kwargs["markdown"],
                kwargs["master_key"],
                kwargs["byte_length"],
                kwargs["sha256"],
                kwargs["status"],
                kwargs["audit_status"],
            ),
        ).fetchone()
        if not row:
            raise ApiError(409, '完整文章已保存，不能覆盖。', 'ARTIFACT_IMMUTABLE')
        return {
            "id": str(row[0]),
            "filename": row[1],
            "byteLength": int(row[2]),
            "sha256": row[3],
            "status": row[4],
            "auditStatus": row[5],
        }

    def get_article_artifact(self, tenant_id: str, artifact_id: str, master_key: str = "", *, user_id: str) -> dict[str, object] | None:
        row = self.conn.execute(
            """
            SELECT id, batch_id, task_id, filename, pgp_sym_decrypt(content_cipher, %s)::TEXT,
                   byte_length, sha256, status, audit_status, created_at
            FROM article_artifacts
            WHERE tenant_id = %s AND id = %s AND user_id = %s AND status = 'complete'
            """,
            (master_key, tenant_id, artifact_id, user_id),
        ).fetchone()
        if not row:
            return None
        return {
            "id": str(row[0]),
            "batchId": row[1],
            "taskId": row[2],
            "filename": row[3],
            "markdown": row[4],
            "byteLength": int(row[5]),
            "sha256": row[6],
            "status": row[7],
            "auditStatus": row[8],
            "createdAt": row[9],
        }

    def create_job(self, tenant_id: str, batch_id: str, idempotency_key: str) -> None:
        self.conn.execute(
            """
            INSERT INTO jobs (tenant_id, batch_id, status, idempotency_key)
            VALUES (%s, %s, 'queued', %s)
            ON CONFLICT (batch_id) DO NOTHING
            """,
            (tenant_id, batch_id, idempotency_key),
        )

    def set_batch_job_status(self, batch_id: str, status: str):
        self.conn.execute("UPDATE jobs SET status = %s, lease_until = NULL, locked_at = NULL, next_run_at = NOW(), updated_at = NOW() WHERE batch_id = %s", (status, batch_id))

    def save_model_snapshot(
        self,
        *,
        batch_id: str,
        tenant_id: str,
        user_id: str,
        model: dict[str, object],
        api_key: str,
        endpoint: str,
        master_key: str,
    ) -> None:
        self.conn.execute(
            """
            INSERT INTO batch_model_snapshots (batch_id, tenant_id, user_id, provider, model_id, endpoint, api_key_cipher)
            VALUES (%s, %s, %s, %s, %s, %s, pgp_sym_encrypt(%s, %s, 'cipher-algo=aes256'))
            ON CONFLICT (batch_id) DO NOTHING
            """,
            (batch_id, tenant_id, user_id, model["id"], model["modelId"], endpoint, api_key, master_key),
        )

    def get_model_snapshot(
        self,
        *,
        batch_id: str,
        tenant_id: str,
        user_id: str,
        master_key: str,
    ) -> dict[str, object] | None:
        row = self.conn.execute(
            """
            SELECT provider, model_id, endpoint,
                   CASE WHEN api_key_cipher IS NULL THEN NULL
                        ELSE pgp_sym_decrypt(api_key_cipher, %s, 'cipher-algo=aes256')
                   END
            FROM batch_model_snapshots
            WHERE batch_id = %s AND tenant_id = %s AND user_id = %s
            """,
            (master_key, batch_id, tenant_id, user_id),
        ).fetchone()
        if not row:
            return None
        return {
            "provider": row[0],
            "modelId": row[1],
            "endpoint": row[2],
            "apiKey": row[3],
        }

    def claim_next_job(self, lease_seconds: int = 90) -> dict[str, object] | None:
        with self.conn.transaction():
            row = self.conn.execute(
                """
                SELECT j.id, j.batch_id, b.user_id, b.seq
                FROM jobs j
                JOIN batches b ON b.id = j.batch_id
                WHERE j.status IN ('queued', 'running') AND j.next_run_at <= NOW()
                  AND b.status = 'ready' AND (j.lease_until IS NULL OR j.lease_until < NOW())
                ORDER BY j.next_run_at, j.created_at
                FOR UPDATE OF j SKIP LOCKED
                LIMIT 1
                """
            ).fetchone()
            if not row:
                return None
            updated = self.conn.execute(
                """
                UPDATE jobs SET status = 'running', attempts = attempts + 1,
                    locked_at = NOW(), lease_until = NOW() + (%s || ' seconds')::INTERVAL,
                    updated_at = NOW(), heartbeat_at = NOW(), lease_token = gen_random_uuid()
                WHERE id = %s
                RETURNING attempts, lease_token
                """,
                (lease_seconds, row[0]),
            ).fetchone()
            return {"id": str(row[0]), "batchId": row[1], "userId": str(row[2]), "seq": int(row[3]), "attempts": int(updated[0]), 'leaseToken': str(updated[1])}

    def finish_job(self, job_id: str, status: str, lease_token: str, delay_seconds: int = 0) -> bool:
        final_status = status if status in {"completed", "failed", "cancelled"} else "queued"
        return self.conn.execute(
            """UPDATE jobs SET status = %s, lease_until = NULL, locked_at = NULL, lease_token = NULL,
               next_run_at = NOW() + (%s || ' seconds')::INTERVAL, updated_at = NOW()
               WHERE id = %s AND lease_token = %s AND status = 'running'""",
            (final_status, delay_seconds, job_id, lease_token),
        ).rowcount == 1

    def fail_job(self, job_id: str, message: str, lease_token: str) -> bool:
        return self.conn.execute(
            "UPDATE jobs SET status = 'failed', last_error = %s, lease_until = NULL, locked_at = NULL, lease_token = NULL, updated_at = NOW() WHERE id = %s AND lease_token = %s AND status = 'running'",
            (message[:4000], job_id, lease_token),
        ).rowcount == 1

    def heartbeat_job(self, job_id: str, lease_token: str, lease_seconds: int = 90) -> bool:
        return self.conn.execute(
            """UPDATE jobs SET lease_until = NOW() + (%s || ' seconds')::INTERVAL,
               heartbeat_at = NOW(), updated_at = NOW()
               WHERE id = %s AND lease_token = %s AND status = 'running' AND lease_until > NOW()""",
            (lease_seconds, job_id, lease_token),
        ).rowcount == 1

    def create_session(self, user_id: str, stored: dict[str, object]) -> None:
        self.conn.execute(
            """
            INSERT INTO sessions (token_hash, user_id, csrf_hash, expires_at)
            VALUES (%s, %s, %s, %s)
            """,
            (stored["token_hash"], user_id, stored["csrf_hash"], stored["expires_at"]),
        )

    def get_session(self, token_hash: str) -> dict[str, object] | None:
        row = self.conn.execute(
            """
            SELECT user_id, csrf_hash, expires_at, revoked_at
            FROM sessions
            WHERE token_hash = %s AND revoked_at IS NULL AND expires_at > NOW()
            """,
            (token_hash,),
        ).fetchone()
        if not row:
            return None
        return {"user_id": str(row[0]), "csrf_hash": row[1], "expires_at": row[2], "revoked_at": row[3]}

    def revoke_session(self, token_hash: str) -> None:
        self.conn.execute(
            "UPDATE sessions SET revoked_at = NOW() WHERE token_hash = %s AND revoked_at IS NULL",
            (token_hash,),
        )

    def load_model_settings(self, user_id: str, master_key: str) -> list[dict[str, object]]:
        rows = self.conn.execute(
            """
            SELECT provider, slot, model_id,
                   CASE WHEN api_key_cipher IS NULL THEN NULL
                        ELSE pgp_sym_decrypt(api_key_cipher, %s)::TEXT END AS api_key,
                   selected
            FROM model_settings WHERE user_id = %s
            """,
            (master_key, user_id),
        ).fetchall()
        return [
            {"provider": row[0], "slot": row[1], "model_id": row[2], "api_key": row[3], "selected": row[4]}
            for row in rows
        ]

    def save_model(
        self,
        user_id: str,
        model: dict[str, str],
        api_key: str | None,
        remove_key: bool,
        master_key: str,
    ) -> None:
        with self.conn.transaction():
            self.conn.execute("UPDATE model_settings SET selected = FALSE WHERE user_id = %s", (user_id,))
            self.conn.execute(
                """
                INSERT INTO model_settings (user_id, provider, slot, model_id, api_key_cipher, selected)
                VALUES (
                    %s, %s, %s, %s,
                    CASE WHEN %s::TEXT IS NULL THEN NULL
                         ELSE pgp_sym_encrypt(%s::TEXT, %s, 'cipher-algo=aes256') END,
                    TRUE
                )
                ON CONFLICT (user_id, provider) DO UPDATE SET
                    slot = EXCLUDED.slot,
                    model_id = EXCLUDED.model_id,
                    api_key_cipher = CASE
                        WHEN %s THEN NULL
                        WHEN EXCLUDED.api_key_cipher IS NOT NULL THEN EXCLUDED.api_key_cipher
                        ELSE model_settings.api_key_cipher
                    END,
                    selected = TRUE,
                    updated_at = NOW()
                """,
                (
                    user_id,
                    model["id"],
                    model["slot"],
                    model["modelId"],
                    api_key,
                    api_key,
                    master_key,
                    remove_key,
                ),
            )

    def load_ima(self, master_key: str) -> dict[str, object] | None:
        row = self.conn.execute(
            "SELECT pgp_sym_decrypt(credentials_cipher, %s)::TEXT, expires_on, updated_at FROM ima_settings WHERE singleton",
            (master_key,),
        ).fetchone()
        if not row:
            return None
        value = json.loads(row[0])
        value["expiresAt"] = row[1].isoformat()
        value["updatedAt"] = row[2].isoformat()
        return value

    def save_ima(self, value: dict[str, object], master_key: str) -> None:
        payload = json.dumps({"clientId": value["clientId"], "apiKey": value["apiKey"]}, ensure_ascii=False)
        self.conn.execute(
            """
            INSERT INTO ima_settings (singleton, credentials_cipher, expires_on, updated_at)
            VALUES (TRUE, pgp_sym_encrypt(%s, %s, 'cipher-algo=aes256'), %s, NOW())
            ON CONFLICT (singleton) DO UPDATE SET
                credentials_cipher = EXCLUDED.credentials_cipher,
                expires_on = EXCLUDED.expires_on,
                updated_at = NOW()
            """,
            (payload, master_key, value["expiresAt"]),
        )

    def take_admin_attempt(self, scope_hash: str, now: datetime, limit: int = 5) -> bool:
        with self.conn.transaction():
            row = self.conn.execute(
                "SELECT failures, window_started FROM login_attempts WHERE scope_hash = %s FOR UPDATE",
                (scope_hash,),
            ).fetchone()
            if row and (now - row[1]).total_seconds() < 900 and row[0] >= limit:
                return False
            if not row or (now - row[1]).total_seconds() >= 900:
                self.conn.execute(
                    """
                    INSERT INTO login_attempts (scope_hash, window_started, failures) VALUES (%s, %s, 1)
                    ON CONFLICT (scope_hash) DO UPDATE SET window_started = EXCLUDED.window_started, failures = 1
                    """,
                    (scope_hash, now),
                )
            else:
                self.conn.execute("UPDATE login_attempts SET failures = failures + 1 WHERE scope_hash = %s", (scope_hash,))
        return True

    def create_or_get_batch(
        self, user_id: str, batch_id: str, request_id_hash: str, state: dict[str, object]
    ) -> dict[str, object]:
        from psycopg.types.json import Jsonb

        with self.conn.transaction():
            self.conn.execute(
                """
                INSERT INTO batches (id, user_id, tenant_id, request_id_hash, state, seq, status)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (user_id, request_id_hash) DO NOTHING
                """,
                (batch_id, user_id, state.get("tenantId"), request_id_hash, Jsonb(state), state["seq"], state["status"]),
            )
            row = self.conn.execute(
                "SELECT state FROM batches WHERE user_id = %s AND request_id_hash = %s",
                (user_id, request_id_hash),
            ).fetchone()
        return row[0]

    def get_batch(self, user_id: str, batch_id: str) -> dict[str, object] | None:
        row = self.conn.execute(
            "SELECT state, pause_requested FROM batches WHERE id = %s AND user_id = %s", (batch_id, user_id)
        ).fetchone()
        return {**row[0], 'pauseRequested': row[1]} if row else None

    def pause_requested(self, batch_id):
        row = self.conn.execute('SELECT pause_requested FROM batches WHERE id = %s FOR UPDATE', (batch_id,)).fetchone()
        return bool(row and row[0])

    def set_pause_requested(self, batch_id, requested):
        self.conn.execute('UPDATE batches SET pause_requested = %s WHERE id = %s', (requested, batch_id))

    def has_step_claim(self, batch_id, seq):
        return bool(self.conn.execute('SELECT 1 FROM batch_claims WHERE batch_id = %s AND seq = %s AND recovered_at IS NULL', (batch_id, seq)).fetchone())

    def list_batches(self, user_id: str) -> list[dict[str, object]]:
        rows = self.conn.execute(
            "SELECT state FROM batches WHERE user_id = %s ORDER BY created_at DESC LIMIT 500", (user_id,)
        ).fetchall()
        return [row[0] for row in rows]

    def has_active_batch(self, user_id: str) -> bool:
        row = self.conn.execute(
            "SELECT 1 FROM batches WHERE user_id = %s AND status NOT IN ('completed', 'cancelled') LIMIT 1",
            (user_id,),
        ).fetchone()
        return bool(row)

    def claim_step(self, batch_id: str, seq: int) -> bool:
        with self.conn.transaction():
            batch = self.conn.execute('SELECT seq, status, pause_requested FROM batches WHERE id = %s FOR UPDATE', (batch_id,)).fetchone()
            if not batch or batch != (seq, 'ready', False):
                return False
            row = self.conn.execute(
                """INSERT INTO batch_claims (batch_id, seq) VALUES (%s, %s)
                   ON CONFLICT (batch_id, seq) DO NOTHING RETURNING batch_id""", (batch_id, seq)
            ).fetchone()
            return bool(row)

    def claim_is_stale(self, batch_id: str, seq: int, now: datetime) -> bool:
        row = self.conn.execute(
            "SELECT claimed_at, recovered_at FROM batch_claims WHERE batch_id = %s AND seq = %s",
            (batch_id, seq),
        ).fetchone()
        return bool(row and row[1] is None and (now - row[0]).total_seconds() >= 150)

    def recover_step(self, batch_id: str, seq: int, now: datetime, allow_failed: bool = False) -> bool:
        if allow_failed:
            row = self.conn.execute(
                """
                INSERT INTO batch_claims (batch_id, seq, claimed_at, recovered_at)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (batch_id, seq) DO UPDATE SET recovered_at = EXCLUDED.recovered_at
                WHERE batch_claims.recovered_at IS NULL
                RETURNING batch_id
                """,
                (batch_id, seq, now, now),
            ).fetchone()
            return bool(row)
        row = self.conn.execute(
            """
            UPDATE batch_claims SET recovered_at = %s
            WHERE batch_id = %s AND seq = %s AND recovered_at IS NULL
              AND (%s OR claimed_at <= %s - INTERVAL '150 seconds')
            RETURNING batch_id
            """,
            (now, batch_id, seq, False, now),
        ).fetchone()
        return bool(row)

    def save_batch(
        self, user_id: str, batch_id: str, state: dict[str, object], expected_seq: int
    ) -> bool:
        from psycopg.types.json import Jsonb

        result = self.conn.execute(
            """
            UPDATE batches SET state = %s, seq = %s, status = %s, updated_at = NOW()
            WHERE id = %s AND user_id = %s AND seq = %s
            """,
            (Jsonb(state), state["seq"], state["status"], batch_id, user_id, expected_seq),
        )
        return result.rowcount == 1




_SCHEMA_READY: set[str] = set()
_SCHEMA_LOCK = Lock()


@contextmanager
def postgres_repository(database_url: str) -> Iterator[PostgresRepository]:
    with connection(database_url) as conn:
        if database_url not in _SCHEMA_READY:
            with _SCHEMA_LOCK:
                if database_url not in _SCHEMA_READY:
                    ensure_schema(conn)
                    _SCHEMA_READY.add(database_url)
        yield PostgresRepository(conn)
