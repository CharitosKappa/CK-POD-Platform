# Milestone 10 — Hardening and Launch Readiness

## Security boundary

Browser mutations pass the same-origin middleware guard; signed payment and fulfillment webhooks are explicitly excluded because their adapter signature checks are the authentication boundary. Authenticated-session rotation creates a new token at login or guest-to-account conversion and invalidates the prior session, preventing session fixation. Logout invalidates the persisted session and clears the secure, HTTP-only, `SameSite=Lax` cookie.

Sensitive API limits use a PostgreSQL-backed shared fixed-window counter. This is distributed across web instances and deliberately fails closed when the database is unavailable. Login, registration, generation, regeneration and checkout creation are bounded; editor autosave is intentionally not throttled. There is currently no browser upload endpoint. Provider-generated artwork is nevertheless untrusted: its claimed MIME, bytes, dimensions and SVG active content are validated before private storage. Any future browser upload must use this boundary plus decode-based verification before storage.

Authenticated limits are bound to the session/user subject as well as the ingress-provided client address; guest and unauthenticated limits remain address-scoped. The deployment reverse proxy must strip client-supplied forwarding headers and set its own address header. Bucket pruning runs outside the hot path through `pnpm rate-limit:prune`, so normal request traffic never performs a table-wide cleanup.

Rate-limit database failures are intentionally propagated as failures rather than allowing an abuse-sensitive request through. The enforcement statement is one atomic PostgreSQL upsert, tested with concurrent contenders and a simulated unavailable database; autosave is deliberately outside this limiter so normal editor persistence is not throttled.

Sensitive service boundaries are deny-by-default. Project, generation, cart, order, and controlled-preview reads match the canonical session/user owner in SQL, returning an indistinguishable not-found result for guessed cross-user IDs. Production masters, source assets, and provider derivatives are never eligible controlled previews. CX search, refund, reprint, defect, credits, analytics, visibility, and audit data require `ADMIN`, `CX_OPS`, or `FULFILLMENT_ADMIN`; a `PREPRESS_REVIEWER` is deliberately insufficient for CX mutation. Fulfillment-provider economics require fulfillment authorization, and production submission remains limited to the M7 trusted operational roles.

Production configuration fails fast unless private S3, Redis, Stripe, Printify, secure cookies and both webhook secrets are configured. Fake adapters remain local/CI-only. Production submission remains separately disabled unless its existing explicit M7 switch is enabled.

For local monorepo execution, the web instrumentation hook explicitly loads the repository root `.env` only in development and without overriding already-supplied process values. This prevents a false startup failure caused by Next resolving its own package directory as the environment-file root; deployed environments do not load that file and must provide their own configuration.

## Production configuration parsing

All security-sensitive flags use a strict parser that accepts only the lowercase strings `true` and `false`; values such as `FALSEE`, `0abc`, `yesplease`, `1`, `0`, or an empty string are validation errors. There is no JavaScript-truthiness configuration path. Adapter, storage, queue, tax, lifecycle, Node, and application environment values are enum allowlists; unknown values, including `APP_ENV=prod`, fail before a runtime is created. `APP_ENV` is limited to `local`, `test`, `staging`, and `production`.

In production, fake payment/fulfillment, memory storage, memory queue, missing private-storage credentials, unsafe cookies, and missing Stripe/Printify webhook credentials are all startup failures. The fake payment-confirmation route also parses the central configuration before deciding whether it may run, so a raw environment value cannot bypass adapter validation. Moderation has no environment bypass: the M8 policy evaluator is instantiated for every generation runtime and its final-artwork gate remains mandatory before production.

## Health and dependencies

`/api/health` is process liveness only. `/api/ready` verifies configuration, database connectivity, and (when configured) an actual Redis connection; it returns HTTP 503 when traffic cannot safely be served. Redis is a critical production dependency by configuration, while Klaviyo is non-critical: an outage marks delivery failed for operational recovery but does not make storefront readiness fail.

Generation workers recover `PROCESSING` generations older than fifteen minutes at startup by returning them to `QUEUED` and sending them through the existing atomic claim/finalization path. Credit consumption and asset delivery are transactional, so duplicate queue delivery or recovery cannot create a second consumption record. BullMQ retains failed jobs (`removeOnFail: false`) for operator inspection; poison jobs exhaust their bounded attempts and remain in the failed queue rather than being silently discarded.

The local Redis-backed queue drill verifies a failed job is retried once and that its completed side effect happens exactly once. Application-specific recovery additionally relies on the generation claim/finalization record, fulfillment-action idempotency record, refund idempotency record, and lifecycle-delivery idempotency key. A lifecycle provider failure is persisted as `FAILED`; an operator must diagnose it before a deliberate replay rather than automatically issuing a second customer message from the same trigger.

The middleware creates or forwards `x-request-id` into handlers and response headers. Representative web logs correlate `requestId → projectId → generationId`, `requestId → cartId → checkoutId`, and `requestId → orderNumber → trusted operations action`; workers log the generation identifier and fulfillment audit records retain the order/action relationship. The logger redacts prompts, exact text, customer/address/payment fields, artwork/asset/storage fields, URLs, credentials, signatures, webhook material, cookies, and tokens by key name. Safe opaque identifiers (`requestId`, `generationId`, `orderId`, `jobId`, and `externalActionId`) remain available for debugging.

The local 100-request/10-concurrency rate-limit contention smoke recorded 0% errors, p50 3.42 ms, p95 109.27 ms, p99 111.55 ms, and 176.6 MB RSS, with its temporary keys removed and database integrity clean. The separate local mixed PostgreSQL smoke interleaved ordinary project reads, generation rate-limit checks, checkout and payment-webhook reads, and Ops order reads at the same request/concurrency count: 0% errors, p50 1.93 ms, p95 35.96 ms, p99 36.93 ms, and 175.2 MB RSS. Both are bounded local database probes, not production capacity claims or browser/API end-to-end measurements.

The local Sharp/libvips resource smoke rendered the canonical 3600×4800 production fixture four times at concurrency two: 0% errors, one deterministic pixel hash, p50 845.03 ms, p95/p99 1176.44 ms, and 297.2 MB process RSS. This is a bounded workstation measurement that exercises production rendering behavior; capacity requires deployment hardware and mixed-workload evidence.

## Dependency audit

The production dependency audit is run with `pnpm audit --prod --audit-level=high`. During M10 it identified the advisory for `drizzle-orm` versions below `0.45.2`; the database package was upgraded to `0.45.2` and the same audit then reported no known production vulnerabilities. Package-manager warnings about unapproved native build scripts remain intentional until each build script is explicitly reviewed in deployment; they do not enable a production capability by default.

## Data protection and recovery

Assets are private storage objects and only controlled previews for an authorized project owner are delivered. Production masters and provider derivatives have no consumer retrieval path. Storage keys are never exposed by the asset API.

The current application has no browser upload route and accepts no user-controlled filename or extension. Generated/private object keys are server-created from UUIDs and the validated content type; unsafe absolute/traversal paths are rejected by storage. MIME spoofing, malformed image bytes, unsupported formats, oversized payloads and excessive/decompression-bomb-style dimensions are rejected before persistent preview/source assets or renderer work.

The local M10 restore drill used `pg_dump -Fc --schema=app` from `letitbe`, restored it into isolated database `letitbe_m10_restore`, provisioned only the required empty `app` schema and `pgcrypto` extension, and verified 66 restored tables plus users/projects/orders/payments/refunds/audit records. This validates database schema/data recovery only; S3 durability and object restore are provider-managed and require deployment-specific evidence.

The integrity diagnostic rejects an unexplained `DELIVERED` order: it must have either an `order_shipments` row or authoritative normalized fulfillment history of `SHIPPED`/`DELIVERED`. This deliberately permits a provider event that has not yet produced carrier details, but never treats raw, unnormalized provider text as evidence of delivery.

## Availability target

99.9% is an operational target, not a locally proven guarantee. It depends on web/worker replicas, PostgreSQL, Redis, object storage, Stripe, Printify and DNS/hosting. Load balancers should use liveness for restart decisions and readiness for traffic admission. Non-critical lifecycle failures must alert operators without failing readiness.

## Browser and accessibility evidence

**BROWSER QA — PASS (manual host-browser evidence)** as of 2026-09-01. The initial Firefox `localhost:3000` connection refusal coincided with no Next.js development process listening on port 3000; it was not sufficient evidence of a Codex in-app Browser URL-policy-only blocker. The supported development command now starts a process listening on `0.0.0.0:3000` and `[::]:3000`; host-loopback requests to both `localhost` and `127.0.0.1`, including health and readiness, return 200. Manual execution against the reachable host application passed in Firefox desktop at 1440×900, Chrome desktop at 1440×900, Chrome tablet at 768×1024, and Chrome mobile at 390×844. Keyboard navigation, focus behavior, forms/errors, dialogs, accessible names/semantics, contrast/readability, and catalog failure/retry also passed with no defects reported. Browser version and session type were not recorded in the supplied evidence.

The Codex in-app browser still blocks `/api/catalog/products` with `net::ERR_BLOCKED_BY_CLIENT`; host requests to that endpoint return 200. It is therefore a tooling limitation, not catalog API evidence, and is not used for the manual browser QA result. No browser policy, firewall, tunnel, or public deployment was changed.

The product-selector catalog request has explicit loading, ready, and error states. A bounded ten-second request timeout prevents an indefinitely pending network request from leaving a consumer on a loading message. Its retry repeats only the read-only catalog request; a project is still created solely by the existing continuation action after a successful selection.

### Manual browser QA checklist

Run this in a normal desktop Firefox, Chrome, or Edge session against `http://localhost:3000` with the local database and Redis running. Record browser/version, viewport, account/session type, PASS/FAIL, and defects for every row. Use no real payment or production provider credentials.

| Viewport          | Required journey evidence                                                                                                                                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop, 1440×900 | Product/color selection; Describe Your Idea; Style Family/Substyle; generation loading/error; editor controls; proof approval; cart and fake checkout; login/register; Ops queue/dashboard with an authorized local account. |
| Tablet, 768×1024  | Product/color selection, guided creation, editor initialization, proof/cart/checkout, and responsive navigation without horizontal overflow.                                                                                 |
| Mobile, 390×844   | Product/color selection, guided creation, editor initialization/controls, proof/cart/checkout, auth forms, focus visibility, and touch targets without horizontal overflow.                                                  |

For each viewport, complete keyboard-only `Tab`/`Shift+Tab` traversal, activate primary actions with the keyboard, confirm a visible logical focus order, inspect accessible names for buttons/links, verify every form field has a label and errors are associated with the relevant field, check modal/dialog focus containment and return, and review primary landmarks/headings plus obvious text/background contrast. Capture screenshots and the browser accessibility tree where the normal browser tooling permits it. Log any failure before declaring launch readiness.

## Development environment loader

The development-only root `.env` loader uses the Node 22 `process.loadEnvFile` runtime API after locating the repository root from `pnpm-workspace.yaml`. It never runs outside `NODE_ENV=development`, tolerates an absent optional root `.env`, and preserves already-supplied process environment values. The prior loader imported `dotenv` and used a static `new URL('../../.env', import.meta.url)` path; Next bundled instrumentation code and tried to resolve both as application dependencies, which caused `next dev` to fail before listening. The replacement keeps environment-file resolution inside the Node runtime and has regression tests for root discovery, development-only loading, and production non-loading.
