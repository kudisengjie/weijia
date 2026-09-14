from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

from .schema import SCHEMA_SQL, SCHEMA_VERSION


_SCHEMA_LOCK_ID = 4_768_636_619


@contextmanager
def connection(database_url: str) -> Iterator[object]:
    import psycopg

    # Explicit transactions cover writes; never hold a transaction across a model request.
    with psycopg.connect(database_url, connect_timeout=10, autocommit=True) as conn:
        yield conn


def ensure_schema(conn: object) -> int:
    with conn.transaction():
        conn.execute("SELECT pg_advisory_xact_lock(%s)", (_SCHEMA_LOCK_ID,))
        conn.execute(SCHEMA_SQL)
    return SCHEMA_VERSION


def database_health(conn: object) -> dict[str, object]:
    row = conn.execute(
        "SELECT current_database(), COALESCE(MAX(version), 0) FROM schema_migrations"
    ).fetchone()
    return {"database": "available", "schemaVersion": int(row[1]), "ready": int(row[1]) == SCHEMA_VERSION}
