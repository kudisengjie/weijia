# Python PostgreSQL Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the failing Node/Blob runtime with an EdgeOne Python 3.10 FastAPI backend backed by PostgreSQL while preserving the latest GEO frontend and `/api/*` contract.

**Architecture:** `cloud-functions/api/[[default]].py` exposes one FastAPI application and imports focused modules from `cloud-functions/geo_backend`. A request-scoped psycopg connection talks to Neon through `DATABASE_URL`; schema creation is serialized with a PostgreSQL advisory lock. Login configuration remains in existing EdgeOne variables, while sessions, encrypted provider credentials, IMA overrides, and batch checkpoints are durable PostgreSQL rows.

**Tech Stack:** EdgeOne Python Cloud Functions, Python 3.10, FastAPI, psycopg 3, httpx, PostgreSQL/pgcrypto, pypdf, python-docx, Node frontend build.

---

### Task 1: Lock the deployment and compatibility contract

**Files:**
- Create: `geo-site/cloud-functions/requirements.txt`
- Modify: `geo-site/edgeone.json`
- Modify: `geo-site/DEPLOYMENT.md`
- Test: `geo-site/tests_py/test_config.py`

- [ ] **Step 1: Write the failing configuration test**

```python
def test_required_configuration_includes_database_url():
    from geo_backend.config import Settings
    settings = Settings.from_mapping({})
    assert "DATABASE_URL" in settings.missing
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python -m unittest tests_py.test_config -v`
Expected: FAIL because `geo_backend.config` does not exist.

- [ ] **Step 3: Add pinned Python dependencies and Python duration configuration**

```text
fastapi
psycopg[binary]
httpx
pydantic
pypdf
python-docx
```

Set `cloudFunctions.python.maxDuration` to 120 seconds and document the existing seven variables plus the new `DATABASE_URL`. Do not record any values.

- [ ] **Step 4: Implement configuration parsing**

`Settings.from_mapping()` must validate `APP_ORIGIN`, `GEO_ACCOUNT`, the existing scrypt hash format, the 64-hex-character `GEO_MASTER_KEY`, IMA variables, and a PostgreSQL URL containing `sslmode=require`.

- [ ] **Step 5: Re-run the configuration test**

Run: `python -m unittest tests_py.test_config -v`
Expected: PASS.

### Task 2: Build the PostgreSQL and security foundation

**Files:**
- Create: `geo-site/cloud-functions/geo_backend/__init__.py`
- Create: `geo-site/cloud-functions/geo_backend/config.py`
- Create: `geo-site/cloud-functions/geo_backend/database.py`
- Create: `geo-site/cloud-functions/geo_backend/schema.py`
- Create: `geo-site/cloud-functions/geo_backend/security.py`
- Test: `geo-site/tests_py/test_security.py`
- Test: `geo-site/tests_py/test_schema.py`

- [ ] **Step 1: Write failing scrypt, token, and schema tests**

```python
def test_node_scrypt_hash_is_verified_by_python():
    encoded = make_node_compatible_hash("secret")
    assert verify_password("secret", encoded)
    assert not verify_password("wrong", encoded)

def test_schema_contains_durable_runtime_tables():
    for name in ("users", "sessions", "model_settings", "ima_settings", "batches", "batch_claims"):
        assert f"CREATE TABLE IF NOT EXISTS {name}" in SCHEMA_SQL
```

- [ ] **Step 2: Run tests and observe the expected missing-module failure**

Run: `python -m unittest tests_py.test_security tests_py.test_schema -v`
Expected: FAIL because the security and schema modules do not exist.

- [ ] **Step 3: Implement Node-compatible scrypt and opaque sessions**

Use `hashlib.scrypt(n=16384, r=8, p=1, dklen=64)` to verify `scrypt:<salt>:<hash>`. Generate independent 32-byte session and CSRF values, store only SHA-256 digests, and compare with `hmac.compare_digest`.

- [ ] **Step 4: Implement schema and connection helpers**

The schema uses `pgcrypto`, stable user IDs, expiring sessions, atomic login throttling, encrypted `bytea` secrets via `pgp_sym_encrypt`, JSONB batch state, and unique `(batch_id, seq)` claims. `ensure_schema()` must take a transaction-scoped advisory lock before applying idempotent DDL.

- [ ] **Step 5: Re-run security and schema tests**

Run: `python -m unittest tests_py.test_security tests_py.test_schema -v`
Expected: PASS.

### Task 3: Implement real login, session, logout, and health APIs

**Files:**
- Create: `geo-site/cloud-functions/geo_backend/errors.py`
- Create: `geo-site/cloud-functions/geo_backend/repository.py`
- Create: `geo-site/cloud-functions/geo_backend/auth.py`
- Create: `geo-site/cloud-functions/geo_backend/app.py`
- Create: `geo-site/cloud-functions/api/[[default]].py`
- Delete: `geo-site/cloud-functions/api/[[path]].js`
- Test: `geo-site/tests_py/test_auth.py`
- Test: `geo-site/tests_py/test_app_contract.py`

- [ ] **Step 1: Write failing repository-backed auth tests**

Test successful login, incorrect credentials, five-failure throttling, HttpOnly/Secure/SameSite cookie flags, session expiry, CSRF rejection, logout revocation, and a database health response that exposes no secrets.

- [ ] **Step 2: Run the tests and verify they fail for missing behavior**

Run: `python -m unittest tests_py.test_auth tests_py.test_app_contract -v`
Expected: FAIL because the auth service and FastAPI app do not exist.

- [ ] **Step 3: Implement the repository and authentication service**

Seed or synchronize the single configured account by username and password hash, create sessions in PostgreSQL, use atomic login-failure counters, and never query model settings or IMA storage before authentication succeeds.

- [ ] **Step 4: Implement FastAPI routing and error responses**

Expose `/health`, `/auth/login`, `/auth/session`, and `/auth/logout` under the file-system `/api` prefix. Preserve JSON `{error, code}` failures, validate `Origin` for mutations, and set `Cache-Control: private, no-store`.

- [ ] **Step 5: Re-run auth contract tests**

Run: `python -m unittest tests_py.test_auth tests_py.test_app_contract -v`
Expected: PASS.

### Task 4: Migrate model and IMA credential operations

**Files:**
- Create: `geo-site/cloud-functions/geo_backend/models.py`
- Create: `geo-site/cloud-functions/geo_backend/providers.py`
- Create: `geo-site/cloud-functions/geo_backend/ima.py`
- Extend: `geo-site/cloud-functions/geo_backend/repository.py`
- Extend: `geo-site/cloud-functions/geo_backend/app.py`
- Test: `geo-site/tests_py/test_settings.py`
- Test: `geo-site/tests_py/test_providers.py`
- Test: `geo-site/tests_py/test_ima.py`

- [ ] **Step 1: Write failing settings and outbound request tests**

Cover eight provider IDs, two model slots, custom model IDs, encrypted key persistence, key removal, real-test request payloads, MiMo `api-key`, disabled thinking flags, IMA environment fallback, admin update throttling, and validation-before-save.

- [ ] **Step 2: Run tests and verify expected failures**

Run: `python -m unittest tests_py.test_settings tests_py.test_providers tests_py.test_ima -v`
Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement encrypted settings and provider clients**

Use PostgreSQL `pgp_sym_encrypt`/`pgp_sym_decrypt` with `GEO_MASTER_KEY`, associate settings with stable `users.id`, and call providers with `httpx` without automatic retries.

- [ ] **Step 4: Implement IMA fallback and update flow**

Return environment IMA credentials when no database override exists. Verify new credentials can access `copilot` before atomically replacing the encrypted override.

- [ ] **Step 5: Re-run settings/provider/IMA tests**

Run: `python -m unittest tests_py.test_settings tests_py.test_providers tests_py.test_ima -v`
Expected: PASS.

### Task 5: Migrate durable batch execution without duplicate model calls

**Files:**
- Create: `geo-site/cloud-functions/geo_backend/tasks.py`
- Create: `geo-site/cloud-functions/geo_backend/batches.py`
- Extend: `geo-site/cloud-functions/geo_backend/ima.py`
- Extend: `geo-site/cloud-functions/geo_backend/app.py`
- Test: `geo-site/tests_py/test_batches.py`

- [ ] **Step 1: Write failing batch state-machine tests**

Cover request ID idempotency, stable ownership, state persistence, unique `(batch_id, seq)` claims, stale-step recovery without an outbound call, one external operation per accepted sequence, failure persistence, list/history, and completed article output.

- [ ] **Step 2: Run tests and verify the expected missing-module failure**

Run: `python -m unittest tests_py.test_batches -v`
Expected: FAIL because the batch service does not exist.

- [ ] **Step 3: Port the current state machine to PostgreSQL**

Persist the whole batch state as JSONB, use transactions and unique claims before external calls, keep the existing explicit recovery semantics, and preserve the frontend summary/article schema.

- [ ] **Step 4: Port IMA source reading**

Use `httpx`, `pypdf`, and `python-docx`; enforce the existing HTTPS host allowlist, header denylist, file/page/character limits, and no automatic retries.

- [ ] **Step 5: Re-run batch tests**

Run: `python -m unittest tests_py.test_batches -v`
Expected: PASS.

### Task 6: Update the frontend diagnostic contract and deployment records

**Files:**
- Modify: `geo-site/src/runtime.js`
- Modify: `geo-site/src/runtime-auth.test.mjs`
- Modify: `geo-site/DEPLOYMENT.md`
- Modify: `docs/superpowers/checkpoints/ACTIVE-GEO-PROGRESS.md`

- [ ] **Step 1: Write a failing frontend message test**

```javascript
assert.doesNotMatch(runtime, /Node Functions|EdgeOne Blob/);
assert.match(runtime, /Python Cloud Functions|PostgreSQL/);
```

- [ ] **Step 2: Run the focused frontend test and observe failure**

Run: `node --test src/runtime-auth.test.mjs`
Expected: FAIL because the current error still mentions Node Functions.

- [ ] **Step 3: Update only runtime-facing diagnostics**

Keep the UI and API paths unchanged. Replace obsolete Node/Blob guidance with precise Python/PostgreSQL deployment guidance and retain user-friendly error codes.

- [ ] **Step 4: Build the public output**

Run: `npm run build`
Expected: PASS and `dist` contains only `index.html`, `styles.css`, `favicon.ico`, and `assets`.

- [ ] **Step 5: Update deployment and progress documentation**

Record exact local verification results, the new `DATABASE_URL` requirement, schema bootstrap behavior, and separate local/GitHub/online status. Do not record secrets.

### Task 7: Verify, checkpoint, push, and perform online acceptance

**Files:**
- Verify all files changed above.

- [ ] **Step 1: Run the new Python suite once**

Run: `python -m unittest discover -s tests_py -v`
Expected: all Python tests PASS.

- [ ] **Step 2: Run only affected existing frontend tests and build once**

Run: `node --test src/runtime-auth.test.mjs src/model-switch.test.mjs && npm run build`
Expected: PASS.

- [ ] **Step 3: Inspect the staged diff for secrets and obsolete runtime entry points**

Run: `git diff --check` and verify `.local`, database URLs, passwords, API keys, and the removed Node function entry are absent from the commit.

- [ ] **Step 4: Create a local Git checkpoint and push the feature commit to the authorized GitHub target**

Commit the migration with a focused message, then push according to the existing repository handoff instructions. Record the exact commit IDs.

- [ ] **Step 5: Configure `DATABASE_URL`, redeploy, and run real online acceptance once**

After the owner creates Neon and adds `DATABASE_URL`, verify `/api/health`, wrong-password rejection, successful login, authenticated session refresh, logout, encrypted model key save/read, IMA status, and one explicitly authorized real model/IMA request. Do not repeat passed checks.
