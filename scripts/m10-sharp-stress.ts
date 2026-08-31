import { createEmptyEditorDocument } from '@let-it-be/editor-schema';
import { SharpProductionRenderer, developmentDtgProfile } from '@let-it-be/prepress';

const total = Number(process.env.M10_SHARP_RENDER_REQUESTS ?? 4);
const concurrency = Number(process.env.M10_SHARP_RENDER_CONCURRENCY ?? 2);
if (!Number.isInteger(total) || total < 1 || !Number.isInteger(concurrency) || concurrency < 1)
  throw new Error('M10 Sharp render request and concurrency values must be positive integers.');

const vector = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000"><rect width="1000" height="1000" fill="#ff5500"/></svg>',
);
const base = createEmptyEditorDocument();
const document = {
  ...base,
  layers: [
    {
      id: 'art',
      type: 'generated' as const,
      assetId: 'stress-source',
      generationId: 'stress-generation',
      x: 0.5,
      y: 0.5,
      width: 0.4,
      height: 0.3,
      rotation: 15,
      opacity: 1,
      visible: true,
      locked: false,
      zIndex: 0,
      crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
    },
    {
      id: 'text',
      type: 'text' as const,
      text: 'CREATE',
      fontId: 'oswald' as const,
      fontWeight: 700,
      fontSize: 120,
      fill: '#ffffff',
      alignment: 'center' as const,
      x: 0.5,
      y: 0.78,
      width: 0.6,
      height: 0.15,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      zIndex: 1,
    },
  ],
};
const resolver = {
  getSourceAsset: async () => ({
    id: 'stress-source',
    body: vector,
    contentType: 'image/svg+xml',
    width: 1000,
    height: 1000,
  }),
};
const latencies: number[] = [];
let next = 0;
let failures = 0;
const hashes = new Set<string>();
const started = performance.now();

async function worker(): Promise<void> {
  const renderer = new SharpProductionRenderer();
  while (true) {
    const index = next++;
    if (index >= total) return;
    const began = performance.now();
    try {
      const result = await renderer.render({
        document,
        profile: developmentDtgProfile,
        assets: resolver,
      });
      hashes.add(result.pixelHash);
    } catch {
      failures += 1;
    } finally {
      latencies.push(performance.now() - began);
    }
  }
}

async function main(): Promise<void> {
  await Promise.all(Array.from({ length: Math.min(total, concurrency) }, () => worker()));
  latencies.sort((left, right) => left - right);
  const percentile = (value: number) =>
    latencies[Math.min(latencies.length - 1, Math.ceil(latencies.length * value) - 1)] ?? 0;
  console.info(
    JSON.stringify({
      scenario: 'sharp_production_render_stress',
      total,
      concurrency: Math.min(total, concurrency),
      errorRate: failures / total,
      deterministicPixelHashes: hashes.size,
      elapsedMs: Math.round(performance.now() - started),
      p50Ms: Number(percentile(0.5).toFixed(2)),
      p95Ms: Number(percentile(0.95).toFixed(2)),
      p99Ms: Number(percentile(0.99).toFixed(2)),
      memoryRssBytes: process.memoryUsage().rss,
    }),
  );
  if (failures || hashes.size !== 1) process.exitCode = 1;
}

void main();
