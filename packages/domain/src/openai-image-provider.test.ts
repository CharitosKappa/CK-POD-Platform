import { describe, expect, it } from 'vitest';

import { type ProviderConfiguration, type ProviderGenerationRequest } from './ai-contracts.js';
import { OpenAiImageProvider } from './openai-image-provider.js';

const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);

describe('OpenAiImageProvider', () => {
  it('creates transparent medium-quality Sunburst artwork through the generations endpoint', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const provider = createProvider(async (input, init) => {
      calls.push({ url: String(input), init: init ?? {} });
      return jsonResponse(
        { data: [{ b64_json: Buffer.from(pngBytes).toString('base64') }] },
        { 'x-request-id': 'req_generation' },
      );
    });

    const output = await provider.generate(generationRequest());

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.openai.test/v1/images/generations');
    expect(calls[0]?.init.headers).toMatchObject({
      Authorization: 'Bearer test-key',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      model: 'gpt-image-2.5-sunburst',
      prompt: 'Create original print artwork.',
      size: '1024x1024',
      quality: 'medium',
      background: 'transparent',
      output_format: 'png',
      moderation: 'auto',
      n: 1,
    });
    expect(output).toMatchObject({
      contentType: 'image/png',
      width: 1024,
      height: 1024,
      providerRequestId: 'req_generation',
    });
    expect(output.body).toEqual(pngBytes);
  });

  it('uses multipart image edits when private reference bytes are supplied', async () => {
    const submission: { form?: FormData } = {};
    const provider = createProvider(async (input, init) => {
      expect(String(input)).toBe('https://api.openai.test/v1/images/edits');
      submission.form = init?.body as FormData;
      return jsonResponse({ data: [{ b64_json: Buffer.from(pngBytes).toString('base64') }] });
    });
    const request = generationRequest();
    request.referenceAssets = [
      {
        id: 'reference-1',
        body: new Uint8Array([1, 2, 3]),
        contentType: 'image/png',
      },
      {
        id: 'reference-2',
        body: new Uint8Array([4, 5, 6]),
        contentType: 'image/jpeg',
      },
    ];

    await provider.generate(request);

    const submitted = submission.form;
    expect(submitted).toBeInstanceOf(FormData);
    if (!submitted) throw new Error('Expected a multipart submission.');
    expect(submitted.get('model')).toBe('gpt-image-2.5-sunburst');
    expect(submitted.get('prompt')).toBe('Create original print artwork.');
    expect(submitted.get('background')).toBe('transparent');
    expect(submitted.get('quality')).toBe('medium');
    expect(submitted.get('output_format')).toBe('png');
    expect(submitted.getAll('image[]')).toHaveLength(2);
    expect((submitted.getAll('image[]')[0] as File).name).toBe('reference-1.png');
    expect((submitted.getAll('image[]')[1] as File).name).toBe('reference-2.jpg');
  });

  it.each([
    [401, 'invalid_api_key', 'CONFIGURATION_ERROR', false],
    [429, 'insufficient_quota', 'CONFIGURATION_ERROR', false],
    [429, 'rate_limit_exceeded', 'RATE_LIMIT', true],
    [400, 'moderation_blocked', 'MODERATION_REJECTION', false],
    [500, 'server_error', 'PROVIDER_ERROR', true],
  ] as const)('maps HTTP %s with %s to %s', async (status, code, category, retryable) => {
    const provider = createProvider(async () =>
      jsonResponse({ error: { code, message: 'Sensitive provider detail' } }, {}, status),
    );

    await expect(provider.generate(generationRequest())).rejects.toMatchObject({
      category,
      retryable,
    });
  });

  it('rejects a successful response without decodable image data', async () => {
    const provider = createProvider(async () => jsonResponse({ data: [{}] }));

    await expect(provider.generate(generationRequest())).rejects.toMatchObject({
      category: 'INVALID_PROVIDER_RESPONSE',
      retryable: false,
    });
  });

  it('aborts a provider request at the configured adapter timeout', async () => {
    const provider = new OpenAiImageProvider(configuration(10), {
      apiKey: 'test-key',
      apiBaseUrl: 'https://api.openai.test/v1',
      fetch: async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted')));
        }),
    });

    await expect(provider.generate(generationRequest())).rejects.toMatchObject({
      category: 'PROVIDER_TIMEOUT',
      retryable: true,
    });
  });
});

function createProvider(fetch: typeof globalThis.fetch): OpenAiImageProvider {
  return new OpenAiImageProvider(configuration(), {
    apiKey: 'test-key',
    apiBaseUrl: 'https://api.openai.test/v1',
    fetch,
  });
}

function configuration(timeoutMs = 1000): ProviderConfiguration {
  return {
    id: 'openai-sunburst',
    adapter: 'openai-images',
    enabled: true,
    tasks: ['TEXT_TO_ARTWORK'],
    model: 'gpt-image-2.5-sunburst',
    priority: 1,
    estimatedCostCents: 0,
    timeoutMs,
    maxRetries: 1,
    fallbackEligible: false,
  };
}

function generationRequest(): ProviderGenerationRequest {
  return {
    generationId: 'generation-1',
    task: 'TEXT_TO_ARTWORK',
    enhancedPrompt: 'Create original print artwork.',
    requestedExactText: [],
    styleSelection: {
      selectionMode: 'AUTO',
      styleFamilyId: 'family',
      presetId: 'preset',
      presetVersion: 1,
      styleFamily: { id: 'family', displayName: 'Family' },
      preset: { id: 'preset', displayName: 'Preset', version: 1 },
      conditioning: {
        promptConditioning: { family: 'family', substyle: 'preset', direction: 'direction' },
        compositionGuidance: { focus: 'focus', layout: 'layout' },
        typographyGuidance: { mood: 'mood', exactTextIsDeterministic: true },
        colorStrategy: { considerShirtColor: true, avoidLowContrast: true },
        textureDetailGuidance: { detailLevel: 'detail', style: 'style' },
        printGuidance: { transparentBackgroundPreferred: true, avoidTinyDetails: true },
        negativeGuidance: [],
        routingHints: { task: 'TEXT_TO_ARTWORK' },
      },
    },
    productContext: {
      productModelId: 'product',
      productDisplayName: 'Classic T-Shirt',
      colorCode: 'black',
      colorName: 'Black',
      printArea: {},
    },
    referenceAssetIds: [],
    referenceAssets: [],
  };
}

function jsonResponse(body: unknown, headers: Record<string, string> = {}, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}
