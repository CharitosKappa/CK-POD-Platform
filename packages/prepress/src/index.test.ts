import { describe, expect, it } from 'vitest';

import { createEmptyEditorDocument, type EditorDocumentV1 } from '@let-it-be/editor-schema';
import sharp from 'sharp';

import {
  SharpProductionRenderer,
  FontResolutionError,
  calculateEffectiveDpi,
  calculatePrintabilityScore,
  developmentDtgProfile,
  normalizedToPhysical,
  validatePreflight,
} from './index';

const vector = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000"><rect x="0" y="0" width="1000" height="1000" fill="#ff5500"/></svg>',
);

function documentWithLayers(): EditorDocumentV1 {
  const document = createEmptyEditorDocument();
  return {
    ...document,
    layers: [
      {
        id: 'art',
        type: 'generated',
        assetId: 'asset-art',
        generationId: 'generation',
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
        type: 'text',
        text: 'CREATE',
        fontId: 'oswald',
        fontWeight: 700,
        fontSize: 120,
        fill: '#ffffff',
        alignment: 'center',
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
}

describe('production prepress primitives', () => {
  it('maps normalized geometry to profile pixels and inches independently of a viewport', () => {
    const geometry = normalizedToPhysical(documentWithLayers().layers[0]!, developmentDtgProfile);
    expect(geometry).toMatchObject({
      xPx: 1800,
      yPx: 2400,
      widthPx: 1440,
      heightPx: 1440,
      rotationDegrees: 15,
    });
    expect(geometry.widthInches).toBeCloseTo(4.8);
    expect(geometry.heightInches).toBeCloseTo(4.8);
  });

  it('calculates effective DPI from crop and printed size', () => {
    const layer = documentWithLayers().layers[0]!;
    const dpi = calculateEffectiveDpi({
      sourceWidth: 2400,
      sourceHeight: 2400,
      layer,
      profile: developmentDtgProfile,
      ...(layer.type !== 'text' && layer.crop ? { crop: layer.crop } : {}),
    });
    expect(dpi.minimum).toBeCloseTo(400);
  });

  it('renders canonical layer order, crop, rotation, alpha and approved text deterministically', async () => {
    const renderer = new SharpProductionRenderer();
    const document = documentWithLayers();
    const resolver = {
      getSourceAsset: async () => ({
        id: 'source-art',
        body: vector,
        contentType: 'image/svg+xml',
        width: 1000,
        height: 1000,
      }),
    };
    const first = await renderer.render({
      document,
      profile: developmentDtgProfile,
      assets: resolver,
    });
    const second = await renderer.render({
      document,
      profile: developmentDtgProfile,
      assets: resolver,
    });
    expect(first.pixelHash).toBe(second.pixelHash);
    expect(first).toMatchObject({
      width: 3600,
      height: 4800,
      sourceAssetIds: ['source-art'],
      hasTransparency: true,
    });
    expect((await sharp(first.png).metadata()).hasAlpha).toBe(true);
    const overlapping = {
      ...document,
      layers: document.layers.map((layer, index) =>
        index === 1 ? { ...layer, y: 0.5, zIndex: 0 } : { ...layer, zIndex: 1 },
      ),
    };
    expect(
      (
        await renderer.render({
          document: overlapping,
          profile: developmentDtgProfile,
          assets: resolver,
        })
      ).pixelHash,
    ).not.toBe(first.pixelHash);
  });

  it('fails safely when an approved production font cannot be resolved', async () => {
    const renderer = new SharpProductionRenderer();
    const document = documentWithLayers();
    const text = document.layers[1];
    if (!text || text.type !== 'text') throw new Error('Expected text fixture.');
    document.layers[1] = { ...text, fontId: 'missing-font' as 'inter' };
    await expect(
      renderer.render({
        document,
        profile: developmentDtgProfile,
        assets: {
          getSourceAsset: async () => ({
            id: 'source-art',
            body: vector,
            contentType: 'image/svg+xml',
            width: 1000,
            height: 1000,
          }),
        },
      }),
    ).rejects.toBeInstanceOf(FontResolutionError);
  });

  it('returns structured blockers while keeping scoring bands distinct', () => {
    const document = documentWithLayers();
    document.layers[0] = { ...document.layers[0]!, x: 0.98 };
    const result = validatePreflight({
      document,
      profile: developmentDtgProfile,
      master: {
        png: new Uint8Array(),
        width: 3600,
        height: 4800,
        pixelHash: 'hash',
        rendererVersion: 'test',
        sourceAssetIds: ['source-art'],
        sourceAssets: [
          {
            layerId: 'art',
            assetId: 'source-art',
            contentType: 'image/png',
            sourceWidth: 40,
            sourceHeight: 40,
            hasAlpha: false,
            isVector: false,
          },
        ],
        hasTransparency: true,
        hasPartialTransparency: false,
      },
      productColorCode: 'black',
    });
    expect(result.readiness).toBe('BLOCKED');
    expect(result.score.blockers.some((finding) => finding.code === 'PRINT_AREA_CLIPPING')).toBe(
      true,
    );
    expect(result.findings.every((finding) => finding.evidence)).toBe(true);
  });

  it('uses the locked score weights and bands', () => {
    expect(calculatePrintabilityScore([])).toMatchObject({ total: 100, band: 'GREEN' });
    expect(
      calculatePrintabilityScore([
        { category: 'CONTRAST', code: 'LOW', severity: 'WARNING', message: 'x', evidence: {} },
      ]),
    ).toMatchObject({ total: 96, band: 'GREEN' });
    expect(
      calculatePrintabilityScore([
        { category: 'PLACEMENT', code: 'BAD', severity: 'BLOCKER', message: 'x', evidence: {} },
      ]),
    ).toMatchObject({ total: 80, band: 'AMBER', blockers: [{ code: 'BAD' }] });
  });
});
