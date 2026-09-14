# GPT-Image 2.5 Flare Temporary A/B Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run a controlled local Flare generation through the existing production generation flow and compare its verified latency and visual output with the existing Sunburst medium samples.

**Architecture:** Extend the server environment allow-list so the existing OpenAI adapter can receive either approved GPT-Image 2.5 model ID. Keep Sunburst as the persisted default and select Flare only through the local server process environment, leaving the provider adapter, medium quality, prompt pipeline, storage, credit lifecycle, and transparency validation unchanged.

**Tech Stack:** TypeScript, Zod, Vitest, Next.js development server, PostgreSQL generation telemetry.

**Spec:** `docs/superpowers/specs/2026-09-14-flare-ab-test-design.md`

## Global Constraints

- Keep `gpt-image-2.5-sunburst` as the configured default.
- Use `gpt-image-2.5-flare` only as a temporary local process override.
- Keep quality `medium`, output size `1024x1024`, PNG transparency, prompt pipeline `m4.5-v2`, and alpha validation unchanged.
- Do not add a customer-facing or admin-facing model selector.
- Do not perform an automatic paid provider retry.
- Do not change Design Credit behavior.

---

### Task 1: Permit the approved Flare runtime override

**Files:**

- Modify: `packages/config/src/index.ts:71`
- Modify: `packages/config/src/index.test.ts:38-109`

**Interfaces:**

- Consumes: `parseServerEnvironment(input: Record<string, string | undefined>): ServerEnvironment`
- Produces: `ServerEnvironment.OPENAI_IMAGE_MODEL` restricted to `'gpt-image-2.5-sunburst' | 'gpt-image-2.5-flare'`

- [ ] **Step 1: Replace the obsolete rejection test with an acceptance and allow-list test**

```ts
it('allows Flare as an explicit temporary image-model override', () => {
  const environment = parseServerEnvironment({
    ...baseEnvironment,
    OPENAI_API_KEY: 'server-only-key',
    OPENAI_IMAGE_MODEL: 'gpt-image-2.5-flare',
  });

  expect(environment.OPENAI_IMAGE_MODEL).toBe('gpt-image-2.5-flare');
  expect(JSON.parse(environment.AI_PROVIDER_CONFIG)[0]).toMatchObject({
    adapter: 'openai-images',
    model: 'gpt-image-2.5-flare',
    maxRetries: 0,
  });
});

it('rejects image models outside the approved GPT-Image 2.5 pair', () => {
  expect(() =>
    parseServerEnvironment({
      ...baseEnvironment,
      OPENAI_IMAGE_MODEL: 'unapproved-image-model',
    }),
  ).toThrow();
});
```

- [ ] **Step 2: Run the focused test and verify the Flare case fails**

Run: `pnpm test -- packages/config/src/index.test.ts`

Expected: FAIL because `OPENAI_IMAGE_MODEL` currently accepts only the Sunburst literal.

- [ ] **Step 3: Replace the literal with the two-model allow-list while preserving the default**

```ts
OPENAI_IMAGE_MODEL: z
  .enum(['gpt-image-2.5-sunburst', 'gpt-image-2.5-flare'])
  .default('gpt-image-2.5-sunburst'),
```

- [ ] **Step 4: Run focused verification**

Run: `pnpm test -- packages/config/src/index.test.ts`

Expected: all configuration tests PASS, including rejection of unapproved model IDs.

- [ ] **Step 5: Commit only the reusable model allow-list**

```powershell
git add -- packages/config/src/index.ts packages/config/src/index.test.ts
git commit -m "feat: allow temporary Flare image model override"
```

### Task 2: Start the isolated Flare runtime and verify routing

**Files:**

- No tracked files modified.

**Interfaces:**

- Consumes: `OPENAI_IMAGE_MODEL=gpt-image-2.5-flare`
- Produces: a local Next.js server whose derived `AI_PROVIDER_CONFIG` routes `TEXT_TO_ARTWORK` to `gpt-image-2.5-flare`

- [ ] **Step 1: Run repository verification before changing the active runtime**

Run: `pnpm lint`

Run: `pnpm typecheck`

Run: `pnpm test`

Expected: all checks PASS.

- [ ] **Step 2: Stop the current local development server**

Send `Ctrl+C` to the active `pnpm dev` session and confirm port `3000` is no longer owned by that process.

- [ ] **Step 3: Start the development server with the temporary Flare process override**

```powershell
$env:OPENAI_IMAGE_MODEL = 'gpt-image-2.5-flare'
$env:DATABASE_URL = 'postgresql://letitbe:letitbe@127.0.0.1:15432/letitbe'
pnpm dev
```

Expected: Next.js reports both `http://localhost:3000` and the current LAN URL as ready.

- [ ] **Step 4: Record the latest generation timestamp as the measurement baseline**

```sql
SELECT max(created_at) FROM app.generations;
```

- [ ] **Step 5: Ask the user to generate the comparison sample with the same prompt and configuration**

Expected: a new `app.generations` row is created after the baseline.

- [ ] **Step 6: Verify model routing and collect timings**

```sql
SELECT
  g.id,
  g.status,
  g.prompt_metadata->>'pipelineVersion' AS pipeline_version,
  ga.model_identifier,
  round(EXTRACT(EPOCH FROM (g.completed_at - g.created_at))::numeric, 3) AS total_seconds,
  ga.latency_ms,
  round(EXTRACT(EPOCH FROM (g.started_at - g.created_at))::numeric, 3) AS queue_seconds,
  round(EXTRACT(EPOCH FROM (g.completed_at - ga.completed_at))::numeric, 3)
    AS validation_delivery_seconds
FROM app.generations g
JOIN LATERAL (
  SELECT *
  FROM app.generation_attempts a
  WHERE a.generation_id = g.id
  ORDER BY a.attempt_number DESC
  LIMIT 1
) ga ON true
WHERE g.created_at > $1
ORDER BY g.created_at DESC
LIMIT 1;
```

Expected: `SUCCEEDED`, `m4.5-v2`, `gpt-image-2.5-flare`, one provider attempt, and populated timing fields. A rejected alpha result is reported as a failed comparison sample and does not consume a Design Credit.

- [ ] **Step 7: Report the comparison without selecting a permanent winner**

Report Flare total/provider/queue/validation time beside the two existing Sunburst medium totals (`21.102s` and `18.581s`). State that visual quality remains the user's judgment and that one Flare sample is directional rather than conclusive.
