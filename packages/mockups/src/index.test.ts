import { describe, expect, it } from 'vitest';

import {
  developmentProfileFor,
  mockupPixelPlacement,
  SharpGarmentMockupRenderer,
} from './index.js';

const artwork = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600"><circle cx="600" cy="580" r="180" fill="#f6b943"/><path d="M170 1190 460 820l170 190 170-250 230 430" fill="none" stroke="#2563eb" stroke-width="90" stroke-linejoin="round"/></svg>',
);

describe('profiled Sharp garment mockup renderer', () => {
  it('resolves explicit product/color profiles and maps artwork into the garment chest', () => {
    const black = developmentProfileFor({
      productModelId: 'essential-dtg-tee',
      colorCode: 'black',
    });
    const navy = developmentProfileFor({ productModelId: 'essential-dtg-tee', colorCode: 'navy' });
    expect(black).toMatchObject({ qualification: 'DEVELOPMENT / UNQUALIFIED', colorCode: 'black' });
    expect(navy?.id).not.toBe(black?.id);
    expect(mockupPixelPlacement(1365, 2048, black!.placement)).toEqual({
      left: 377,
      top: 584,
      width: 612,
      height: 696,
    });
  });

  // Three full garment composites can contend with the production renderer in the parallel suite.
  // This is a test-environment budget, not a rendering-quality threshold.
  it('renders the same approved artwork deterministically and varies with the shirt profile', async () => {
    const renderer = new SharpGarmentMockupRenderer();
    const black = developmentProfileFor({
      productModelId: 'essential-dtg-tee',
      colorCode: 'black',
    })!;
    const navy = developmentProfileFor({ productModelId: 'essential-dtg-tee', colorCode: 'navy' })!;
    const first = await renderer.render({ profile: black, artwork });
    const repeated = await renderer.render({ profile: black, artwork });
    const navyProof = await renderer.render({ profile: navy, artwork });
    expect(first.pixelHash).toBe(repeated.pixelHash);
    expect(first.png.byteLength).toBeGreaterThan(50_000);
    expect(first.pixelHash).not.toBe(navyProof.pixelHash);
  }, 10_000);
});
