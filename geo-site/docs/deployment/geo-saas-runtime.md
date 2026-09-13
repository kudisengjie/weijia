# GEO SaaS runtime deployment

This document is the operator handoff for the Python Cloud Functions and Neon PostgreSQL runtime. It does not contain credentials, passwords, API keys, or database connection strings.

## EdgeOne Pages environment variables

Configure these in the production environment, then create a new deployment from the intended Git commit:

- APP_ORIGIN: the public HTTPS origin, for example https://geo.example.test
- GEO_ACCOUNT: the owner login account
- GEO_PASSWORD_HASH: the owner scrypt hash in the existing scrypt format
- GEO_MASTER_KEY: a 64-character hexadecimal encryption key
- DATABASE_URL: the Neon pooled PostgreSQL URL with sslmode=require
- IMA_ADMIN_SECRET: an owner-only secret of at least 24 characters
- IMA_OPENAPI_CLIENTID: the owner IMA OpenAPI client id
- IMA_OPENAPI_APIKEY: the owner IMA OpenAPI key

The IMA values are server-only. Model API keys are entered by each member in the settings page and encrypted in PostgreSQL. Never place any key in HTML, JavaScript, Git, screenshots, or this document.

## Neon setup

Use the Neon Connect dialog for the production branch and database. Enable connection pooling and copy the pooled URL into DATABASE_URL. The Python startup lock runs the schema migration and reports schemaVersion 2 from /api/health.

The migration creates tenant membership, subscription, credit, shared IMA cache, model snapshot, article artifact, and job tables. It is idempotent. Do not manually delete these tables to repair a deployment.

## Worker setup

EdgeOne handles login, settings, bounded batch steps, polling, and artifact downloads. A separate Python process may run geo_backend.worker.run_forever with the same DATABASE_URL and environment encryption values. The worker claims one queued or expired lease at a time, uses a 90 second lease, and shares the same idempotent BatchService transitions. It must not be configured to retry failed provider calls automatically.

For a scheduled invocation, call one BatchWorker.run_once tick per invocation. For a long-running service, use run_forever with a bounded interval and a graceful shutdown handler.

## IMA cache operations

The cache is site-wide for the owner tenant and all subaccounts. Payloads are encrypted in Neon. A cache hit does not call IMA. Only the knowledge-base pages, search results, and media required by a task are fetched. Updating IMA credentials or pressing the owner cache-clear action increments the cache generation; the next required read creates a fresh entry.

Use the owner settings action to clear the generation. Do not truncate cache tables in production because audit history and concurrent jobs rely on generation isolation.

## Credits and subscriptions

The owner grants or revokes credits from the workbench. Payment is outside the website; the workbench displays the provided WeChat contact QR and does not process payments. A batch reserves one credit per valid Excel task. A complete encrypted artifact keeps its reservation. Every task without a complete artifact receives exactly one refund, including a failed batch; retrying a failed batch explicitly reopens and reserves those tasks again.

Subaccounts have their own login and model API keys. Each subaccount has a subscription expiry. The server blocks model tests, batch creation, and IMA mutations after expiry while keeping the expiry warning and existing artifact reads visible.

## Verification checklist

1. Confirm the EdgeOne deployment commit equals the local commit intended for release.
2. Open /api/health and verify service available, database available, schemaVersion 2, and ready true.
3. Log in as the owner, confirm the owner workspace and subscription warning, and verify the settings page shows the saved IMA state.
4. Create a test subaccount, set a future expiry, log in with that account, save its own model API key, and confirm the owner IMA state remains shared.
5. Grant enough credits for a two-task test, run it, download the server artifacts, and verify the task-level balance change.
6. Stop a worker or close the browser, then confirm a later EdgeOne poll or worker tick resumes the same batch without duplicate ledger entries.
7. Treat these as separate facts: local commit exists, GitHub push succeeded, and EdgeOne deployed that exact commit. Verify each one independently.
