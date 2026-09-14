# OpenAI Image Generation Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver real initial and reference-guided apparel artwork through OpenAI `gpt-image-2.5-sunburst` while preserving the platform-owned generation lifecycle.

**Architecture:** Environment parsing activates an OpenAI provider configuration only when a server-side key exists and no explicit routing configuration overrides it. A focused HTTP adapter implements the existing `ImageGenerationService`; the worker resolves authorized reference assets from private storage before invoking that adapter.

**Tech Stack:** TypeScript, Node 22 native `fetch`/`FormData`/`Blob`, Zod, PostgreSQL, private object storage, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-14-openai-image-generation-adapter-design.md`

## Global Constraints

- Preserve model ID `gpt-image-2.5-sunburst` exactly.
- Never expose or commit `OPENAI_API_KEY`.
- Use transparent PNG, `1024x1024`, `high` quality, and `auto` moderation.
- Never fall back to deterministic artwork after a paid OpenAI failure.
- Consume one Design Credit only after validated output delivery.
- Keep selected-layer image editing outside this slice.

---

### Task 1: Secure runtime configuration and provider activation

**Files:**

- Modify: `packages/config/src/index.ts`
- Modify: `packages/config/src/index.test.ts`
- Modify: `.env.example`

**Interfaces:**

- Produces: `ServerEnvironment.OPENAI_API_KEY?: string`
- Produces: `ServerEnvironment.OPENAI_IMAGE_MODEL: 'gpt-image-2.5-sunburst'`
- Produces: `ServerEnvironment.OPENAI_API_BASE_URL: string`
- Produces: an `openai-images` entry in `AI_PROVIDER_CONFIG` when a key is present and the caller did not explicitly supply routing configuration.

- [ ] **Step 1: Write failing configuration tests**

```ts
it('activates Sunburst only when a server-side OpenAI key is present', () => {
  const environment = parseServerEnvironment({
    ...baseEnvironment,
    OPENAI_API_KEY: 'server-only-key',
    OPENAI_IMAGE_MODEL: 'gpt-image-2.5-sunburst',
  });
  expect(JSON.parse(environment.AI_PROVIDER_CONFIG)[0]).toMatchObject({
    adapter: 'openai-images',
    model: 'gpt-image-2.5-sunburst',
    fallbackEligible: false,
  });
});
```

- [ ] **Step 2: Run `pnpm test -- packages/config/src/index.test.ts` and verify the test fails because OpenAI configuration is absent**

- [ ] **Step 3: Add the optional secret, locked model, base URL, and implicit routing composition**

- [ ] **Step 4: Run the configuration test and verify it passes**

- [ ] **Step 5: Add blank committed placeholders to `.env.example` and commit**

### Task 2: OpenAI Image API adapter

**Files:**

- Create: `packages/domain/src/openai-image-provider.ts`
- Create: `packages/domain/src/openai-image-provider.test.ts`
- Modify: `packages/domain/src/ai-contracts.ts`
- Modify: `packages/domain/src/ai-providers.ts`
- Modify: `packages/domain/src/ai-runtime.ts`
- Modify: `apps/web/lib/generation-runtime.ts`
- Modify: `apps/worker/src/index.ts`

**Interfaces:**

- Produces: `ProviderReferenceAsset { id: string; body: Uint8Array; contentType: 'image/png' | 'image/jpeg' | 'image/webp' }`
- Produces: `OpenAiImageProvider implements ImageGenerationService`
- Produces: `ProviderRegistryOptions { openAiApiKey?: string; openAiApiBaseUrl?: string; fetch?: typeof globalThis.fetch }`

- [ ] **Step 1: Write failing adapter tests for JSON generation, multipart reference editing, response decoding, request ID capture, and classified failures**

```ts
const provider = new OpenAiImageProvider(configuration, {
  apiKey: 'test-key',
  apiBaseUrl: 'https://api.openai.test/v1',
  fetch: recordingFetch,
});
const output = await provider.generate(request);
expect(output.contentType).toBe('image/png');
expect(output.providerRequestId).toBe('req_test');
```

- [ ] **Step 2: Run `pnpm test -- packages/domain/src/openai-image-provider.test.ts` and verify missing adapter failures**

- [ ] **Step 3: Implement the adapter with native fetch, bounded base64 decoding, abort timeout, and stable error mapping**

- [ ] **Step 4: Extend provider configuration parsing and registry construction for `openai-images`**

- [ ] **Step 5: Thread the server-only OpenAI settings from web and worker runtimes into the provider registry**

- [ ] **Step 6: Run adapter, configuration, benchmark, and provider tests and verify they pass**

- [ ] **Step 7: Commit the adapter slice**

### Task 3: Private reference asset resolution

**Files:**

- Modify: `packages/domain/src/generation-worker.ts`
- Modify: `packages/domain/src/generation.integration.test.ts`

**Interfaces:**

- Produces: worker-internal `loadProviderReferenceAssets(generation): Promise<ProviderReferenceAsset[]>`
- Consumes: active `app.assets` rows and `PrivateObjectStorage.get(storageKey)`.

- [ ] **Step 1: Write a failing integration test proving active reference bytes reach the provider and storage keys do not**

- [ ] **Step 2: Write a failing integration test proving a missing private object fails before provider execution and does not consume credit**

- [ ] **Step 3: Run the focused integration tests and verify both fail for the expected missing-resolution behavior**

- [ ] **Step 4: Implement ordered database lookup, MIME/size validation, and private storage loading**

- [ ] **Step 5: Pass resolved references to each provider attempt without logging bytes or keys**

- [ ] **Step 6: Run the generation integration suite and verify it passes**

- [ ] **Step 7: Commit the reference-resolution slice**

### Task 4: End-to-end verification and live smoke test

**Files:**

- Modify: `docs/runbooks/local-development.md`

**Interfaces:**

- Documents: key/model configuration, in-process memory mode, expected statuses, and explicit paid-call warning.

- [ ] **Step 1: Document the live local configuration without secret values**

- [ ] **Step 2: Run `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, focused tests, full tests, and `pnpm build`**

- [ ] **Step 3: Start the local application with the existing root `.env` and confirm the OpenAI provider is registered without printing the key**

- [ ] **Step 4: Make one explicitly identified paid smoke generation, poll it to terminal status, and verify a controlled preview if the external API is reachable**

- [ ] **Step 5: Confirm the generation attempt stores model, request ID, latency, dimensions, and a non-secret outcome**

- [ ] **Step 6: Commit runbook updates and report mocked versus real-provider verification separately**
