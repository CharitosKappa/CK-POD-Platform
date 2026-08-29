import { config } from 'dotenv';
import { readFile } from 'node:fs/promises';

import { parseServerEnvironment } from '@let-it-be/config';
import {
  createConfiguredProviderRegistry,
  G1BenchmarkHarness,
  parseProviderConfigurations,
  type BenchmarkDataset,
  type BenchmarkManualScore,
} from '@let-it-be/domain';

config();

async function main(): Promise<void> {
  const environment = parseServerEnvironment(process.env);
  const fixturePath =
    process.env.G1_BENCHMARK_DATASET ?? 'packages/domain/benchmarks/g1-development-fixture.json';
  const dataset = JSON.parse(await readFile(fixturePath, 'utf8')) as BenchmarkDataset;
  const manualScores = process.env.G1_MANUAL_SCORES_FILE
    ? (JSON.parse(
        await readFile(process.env.G1_MANUAL_SCORES_FILE, 'utf8'),
      ) as BenchmarkManualScore[])
    : [];
  const harness = new G1BenchmarkHarness(
    createConfiguredProviderRegistry(parseProviderConfigurations(environment.AI_PROVIDER_CONFIG)),
  );

  process.stdout.write(`${JSON.stringify(await harness.run(dataset, manualScores), null, 2)}\n`);
}

void main();
