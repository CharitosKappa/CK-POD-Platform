import { describe, expect, it } from 'vitest';

import { DeterministicSvgProvider } from './ai-providers.js';
import { DefaultPromptPipeline } from './prompt-pipeline.js';
import type { ResolvedStyleSelection } from './styles.js';

const productContext = {
  productModelId: 'essential-dtg-tee',
  productDisplayName: 'Essential DTG T-Shirt',
  colorCode: 'black',
  colorName: 'Black',
  printArea: {},
};

describe('structured preset conditioning', () => {
  it('keeps exact text separate while changing deterministic provider output by preset', async () => {
    const vintage = style(
      'family-vintage',
      'preset-vintage-engraving',
      'Vintage',
      'Vintage Engraving',
    );
    const dark = style('family-dark', 'preset-dark-blackwork', 'Dark', 'Blackwork');
    const pipeline = new DefaultPromptPipeline();
    const input = {
      rawPrompt: 'A raven crest with the words "MAKE NOISE".',
      productContext,
      referenceAssetIds: [],
    };
    const vintagePrompt = pipeline.prepare({ ...input, styleSelection: vintage });
    const darkPrompt = pipeline.prepare({ ...input, styleSelection: dark });

    expect(vintagePrompt.metadata.requestedExactText).toEqual(['MAKE NOISE']);
    expect(darkPrompt.metadata.requestedExactText).toEqual(['MAKE NOISE']);
    expect(vintagePrompt.enhancedPrompt).toContain('Vintage / Vintage Engraving');
    expect(darkPrompt.enhancedPrompt).toContain('Dark / Blackwork');

    const provider = new DeterministicSvgProvider('development', 'v1');
    const [vintageOutput, darkOutput] = await Promise.all([
      provider.generate({
        generationId: 'vintage',
        task: 'TEXT_TO_ARTWORK',
        enhancedPrompt: vintagePrompt.enhancedPrompt,
        requestedExactText: vintagePrompt.metadata.requestedExactText,
        styleSelection: vintage,
        productContext,
        referenceAssetIds: [],
      }),
      provider.generate({
        generationId: 'dark',
        task: 'TEXT_TO_ARTWORK',
        enhancedPrompt: darkPrompt.enhancedPrompt,
        requestedExactText: darkPrompt.metadata.requestedExactText,
        styleSelection: dark,
        productContext,
        referenceAssetIds: [],
      }),
    ]);
    expect(new TextDecoder().decode(vintageOutput.body)).not.toEqual(
      new TextDecoder().decode(darkOutput.body),
    );
  });
});

function style(
  styleFamilyId: string,
  presetId: string,
  family: string,
  preset: string,
): ResolvedStyleSelection {
  return {
    selectionMode: 'MANUAL',
    styleFamilyId,
    presetId,
    presetVersion: 1,
    styleFamily: { id: styleFamilyId, displayName: family },
    preset: { id: presetId, displayName: preset, version: 1 },
    conditioning: {
      promptConditioning: { family, substyle: preset, direction: `${preset} direction` },
      compositionGuidance: { focus: 'single focal point', layout: 'balanced layout' },
      typographyGuidance: { mood: preset, exactTextIsDeterministic: true },
      colorStrategy: { considerShirtColor: true, avoidLowContrast: true },
      textureDetailGuidance: { detailLevel: 'print-friendly', style: presetId },
      printGuidance: { transparentBackgroundPreferred: true, avoidTinyDetails: true },
      negativeGuidance: ['unintended readable text'],
      routingHints: { task: 'TEXT_TO_ARTWORK' },
    },
  };
}
