import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { createConfiguredProviderRegistry, parseProviderConfigurations } from './ai-providers.js';
import { benchmarkScoreWeights, G1BenchmarkHarness, type BenchmarkDataset } from './benchmark.js';

const providerConfiguration = JSON.stringify([
  {
    id: 'benchmark-primary',
    adapter: 'deterministic-svg',
    enabled: true,
    tasks: ['TEXT_TO_ARTWORK'],
    model: 'benchmark-v1',
    priority: 10,
    estimatedCostCents: 0,
    timeoutMs: 1000,
    maxRetries: 0,
    fallbackEligible: true,
  },
  {
    id: 'benchmark-fallback',
    adapter: 'deterministic-pattern',
    enabled: true,
    tasks: ['TEXT_TO_ARTWORK'],
    model: 'benchmark-v2',
    priority: 20,
    estimatedCostCents: 0,
    timeoutMs: 1000,
    maxRetries: 0,
    fallbackEligible: true,
  },
]);

describe('G1 benchmark harness', () => {
  it('runs the versioned development fixture and emits structured results without choosing a winner', async () => {
    const dataset = JSON.parse(
      await readFile(new URL('../benchmarks/g1-development-fixture.json', import.meta.url), 'utf8'),
    ) as BenchmarkDataset;
    const result = await new G1BenchmarkHarness(
      createConfiguredProviderRegistry(parseProviderConfigurations(providerConfiguration)),
    ).run(dataset, [
      {
        caseId: 'typography-metadata',
        providerId: 'benchmark-primary',
        scores: { promptAdherence: 4, textHandling: 4 },
      },
    ]);

    expect(result.results).toHaveLength(dataset.cases.length * 2);
    expect(result.summary).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ providerId: 'benchmark-primary', attempts: 2 }),
      ]),
    );
    expect(benchmarkScoreWeights).toMatchObject({ promptAdherence: 20, cost: 5 });
    expect(
      createConfiguredProviderRegistry(
        parseProviderConfigurations(
          providerConfiguration
            .replace('"priority":10', '"priority":30')
            .replace('"priority":20', '"priority":1'),
        ),
      )
        .forTask('TEXT_TO_ARTWORK')
        .map((provider) => provider.configuration.id)[0],
    ).toBe('benchmark-fallback');
  });
});
