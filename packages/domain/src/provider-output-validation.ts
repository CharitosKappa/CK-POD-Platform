import type { GenerationValidationService, ModerationResult } from './ai-contracts.js';

const maxBytes = 15 * 1024 * 1024;
const maxPixels = 50_000_000;
const maxDimension = 10_000;
const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];

/**
 * Rejects malformed or implausibly large provider artwork before private
 * storage. The provider's MIME label, dimensions, and bytes are all treated
 * as untrusted. This is also the mandatory boundary for any future uploads.
 */
export class DefaultProviderOutputValidation implements GenerationValidationService {
  async validate(
    input: Parameters<GenerationValidationService['validate']>[0],
  ): Promise<ModerationResult> {
    if (!['image/png', 'image/jpeg', 'image/svg+xml'].includes(input.contentType))
      return { accepted: false, reason: 'Unsupported image format.' };
    if (!input.body.byteLength || input.body.byteLength > maxBytes)
      return { accepted: false, reason: 'Image payload exceeds the permitted size.' };
    if (
      !Number.isInteger(input.width) ||
      !Number.isInteger(input.height) ||
      input.width < 1 ||
      input.height < 1 ||
      input.width > maxDimension ||
      input.height > maxDimension ||
      input.width * input.height > maxPixels
    )
      return { accepted: false, reason: 'Image dimensions exceed the permitted limits.' };
    if (!hasMatchingSignature(input.body, input.contentType))
      return { accepted: false, reason: 'Image bytes do not match the declared content type.' };
    return { accepted: true };
  }
}

function hasMatchingSignature(body: Uint8Array, contentType: string): boolean {
  if (contentType === 'image/png') return pngSignature.every((byte, index) => body[index] === byte);
  if (contentType === 'image/jpeg') return body[0] === 0xff && body[1] === 0xd8;

  const svg = new TextDecoder().decode(body.subarray(0, Math.min(body.byteLength, 32_768))).trim();
  return (
    /<svg(?:\s|>)/i.test(svg) &&
    !/<script(?:\s|>)/i.test(svg) &&
    !/\son[a-z]+\s*=/i.test(svg) &&
    !/(?:href|xlink:href)\s*=\s*["']\s*(?:https?:|data:|file:)/i.test(svg)
  );
}
