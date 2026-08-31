import { randomBytes } from 'node:crypto';

import { createDatabaseClient, type SqlPool } from '@let-it-be/db';
import { applyEditorCommand, createEmptyEditorDocument } from '@let-it-be/editor-schema';
import { createLogger } from '@let-it-be/observability';
import { InMemoryJobQueue } from '@let-it-be/queue';
import { MemoryObjectStorage } from '@let-it-be/storage';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type {
  AiTask,
  GenerationModerationService,
  GenerationValidationService,
  ImageGenerationService,
  ModerationResult,
  ProviderConfiguration,
  ProviderGenerationOutput,
  ProviderGenerationRequest,
} from './ai-contracts.js';
import { GenerationPolicyBlockedError } from './ai-contracts.js';
import {
  DeterministicSvgProvider,
  ProviderRegistry,
  ScriptedGenerationProvider,
} from './ai-providers.js';
import { CreditService } from './credits.js';
import { AssetService } from './assets.js';
import { applySuccessfulRegeneration, generatedLayerFromDeliveredResult } from './editor.js';
import { GenerationWorkerService } from './generation-worker.js';
import { GenerationService, startGenerationConsumer } from './generations.js';
import { IdentityService } from './identity.js';
import {
  AllowAllDevelopmentModeration,
  DefaultPromptPipeline,
  extractExactText,
} from './prompt-pipeline.js';
import { ProjectService } from './projects.js';
import { DeterministicPolicyClassifier, PolicyService } from './policy.js';

const integrationDatabaseUrl = process.env.DATABASE_URL;
const integrationSuite = integrationDatabaseUrl ? describe : describe.skip;
let integrationPool: SqlPool;

integrationSuite('AI generation orchestration integration', () => {
  let pool: SqlPool;
  let close: () => Promise<void>;
  let identity: IdentityService;
  let projects: ProjectService;

  beforeAll(() => {
    const database = createDatabaseClient(integrationDatabaseUrl as string);
    pool = database.pool;
    integrationPool = pool;
    close = database.close;
    identity = new IdentityService(pool);
    projects = new ProjectService(pool);
  });

  afterAll(async () => close());

  it('persists and asynchronously completes a queued generation with one private preview credit', async () => {
    const harness = await createHarness();
    const guest = await identity.createGuestSession();
    const project = await projects.create(guest, selection('navy'));
    const created = await harness.generations.create(guest, project.id, {
      rawPrompt: 'A sunrise badge with the words: CREATE KINDLY.',
      style: 'vintage',
    });
    expect(created.status).toBe('QUEUED');

    await harness.queue.waitForIdle();
    const delivered = await harness.generations.get(guest, project.id, created.id);
    expect(delivered).toMatchObject({ status: 'SUCCEEDED', creditStatus: 'CONSUMED' });
    expect(delivered?.requestedExactText).toContain('CREATE KINDLY');
    expect(delivered?.previewAsset).toMatchObject({ contentType: 'image/svg+xml' });
    expect(await harness.credits.getBalance(guest)).toMatchObject({ balance: 0 });

    const asset = await pool.query<{ storage_key: string; asset_type: string }>(
      `SELECT storage_key, asset_type FROM app.assets
       WHERE generation_id = $1 AND asset_type = 'SOURCE_OUTPUT'`,
      [created.id],
    );
    expect(asset.rows[0]?.storage_key).toMatch(/^generations\//);
    expect(await harness.storage.exists(asset.rows[0]?.storage_key as string)).toBe(true);
    expect(JSON.stringify(delivered)).not.toContain('storage_key');
    await harness.close();
  });

  it('blocks a prohibited prompt before provider work or credit consumption and persists its evaluation', async () => {
    const queue = new InMemoryJobQueue();
    const credits = new CreditService(pool, { guestFreeCredits: 1, registeredFreeCredits: 0 });
    const policy = new PolicyService(pool);
    const generations = new GenerationService(
      pool,
      queue,
      credits,
      new DefaultPromptPipeline(),
      { allow: async () => true },
      {},
      policy,
    );
    const guest = await identity.createGuestSession();
    const project = await projects.create(guest, selection('black'));
    await expect(
      generations.create(guest, project.id, { rawPrompt: 'A Mickey fan art shirt.' }),
    ).rejects.toBeInstanceOf(GenerationPolicyBlockedError);
    const evaluations = await pool.query<{ machine_result: string; stage: string }>(
      `SELECT machine_result, stage FROM app.policy_evaluations WHERE project_id = $1 ORDER BY created_at DESC`,
      [project.id],
    );
    expect(evaluations.rows[0]).toEqual({
      machine_result: 'BLOCK',
      stage: 'PROMPT_PRE_GENERATION',
    });
    const consumed = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM app.credit_ledger l
       JOIN app.generations g ON g.id = l.generation_id
       WHERE l.entry_type = 'CONSUME' AND g.project_id = $1`,
      [project.id],
    );
    expect(consumed.rows[0]?.count).toBe('0');
    await queue.close();
  });

  it('prevents another guest session from reading a generation', async () => {
    const harness = await createHarness();
    const guest = await identity.createGuestSession();
    const project = await projects.create(guest, selection('black'));
    const created = await harness.generations.create(guest, project.id, {
      rawPrompt: 'A mountain badge.',
    });
    await harness.queue.waitForIdle();

    expect(
      await harness.generations.get(await identity.createGuestSession(), project.id, created.id),
    ).toBeNull();
    expect(await harness.generations.get(guest, project.id, created.id)).toMatchObject({
      id: created.id,
    });
    await harness.close();
  });

  it('delivers preview bytes only to the owning guest or account, never a source asset', async () => {
    const harness = await createHarness();
    const guest = await identity.createGuestSession();
    const project = await projects.create(guest, selection('black'));
    const created = await harness.generations.create(guest, project.id, {
      rawPrompt: 'A bright sun.',
    });
    await harness.queue.waitForIdle();
    const delivered = await harness.generations.get(guest, project.id, created.id);
    const assets = await pool.query<{ id: string; asset_type: string }>(
      'SELECT id, asset_type FROM app.assets WHERE generation_id = $1',
      [created.id],
    );
    const preview = assets.rows.find((asset) => asset.asset_type === 'PREVIEW');
    const source = assets.rows.find((asset) => asset.asset_type === 'SOURCE_OUTPUT');
    const assetService = new AssetService(pool);
    expect(
      await assetService.getControlledPreview(guest, project.id, preview?.id as string),
    ).toMatchObject({
      contentType: 'image/svg+xml',
    });
    const account = await identity.register(
      guest,
      `preview-${randomBytes(8).toString('hex')}@example.test`,
      'secure-editor-preview-password',
    );
    expect(
      await assetService.getControlledPreview(account, project.id, preview?.id as string),
    ).toMatchObject({ contentType: 'image/svg+xml' });
    expect(
      await assetService.getControlledPreview(guest, project.id, source?.id as string),
    ).toBeNull();
    expect(
      await assetService.getControlledPreview(
        await identity.createGuestSession(),
        project.id,
        preview?.id as string,
      ),
    ).toBeNull();
    expect(JSON.stringify(delivered)).not.toContain('storage_key');
    await harness.close();
  });

  it('routes selected-element regeneration through the task abstraction and leaves the prior editor version recoverable', async () => {
    const harness = await createHarness({
      providers: [
        provider(
          'editor-provider',
          new DeterministicSvgProvider('editor-provider', 'editor-v1'),
          true,
          10,
          ['SELECTED_ELEMENT_EDITING'],
        ),
      ],
    });
    const guest = await identity.createGuestSession();
    const project = await projects.create(guest, selection('white'));
    const original = applyEditorCommand(createEmptyEditorDocument(), {
      type: 'add-layer',
      layer: generatedLayerFromDeliveredResult({
        layerId: 'generated-layer',
        assetId: 'existing-preview',
        generationId: 'existing-generation',
        zIndex: 0,
      }),
    });
    const saved = await projects.autosave(guest, project.id, original, project.revision);
    const regeneration = await harness.generations.create(guest, project.id, {
      rawPrompt: 'Make the selected artwork warmer.',
      task: 'SELECTED_ELEMENT_EDITING',
      editorMetadata: { targetLayerId: 'generated-layer', lockedLayerIds: [] },
    });
    await harness.queue.waitForIdle();
    const delivered = await harness.generations.get(guest, project.id, regeneration.id);
    expect(delivered).toMatchObject({ status: 'SUCCEEDED', task: 'SELECTED_ELEMENT_EDITING' });
    const replacement = applySuccessfulRegeneration(original, {
      layerId: 'generated-layer',
      assetId: delivered?.previewAsset?.id as string,
      generationId: regeneration.id,
    });
    await projects.autosave(guest, project.id, replacement, saved.project.revision);
    const versions = await projects.getVersions(guest, project.id);
    expect(
      versions.some((version) =>
        JSON.stringify(version.editorDocument).includes('existing-preview'),
      ),
    ).toBe(true);
    expect(versions[0]?.editorDocument.layers[0]).toMatchObject({ generationId: regeneration.id });
    await harness.close();
  });

  it('does not consume a credit for provider failures or timeouts', async () => {
    const failureHarness = await createHarness({
      providers: [
        provider(
          'provider-error',
          new ScriptedGenerationProvider('provider-error', 'test-v1', ['PROVIDER_ERROR']),
          false,
        ),
      ],
    });
    const failureGuest = await identity.createGuestSession();
    const failureProject = await projects.create(failureGuest, selection('white'));
    const failed = await failureHarness.generations.create(failureGuest, failureProject.id, {
      rawPrompt: 'A flower illustration.',
    });
    await failureHarness.queue.waitForIdle();
    expect(
      await failureHarness.generations.get(failureGuest, failureProject.id, failed.id),
    ).toMatchObject({
      status: 'FAILED',
      failureCategory: 'PROVIDER_ERROR',
      creditStatus: 'NOT_CONSUMED',
    });
    expect(await failureHarness.credits.getBalance(failureGuest)).toMatchObject({ balance: 1 });
    await failureHarness.close();

    const timeoutHarness = await createHarness({
      providers: [
        provider(
          'provider-timeout',
          new ScriptedGenerationProvider('provider-timeout', 'test-v1', ['PROVIDER_TIMEOUT']),
          false,
        ),
      ],
    });
    const timeoutGuest = await identity.createGuestSession();
    const timeoutProject = await projects.create(timeoutGuest, selection('white'));
    const timedOut = await timeoutHarness.generations.create(timeoutGuest, timeoutProject.id, {
      rawPrompt: 'A flower illustration.',
    });
    await timeoutHarness.queue.waitForIdle();
    expect(
      await timeoutHarness.generations.get(timeoutGuest, timeoutProject.id, timedOut.id),
    ).toMatchObject({
      status: 'FAILED',
      failureCategory: 'PROVIDER_TIMEOUT',
      creditStatus: 'NOT_CONSUMED',
    });
    expect(await timeoutHarness.credits.getBalance(timeoutGuest)).toMatchObject({ balance: 1 });
    await timeoutHarness.close();
  });

  it('retries/falls back without double-consuming a credit and records every attempt', async () => {
    const fallback = new CapturingProvider('fallback-provider', 'fallback-v1');
    const harness = await createHarness({
      providers: [
        provider(
          'failing-provider',
          new ScriptedGenerationProvider('failing-provider', 'test-v1', ['PROVIDER_ERROR']),
          true,
        ),
        provider('fallback-provider', fallback, true, 20),
      ],
    });
    const guest = await identity.createGuestSession();
    const project = await projects.create(guest, selection('navy'));
    const created = await harness.generations.create(guest, project.id, {
      rawPrompt: 'A bold botanical sign reading "BLOOM".',
      style: 'illustrated',
    });
    await harness.queue.waitForIdle();
    await harness.worker.process(created.id);

    expect(await harness.generations.get(guest, project.id, created.id)).toMatchObject({
      status: 'SUCCEEDED',
      creditStatus: 'CONSUMED',
    });
    expect(await harness.credits.getBalance(guest)).toMatchObject({ balance: 0 });
    expect(fallback.requests[0]?.productContext).toMatchObject({ colorCode: 'navy' });
    expect(fallback.requests[0]?.requestedExactText).toContain('BLOOM');
    const attempts = await pool.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM app.generation_attempts WHERE generation_id = $1',
      [created.id],
    );
    const consumes = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM app.credit_ledger
       WHERE generation_id = $1 AND entry_type = 'CONSUME'`,
      [created.id],
    );
    expect(attempts.rows[0]?.count).toBe(2);
    expect(consumes.rows[0]?.count).toBe(1);
    await harness.close();
  });

  it('rejects an internally invalid output without consuming a credit and makes repeated status reads safe', async () => {
    const harness = await createHarness({ validation: new RejectingValidation() });
    const guest = await identity.createGuestSession();
    const project = await projects.create(guest, selection('black'));
    const created = await harness.generations.create(guest, project.id, {
      rawPrompt: 'A small moon.',
    });
    await harness.queue.waitForIdle();

    const first = await harness.generations.get(guest, project.id, created.id);
    const second = await harness.generations.get(guest, project.id, created.id);
    expect(first).toMatchObject({
      status: 'REJECTED_INTERNAL',
      failureCategory: 'INTERNAL_VALIDATION_FAILURE',
      creditStatus: 'NOT_CONSUMED',
    });
    expect(second).toEqual(first);
    expect(await harness.credits.getBalance(guest)).toMatchObject({ balance: 1 });
    await harness.close();
  });

  it('persists stable guided-style attribution and keeps private conditioning inside the provider boundary', async () => {
    const provider = new CapturingProvider('style-provider', 'style-v1');
    const harness = await createHarness({
      providers: [providerEntry('style-provider', provider, true)],
    });
    const guest = await identity.createGuestSession();
    const project = await projects.create(guest, selection('navy'));
    const styled = await projects.selectGuidedStyle(
      guest,
      project.id,
      {
        selectionMode: 'MANUAL',
        styleFamilyId: 'family-vintage',
        presetId: 'preset-vintage-engraving',
      },
      project.revision,
    );
    const created = await harness.generations.create(guest, project.id, {
      rawPrompt: 'A mountain crest with the words "STAY CURIOUS".',
    });
    await harness.queue.waitForIdle();
    const delivered = await harness.generations.get(guest, project.id, created.id);

    expect(delivered?.styleSelection).toEqual({
      selectionMode: 'MANUAL',
      styleFamilyId: 'family-vintage',
      presetId: 'preset-vintage-engraving',
      presetVersion: 1,
    });
    expect(await projects.get(guest, project.id)).toMatchObject({
      revision: styled.revision,
      styleSelection: delivered?.styleSelection,
    });
    expect(provider.requests[0]?.styleSelection.conditioning).toMatchObject({
      promptConditioning: { family: 'Vintage', substyle: 'Vintage Engraving' },
      colorStrategy: { considerShirtColor: true, avoidLowContrast: true },
    });
    expect(provider.requests[0]?.productContext.colorCode).toBe('navy');
    expect(provider.requests[0]?.requestedExactText).toEqual(['STAY CURIOUS']);
    expect(JSON.stringify(delivered)).not.toContain('conditioning');
    const analytics = await pool.query<{ event_name: string; dimensions: Record<string, unknown> }>(
      `SELECT event_name, dimensions FROM app.analytics_events WHERE generation_id = $1 ORDER BY occurred_at`,
      [created.id],
    );
    expect(analytics.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_name: 'generation_started',
          dimensions: expect.objectContaining({
            styleFamilyId: 'family-vintage',
            presetId: 'preset-vintage-engraving',
            presetVersion: 1,
            selectionMode: 'MANUAL',
          }),
        }),
        expect.objectContaining({ event_name: 'generation_succeeded' }),
      ]),
    );
    await harness.close();
  });

  it('preserves the current style for regeneration until the customer deliberately changes it', async () => {
    const harness = await createHarness({ guestFreeCredits: 3 });
    const guest = await identity.createGuestSession();
    const project = await projects.create(guest, selection('white'));
    const vintage = await projects.selectGuidedStyle(
      guest,
      project.id,
      {
        selectionMode: 'MANUAL',
        styleFamilyId: 'family-vintage',
        presetId: 'preset-vintage-70s-retro',
      },
      project.revision,
    );
    const first = await harness.generations.create(guest, project.id, {
      rawPrompt: 'A sunny coffee club.',
    });
    const second = await harness.generations.create(guest, project.id, {
      rawPrompt: 'Make it bolder.',
      task: 'SELECTED_ELEMENT_EDITING',
      editorMetadata: { targetLayerId: 'layer', lockedLayerIds: [] },
    });
    const dark = await projects.selectGuidedStyle(
      guest,
      project.id,
      {
        selectionMode: 'MANUAL',
        styleFamilyId: 'family-dark',
        presetId: 'preset-dark-blackwork',
      },
      vintage.revision,
    );
    const third = await harness.generations.create(guest, project.id, {
      rawPrompt: 'A dark coffee club.',
    });
    await harness.queue.waitForIdle();

    expect(
      (await harness.generations.get(guest, project.id, first.id))?.styleSelection.presetId,
    ).toBe('preset-vintage-70s-retro');
    expect(
      (await harness.generations.get(guest, project.id, second.id))?.styleSelection.presetId,
    ).toBe('preset-vintage-70s-retro');
    expect(
      (await harness.generations.get(guest, project.id, third.id))?.styleSelection,
    ).toMatchObject({
      presetId: 'preset-dark-blackwork',
      presetVersion: 1,
    });
    expect(dark.styleSelection.presetId).toBe('preset-dark-blackwork');
    await harness.close();
  });

  it('attributes Let AI Decide to a resolved, deterministic preset before generation', async () => {
    const harness = await createHarness();
    const guest = await identity.createGuestSession();
    const project = await projects.create(guest, selection('black'));
    const created = await harness.generations.create(guest, project.id, {
      rawPrompt: 'A funny moonlit raccoon with coffee.',
    });
    await harness.queue.waitForIdle();
    const delivered = await harness.generations.get(guest, project.id, created.id);
    const updatedProject = await projects.get(guest, project.id);

    expect(delivered?.styleSelection).toMatchObject({
      selectionMode: 'AUTO',
      styleFamilyId: expect.any(String),
      presetId: expect.any(String),
      presetVersion: 1,
    });
    expect(updatedProject?.styleSelection).toEqual(delivered?.styleSelection);
    await harness.close();
  });

  it('extracts exact text as structured metadata rather than relying on model spelling', () => {
    expect(extractExactText('A shirt with the phrase "CREATE KINDLY".')).toEqual(['CREATE KINDLY']);
  });
});

describe('deterministic policy classifier', () => {
  it('keeps IP, adult/violence, protected text, and political-expression categories distinct', async () => {
    const classifier = new DeterministicPolicyClassifier();
    await expect(
      classifier.classify({ stage: 'PROMPT_PRE_GENERATION', text: 'Nike-style logo' }),
    ).resolves.toMatchObject({ outcome: 'REVIEW' });
    await expect(
      classifier.classify({
        stage: 'PROMPT_PRE_GENERATION',
        text: 'A political voting message without a likeness',
      }),
    ).resolves.toMatchObject({ outcome: 'ALLOW' });
    await expect(
      classifier.classify({
        stage: 'PROMPT_PRE_GENERATION',
        text: 'Bohemian Rhapsody song lyrics',
      }),
    ).resolves.toMatchObject({ outcome: 'REVIEW' });
    await expect(
      classifier.classify({ stage: 'PROMPT_PRE_GENERATION', text: 'Explicit sex merchandise' }),
    ).resolves.toMatchObject({ outcome: 'BLOCK' });
    await expect(
      classifier.classify({
        stage: 'PROMPT_PRE_GENERATION',
        text: 'Graphic gore assault rifle shirt',
      }),
    ).resolves.toMatchObject({ outcome: 'BLOCK' });
    await expect(
      classifier.classify({ stage: 'PROMPT_PRE_GENERATION', text: 'policy:unknown' }),
    ).resolves.toMatchObject({ outcome: 'UNKNOWN' });
  });
});

async function createHarness(
  input: {
    providers?: Array<{ configuration: ProviderConfiguration; service: ImageGenerationService }>;
    moderation?: GenerationModerationService;
    validation?: GenerationValidationService;
    guestFreeCredits?: number;
  } = {},
) {
  const queue = new InMemoryJobQueue();
  const storage = new MemoryObjectStorage();
  const credits = new CreditService(integrationPool, {
    guestFreeCredits: input.guestFreeCredits ?? 1,
    registeredFreeCredits: 0,
  });
  const generations = new GenerationService(
    integrationPool,
    queue,
    credits,
    new DefaultPromptPipeline(),
    { allow: async () => true },
  );
  const registry = new ProviderRegistry(
    input.providers ?? [
      provider(
        'primary-provider',
        new DeterministicSvgProvider('primary-provider', 'test-v1'),
        true,
      ),
      provider(
        'secondary-provider',
        new DeterministicSvgProvider('secondary-provider', 'test-v2'),
        true,
        20,
      ),
    ],
  );
  const worker = new GenerationWorkerService(
    integrationPool,
    generations,
    credits,
    registry,
    storage,
    input.moderation ?? new AllowAllDevelopmentModeration(),
    input.validation ?? { validate: async () => ({ accepted: true }) },
    createLogger({ service: 'test', write: () => undefined }),
  );
  const consumer = await startGenerationConsumer(queue, (generationId) =>
    worker.process(generationId),
  );
  return {
    queue,
    storage,
    credits,
    generations,
    worker,
    close: async () => {
      await consumer.close();
      await queue.close();
    },
  };
}

function provider(
  id: string,
  service: ImageGenerationService,
  fallbackEligible: boolean,
  priority = 10,
  tasks: AiTask[] = ['TEXT_TO_ARTWORK'],
): { configuration: ProviderConfiguration; service: ImageGenerationService } {
  return {
    configuration: {
      id,
      adapter: priority === 10 ? 'deterministic-svg' : 'deterministic-pattern',
      enabled: true,
      tasks,
      model: service.model,
      priority,
      estimatedCostCents: 0,
      timeoutMs: 100,
      maxRetries: 0,
      fallbackEligible,
    },
    service,
  };
}

function providerEntry(
  id: string,
  service: ImageGenerationService,
  fallbackEligible: boolean,
): { configuration: ProviderConfiguration; service: ImageGenerationService } {
  return provider(id, service, fallbackEligible);
}

class CapturingProvider implements ImageGenerationService {
  public readonly requests: ProviderGenerationRequest[] = [];

  public constructor(
    public readonly id: string,
    public readonly model: string,
  ) {}

  supports(task: AiTask): boolean {
    return task === 'TEXT_TO_ARTWORK';
  }

  async generate(request: ProviderGenerationRequest): Promise<ProviderGenerationOutput> {
    this.requests.push(request);
    return new DeterministicSvgProvider(this.id, this.model).generate(request);
  }
}

class RejectingValidation implements GenerationValidationService {
  async validate(): Promise<ModerationResult> {
    return { accepted: false, reason: 'development rejection' };
  }
}

function selection(colorCode: string) {
  return { productModelId: 'essential-dtg-tee', colorCode };
}
