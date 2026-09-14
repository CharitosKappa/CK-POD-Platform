import { createHash } from 'node:crypto';

import { config } from 'dotenv';

import { parseServerEnvironment } from '@let-it-be/config';
import {
  createConfiguredProviderRegistry,
  parseProviderConfigurations,
  type ProviderGenerationRequest,
} from '@let-it-be/domain';

config();

async function main(): Promise<void> {
  const environment = parseServerEnvironment(process.env);
  if (!environment.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required for the paid OpenAI image smoke test.');
  }
  const registry = createConfiguredProviderRegistry(
    parseProviderConfigurations(environment.AI_PROVIDER_CONFIG),
    {
      openAiApiKey: environment.OPENAI_API_KEY,
      openAiApiBaseUrl: environment.OPENAI_API_BASE_URL,
    },
  );
  const provider = registry
    .forTask('TEXT_TO_ARTWORK')
    .find(({ configuration }) => configuration.adapter === 'openai-images');
  if (!provider) throw new Error('The OpenAI image provider is not active.');

  const output = await provider.service.generate(smokeRequest());
  process.stdout.write(
    `${JSON.stringify(
      {
        provider: provider.configuration.id,
        model: provider.configuration.model,
        requestId: output.providerRequestId ?? null,
        contentType: output.contentType,
        width: output.width,
        height: output.height,
        byteSize: output.body.byteLength,
        sha256: createHash('sha256').update(output.body).digest('hex'),
      },
      null,
      2,
    )}\n`,
  );
}

function smokeRequest(): ProviderGenerationRequest {
  return {
    generationId: 'paid-openai-smoke',
    task: 'TEXT_TO_ARTWORK',
    enhancedPrompt:
      'Create premium original apparel artwork: a bold rising sun above abstract ocean waves, no words or letters, centered isolated composition, transparent background, high contrast suitable for printing on a black T-shirt.',
    requestedExactText: [],
    styleSelection: {
      selectionMode: 'AUTO',
      styleFamilyId: 'smoke-original-emblem',
      presetId: 'smoke-sun-and-waves',
      presetVersion: 1,
      styleFamily: { id: 'smoke-original-emblem', displayName: 'Original Emblem' },
      preset: { id: 'smoke-sun-and-waves', displayName: 'Sun and Waves', version: 1 },
      conditioning: {
        promptConditioning: {
          family: 'Original Emblem',
          substyle: 'Sun and Waves',
          direction: 'Premium graphic apparel artwork.',
        },
        compositionGuidance: { focus: 'single focal emblem', layout: 'centered' },
        typographyGuidance: { mood: 'none', exactTextIsDeterministic: true },
        colorStrategy: { considerShirtColor: true, avoidLowContrast: true },
        textureDetailGuidance: { detailLevel: 'print-friendly', style: 'clean graphic' },
        printGuidance: { transparentBackgroundPreferred: true, avoidTinyDetails: true },
        negativeGuidance: ['text', 'letters', 'mockup', 'shirt', 'background'],
        routingHints: { task: 'TEXT_TO_ARTWORK' },
      },
    },
    productContext: {
      productModelId: 'essential-dtg-tee',
      productDisplayName: 'Classic T-Shirt',
      colorCode: 'black',
      colorName: 'Black',
      printArea: {},
    },
    referenceAssetIds: [],
    referenceAssets: [],
  };
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'OpenAI image smoke test failed.');
  process.exitCode = 1;
});
