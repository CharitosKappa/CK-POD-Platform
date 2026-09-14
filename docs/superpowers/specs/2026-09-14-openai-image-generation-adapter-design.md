# OpenAI Image Generation Adapter Design

## Goal

Connect the existing provider-neutral generation pipeline to the OpenAI Image API using the user-selected `gpt-image-2.5-sunburst` model. Preserve the current queue, worker, validation, private-storage, policy, analytics, and Design Credit boundaries.

## Selected approach

Implement a focused server-side HTTP adapter inside `@let-it-be/domain`. This follows the existing fetch-based provider pattern used elsewhere in the repository, avoids coupling domain callers to an SDK, and keeps the existing `ImageGenerationService` interface authoritative.

Alternatives considered:

- The official OpenAI JavaScript SDK would reduce request-shape boilerplate but adds a dependency and exposes SDK-specific types at the adapter boundary.
- A separate AI microservice would isolate scaling but adds deployment and operational complexity that is unnecessary for the first live integration.

The selected direct adapter remains replaceable and can later coexist with other G1 benchmark candidates.

## Runtime configuration

The root `.env` supplies these server-only settings:

- `OPENAI_API_KEY`: optional outside real-provider use and never exposed to browser code.
- `OPENAI_IMAGE_MODEL`: locked to `gpt-image-2.5-sunburst` for this integration.
- `OPENAI_API_BASE_URL`: defaults to `https://api.openai.com/v1` and exists only to make contract tests deterministic.

When an OpenAI key is present and `AI_PROVIDER_CONFIG` is not explicitly overridden, environment parsing prepends one OpenAI provider to the existing deterministic development providers. The OpenAI provider supports `TEXT_TO_ARTWORK`; deterministic adapters remain available for local non-OpenAI tasks. The OpenAI provider does not fall back to a fake result after a paid request failure, so a provider failure remains visible and never consumes a Design Credit.

Production and CI never receive credentials from committed files. `.env.example` documents blank placeholders only.

## Request and output behavior

Text-only generations call `POST /images/generations`. Generations with one or more stored reference images call `POST /images/edits` with multipart `image[]` parts.

Both request types use:

- model `gpt-image-2.5-sunburst`;
- explicit `1024x1024` size for the first benchmarkable integration;
- `high` quality;
- transparent background;
- PNG output;
- standard `auto` moderation.

The enhanced platform prompt remains the sole prompt sent to the provider. Reference asset storage keys and bytes are resolved only inside the worker. Private object keys, API credentials, raw provider errors, and provider request bodies never reach the consumer.

The adapter decodes the first base64 image, returns PNG bytes and the `x-request-id`, and rejects empty, malformed, or non-image responses. Provider output continues through the existing signature, dimension, moderation, policy, storage, and delivery checks before a credit can be consumed.

## Reference assets

The worker resolves each previously authorized reference asset ID to its active database asset record, loads the bytes from `PrivateObjectStorage`, and passes a bounded provider-safe payload to the adapter. Missing records, missing objects, unsupported MIME types, or oversized payloads fail as storage/validation failures before any provider call.

Local smoke testing uses the already configured in-process `QUEUE_DRIVER=memory` and `STORAGE_DRIVER=memory`, ensuring uploads and generated outputs share one process. Durable deployments continue to require Redis plus S3-compatible private storage.

## Failure mapping

- Authentication and permission errors become non-retryable `CONFIGURATION_ERROR` failures.
- Quota and billing exhaustion become non-retryable `CONFIGURATION_ERROR` failures.
- `moderation_blocked` becomes non-retryable `MODERATION_REJECTION`.
- Ordinary invalid requests become non-retryable `PROVIDER_ERROR`.
- HTTP 429 rate limiting becomes retryable `RATE_LIMIT`.
- HTTP 5xx and network failures become retryable `PROVIDER_ERROR`.
- Adapter timeouts become retryable `PROVIDER_TIMEOUT`.
- Invalid successful responses become non-retryable `INVALID_PROVIDER_RESPONSE`.

Only consumer-safe generation status and failure categories are returned by existing routes. Logs retain the OpenAI request ID, not the API key or raw image payload.

## Scope boundary

This slice provides live initial generation and reference-guided generation. It does not claim completion of G1 provider selection, G2 economics, exact deterministic typography composition, background-removal post-processing, production upscaling, physical DTG qualification, or selected-layer image editing. The existing selected-element editing task stays on its current deterministic development adapter until its source-layer asset contract is designed.

## Verification

- Configuration tests prove secure optional credentials and automatic local provider activation.
- Adapter contract tests prove JSON generation, multipart reference editing, response decoding, request ID capture, and error classification without making network calls.
- Worker tests prove reference assets are resolved privately and missing assets fail before provider execution.
- Existing generation integration tests prove credits are consumed only after validated delivery.
- A manual live smoke test is performed only if the configured key can reach OpenAI from the local environment. The report distinguishes mocked contract verification from an actual paid provider call.
