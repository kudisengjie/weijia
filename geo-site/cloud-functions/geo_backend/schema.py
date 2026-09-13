SCHEMA_VERSION = 1

SCHEMA_SQL = r"""
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(128) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_uniq ON users (LOWER(username));

CREATE TABLE IF NOT EXISTS sessions (
    token_hash CHAR(64) PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    csrf_hash CHAR(64) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sessions_user_expiry_idx ON sessions (user_id, expires_at DESC);

CREATE TABLE IF NOT EXISTS login_attempts (
    scope_hash CHAR(64) PRIMARY KEY,
    window_started TIMESTAMPTZ NOT NULL,
    failures INTEGER NOT NULL DEFAULT 0 CHECK (failures >= 0)
);

CREATE TABLE IF NOT EXISTS model_settings (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(32) NOT NULL,
    slot VARCHAR(16) NOT NULL CHECK (slot IN ('primary', 'secondary')),
    model_id VARCHAR(160) NOT NULL,
    api_key_cipher BYTEA,
    selected BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, provider)
);
CREATE UNIQUE INDEX IF NOT EXISTS model_settings_one_selected_per_user
    ON model_settings (user_id) WHERE selected;

CREATE TABLE IF NOT EXISTS ima_settings (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    credentials_cipher BYTEA NOT NULL,
    expires_on DATE NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS batches (
    id CHAR(32) PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    request_id_hash CHAR(64) NOT NULL,
    state JSONB NOT NULL,
    seq INTEGER NOT NULL DEFAULT 0 CHECK (seq >= 0),
    status VARCHAR(16) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, request_id_hash)
);
CREATE INDEX IF NOT EXISTS batches_user_created_idx ON batches (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS batch_claims (
    batch_id CHAR(32) NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL CHECK (seq >= 0),
    claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    recovered_at TIMESTAMPTZ,
    PRIMARY KEY (batch_id, seq)
);

INSERT INTO schema_migrations (version) VALUES (1) ON CONFLICT (version) DO NOTHING;
"""
