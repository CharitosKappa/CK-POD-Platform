import type {
  GenerationModerationService,
  GenerationRateLimiter,
  GenerationValidationService,
  ModerationResult,
  PreparedPrompt,
  PromptPipeline,
} from './ai-contracts';

export class DefaultPromptPipeline implements PromptPipeline {
  prepare(input: Parameters<PromptPipeline['prepare']>[0]): PreparedPrompt {
    const rawPrompt = input.rawPrompt.trim();
    if (!rawPrompt || rawPrompt.length > 2000) {
      throw new Error('Describe your idea in between 1 and 2000 characters.');
    }
    const requestedExactText = extractExactText(rawPrompt);
    const style = input.style?.trim() || 'unspecified';
    const context = `${input.productContext.productDisplayName} in ${input.productContext.colorName}`;
    const typographyInstruction = requestedExactText.length
      ? 'Required exact text is preserved as structured metadata and must not be generated as image text.'
      : 'Do not add unintended readable text.';

    return {
      enhancedPrompt: `Create original apparel artwork for ${context}. User concept: ${rawPrompt}. Style: ${style}. ${typographyInstruction}`,
      metadata: { requestedExactText, pipelineVersion: 'm2-v1' },
    };
  }
}

export class AllowAllDevelopmentModeration implements GenerationModerationService {
  async checkPrompt(): Promise<ModerationResult> {
    return { accepted: true };
  }

  async checkReferenceAssets(): Promise<ModerationResult> {
    return { accepted: true };
  }

  async checkOutput(): Promise<ModerationResult> {
    return { accepted: true };
  }
}

export class AllowAllDevelopmentValidation implements GenerationValidationService {
  async validate(): Promise<ModerationResult> {
    return { accepted: true };
  }
}

export class AllowAllGenerationRateLimiter implements GenerationRateLimiter {
  async allow(): Promise<boolean> {
    return true;
  }
}

export function extractExactText(rawPrompt: string): string[] {
  const candidates = [
    ...rawPrompt.matchAll(/[“"]([^”"]{1,120})[”"]/g),
    ...rawPrompt.matchAll(/\b(?:text|words?|phrase)\s*[:=]\s*([^,.;\n]{1,120})/gi),
  ].map((match) => match[1]?.trim() ?? '');

  return [...new Set(candidates.filter(Boolean))];
}
