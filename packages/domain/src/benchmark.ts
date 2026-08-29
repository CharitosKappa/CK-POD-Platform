import type { AiTask, ProductGenerationContext } from './ai-contracts';
import type { ProviderRegistry } from './ai-providers';
import type { ResolvedStyleSelection } from './styles';

export const benchmarkScoreWeights = {
  promptAdherence: 20,
  visualQuality: 20,
  printSuitability: 15,
  compositionControl: 10,
  referenceAdherence: 10,
  editConsistency: 10,
  textHandling: 5,
  latency: 5,
  cost: 5,
} as const;

export interface BenchmarkCase {
  id: string;
  task: AiTask;
  prompt: string;
  productContext: ProductGenerationContext;
  requestedExactText?: string[];
  referenceAssetIds?: string[];
  styleSelection?: {
    styleFamilyId: string;
    presetId: string;
    presetVersion: number;
  };
}

export interface BenchmarkDataset {
  version: string;
  cases: BenchmarkCase[];
}

export interface BenchmarkManualScore {
  caseId: string;
  providerId: string;
  scores: Partial<Record<keyof typeof benchmarkScoreWeights, number>>;
}

export interface BenchmarkResult {
  datasetVersion: string;
  results: Array<{
    caseId: string;
    providerId: string;
    model: string;
    task: AiTask;
    outcome: 'SUCCEEDED' | 'FAILED';
    latencyMs: number;
    costCents: number | null;
    providerRequestId: string | null;
    manualScore: number | null;
    styleSelection: BenchmarkCase['styleSelection'] | null;
  }>;
  summary: Array<{
    providerId: string;
    attempts: number;
    succeeded: number;
    averageLatencyMs: number;
    averageCostCents: number | null;
    averageManualScore: number | null;
  }>;
}

/** Executes fixtures through every configured provider without selecting a winner. */
export class G1BenchmarkHarness {
  public constructor(private readonly providers: ProviderRegistry) {}

  async run(
    dataset: BenchmarkDataset,
    manualScores: BenchmarkManualScore[] = [],
  ): Promise<BenchmarkResult> {
    const results: BenchmarkResult['results'] = [];
    for (const fixture of dataset.cases) {
      for (const provider of this.providers.forTask(fixture.task)) {
        const startedAt = Date.now();
        try {
          const output = await provider.service.generate({
            generationId: `benchmark-${fixture.id}`,
            task: fixture.task,
            enhancedPrompt: fixture.prompt,
            requestedExactText: fixture.requestedExactText ?? [],
            styleSelection: benchmarkStyleSelection(fixture),
            productContext: fixture.productContext,
            referenceAssetIds: fixture.referenceAssetIds ?? [],
          });
          results.push({
            caseId: fixture.id,
            providerId: provider.configuration.id,
            model: provider.configuration.model,
            task: fixture.task,
            outcome: 'SUCCEEDED',
            latencyMs: Date.now() - startedAt,
            costCents: output.actualCostCents ?? provider.configuration.estimatedCostCents,
            providerRequestId: output.providerRequestId ?? null,
            manualScore: weightedScore(manualScores, fixture.id, provider.configuration.id),
            styleSelection: fixture.styleSelection ?? null,
          });
        } catch {
          results.push({
            caseId: fixture.id,
            providerId: provider.configuration.id,
            model: provider.configuration.model,
            task: fixture.task,
            outcome: 'FAILED',
            latencyMs: Date.now() - startedAt,
            costCents: null,
            providerRequestId: null,
            manualScore: weightedScore(manualScores, fixture.id, provider.configuration.id),
            styleSelection: fixture.styleSelection ?? null,
          });
        }
      }
    }
    return { datasetVersion: dataset.version, results, summary: summarize(results) };
  }
}

function weightedScore(
  manualScores: BenchmarkManualScore[],
  caseId: string,
  providerId: string,
): number | null {
  const score = manualScores.find(
    (entry) => entry.caseId === caseId && entry.providerId === providerId,
  );
  if (!score) return null;
  let total = 0;
  let weight = 0;
  for (const [category, categoryWeight] of Object.entries(benchmarkScoreWeights)) {
    const value = score.scores[category as keyof typeof benchmarkScoreWeights];
    if (typeof value === 'number') {
      total += value * categoryWeight;
      weight += categoryWeight;
    }
  }
  return weight ? total / weight : null;
}

function summarize(results: BenchmarkResult['results']): BenchmarkResult['summary'] {
  return [...new Set(results.map((result) => result.providerId))].map((providerId) => {
    const providerResults = results.filter((result) => result.providerId === providerId);
    const successful = providerResults.filter((result) => result.outcome === 'SUCCEEDED');
    const manual = providerResults
      .map((result) => result.manualScore)
      .filter((score): score is number => score !== null);
    const costs = successful
      .map((result) => result.costCents)
      .filter((cost): cost is number => cost !== null);
    return {
      providerId,
      attempts: providerResults.length,
      succeeded: successful.length,
      averageLatencyMs: average(providerResults.map((result) => result.latencyMs)),
      averageCostCents: costs.length ? average(costs) : null,
      averageManualScore: manual.length ? average(manual) : null,
    };
  });
}

function average(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function benchmarkStyleSelection(fixture: BenchmarkCase): ResolvedStyleSelection {
  const selection = fixture.styleSelection ?? {
    styleFamilyId: 'benchmark-auto-family',
    presetId: 'benchmark-auto-preset',
    presetVersion: 1,
  };
  return {
    selectionMode: fixture.styleSelection ? 'MANUAL' : 'AUTO',
    styleFamilyId: selection.styleFamilyId,
    presetId: selection.presetId,
    presetVersion: selection.presetVersion,
    styleFamily: { id: selection.styleFamilyId, displayName: selection.styleFamilyId },
    preset: {
      id: selection.presetId,
      displayName: selection.presetId,
      version: selection.presetVersion,
    },
    conditioning: {
      promptConditioning: {
        family: selection.styleFamilyId,
        substyle: selection.presetId,
        direction: 'Benchmark fixture structured style conditioning.',
      },
      compositionGuidance: { focus: 'benchmark focal point', layout: 'benchmark layout' },
      typographyGuidance: { mood: 'benchmark', exactTextIsDeterministic: true },
      colorStrategy: { considerShirtColor: true, avoidLowContrast: true },
      textureDetailGuidance: { detailLevel: 'print-friendly', style: 'benchmark' },
      printGuidance: { transparentBackgroundPreferred: true, avoidTinyDetails: true },
      negativeGuidance: ['unintended readable text'],
      routingHints: { task: 'TEXT_TO_ARTWORK' },
    },
  };
}
