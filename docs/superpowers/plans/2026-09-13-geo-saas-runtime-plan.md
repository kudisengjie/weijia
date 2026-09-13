# GEO SaaS Runtime, Shared IMA Cache, Credits, and Durable Jobs Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Turn the current EdgeOne-hosted GEO site into a reliable multi-tenant application. Keep the owner-controlled IMA knowledge base shared across the site, let each tenant member use their own model API keys, charge one credit per valid Excel task, refund exactly one credit for each task that does not produce a complete article artifact, enforce subscription expiry, and finish jobs even when the browser is closed.

**Architecture:** Python HTTP handlers remain the public API. Neon PostgreSQL becomes the source of truth for tenants, subscriptions, credits, encrypted IMA cache, batch snapshots, durable article artifacts, and resumable jobs. A bounded EdgeOne runner handles short interactive runs; an independent Python worker drains the same job table for long or disconnected runs. All state-changing operations use idempotency keys and database transactions.

**Tech Stack:** Python 3, existing EdgeOne function adapter, psycopg PostgreSQL driver, Neon pooled connection URL, existing browser runtime, pytest, Playwright smoke checks.

---

## File map and contracts

Create or update only these areas unless tests prove a different existing boundary is required:

- geo-site/cloud-functions/geo_backend/schema.py: schema version 2 migration and constraints.
- geo-site/cloud-functions/geo_backend/repository.py: transactional repositories for tenants, access, credits, cache, snapshots, artifacts, and jobs.
- geo-site/cloud-functions/geo_backend/auth.py and app.py: authenticated tenant context, owner/member permissions, and routes.
- geo-site/cloud-functions/geo_backend/batches.py and ima.py: snapshot, cache, credit, artifact, and resumable execution integration.
- geo-site/cloud-functions/geo_backend/worker.py: lease-based independent worker entry point.
- geo-site/runtime.js and geo-site/index.html or the current settings/batch templates: UI state, model locking, artifact downloads, expiry, credits, cache controls, and QR display.
- geo-site/tests_py/fakes.py and geo-site/tests_py/test_*.py: deterministic unit and contract coverage.
- geo-site/docs/deployment/geo-saas-runtime.md: EdgeOne variables, Neon URL, worker deployment, and acceptance checklist.

The following invariants are mandatory:

- A credit ledger entry has a unique tenant id plus idempotency key; retries cannot double-charge or double-refund.
- A batch reserves one credit for every valid task before any IMA call. A task is complete only when model output is nonempty, audit status is accepted, and a durable artifact row is saved with positive byte length, hash, and complete status.
- Each incomplete task refunds exactly one reserved credit. Tasks never started release their reservation. A successful task keeps its charge.
- The selected provider, model id, endpoint, and encrypted API key are copied into an immutable batch snapshot at batch creation. Settings changes affect only future batches.
- IMA cache rows are site-wide and keyed by cache generation, knowledge-base id, normalized request, and relevant content version. A cache hit performs no IMA request. The owner clear operation increments generation and invalidates all prior rows without deleting audit history.
- IMA credentials and cache payloads are encrypted at rest and never returned to the browser. Only the owner can update credentials, knowledge-base ids, cache generation, and credit/subscription administration.

## Task 1: Add the schema v2 migration

- [ ] Add a failing schema test in geo-site/tests_py/test_schema.py that expects schema version 2 and the new tables and constraints.
- [ ] Implement a forward-only migration in geo-site/cloud-functions/geo_backend/schema.py. Keep the existing v1 tables and add:
  - tenants, tenant_members, subscriptions
  - credit_accounts and credit_ledger
  - ima_cache_meta, ima_knowledge_bases, ima_rule_documents, ima_search_cache, ima_media_cache, ima_cache_locks
  - batch_model_snapshots, article_artifacts, jobs
- [ ] Add foreign keys, tenant membership uniqueness, subscription start-before-expiry checks, nonzero ledger amounts, artifact status checks, and a unique ledger constraint on tenant plus idempotency key.
- [ ] Make migration startup-safe and idempotent; update SCHEMA_VERSION to 2 only after all statements succeed.
- [ ] Run: pytest -q geo-site/tests_py/test_schema.py. Confirm the pre-change test fails, then the implementation passes.
- [ ] Commit: git commit -am "feat: add SaaS runtime schema v2"

## Task 2: Establish tenant and subscription context

- [ ] Add failing tests for owner, admin, and member permissions, missing membership, and expired subscriptions.
- [ ] Extend geo-site/cloud-functions/geo_backend/auth.py and repository.py to resolve a session to one tenant context, role, and active subscription. Use UTC timestamps and a single server-side clock.
- [ ] Create an initial owner tenant deterministically from the existing owner account during migration; do not place credentials or passwords in source or progress files.
- [ ] Return a stable authorization error shape with code, message, and expiry timestamp. Permit read-only expiry warnings before expiry and reject batch creation, model tests, and IMA operations after expiry.
- [ ] Run the focused auth tests and commit: git commit -am "feat: enforce tenant membership and subscription expiry"

## Task 3: Implement atomic credit reserve, consume, release, and refund

- [ ] Add failing repository and batch tests for a five-task batch, one failed artifact, retrying the same request, concurrent reservation, and expiry.
- [ ] Implement credit transactions with row locking: reserve N credits once per batch, create one reservation ledger record per task, consume on complete artifact, release unstarted tasks, and refund one for each incomplete task.
- [ ] Store task-level finalization state so a repeated worker step cannot refund or charge twice. Use idempotency keys derived from tenant, batch, task, and transition.
- [ ] Expose owner-only credit adjustment and ledger history routes. Expose member balance and task-level outcome without revealing other tenants.
- [ ] Run: pytest -q geo-site/tests_py/test_credits.py geo-site/tests_py/test_batches.py. Commit: git commit -am "feat: add idempotent credits and refunds"

## Task 4: Replace per-batch IMA evidence with a shared encrypted cache

- [ ] Add failing tests proving the same normalized request from two batches causes one IMA call, an owner generation clear causes a miss, unrelated knowledge bases are not fetched, and a failed upstream request is not cached as valid content.
- [ ] Refactor geo-site/cloud-functions/geo_backend/ima.py and repository.py to read and write the Neon cache tables. Use normalized KB id, query, media id, and content version keys; acquire a short database lock for misses; encrypt payloads before persistence.
- [ ] Fetch only the knowledge-base documents and media required by the current task. Keep source metadata and cache provenance for audit, but never send the owner token to the browser.
- [ ] Add owner-only cache status, clear-generation, and refresh routes. Include generation and hit/miss counts in the owner dashboard.
- [ ] Run the IMA cache tests and commit: git commit -am "feat: add site-wide encrypted IMA cache"

## Task 5: Snapshot model settings and make active batches immutable

- [ ] Add failing tests that change default model settings while a batch is running and verify the active batch continues with its original provider, model, endpoint, and key snapshot.
- [ ] At batch creation, validate the member model configuration, encrypt the API key, and write batch_model_snapshots in the same transaction as the batch and credit reservations.
- [ ] Remove runtime reads of mutable default settings from active batch execution. Add explicit status fields for provider readiness, invalid key, timeout, rate limit, and upstream error.
- [ ] Keep the existing model catalog UI and API shape; add current model ids from provider configuration without hard-coding secrets. Disable model changes for an active batch and allow selection only after completion or cancellation.
- [ ] Run model snapshot and provider contract tests and commit: git commit -am "feat: lock model credentials per batch"

## Task 6: Persist article artifacts and make output recoverable

- [ ] Add failing tests for empty output, audit rejection, repair failure, successful artifact save, duplicate artifact save, and download authorization.
- [ ] Add article_artifacts with encrypted markdown or object reference, byte length, SHA-256, status, audit result, task id, and created timestamp. Store the artifact before marking the task complete.
- [ ] Add authenticated artifact list and download routes. Browser downloads must use the server artifact route rather than an in-memory Blob. Preserve the user-selected local save path in browser storage and ask once before the first download; document that browsers cannot silently write arbitrary paths.
- [ ] Update batch state to reference artifact ids and task outcomes, not large inline article bodies. Keep a migration-compatible read path for existing batches.
- [ ] Run artifact tests and commit: git commit -am "feat: persist recoverable article artifacts"

## Task 7: Build the bounded EdgeOne runner and PC layout updates

- [ ] Add failing app contract tests for POST batch run, bounded phase advancement, polling, active-batch model lock, credit display, expiry warning, and artifact links.
- [ ] Add POST /api/batches/{id}/run with a bounded step budget and idempotency key. Return running, completed, failed, or expired state plus next-poll information; never run an unbounded loop in one EdgeOne request.
- [ ] Update geo-site/runtime.js to poll and resume safely, disable model controls while running, display per-task credit outcomes, and show a clear retry or download action. Keep the current API-key custom model flow unchanged.
- [ ] Apply the approved PC typography/layout plan: Microsoft YaHei first, readable body text, proportional status cards, centered mascot and paired login copy, responsive desktop grid, and mobile safeguards. Do not change the existing mobile behavior unless a regression test catches it.
- [ ] Run app contract tests and the browser smoke test at desktop and mobile widths. Commit: git commit -am "feat: add bounded runner and readable desktop UI"

## Task 8: Add the independent Python worker

- [ ] Add failing worker tests for lease acquisition, lease expiry recovery, duplicate delivery, graceful shutdown, and no work when all tasks are complete.
- [ ] Implement geo-site/cloud-functions/geo_backend/worker.py using the same BatchService as the EdgeOne runner. Claim jobs with a transaction and row lock, use a 90-second lease with heartbeat, advance a bounded number of phases, and release the lease on shutdown.
- [ ] Ensure worker and HTTP runner share idempotency, artifact finalization, credit settlement, and cache locks. A worker crash must leave the job resumable and must not duplicate a credit transition.
- [ ] Add a small command entry point and health output suitable for a container or scheduled process. Commit: git commit -am "feat: add resumable Python batch worker"

## Task 9: Add owner SaaS controls and payment-free QR instructions

- [ ] Add failing permission/UI tests for owner-only actions and member read-only views.
- [ ] Add owner routes and settings screens for tenants, subaccounts, 30-day subscription dates, credit grants/revocations, ledger inspection, IMA credential refresh, cache clear, and worker health.
- [ ] Keep payment outside the website. Add the existing personal WeChat QR image as a static asset with a concise contact instruction; do not add payment APIs or collect payment credentials.
- [ ] Show members remaining credits, expiry date, warning threshold, configured model status, and task-level refunds. Ensure tenant data is scoped in every query.
- [ ] Run owner/member UI contract tests and commit: git commit -am "feat: add owner SaaS controls and QR guidance"

## Task 10: End-to-end verification and deployment handoff

- [ ] Add an end-to-end fake-IMA/fake-provider test: create tenant, configure a member model, upload five tasks, verify one shared IMA miss then hits, complete four artifacts, fail one artifact, verify four charges plus one refund, close and resume through the worker, and download all completed files.
- [ ] Add negative tests for expired subscription, missing IMA credentials, invalid model key, duplicate run requests, cross-tenant artifact access, and a batch model change while running.
- [ ] Run the smallest relevant commands after each task, then the full suite: pytest -q geo-site/tests_py; npm test --prefix geo-site when available; git diff --check.
- [ ] Update geo-site/docs/deployment/geo-saas-runtime.md with exact EdgeOne environment variable names, Neon pooled URL format, encryption key rotation steps, worker deployment, cache generation procedure, and a checklist distinguishing local commit, GitHub push, and EdgeOne deployment.
- [ ] Verify no secrets, passwords, admin keys, or local environment files are present in tracked files. Commit: git commit -am "test: verify GEO SaaS runtime end to end"

## Self-review checklist

- [ ] Every user requirement is mapped: shared owner-only IMA cache, per-member model keys, current model catalog, immutable running batches, durable output, one-credit-per-task, exact per-task refunds, 30-day expiry, owner controls, QR-only payment instructions, and both bounded EdgeOne and independent worker execution paths.
- [ ] All state transitions are transactional and idempotent under retries and concurrent requests.
- [ ] No browser-only state is required for job completion or credit settlement.
- [ ] Tests cover normal, retry, crash, expiry, permission, and cross-tenant paths.
- [ ] The deployment document explains what the operator must configure and how to verify the deployed commit.
