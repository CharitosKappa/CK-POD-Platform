# Milestone 2 — AI Orchestration Architecture

## Scope

Milestone 2 adds provider-neutral generation orchestration only. It does not add a canvas/editor, prepress, printability scoring, production fulfillment, checkout, or a production moderation policy.

## Generation flow

```text
POST generation request
  → verify project ownership and credit capacity
  → capture immutable product/color and guided-style context
  → extract required exact text and create internal enhanced prompt
  → persist Generation (QUEUED)
  → enqueue durable generation job
  → worker claims job (PROCESSING)
  → pre-generation moderation hooks
  → provider attempts with bounded retry/fallback
  → private source storage (VALIDATING)
  → validation and output-moderation hooks
  → private preview derivative
  → atomic delivery + ledger consume (SUCCEEDED)
```

The consumer status API returns only status, structured exact-text metadata, and controlled preview asset metadata. It never returns enhanced prompts, provider payloads, storage keys, model/provider diagnostics, or permanent storage URLs.

Milestone 4.5 extends this pipeline with a server-resolved Style Family / preset / version and private structured conditioning. It preserves exact text separately, keeps provider translation behind `ImageGenerationService`, and does not expose conditioning or routing hints through consumer APIs.

## Provider contracts and local behavior

Application code routes a task such as `TEXT_TO_ARTWORK` through `ImageGenerationService`; it never depends on a vendor SDK. `AI_PROVIDER_CONFIG` supplies adapter type, task capabilities, priority, model label, estimated cost, timeout, retry count, and fallback eligibility.

The checked-in default contains two deterministic local adapters: SVG primary and pattern fallback. They generate private SVG bytes without network or paid API calls, so CI and local development are reproducible. Real-provider adapters and credentials are deliberately deferred until G1 evaluation; no winner is configured in business logic.

## Persistence and failure behavior

`generations` records the user request and lifecycle. `generation_attempts` records every provider/model attempt, latency, cost, request identifier, retry/fallback outcome, and structured failure category. `assets` records private source-output and preview keys. Attempt metadata is operational and is not returned by consumer APIs.

Provider errors, provider timeouts, invalid provider responses, storage errors, validation failures, moderation rejections, configuration errors, and unknown errors remain distinct. A failed or rejected generation becomes non-consumptive. Retries are bounded by the active provider configuration; a fallback runs only when the previous provider is eligible.

## Credits

`credit_ledger` is the durable record for GRANT, PURCHASE, CONSUME, REFUND, ADJUSTMENT, and EXPIRATION. `credit_accounts.current_balance` is only a locked projection of the ledger, never the sole record of a balance change.

The service grants guests one configurable free credit by default. Registered allowance defaults to zero pending G2. A credit is consumed exactly once, in the transaction that marks a validated private preview as delivered. Provider failures, timeouts, validation rejections, moderation rejections, and fallback attempts do not consume credits. Pending requests count against the available balance to prevent concurrent over-delivery.

## Security boundaries

- Existing project ownership rules gate generation creation and status retrieval.
- API users receive asset IDs and metadata only; private object keys remain server-only.
- Provider credentials are environment-only and no provider diagnostics are exposed by consumer APIs.
- Reference asset IDs must belong to the same project and must be active private `REFERENCE` assets.
- The current rate-limiter port is permissive only for local/MVP composition; a durable abuse throttle remains hardening work.

## G1 benchmark

The versioned development fixture is at `packages/domain/benchmarks/g1-development-fixture.json`. It defines cases, tasks, product/color context, exact-text metadata, and the locked score schema:

- Prompt adherence — 20%
- Visual quality — 20%
- Print suitability — 15%
- Composition control — 10%
- Reference adherence — 10%
- Edit consistency — 10%
- Text handling — 5%
- Latency — 5%
- Cost — 5%

Run the deterministic fixture with `pnpm benchmark:g1`. It emits machine-readable JSON and accepts `G1_BENCHMARK_DATASET` and `G1_MANUAL_SCORES_FILE` environment variables for a full versioned dataset and manually entered/imported scores. The harness reports results; it never selects a winning provider.

## Decision classification

| Item                                                                                                | Classification          | Resolution                                                                                                                              |
| --------------------------------------------------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Task contracts, JSON prompt metadata, local adapters, retries, asset records, and ledger projection | `IMPLEMENTATION DETAIL` | Implemented with the smallest modular-monolith components in ADRs 0012–0016.                                                            |
| G1 provider benchmark                                                                               | `EXECUTION GATE`        | Blocks final provider routing only. The harness and local fixture are ready; provider credentials and human scoring are still required. |
| G2 credit economics                                                                                 | `EXECUTION GATE`        | Blocks final registered allowances and commercial credit pricing only. Current grants remain configurable development defaults.         |

There are no `PRODUCT DECISION REQUIRED` items preventing Milestone 2.
