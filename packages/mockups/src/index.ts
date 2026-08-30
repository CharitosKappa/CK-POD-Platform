import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

export const mockupRendererName = 'SHARP_GARMENT_PROFILE';
export const mockupRendererVersion = 'sharp-garment-profile-v1';

export interface GarmentMockupProfile {
  id: string;
  version: string;
  productModelId: string;
  colorCode: string;
  developmentOnly: boolean;
  qualification: 'DEVELOPMENT / UNQUALIFIED' | 'QUALIFIED';
  blankAsset: string;
  placement: { x: number; y: number; width: number; height: number; rotation: number };
  mask: { cornerRadius: number; inset: number };
  integration: { artworkOpacity: number; shadingOpacity: number; highlightOpacity: number };
  perspective: { enabled: boolean; note: string };
}

export interface RenderedMockup {
  png: Uint8Array;
  width: number;
  height: number;
  pixelHash: string;
  renderer: typeof mockupRendererName;
  rendererVersion: typeof mockupRendererVersion;
}

/**
 * Development-only profile registry. Each product/color is intentionally explicit,
 * so qualified licensed photography can replace any one profile without changing
 * commerce or proof logic.
 */
export const developmentGarmentMockupProfiles: readonly GarmentMockupProfile[] = [
  profile('black'),
  profile('white'),
  profile('navy'),
];

export function developmentProfileFor(input: {
  productModelId: string;
  colorCode: string;
}): GarmentMockupProfile | null {
  return (
    developmentGarmentMockupProfiles.find(
      (profile) =>
        profile.productModelId === input.productModelId && profile.colorCode === input.colorCode,
    ) ?? null
  );
}

/** Server-only renderer for controlled consumer proof derivatives. */
export class SharpGarmentMockupRenderer {
  async render(input: {
    profile: GarmentMockupProfile;
    artwork: Uint8Array;
  }): Promise<RenderedMockup> {
    const blank = await readFile(assetPath(input.profile.blankAsset));
    const source = sharp(blank, { animated: false });
    const metadata = await source.metadata();
    const width = metadata.width;
    const height = metadata.height;
    if (!width || !height) throw new Error('Garment mockup asset dimensions are unavailable.');

    const placement = mockupPixelPlacement(width, height, input.profile.placement);
    const artwork = await sharp(input.artwork, { animated: false })
      .resize(placement.width, placement.height, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
        kernel: sharp.kernel.lanczos3,
      })
      .rotate(input.profile.placement.rotation, {
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const mask = await chestMask(artwork.info.width, artwork.info.height, input.profile.mask);
    const integratedArtwork = await applyMaskAndOpacity(
      artwork.data,
      mask,
      input.profile.integration.artworkOpacity,
      artwork.info.width,
      artwork.info.height,
    );
    const garmentIntegration = await garmentShading(
      blank,
      placement,
      integratedArtwork.alpha,
      artwork.info.width,
      artwork.info.height,
      input.profile.integration,
    );

    const png = await source
      .composite([
        { input: integratedArtwork.png, left: placement.left, top: placement.top, blend: 'over' },
        {
          input: garmentIntegration.shading,
          left: placement.left,
          top: placement.top,
          blend: 'multiply',
        },
        {
          input: garmentIntegration.highlights,
          left: placement.left,
          top: placement.top,
          blend: 'screen',
        },
      ])
      .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
      .toBuffer();
    const raw = await sharp(png).ensureAlpha().raw().toBuffer();
    return {
      png,
      width,
      height,
      pixelHash: createHash('sha256').update(raw).digest('hex'),
      renderer: mockupRendererName,
      rendererVersion: mockupRendererVersion,
    };
  }
}

function profile(colorCode: 'black' | 'white' | 'navy'): GarmentMockupProfile {
  return {
    id: `development-essential-tee-${colorCode}-front-v1`,
    version: 'v1',
    productModelId: 'essential-dtg-tee',
    colorCode,
    developmentOnly: true,
    qualification: 'DEVELOPMENT / UNQUALIFIED',
    blankAsset: `development-essential-tee-${colorCode}-v1.png`,
    placement: { x: 0.276, y: 0.285, width: 0.448, height: 0.34, rotation: 0 },
    mask: { cornerRadius: 0.035, inset: 0.015 },
    integration: { artworkOpacity: 0.97, shadingOpacity: 0.2, highlightOpacity: 0.06 },
    perspective: {
      enabled: false,
      note: 'Front-facing flat-lay development photography does not require a perspective warp.',
    },
  };
}

function assetPath(asset: string): string {
  return fileURLToPath(new URL(`../assets/${asset}`, import.meta.url));
}

export function mockupPixelPlacement(
  width: number,
  height: number,
  placement: GarmentMockupProfile['placement'],
) {
  return {
    left: Math.round(width * placement.x),
    top: Math.round(height * placement.y),
    width: Math.max(1, Math.round(width * placement.width)),
    height: Math.max(1, Math.round(height * placement.height)),
  };
}

async function chestMask(
  width: number,
  height: number,
  mask: GarmentMockupProfile['mask'],
): Promise<Uint8Array> {
  const inset = Math.round(Math.min(width, height) * mask.inset);
  const radius = Math.round(Math.min(width, height) * mask.cornerRadius);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect x="${inset}" y="${inset}" width="${Math.max(1, width - inset * 2)}" height="${Math.max(1, height - inset * 2)}" rx="${radius}" fill="#fff"/></svg>`;
  return sharp(Buffer.from(svg)).removeAlpha().raw().toBuffer();
}

async function applyMaskAndOpacity(
  body: Buffer,
  mask: Uint8Array,
  opacity: number,
  width: number,
  height: number,
): Promise<{ png: Buffer; alpha: Buffer }> {
  const output = Buffer.from(body);
  const alpha = Buffer.allocUnsafe(body.length / 4);
  for (let pixel = 0, offset = 3; offset < output.length; pixel += 1, offset += 4) {
    const masked = Math.round((output[offset] ?? 0) * ((mask[pixel] ?? 0) / 255) * opacity);
    output[offset] = masked;
    alpha[pixel] = masked;
  }
  return {
    png: await sharp(output, { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer(),
    alpha,
  };
}

async function garmentShading(
  blank: Buffer,
  placement: { left: number; top: number; width: number; height: number },
  artworkAlpha: Buffer,
  width: number,
  height: number,
  integration: GarmentMockupProfile['integration'],
): Promise<{ shading: Buffer; highlights: Buffer }> {
  const garment = await sharp(blank)
    .extract({
      left: placement.left,
      top: placement.top,
      width: placement.width,
      height: placement.height,
    })
    .resize(width, height, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .grayscale()
    .raw()
    .toBuffer();
  const shading = Buffer.allocUnsafe(width * height * 4);
  const highlights = Buffer.allocUnsafe(width * height * 4);
  for (let pixel = 0; pixel < artworkAlpha.length; pixel += 1) {
    const value = garment[pixel] ?? 0;
    const alpha = artworkAlpha[pixel] ?? 0;
    const base = pixel * 4;
    const shadeAlpha = Math.round(alpha * integration.shadingOpacity);
    const highlightAlpha = value > 150 ? Math.round(alpha * integration.highlightOpacity) : 0;
    shading[base] = value;
    shading[base + 1] = value;
    shading[base + 2] = value;
    shading[base + 3] = shadeAlpha;
    highlights[base] = Math.max(value, 205);
    highlights[base + 1] = Math.max(value, 205);
    highlights[base + 2] = Math.max(value, 205);
    highlights[base + 3] = highlightAlpha;
  }
  return {
    shading: await sharp(shading, { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer(),
    highlights: await sharp(highlights, { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer(),
  };
}
