import {
  type ImageGenerationService,
  type ProviderConfiguration,
  ProviderExecutionError,
  type ProviderGenerationOutput,
  type ProviderGenerationRequest,
  type ProviderReferenceAsset,
} from './ai-contracts';

const imageSize = '1024x1024';
const imageWidth = 1024;
const imageHeight = 1024;
const maximumEncodedImageLength = 24 * 1024 * 1024;

interface OpenAiImageProviderOptions {
  apiKey: string;
  apiBaseUrl?: string;
  fetch?: typeof globalThis.fetch;
}

interface OpenAiImageResponse {
  data?: Array<{ b64_json?: unknown }>;
}

interface OpenAiErrorResponse {
  error?: { code?: unknown };
}

export class OpenAiImageProvider implements ImageGenerationService {
  readonly id: string;
  readonly model: string;
  private readonly apiBaseUrl: string;
  private readonly request: typeof globalThis.fetch;

  public constructor(
    private readonly configuration: ProviderConfiguration,
    private readonly options: OpenAiImageProviderOptions,
  ) {
    if (!options.apiKey.trim()) throw new Error('OpenAI image provider requires an API key.');
    this.id = configuration.id;
    this.model = configuration.model;
    this.apiBaseUrl = (options.apiBaseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '');
    this.request = options.fetch ?? globalThis.fetch;
  }

  supports(task: Parameters<ImageGenerationService['supports']>[0]): boolean {
    return this.configuration.tasks.includes(task);
  }

  async generate(request: ProviderGenerationRequest): Promise<ProviderGenerationOutput> {
    const references = request.referenceAssets ?? [];
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.configuration.timeoutMs);
    try {
      const response = references.length
        ? await this.editWithReferences(request, references, controller.signal)
        : await this.generateFromText(request, controller.signal);
      if (!response.ok) throw await providerHttpError(response);
      const result = (await response.json()) as OpenAiImageResponse;
      const encoded = result.data?.[0]?.b64_json;
      if (typeof encoded !== 'string') {
        throw invalidProviderResponse();
      }
      const body = decodeBase64Image(encoded);
      return {
        body,
        contentType: 'image/png',
        width: imageWidth,
        height: imageHeight,
        ...(response.headers.get('x-request-id')
          ? { providerRequestId: response.headers.get('x-request-id') as string }
          : {}),
      };
    } catch (error) {
      if (error instanceof ProviderExecutionError) throw error;
      if (controller.signal.aborted) {
        throw new ProviderExecutionError(
          'PROVIDER_TIMEOUT',
          true,
          'OpenAI image generation timed out.',
        );
      }
      throw new ProviderExecutionError(
        'PROVIDER_ERROR',
        true,
        'OpenAI image generation could not be reached.',
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private generateFromText(
    request: ProviderGenerationRequest,
    signal: AbortSignal,
  ): Promise<Response> {
    return this.request(`${this.apiBaseUrl}/images/generations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        prompt: request.enhancedPrompt,
        size: imageSize,
        quality: 'high',
        background: 'transparent',
        output_format: 'png',
        moderation: 'auto',
        n: 1,
      }),
      signal,
    });
  }

  private editWithReferences(
    request: ProviderGenerationRequest,
    references: ProviderReferenceAsset[],
    signal: AbortSignal,
  ): Promise<Response> {
    const form = new FormData();
    form.set('model', this.model);
    form.set('prompt', request.enhancedPrompt);
    form.set('size', imageSize);
    form.set('quality', 'high');
    form.set('background', 'transparent');
    form.set('output_format', 'png');
    form.set('moderation', 'auto');
    form.set('n', '1');
    for (const reference of references) {
      form.append(
        'image[]',
        new File([new Uint8Array(reference.body).buffer], referenceFileName(reference), {
          type: reference.contentType,
        }),
      );
    }
    return this.request(`${this.apiBaseUrl}/images/edits`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.options.apiKey}` },
      body: form,
      signal,
    });
  }
}

async function providerHttpError(response: Response): Promise<ProviderExecutionError> {
  const payload = await response.json().catch(() => ({}) as OpenAiErrorResponse);
  const code =
    payload && typeof payload === 'object' && 'error' in payload
      ? (payload as OpenAiErrorResponse).error?.code
      : undefined;

  if (code === 'moderation_blocked') {
    return new ProviderExecutionError(
      'MODERATION_REJECTION',
      false,
      'OpenAI rejected the image request under its moderation policy.',
    );
  }
  if (response.status === 401 || response.status === 403) {
    return new ProviderExecutionError(
      'CONFIGURATION_ERROR',
      false,
      'OpenAI authentication or model access failed.',
    );
  }
  if (response.status === 429 && code === 'insufficient_quota') {
    return new ProviderExecutionError(
      'CONFIGURATION_ERROR',
      false,
      'OpenAI quota or billing capacity is unavailable.',
    );
  }
  if (response.status === 429) {
    return new ProviderExecutionError('RATE_LIMIT', true, 'OpenAI rate limit reached.');
  }
  return new ProviderExecutionError(
    'PROVIDER_ERROR',
    response.status >= 500,
    'OpenAI image generation request failed.',
  );
}

function decodeBase64Image(encoded: string): Uint8Array {
  if (
    !encoded.length ||
    encoded.length > maximumEncodedImageLength ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
  ) {
    throw invalidProviderResponse();
  }
  const body = new Uint8Array(Buffer.from(encoded, 'base64'));
  if (!body.byteLength) throw invalidProviderResponse();
  return body;
}

function invalidProviderResponse(): ProviderExecutionError {
  return new ProviderExecutionError(
    'INVALID_PROVIDER_RESPONSE',
    false,
    'OpenAI did not return a valid image.',
  );
}

function referenceFileName(reference: ProviderReferenceAsset): string {
  const extension =
    reference.contentType === 'image/png'
      ? 'png'
      : reference.contentType === 'image/jpeg'
        ? 'jpg'
        : 'webp';
  return `${reference.id}.${extension}`;
}
