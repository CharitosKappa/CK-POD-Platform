# M10 Launch Smoke Checklist

Run this checklist for each deployment candidate. It is executable with a sandbox
configuration first; it does not authorize real payment, AI, or fulfillment actions.
Production configuration must separately satisfy its fail-closed validation.

## Preconditions

- Record the deployment revision, operator, date/time, environment, and adapter modes.
- Use only fake/sandbox AI, payment, fulfillment, and lifecycle adapters for this drill.
- Never place a real Printify order or invoke a paid provider from this checklist.
- Stop immediately on a failed safety check; retain the request/action IDs and logs.

## Execution record — 2026-09-01, local M10 sandbox

Environment: Node `22.19.0`, pnpm `10.33.0`, Docker Engine `29.7.2`, PostgreSQL 16
and Redis 7 containers. `APP_ENV=local`; fake AI, payment, fulfillment, tax, storage,
and lifecycle adapters; Redis queue; synthetic qualification fixtures only.

| Check                                                                      | Command / evidence                                                                                                                   | Result                                                               |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Production-mode fail-closed configuration                                  | `packages/config/src/index.test.ts`: fake adapters, unsafe cookies, missing secrets, malformed flags, and unknown adapters reject    | PASS                                                                 |
| Required local configuration/secrets                                       | Root `.env` parsed through the same server config parser; only local fake adapter values present                                     | PASS                                                                 |
| Database and Redis                                                         | Docker containers healthy; `/api/ready` returned 200 with database `ready` and Redis queue `configured`                              | PASS                                                                 |
| Private storage configuration                                              | Local memory implementation of the private-object interface only; production S3 requirement tested fail-closed                       | PASS                                                                 |
| Health/readiness                                                           | `GET /api/health` = 200; `GET /api/ready` = 200                                                                                      | PASS                                                                 |
| Migrations and diagnostics                                                 | `pnpm db:migrate`, `pnpm db:verify`, `pnpm db:integrity`                                                                             | PASS                                                                 |
| Storefront/catalog                                                         | `GET /api/catalog/products` = 200 and returned the synthetic development catalog                                                     | PASS                                                                 |
| Guest session; registration/login/logout                                   | `identity-projects.integration.test.ts` owns guest migration, session rotation, login and invalidation                               | PASS                                                                 |
| Product/color, prompt/style, generation, editor, prepress/proof            | Catalog, generation, styles, prepress and editor integration tests with deterministic fake providers                                 | PASS                                                                 |
| Cart and test-payment checkout                                             | `commerce.integration.test.ts` fake checkout/payment flow                                                                            | PASS                                                                 |
| PAID → reviews → compliance → routing → readiness                          | `commerce.integration.test.ts` canonical M7 fake lifecycle                                                                           | PASS                                                                 |
| Production kill switch and trusted fake submission                         | M7 operations integration: READY has zero side effects; disabled production submission preserves the order; trusted fake action only | PASS                                                                 |
| Shipment/delivery reconciliation                                           | Fake normalized webhook/polling lifecycle through `DELIVERED`                                                                        | PASS                                                                 |
| Refund, reprint, provider defect and Ops authorization                     | M9/M10 commerce and operations integration tests                                                                                     | PASS                                                                 |
| No production on payment webhook; blocked compliance; unqualified provider | M7 negative-path integration assertions                                                                                              | PASS                                                                 |
| Private source/production assets                                           | Asset privacy/MIME-spoof tests; no storage key is returned to consumers                                                              | PASS                                                                 |
| Generation, checkout, production and lifecycle kill switches               | Config and operational-capability tests plus M7 negative-path integration                                                            | PASS                                                                 |
| Transactional lifecycle and marketing suppression                          | Lifecycle and privacy integration tests                                                                                              | PASS                                                                 |
| Correlation and redaction                                                  | HTTP responses carried request IDs; structured-log redaction regression tests                                                        | PASS                                                                 |
| Manual viewport/browser sweep                                              | Previous accepted Firefox/Chrome desktop/tablet/mobile evidence; not re-run by this non-interactive local checklist                  | SKIPPED — operator must record it for a release requiring UI changes |

Final local sandbox smoke result: **PASS**. No real payment, AI, lifecycle, or Printify production action was performed.

## Operator completion

Attach the exact command output, revision, environment configuration fingerprint (never
secrets), browser evidence when required, and any request/order/action identifiers to the
release record. A failed, skipped, or changed safety item requires explicit release review.
