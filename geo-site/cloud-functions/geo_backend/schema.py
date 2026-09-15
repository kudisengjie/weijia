SCHEMA_VERSION = 4

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
ALTER TABLE batches ADD COLUMN IF NOT EXISTS pause_requested BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE batches ADD COLUMN IF NOT EXISTS state_cipher BYTEA;

CREATE TABLE IF NOT EXISTS batch_claims (
    batch_id CHAR(32) NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL CHECK (seq >= 0),
    claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    recovered_at TIMESTAMPTZ,
    PRIMARY KEY (batch_id, seq)
);

CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug VARCHAR(96) NOT NULL UNIQUE,
    name VARCHAR(160) NOT NULL,
    owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tenant_members (
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(16) NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, user_id)
);
CREATE INDEX IF NOT EXISTS tenant_members_user_idx ON tenant_members (user_id, tenant_id);

CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    starts_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (expires_at > starts_at)
);
CREATE INDEX IF NOT EXISTS subscriptions_tenant_expiry_idx ON subscriptions (tenant_id, expires_at DESC);
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS subscriptions_user_expiry_idx ON subscriptions (tenant_id, user_id, expires_at DESC);

CREATE TABLE IF NOT EXISTS credit_accounts (
    tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS member_credit_accounts (
    tenant_id UUID NOT NULL,
    user_id UUID NOT NULL,
    balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, user_id),
    FOREIGN KEY (tenant_id, user_id) REFERENCES tenant_members(tenant_id, user_id) ON DELETE CASCADE
);
-- Preserve any prototype tenant balance once, under that tenant's owner.
INSERT INTO member_credit_accounts (tenant_id, user_id, balance)
SELECT t.id, t.owner_user_id, c.balance FROM tenants t
JOIN credit_accounts c ON c.tenant_id = t.id
JOIN tenant_members tm ON tm.tenant_id = t.id AND tm.user_id = t.owner_user_id
ON CONFLICT (tenant_id, user_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS admin_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    actor_id UUID NOT NULL REFERENCES users(id),
    target_user_id UUID REFERENCES users(id),
    action VARCHAR(64) NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS credit_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    batch_id CHAR(32) REFERENCES batches(id) ON DELETE SET NULL,
    task_id VARCHAR(160),
    kind VARCHAR(24) NOT NULL CHECK (kind IN ('grant', 'reserve', 'consume', 'release', 'refund', 'revoke')),
    amount INTEGER NOT NULL CHECK (amount <> 0),
    idempotency_key VARCHAR(255) NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS credit_ledger_tenant_created_idx ON credit_ledger (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS credit_task_states (
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    batch_id CHAR(32) NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
    task_id VARCHAR(160) NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(16) NOT NULL CHECK (status IN ('reserved', 'complete', 'refunded', 'released')),
    attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (batch_id, task_id)
);
ALTER TABLE credit_task_states ADD COLUMN IF NOT EXISTS attempt INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS ima_cache_meta (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    generation BIGINT NOT NULL DEFAULT 1 CHECK (generation > 0),
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO ima_cache_meta (singleton) VALUES (TRUE) ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE IF NOT EXISTS ima_knowledge_bases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_id VARCHAR(255) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ima_rule_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    knowledge_base_id UUID NOT NULL REFERENCES ima_knowledge_bases(id) ON DELETE CASCADE,
    external_id VARCHAR(255) NOT NULL,
    content_cipher BYTEA NOT NULL,
    content_hash CHAR(64) NOT NULL,
    content_version VARCHAR(160) NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (knowledge_base_id, external_id, content_version)
);

CREATE TABLE IF NOT EXISTS ima_search_cache (
    cache_key CHAR(64) PRIMARY KEY,
    generation BIGINT NOT NULL,
    knowledge_base_id UUID NOT NULL REFERENCES ima_knowledge_bases(id) ON DELETE CASCADE,
    request_key VARCHAR(255) NOT NULL,
    payload_cipher BYTEA NOT NULL,
    content_version VARCHAR(160),
    hit_count INTEGER NOT NULL DEFAULT 0 CHECK (hit_count >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ima_search_cache_lookup_idx
    ON ima_search_cache (generation, knowledge_base_id, request_key);

CREATE TABLE IF NOT EXISTS ima_media_cache (
    cache_key CHAR(64) PRIMARY KEY,
    generation BIGINT NOT NULL,
    knowledge_base_id UUID NOT NULL REFERENCES ima_knowledge_bases(id) ON DELETE CASCADE,
    media_id VARCHAR(255) NOT NULL,
    payload_cipher BYTEA NOT NULL,
    content_version VARCHAR(160),
    hit_count INTEGER NOT NULL DEFAULT 0 CHECK (hit_count >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ima_media_cache_lookup_idx
    ON ima_media_cache (generation, knowledge_base_id, media_id);

CREATE TABLE IF NOT EXISTS ima_cache_locks (
    cache_key CHAR(64) PRIMARY KEY,
    generation BIGINT NOT NULL,
    locked_until TIMESTAMPTZ NOT NULL,
    owner_token CHAR(64) NOT NULL
);

ALTER TABLE batches ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS batches_tenant_created_idx ON batches (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS batch_model_snapshots (
    batch_id CHAR(32) PRIMARY KEY REFERENCES batches(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(32) NOT NULL,
    model_id VARCHAR(160) NOT NULL,
    endpoint TEXT NOT NULL,
    api_key_cipher BYTEA,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS article_artifacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    batch_id CHAR(32) NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
    task_id VARCHAR(160) NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    filename VARCHAR(255) NOT NULL,
    content_cipher BYTEA NOT NULL,
    byte_length INTEGER NOT NULL CHECK (byte_length > 0),
    sha256 CHAR(64) NOT NULL,
    status VARCHAR(16) NOT NULL CHECK (status IN ('complete', 'failed', 'deleted')),
    audit_status VARCHAR(16) NOT NULL CHECK (audit_status IN ('pending', 'accepted', 'rejected')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (batch_id, task_id)
);
CREATE INDEX IF NOT EXISTS article_artifacts_tenant_created_idx ON article_artifacts (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    batch_id CHAR(32) NOT NULL UNIQUE REFERENCES batches(id) ON DELETE CASCADE,
    status VARCHAR(16) NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    lease_until TIMESTAMPTZ,
    locked_at TIMESTAMPTZ,
    next_run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_error TEXT,
    idempotency_key VARCHAR(255) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS jobs_ready_idx ON jobs (status, next_run_at, lease_until);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS lease_token UUID;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ;

INSERT INTO schema_migrations (version) VALUES (1) ON CONFLICT (version) DO NOTHING;
INSERT INTO schema_migrations (version) VALUES (2) ON CONFLICT (version) DO NOTHING;

CREATE TABLE IF NOT EXISTS workspaces (
    id CHAR(32) PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    request_hash CHAR(64) NOT NULL,
    state_cipher BYTEA NOT NULL,
    version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
    status VARCHAR(16) NOT NULL CHECK (status IN ('draft', 'started', 'archived')),
    batch_id CHAR(32) UNIQUE REFERENCES batches(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, request_hash),
    CHECK ((status = 'started') = (batch_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS workspaces_user_status_idx ON workspaces(user_id, status);
"""
