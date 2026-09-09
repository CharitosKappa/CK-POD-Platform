import { createHash, randomUUID } from 'node:crypto';

import {
  aiTasks,
  type AiTask,
  type GenerationFailureCategory,
  type GenerationProvider,
  type ImageGenerationService,
  type ProviderConfiguration,
  type ProviderGenerationOutput,
  type ProviderGenerationRequest,
  ProviderExecutionError,
} from './ai-contracts';

export class ProviderRegistry {
  public constructor(private readonly providers: GenerationProvider[]) {}

  forTask(task: AiTask): GenerationProvider[] {
    return this.providers
      .filter(({ configuration, service }) => configuration.enabled && service.supports(task))
      .sort((left, right) => left.configuration.priority - right.configuration.priority);
  }

  all(): GenerationProvider[] {
    return [...this.providers];
  }
}

/**
 * A deterministic SVG adapter for local development, CI, and benchmark plumbing.
 * It intentionally uses no external credentials or network calls.
 */
export class DeterministicSvgProvider implements ImageGenerationService {
  public constructor(
    public readonly id: string,
    public readonly model: string,
    private readonly pattern = 'orbit',
  ) {}

  supports(task: AiTask): boolean {
    return task === 'TEXT_TO_ARTWORK' || task === 'SELECTED_ELEMENT_EDITING';
  }

  async generate(request: ProviderGenerationRequest): Promise<ProviderGenerationOutput> {
    const digest = createHash('sha256')
      .update(
        `${this.id}:${request.enhancedPrompt}:${request.productContext.colorCode}:${request.styleSelection.styleFamilyId}:${request.styleSelection.presetId}:${request.styleSelection.presetVersion}`,
      )
      .digest('hex');
    const palette = ['#e53935', '#ef6c00', '#f9a825', '#00897b', '#1e88e5', '#5e35b1', '#d81b60'];
    const primary = palette[Number.parseInt(digest.slice(0, 2), 16) % palette.length]!;
    const secondary = palette[Number.parseInt(digest.slice(2, 4), 16) % palette.length]!;
    const label = escapeXml('LET IT BE');
    const shape =
      this.pattern === 'grid'
        ? `<path d="M150 230h500M150 350h500M150 470h500M230 150v500M350 150v500M470 150v500M590 150v500" stroke="${secondary}" stroke-width="28" opacity=".92"/>`
        : `<circle cx="400" cy="400" r="188" fill="none" stroke="${secondary}" stroke-width="58"/><circle cx="400" cy="400" r="92" fill="none" stroke="#fff" stroke-width="18" opacity=".92"/>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800"><circle cx="400" cy="400" r="300" fill="${primary}"/>${shape}<text x="400" y="715" text-anchor="middle" font-family="sans-serif" font-size="38" font-weight="700" fill="#fff">${label}</text></svg>`;

    return {
      body: new TextEncoder().encode(svg),
      contentType: 'image/svg+xml',
      width: 800,
      height: 800,
      providerRequestId: randomUUID(),
      actualCostCents: 0,
    };
  }
}

/** A distinct deterministic adapter used to exercise configured fallback routing. */
export class DeterministicPatternProvider implements ImageGenerationService {
  private readonly delegate: DeterministicSvgProvider;

  public constructor(
    public readonly id: string,
    public readonly model: string,
  ) {
    this.delegate = new DeterministicSvgProvider(id, model, 'grid');
  }

  supports(task: AiTask): boolean {
    return this.delegate.supports(task);
  }

  async generate(request: ProviderGenerationRequest): Promise<ProviderGenerationOutput> {
    return this.delegate.generate(request);
  }
}

/** A scripted adapter makes provider failure, timeout, and fallback paths deterministic in tests. */
export class ScriptedGenerationProvider implements ImageGenerationService {
  private currentOutcome = 0;

  public constructor(
    public readonly id: string,
    public readonly model: string,
    private readonly outcomes: Array<'SUCCESS' | GenerationFailureCategory>,
  ) {}

  supports(task: AiTask): boolean {
    return task === 'TEXT_TO_ARTWORK';
  }

  async generate(request: ProviderGenerationRequest): Promise<ProviderGenerationOutput> {
    const outcome =
      this.outcomes[Math.min(this.currentOutcome++, this.outcomes.length - 1)] ?? 'SUCCESS';
    if (outcome !== 'SUCCESS') {
      throw new ProviderExecutionError(
        outcome,
        outcome === 'PROVIDER_ERROR' || outcome === 'PROVIDER_TIMEOUT' || outcome === 'RATE_LIMIT',
        `Scripted provider outcome: ${outcome}`,
      );
    }
    return new DeterministicSvgProvider(this.id, this.model, 'grid').generate(request);
  }
}

export function parseProviderConfigurations(value: string): ProviderConfiguration[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('AI_PROVIDER_CONFIG must be valid JSON.');
  }
  if (!Array.isArray(parsed) || parsed.length < 2) {
    throw new Error('AI_PROVIDER_CONFIG must define at least two provider adapters.');
  }

  return parsed.map((entry, index) => parseProviderConfiguration(entry, index));
}

export function createConfiguredProviderRegistry(
  configurations: ProviderConfiguration[],
): ProviderRegistry {
  return new ProviderRegistry(
    configurations.map((configuration) => ({
      configuration,
      service:
        configuration.adapter === 'deterministic-pattern'
          ? new DeterministicPatternProvider(configuration.id, configuration.model)
          : new DeterministicSvgProvider(configuration.id, configuration.model),
    })),
  );
}

function parseProviderConfiguration(value: unknown, index: number): ProviderConfiguration {
  if (!value || typeof value !== 'object') {
    throw new Error(`AI provider configuration at index ${index} must be an object.`);
  }
  const input = value as Record<string, unknown>;
  const adapter = input.adapter;
  const tasks = input.tasks;
  if (
    typeof input.id !== 'string' ||
    !input.id ||
    (adapter !== 'deterministic-svg' && adapter !== 'deterministic-pattern') ||
    !Array.isArray(tasks) ||
    !tasks.every((task) => typeof task === 'string' && aiTasks.includes(task as AiTask)) ||
    typeof input.model !== 'string' ||
    typeof input.enabled !== 'boolean' ||
    !isNonNegativeInteger(input.priority) ||
    !isNonNegativeInteger(input.estimatedCostCents) ||
    !isPositiveInteger(input.timeoutMs) ||
    !isNonNegativeInteger(input.maxRetries) ||
    typeof input.fallbackEligible !== 'boolean'
  ) {
    throw new Error(`AI provider configuration at index ${index} is invalid.`);
  }
  return {
    id: input.id,
    adapter,
    enabled: input.enabled,
    tasks: tasks as AiTask[],
    model: input.model,
    priority: input.priority,
    estimatedCostCents: input.estimatedCostCents,
    timeoutMs: input.timeoutMs,
    maxRetries: input.maxRetries,
    fallbackEligible: input.fallbackEligible,
  };
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (character) => {
    const encoded: Record<string, string> = {
      '<': '&lt;',
      '>': '&gt;',
      '&': '&amp;',
      "'": '&apos;',
      '"': '&quot;',
    };
    return encoded[character] ?? character;
  });
}
