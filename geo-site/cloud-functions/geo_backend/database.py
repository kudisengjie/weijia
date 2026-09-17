from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator
import re

from .schema import SCHEMA_SQL, SCHEMA_VERSION


_SCHEMA_LOCK_ID = 4_768_636_619


@contextmanager
def connection(database_url: str) -> Iterator[object]:
    import psycopg

    # Explicit transactions cover writes; never hold a transaction across a model request.
    with psycopg.connect(database_url, connect_timeout=10, autocommit=True) as conn:
        yield conn


def ensure_schema(conn: object, master_key: str) -> int:
    if not re.fullmatch(r'[0-9a-f]{64}', master_key):
        raise ValueError('INVALID_MASTER_KEY')
    with conn.transaction():
        conn.execute("SELECT pg_advisory_xact_lock(%s)", (_SCHEMA_LOCK_ID,))
        conn.execute(SCHEMA_SQL)
        if not conn.execute('SELECT 1 FROM schema_migrations WHERE version = 3').fetchone():
            # Upgrade old progress in the same transaction as the version marker.
            # Bind the encrypted envelope to its account and batch to reject swaps.
            conn.execute("""
                UPDATE batches SET state_cipher = pgp_sym_encrypt(
                    jsonb_build_object('userId', user_id::text, 'batchId', id::text, 'state', state)::text,
                    %s, 'cipher-algo=aes256'), state = '{}'::jsonb
                WHERE state_cipher IS NULL
            """, (master_key,))
            conn.execute("ALTER TABLE batches ALTER COLUMN state_cipher SET NOT NULL")
            conn.execute("ALTER TABLE batches ADD CONSTRAINT batches_no_plaintext_state CHECK (state = '{}'::jsonb)")
            conn.execute('INSERT INTO schema_migrations (version) VALUES (3)')
        conn.execute('INSERT INTO schema_migrations (version) VALUES (4) ON CONFLICT (version) DO NOTHING')
        if not conn.execute('SELECT 1 FROM schema_migrations WHERE version = 5').fetchone():
            # v4 → v5：旧批次/旧文件明确回到 server_legacy / pending，再启用交付模式。
            conn.execute("UPDATE batches SET delivery_mode = 'server_legacy' WHERE delivery_mode IS NULL")
            conn.execute("UPDATE article_artifacts SET delivery_state = 'pending' WHERE delivery_state IS NULL")
            conn.execute('INSERT INTO schema_migrations (version) VALUES (5)')
    return SCHEMA_VERSION


def database_health(conn: object) -> dict[str, object]:
    row = conn.execute(
        "SELECT current_database(), COALESCE(MAX(version), 0) FROM schema_migrations"
    ).fetchone()
    return {"database": "available", "schemaVersion": int(row[1]), "ready": int(row[1]) == SCHEMA_VERSION}
