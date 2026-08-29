export const aiTasks = [
  'PROMPT_UNDERSTANDING',
  'PROMPT_ENHANCEMENT',
  'TEXT_TO_ARTWORK',
  'REFERENCE_TO_ARTWORK',
  'IMAGE_EDITING',
  'SELECTED_ELEMENT_EDITING',
  'BACKGROUND_REMOVAL',
  'UPSCALE',
  'PROMPT_ALIGNMENT_VALIDATION',
  'ARTIFACT_DETECTION',
  'SAFETY_CLASSIFICATION',
  'IP_RISK_CLASSIFICATION',
] as const;

export type AiTask = (typeof aiTasks)[number];

export const generationStatuses = [
  'QUEUED',
  'PROCESSING',
  'VALIDATING',
  'SUCCEEDED',
  'FAILED',
  'REJECTED_INTERNAL',
  'CANCELLED',
] as const;

export type GenerationStatus = (typeof generationStatuses)[number];

export const generationFailureCategories = [
  'PROVIDER_ERROR',
  'PROVIDER_TIMEOUT',
  'RATE_LIMIT',
  'INVALID_PROVIDER_RESPONSE',
  'STORAGE_FAILURE',
  'INTERNAL_VALIDATION_FAILURE',
  'MODERATION_REJECTION',
  'CONFIGURATION_ERROR',
  'UNKNOWN',
] as const;

export type GenerationFailureCategory = (typeof generationFailureCategories)[number];

export interface ProductGenerationContext {
  productModelId: string;
  productDisplayName: string;
  colorCode: string;
  colorName: string;
  printArea: Record<string, unknown>;
}

export interface ProviderConfiguration {
  id: string;
  adapter: 'deterministic-svg' | 'deterministic-pattern';
  enabled: boolean;
  tasks: AiTask[];
  model: string;
  priority: number;
  estimatedCostCents: number;
  timeoutMs: number;
  maxRetries: number;
  fallbackEligible: boolean;
}

export interface ProviderGenerationRequest {
  generationId: string;
  task: AiTask;
  enhancedPrompt: string;
  requestedExactText: string[];
  style: string | null;
  productContext: ProductGenerationContext;
  referenceAssetIds: string[];
}

export interface ProviderGenerationOutput {
  body: Uint8Array;
  contentType: string;
  width: number;
  height: number;
  providerRequestId?: string;
  actualCostCents?: number;
}

/** Task-oriented generation provider contract. Domain callers never depend on a vendor SDK. */
export interface ImageGenerationService {
  readonly id: string;
  readonly model: string;
  supports(task: AiTask): boolean;
  generate(request: ProviderGenerationRequest): Promise<ProviderGenerationOutput>;
}

export interface GenerationProvider {
  configuration: ProviderConfiguration;
  service: ImageGenerationService;
}

export interface PreparedPrompt {
  enhancedPrompt: string;
  metadata: {
    requestedExactText: string[];
    pipelineVersion: string;
  };
}

export interface PromptPipeline {
  prepare(input: {
    rawPrompt: string;
    style: string | null;
    productContext: ProductGenerationContext;
    referenceAssetIds: string[];
  }): PreparedPrompt;
}

export interface ModerationResult {
  accepted: boolean;
  reason?: string;
}

export interface GenerationModerationService {
  checkPrompt(input: { rawPrompt: string }): Promise<ModerationResult>;
  checkReferenceAssets(input: { assetIds: string[] }): Promise<ModerationResult>;
  checkOutput(input: { body: Uint8Array; contentType: string }): Promise<ModerationResult>;
}

export interface GenerationValidationService {
  validate(input: {
    body: Uint8Array;
    contentType: string;
    width: number;
    height: number;
    productContext: ProductGenerationContext;
  }): Promise<ModerationResult>;
}

export interface GenerationRateLimiter {
  allow(input: { subjectId: string; projectId: string }): Promise<boolean>;
}

export class ProviderExecutionError extends Error {
  public constructor(
    public readonly category: GenerationFailureCategory,
    public readonly retryable: boolean,
    message: string,
  ) {
    super(message);
  }
}

export class GenerationAccessError extends Error {}
export class GenerationCreditError extends Error {}
