# M10 Operations Runbook

## Backup and restore

Take PostgreSQL backups with `pg_dump -Fc --schema=app`; retain encrypted backups according to the deployment retention policy. Restore only into an empty isolated database, create `pgcrypto` and schema `app`, then run `pg_restore --exit-on-error`. Verify table count and relationship counts for users, projects, orders, payments, refunds, fulfillment and audit history before declaring the drill successful. Do not restore over production in place.

## Recovery

- Generation/prepress/moderation failure: inspect the persisted generation or prepress row, correct the recoverable cause, then replay only its idempotent job.
- Fulfillment or webhook failure: inspect `order_fulfillment_actions` and operational audits; never create an external order manually outside M7's explicit trusted submit action.
- Lifecycle failure: inspect `lifecycle_deliveries`; retries retain the delivery idempotency key.
- Payment/refund incident: inspect payment events and refund idempotency records before contacting Stripe or retrying.
- Queue backlog: confirm Redis health and worker replicas, then restart workers; generation startup recovers stale `PROCESSING` claims older than fifteen minutes. Duplicate deliveries are expected and must remain idempotent. Inspect retained failed BullMQ jobs after bounded retries before deciding whether an idempotent replay is safe; do not delete a poison job as a substitute for diagnosis.

The executed 2026-09-01 local drill is recorded in the M10 architecture evidence: an interrupted
child worker recovered one active job with one canonical side effect, while a three-attempt poison
job remained retained and was recovered only by trusted `job.retry()` using its original identity.
Never replay an ambiguous external fulfillment, refund, or lifecycle operation merely because a
queue job failed; inspect its persistent idempotency/audit record first.

## Privacy lifecycle operations

Use `PrivacyLifecycleService` to inspect a user-linked dry-run inventory before any action. A
retention hold blocks anonymization and unfinished-project deletion. Account anonymization
invalidates sessions, suppresses marketing, pseudonymizes eligible profile/lifecycle fields, and
preserves orders, payments, refunds, fulfillment, and immutable audit relationships. Expired
unfinished projects are deletable only when they have no cart or order-item lineage; use the
private storage adapter and the explicit service method, never a bulk database cascade. Counsel
controls the legal retention conditions and durations; see the M10 architecture evidence and G5.

## Incident containment and kill switches

Set an explicit kill switch and roll web/worker configuration normally: `GENERATION_ENABLED=false` stops generation intake and consumers, `CHECKOUT_ENABLED=false` stops new checkout creation without interrupting already-created payments, `PRINTIFY_PRODUCTION_SUBMISSION_ENABLED=false` blocks trusted production submission, and `LIFECYCLE_MARKETING_ENABLED=false` suppresses marketing only while preserving transactional lifecycle delivery. Production-submission shutdown leaves paid orders in their existing canonical state for later trusted review; it never deletes fulfillment action history. Preserve logs and operational audits. Credential-suspicion incidents require secret rotation, webhook-secret rotation and session invalidation review.

## Deploy and rollback

1. Run migrations before deploying code that requires them.
2. Deploy web and workers with validated production configuration.
3. Check `/api/health`, `/api/ready`, worker logs, and the [canonical launch smoke checklist](./launch-smoke-checklist.md) with sandbox adapters.
4. Roll back application code only if its database migration is backward compatible; otherwise use a forward fix. Never roll back a destructive migration without a tested restore plan.

Schedule `pnpm rate-limit:prune` once per day with the same database credentials as the web service. The reverse proxy must remove incoming `X-Forwarded-For` and inject the canonical client address before requests reach the web application.

For a reproducible local rate-limiter contention probe, run `M10_RATE_LIMIT_REQUESTS=100 M10_RATE_LIMIT_CONCURRENCY=10 pnpm load:m10-rate-limit`. It uses distinct temporary bucket keys, reports latency percentiles and RSS, and removes only its own keys. It is a local database probe, not a storefront capacity claim.

For a bounded local mixed-database smoke, run `M10_MIXED_LOAD_REQUESTS=100 M10_MIXED_LOAD_CONCURRENCY=10 pnpm load:m10-mixed-db`. It interleaves ordinary project reads, generation rate-limit checks, checkout and payment-webhook reads, and Ops order reads. It performs no provider action and removes only its own temporary rate-limit keys. This is deliberately not a browser/API end-to-end capacity test.

For a controlled local libvips resource smoke, run `M10_SHARP_RENDER_REQUESTS=4 M10_SHARP_RENDER_CONCURRENCY=2 pnpm load:m10-sharp`. It renders the canonical 3600×4800 production fixture, records percentiles/RSS, and fails if any render fails or hashes differ. It is a bounded determinism/resource test, not a production render-capacity claim.

## Alerts

Alert on readiness failures, elevated 5xx, generation/fulfillment/lifecycle failure spikes, queue backlog, webhook failures and database/storage connectivity errors. Each alert starts with this runbook and the corresponding persisted operational record.
