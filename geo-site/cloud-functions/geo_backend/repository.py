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
                INSERT INTO batches (id, user_id, request_id_hash, state, seq, status)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (user_id, request_id_hash) DO NOTHING
                """,
                (batch_id, user_id, request_id_hash, Jsonb(state), state["seq"], state["status"]),
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
