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
        self, tenant_id: str, user_id: str | None, starts_at: datetime, expires_at: datetime
    ) -> dict[str, object]:
        with self.conn.transaction():
            self.conn.execute(
                "UPDATE subscriptions SET status = 'revoked' WHERE tenant_id = %s AND user_id IS NOT DISTINCT FROM %s AND status = 'active'",
                (tenant_id, user_id),
            )
            row = self.conn.execute(
                "INSERT INTO subscriptions (tenant_id, user_id, starts_at, expires_at, status) VALUES (%s, %s, %s, %s, 'active') RETURNING id, expires_at",
                (tenant_id, user_id, starts_at, expires_at),
            ).fetchone()
        return {"id": str(row[0]), "expiresAt": row[1]}

    def ensure_owner_tenant(self, user_id: str, slug: str = "owner") -> dict[str, object]:
        with self.conn.transaction():
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
                         expires_at DESC NULLS LAST
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

    def reserve_task_credits(
        self, tenant_id: str, user_id: str, batch_id: str, task_ids: list[str]
    ) -> dict[str, object]:
        from psycopg.types.json import Jsonb

        with self.conn.transaction():
            new_ids = []
            for task_id in task_ids:
                existing = self.conn.execute(
                    "SELECT 1 FROM credit_task_states WHERE batch_id = %s AND task_id = %s",
                    (batch_id, task_id),
                ).fetchone()
                if not existing:
                    new_ids.append(task_id)
            account = self.conn.execute(
                "SELECT balance FROM credit_accounts WHERE tenant_id = %s FOR UPDATE",
                (tenant_id,),
            ).fetchone()
            balance = int(account[0]) if account else 0
            if balance < len(new_ids):
                raise ValueError("INSUFFICIENT_CREDITS")
            reserved = 0
            for task_id in new_ids:
                inserted = self.conn.execute(
                    """
                    INSERT INTO credit_task_states (tenant_id, batch_id, task_id, user_id, status)
                    VALUES (%s, %s, %s, %s, 'reserved')
                    ON CONFLICT (batch_id, task_id) DO NOTHING
                    RETURNING task_id
                    """,
                    (tenant_id, batch_id, task_id, user_id),
                ).fetchone()
                if not inserted:
                    continue
                reserved += 1
                self.conn.execute(
                    "UPDATE credit_accounts SET balance = balance - 1, updated_at = NOW() WHERE tenant_id = %s",
                    (tenant_id,),
                )
                self.conn.execute(
                    """
                    INSERT INTO credit_ledger (tenant_id, user_id, batch_id, task_id, kind, amount, idempotency_key, metadata)
                    VALUES (%s, %s, %s, %s, 'reserve', -1, %s, %s)
                    ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
                    """,
                    (tenant_id, user_id, batch_id, task_id, f"{batch_id}:{task_id}:reserve", Jsonb({"reason": "batch_start"})),
                )
            return {"reserved": reserved, "balance": balance - reserved}

    def settle_task_credit(
        self, tenant_id: str, batch_id: str, task_id: str, complete: bool
    ) -> dict[str, object]:
        from psycopg.types.json import Jsonb

        with self.conn.transaction():
            row = self.conn.execute(
                """
                SELECT status, user_id FROM credit_task_states
                WHERE tenant_id = %s AND batch_id = %s AND task_id = %s
                FOR UPDATE
                """,
                (tenant_id, batch_id, task_id),
            ).fetchone()
            if not row:
                return {"status": "missing", "refunded": False}
            status, user_id = row
            if status != "reserved":
                return {"status": status, "refunded": False}
            if complete:
                self.conn.execute(
                    "UPDATE credit_task_states SET status = 'complete', updated_at = NOW() WHERE batch_id = %s AND task_id = %s",
                    (batch_id, task_id),
                )
                return {"status": "complete", "refunded": False}
            self.conn.execute(
                "UPDATE credit_task_states SET status = 'refunded', updated_at = NOW() WHERE batch_id = %s AND task_id = %s",
                (batch_id, task_id),
            )
            self.conn.execute(
                "UPDATE credit_accounts SET balance = balance + 1, updated_at = NOW() WHERE tenant_id = %s",
                (tenant_id,),
            )
            self.conn.execute(
                """
                INSERT INTO credit_ledger (tenant_id, user_id, batch_id, task_id, kind, amount, idempotency_key, metadata)
                VALUES (%s, %s, %s, %s, 'refund', 1, %s, %s)
                ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
                """,
                (tenant_id, user_id, batch_id, task_id, f"{batch_id}:{task_id}:refund", Jsonb({"reason": "incomplete_artifact"})),
            )
            return {"status": "refunded", "refunded": True}

    def release_unstarted_credits(
        self, tenant_id: str, batch_id: str, task_ids: list[str]
    ) -> dict[str, object]:
        from psycopg.types.json import Jsonb

        with self.conn.transaction():
            released = 0
            for task_id in task_ids:
                row = self.conn.execute(
                    "SELECT status, user_id FROM credit_task_states WHERE tenant_id = %s AND batch_id = %s AND task_id = %s FOR UPDATE",
                    (tenant_id, batch_id, task_id),
                ).fetchone()
                if not row or row[0] != "reserved":
                    continue
                self.conn.execute(
                    "UPDATE credit_task_states SET status = 'released', updated_at = NOW() WHERE batch_id = %s AND task_id = %s",
                    (batch_id, task_id),
                )
                self.conn.execute(
                    "UPDATE credit_accounts SET balance = balance + 1, updated_at = NOW() WHERE tenant_id = %s",
                    (tenant_id,),
                )
                self.conn.execute(
                    """
                    INSERT INTO credit_ledger (tenant_id, user_id, batch_id, task_id, kind, amount, idempotency_key, metadata)
                    VALUES (%s, %s, %s, %s, 'release', 1, %s, %s)
                    ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
                    """,
                    (tenant_id, row[1], batch_id, task_id, f"{batch_id}:{task_id}:release", Jsonb({"reason": "not_started"})),
                )
                released += 1
            account = self.conn.execute(
                "SELECT balance FROM credit_accounts WHERE tenant_id = %s",
                (tenant_id,),
            ).fetchone()
            return {"released": released, "balance": int(account[0]) if account else 0}

    def settle_batch_incomplete(self, tenant_id: str, batch_id: str) -> dict[str, object]:
        from psycopg.types.json import Jsonb

        with self.conn.transaction():
            rows = self.conn.execute(
                "SELECT task_id, user_id FROM credit_task_states WHERE tenant_id = %s AND batch_id = %s AND status = 'reserved' FOR UPDATE",
                (tenant_id, batch_id),
            ).fetchall()
            for task_id, user_id in rows:
                self.conn.execute(
                    "UPDATE credit_task_states SET status = 'refunded', updated_at = NOW() WHERE batch_id = %s AND task_id = %s",
                    (batch_id, task_id),
                )
                self.conn.execute(
                    "INSERT INTO credit_ledger (tenant_id, user_id, batch_id, task_id, kind, amount, idempotency_key, metadata) VALUES (%s, %s, %s, %s, 'refund', 1, %s, %s) ON CONFLICT (tenant_id, idempotency_key) DO NOTHING",
                    (tenant_id, user_id, batch_id, task_id, f"{batch_id}:{task_id}:refund", Jsonb({"reason": "batch_failed"})),
                )
            if rows:
                self.conn.execute(
                    "UPDATE credit_accounts SET balance = balance + %s, updated_at = NOW() WHERE tenant_id = %s",
                    (len(rows), tenant_id),
                )
            account = self.conn.execute("SELECT balance FROM credit_accounts WHERE tenant_id = %s", (tenant_id,)).fetchone()
            return {"refunded": len(rows), "balance": int(account[0]) if account else 0}

    def reopen_batch_credits(self, tenant_id: str, user_id: str, batch_id: str) -> dict[str, object]:
        from psycopg.types.json import Jsonb

        with self.conn.transaction():
            rows = self.conn.execute(
                "SELECT task_id, attempt FROM credit_task_states WHERE tenant_id = %s AND batch_id = %s AND status IN ('refunded', 'released') FOR UPDATE",
                (tenant_id, batch_id),
            ).fetchall()
            account = self.conn.execute("SELECT balance FROM credit_accounts WHERE tenant_id = %s FOR UPDATE", (tenant_id,)).fetchone()
            balance = int(account[0]) if account else 0
            if balance < len(rows):
                raise ValueError("INSUFFICIENT_CREDITS")
            for task_id, attempt in rows:
                next_attempt = int(attempt) + 1
                self.conn.execute(
                    "UPDATE credit_task_states SET status = 'reserved', attempt = %s, updated_at = NOW() WHERE batch_id = %s AND task_id = %s",
                    (next_attempt, batch_id, task_id),
                )
                self.conn.execute(
                    "INSERT INTO credit_ledger (tenant_id, user_id, batch_id, task_id, kind, amount, idempotency_key, metadata) VALUES (%s, %s, %s, %s, 'reserve', -1, %s, %s) ON CONFLICT (tenant_id, idempotency_key) DO NOTHING",
                    (tenant_id, user_id, batch_id, task_id, f"{batch_id}:{task_id}:reserve:{next_attempt}", Jsonb({"reason": "batch_retry"})),
                )
            if rows:
                self.conn.execute(
                    "UPDATE credit_accounts SET balance = balance - %s, updated_at = NOW() WHERE tenant_id = %s",
                    (len(rows), tenant_id),
                )
            return {"reopened": len(rows), "balance": balance - len(rows)}

    def credit_balance(self, tenant_id: str) -> int:
        row = self.conn.execute("SELECT balance FROM credit_accounts WHERE tenant_id = %s", (tenant_id,)).fetchone()
        return int(row[0]) if row else 0

    def adjust_credits(
        self, tenant_id: str, user_id: str, amount: int, idempotency_key: str, kind: str, metadata: dict[str, object] | None = None
    ) -> dict[str, object]:
        from psycopg.types.json import Jsonb

        if not amount or kind not in {"grant", "revoke"}:
            raise ValueError("INVALID_CREDIT_ADJUSTMENT")
        signed = abs(int(amount)) if kind == "grant" else -abs(int(amount))
        with self.conn.transaction():
            existing = self.conn.execute(
                "SELECT amount FROM credit_ledger WHERE tenant_id = %s AND idempotency_key = %s",
                (tenant_id, idempotency_key),
            ).fetchone()
            if existing:
                return {"applied": False, "amount": int(existing[0]), "balance": self.credit_balance(tenant_id)}
            account = self.conn.execute(
                "SELECT balance FROM credit_accounts WHERE tenant_id = %s FOR UPDATE",
                (tenant_id,),
            ).fetchone()
            balance = int(account[0]) if account else 0
            if balance + signed < 0:
                raise ValueError("INSUFFICIENT_CREDITS")
            self.conn.execute(
                "INSERT INTO credit_accounts (tenant_id, balance) VALUES (%s, %s) ON CONFLICT (tenant_id) DO UPDATE SET balance = credit_accounts.balance + EXCLUDED.balance, updated_at = NOW()",
                (tenant_id, signed),
            )
            self.conn.execute(
                "INSERT INTO credit_ledger (tenant_id, user_id, kind, amount, idempotency_key, metadata) VALUES (%s, %s, %s, %s, %s, %s)",
                (tenant_id, user_id, kind, signed, idempotency_key, Jsonb(metadata or {})),
            )
            return {"applied": True, "amount": signed, "balance": balance + signed}

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

    def acquire_ima_cache_lock(self, cache_key: str, generation: int, owner_token: str, lock_seconds: int = 30) -> bool:
        with self.conn.transaction():
            self.conn.execute("DELETE FROM ima_cache_locks WHERE locked_until <= NOW()")
            row = self.conn.execute(
                """
                INSERT INTO ima_cache_locks (cache_key, generation, locked_until, owner_token)
                VALUES (%s, %s, NOW() + (%s || ' seconds')::INTERVAL, %s)
                ON CONFLICT (cache_key) DO NOTHING
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
                request_key = json.dumps(metadata, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
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
        row = self.conn.execute(
            """
            INSERT INTO article_artifacts (
                tenant_id, batch_id, task_id, user_id, filename, content_cipher,
                byte_length, sha256, status, audit_status
            )
            VALUES (%s, %s, %s, %s, %s, pgp_sym_encrypt(%s, %s, 'cipher-algo=aes256'), %s, %s, %s, %s)
            ON CONFLICT (batch_id, task_id) DO UPDATE SET
                filename = EXCLUDED.filename,
                content_cipher = EXCLUDED.content_cipher,
                byte_length = EXCLUDED.byte_length,
                sha256 = EXCLUDED.sha256,
                status = EXCLUDED.status,
                audit_status = EXCLUDED.audit_status
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
        return {
            "id": str(row[0]),
            "filename": row[1],
            "byteLength": int(row[2]),
            "sha256": row[3],
            "status": row[4],
            "auditStatus": row[5],
        }

    def get_article_artifact(self, tenant_id: str, artifact_id: str, master_key: str = "") -> dict[str, object] | None:
        row = self.conn.execute(
            """
            SELECT id, batch_id, task_id, filename, pgp_sym_decrypt(content_cipher, %s)::TEXT,
                   byte_length, sha256, status, audit_status, created_at
            FROM article_artifacts
            WHERE tenant_id = %s AND id = %s AND status = 'complete'
            """,
            (master_key, tenant_id, artifact_id),
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
                WHERE j.status IN ('queued', 'running') AND (j.lease_until IS NULL OR j.lease_until < NOW())
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
                    updated_at = NOW()
                WHERE id = %s
                RETURNING attempts
                """,
                (lease_seconds, row[0]),
            ).fetchone()
            return {"id": str(row[0]), "batchId": row[1], "userId": str(row[2]), "seq": int(row[3]), "attempts": int(updated[0])}

    def finish_job(self, job_id: str, status: str) -> None:
        final_status = status if status in {"completed", "failed", "cancelled"} else "queued"
        self.conn.execute(
            "UPDATE jobs SET status = %s, lease_until = NULL, locked_at = NULL, next_run_at = NOW(), updated_at = NOW() WHERE id = %s",
            (final_status, job_id),
        )

    def fail_job(self, job_id: str, message: str) -> None:
        self.conn.execute(
            "UPDATE jobs SET status = 'failed', last_error = %s, lease_until = NULL, locked_at = NULL, updated_at = NOW() WHERE id = %s",
            (message[:4000], job_id),
        )

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
            "SELECT state FROM batches WHERE id = %s AND user_id = %s", (batch_id, user_id)
        ).fetchone()
        return row[0] if row else None

    def list_batches(self, user_id: str) -> list[dict[str, object]]:
        rows = self.conn.execute(
            "SELECT state FROM batches WHERE user_id = %s ORDER BY created_at DESC LIMIT 500", (user_id,)
        ).fetchall()
        return [row[0] for row in rows]

    def has_active_batch(self, user_id: str) -> bool:
        row = self.conn.execute(
            "SELECT 1 FROM batches WHERE user_id = %s AND status = 'ready' LIMIT 1",
            (user_id,),
        ).fetchone()
        return bool(row)

    def claim_step(self, batch_id: str, seq: int) -> bool:
        row = self.conn.execute(
            """
            INSERT INTO batch_claims (batch_id, seq) VALUES (%s, %s)
            ON CONFLICT (batch_id, seq) DO NOTHING
            RETURNING batch_id
            """,
            (batch_id, seq),
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
