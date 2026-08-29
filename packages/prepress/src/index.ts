import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  layerBounds,
  type EditorDocumentV1,
  type EditorFontId,
  type EditorLayer,
  type ImageLayer,
  type TextLayer,
} from '@let-it-be/editor-schema';
import * as opentype from 'opentype.js';
import sharp, { type OverlayOptions } from 'sharp';

export const productionRendererVersion = 'sharp-opentype-v1';

export type PrepressSeverity = 'INFO' | 'WARNING' | 'BLOCKER';
export type PrepressBand = 'GREEN' | 'AMBER' | 'RED';
export type PrepressRunStatus =
  'PENDING' | 'RENDERING' | 'VALIDATING' | 'PASSED' | 'REVIEW_REQUIRED' | 'BLOCKED' | 'FAILED';

export interface ProductionProfile {
  id: string;
  productModelId: string;
  providerId: string | null;
  decorationMethod: 'DTG';
  qualificationStatus:
    'UNQUALIFIED' | 'CANDIDATE' | 'TESTING' | 'APPROVED' | 'DEGRADED' | 'DISABLED';
  physicalWidthInches: number;
  physicalHeightInches: number;
  targetWidthPx: number;
  targetHeightPx: number;
  targetDpi: number;
  dpiWarningThreshold: number;
  dpiBlockThreshold: number;
  safeBounds: { x: number; y: number; width: number; height: number };
  allowedFormats: readonly ['png'];
  requiresTransparency: boolean;
  developmentOnly: boolean;
}

/** Development only. G3 must replace this with a provider-qualified combination. */
export const developmentDtgProfile: ProductionProfile = {
  id: 'development-essential-dtg-front-v1',
  productModelId: 'essential-dtg-tee',
  providerId: null,
  decorationMethod: 'DTG',
  qualificationStatus: 'UNQUALIFIED',
  physicalWidthInches: 12,
  physicalHeightInches: 16,
  targetWidthPx: 3600,
  targetHeightPx: 4800,
  targetDpi: 300,
  dpiWarningThreshold: 200,
  dpiBlockThreshold: 120,
  safeBounds: { x: 0.056, y: 0.078, width: 0.888, height: 0.844 },
  allowedFormats: ['png'],
  requiresTransparency: true,
  developmentOnly: true,
};

export interface SourceAsset {
  id: string;
  body: Uint8Array;
  contentType: string;
  width: number | null;
  height: number | null;
}

export interface RenderAssetResolver {
  getSourceAsset(assetId: string): Promise<SourceAsset | null>;
}

export interface RenderedProductionMaster {
  png: Uint8Array;
  width: number;
  height: number;
  pixelHash: string;
  sourceAssetIds: string[];
  sourceAssets: RenderSourceAsset[];
  rendererVersion: string;
  hasTransparency: boolean;
  hasPartialTransparency: boolean;
}

export interface RenderSourceAsset {
  layerId: string;
  assetId: string;
  contentType: string;
  sourceWidth: number | null;
  sourceHeight: number | null;
  hasAlpha: boolean | null;
  isVector: boolean;
}

export interface ProductionRenderer {
  render(input: {
    document: EditorDocumentV1;
    profile: ProductionProfile;
    assets: RenderAssetResolver;
  }): Promise<RenderedProductionMaster>;
}

/** Browser-safe derivative. It is intentionally smaller than the production master. */
export async function createControlledPrepressPreview(masterPng: Uint8Array): Promise<Uint8Array> {
  return sharp(masterPng)
    .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toBuffer();
}

interface LoadedFont {
  unitsPerEm: number;
  ascender: number;
  descender: number;
  charToGlyph(character: string): LoadedGlyph;
  getKerningValue(left: LoadedGlyph, right: LoadedGlyph): number;
}

interface LoadedGlyph {
  advanceWidth: number;
  getPath(x: number, y: number, size: number): { toPathData(decimalPlaces?: number): string };
}

const fontCache = new Map<string, Promise<LoadedFont>>();

export class FontResolutionError extends Error {}

/** Sharp/libvips composites only canonical values. It never imports a browser canvas or Konva. */
export class SharpProductionRenderer implements ProductionRenderer {
  async render(input: {
    document: EditorDocumentV1;
    profile: ProductionProfile;
    assets: RenderAssetResolver;
  }): Promise<RenderedProductionMaster> {
    assertProfile(input.profile);
    const composites: OverlayOptions[] = [];
    const sourceAssets: RenderSourceAsset[] = [];
    const sourceAssetIds = new Set<string>();
    for (const layer of [...input.document.layers].sort(
      (left, right) => left.zIndex - right.zIndex,
    )) {
      if (!layer.visible) continue;
      const rendered = await this.renderLayer(layer, input.document, input.profile, input.assets);
      composites.push({ input: rendered.body, left: rendered.left, top: rendered.top });
      if (rendered.source) {
        sourceAssets.push(rendered.source);
        sourceAssetIds.add(rendered.source.assetId);
      }
    }
    const png = await sharp({
      create: {
        width: input.profile.targetWidthPx,
        height: input.profile.targetHeightPx,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite(composites)
      .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
      .toBuffer();
    const raw = await sharp(png).ensureAlpha().raw().toBuffer();
    let hasTransparency = false;
    let hasPartialTransparency = false;
    for (let offset = 3; offset < raw.length; offset += 4) {
      const alpha = raw[offset] ?? 0;
      if (alpha < 255) hasTransparency = true;
      if (alpha > 0 && alpha < 255) hasPartialTransparency = true;
    }
    return {
      png,
      width: input.profile.targetWidthPx,
      height: input.profile.targetHeightPx,
      pixelHash: createHash('sha256').update(raw).digest('hex'),
      sourceAssetIds: [...sourceAssetIds].sort(),
      sourceAssets,
      rendererVersion: productionRendererVersion,
      hasTransparency,
      hasPartialTransparency,
    };
  }

  private async renderLayer(
    layer: EditorLayer,
    document: EditorDocumentV1,
    profile: ProductionProfile,
    assets: RenderAssetResolver,
  ): Promise<{ body: Buffer; left: number; top: number; source?: RenderSourceAsset }> {
    const width = Math.max(1, Math.round(layer.width * profile.targetWidthPx));
    const height = Math.max(1, Math.round(layer.height * profile.targetHeightPx));
    let body: Buffer;
    let source: RenderSourceAsset | undefined;
    if (layer.type === 'text') {
      body = await renderText(layer, document, profile, width, height);
    } else {
      const asset = await assets.getSourceAsset(layer.assetId);
      if (!asset) throw new Error(`Source asset ${layer.assetId} is unavailable.`);
      const prepared = await prepareRaster(asset, layer, width, height);
      body = prepared.body;
      source = {
        layerId: layer.id,
        assetId: asset.id,
        contentType: asset.contentType,
        sourceWidth: prepared.width,
        sourceHeight: prepared.height,
        hasAlpha: prepared.hasAlpha,
        isVector: asset.contentType === 'image/svg+xml',
      };
    }
    const rotated = await sharp(body)
      .rotate(layer.rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9, adaptiveFiltering: false })
      .toBuffer({ resolveWithObject: true });
    const centreX = Math.round(layer.x * profile.targetWidthPx);
    const centreY = Math.round(layer.y * profile.targetHeightPx);
    return {
      body: rotated.data,
      left: Math.round(centreX - rotated.info.width / 2),
      top: Math.round(centreY - rotated.info.height / 2),
      ...(source ? { source } : {}),
    };
  }
}

async function prepareRaster(
  asset: SourceAsset,
  layer: ImageLayer | Extract<EditorLayer, { type: 'generated' }>,
  targetWidth: number,
  targetHeight: number,
): Promise<{
  body: Buffer;
  width: number | null;
  height: number | null;
  hasAlpha: boolean | null;
}> {
  const metadata = await sharp(asset.body, { animated: false }).metadata();
  let operation = sharp(asset.body, { animated: false, density: 72 });
  if (layer.crop && metadata.width && metadata.height) {
    operation = operation.extract({
      left: Math.floor(layer.crop.x * metadata.width),
      top: Math.floor(layer.crop.y * metadata.height),
      width: Math.max(1, Math.floor(layer.crop.width * metadata.width)),
      height: Math.max(1, Math.floor(layer.crop.height * metadata.height)),
    });
  }
  const output = await operation
    .resize(targetWidth, targetHeight, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (layer.opacity < 1) {
    for (let offset = 3; offset < output.data.length; offset += 4) {
      output.data[offset] = Math.round((output.data[offset] ?? 0) * layer.opacity);
    }
  }
  return {
    body: await sharp(output.data, {
      raw: { width: output.info.width, height: output.info.height, channels: 4 },
    })
      .png({ compressionLevel: 9, adaptiveFiltering: false })
      .toBuffer(),
    width: metadata.width ?? asset.width,
    height: metadata.height ?? asset.height,
    hasAlpha: metadata.hasAlpha ?? null,
  };
}

async function renderText(
  layer: TextLayer,
  document: EditorDocumentV1,
  profile: ProductionProfile,
  width: number,
  height: number,
): Promise<Buffer> {
  const font = await loadFont(layer.fontId, layer.fontWeight);
  const printLogicalWidth = document.canvas.width * document.printArea.bounds.width;
  const fontSize = (layer.fontSize / printLogicalWidth) * profile.targetWidthPx;
  const glyphs = [...layer.text].map((character) => font.charToGlyph(character));
  const advance = glyphAdvance(font, glyphs, fontSize);
  const x =
    layer.alignment === 'left'
      ? 0
      : layer.alignment === 'right'
        ? width - advance
        : (width - advance) / 2;
  const baseline = (height + ((font.ascender + font.descender) / font.unitsPerEm) * fontSize) / 2;
  const path = glyphPath(font, glyphs, x, baseline, fontSize);
  const outline = layer.stroke
    ? `<path d="${path}" fill="none" stroke="${safeColor(layer.stroke.color)}" stroke-width="${Math.max(1, layer.stroke.width * profile.targetWidthPx)}" stroke-linejoin="round"/>`
    : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${outline}<path d="${path}" fill="${safeColor(layer.fill)}" fill-opacity="${layer.opacity}"/></svg>`;
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer();
}

/**
 * Deliberately performs a simple deterministic glyph walk rather than asking a
 * browser/Pango shaping engine to resolve the supplied text. The approved MVP
 * fonts cover this consumer text surface; unsupported glyphs remain visible as
 * the font's own .notdef glyph rather than being silently substituted.
 */
function glyphAdvance(font: LoadedFont, glyphs: LoadedGlyph[], size: number): number {
  return glyphs.reduce((advance, glyph, index) => {
    const next = glyphs[index + 1];
    return (
      advance +
      ((glyph.advanceWidth + (next ? font.getKerningValue(glyph, next) : 0)) / font.unitsPerEm) *
        size
    );
  }, 0);
}

function glyphPath(
  font: LoadedFont,
  glyphs: LoadedGlyph[],
  x: number,
  baseline: number,
  size: number,
): string {
  let cursor = x;
  return glyphs
    .map((glyph, index) => {
      const next = glyphs[index + 1];
      const path = glyph.getPath(cursor, baseline, size).toPathData(3);
      cursor +=
        ((glyph.advanceWidth + (next ? font.getKerningValue(glyph, next) : 0)) / font.unitsPerEm) *
        size;
      return path;
    })
    .join('');
}

async function loadFont(fontId: EditorFontId, weight: 400 | 700): Promise<LoadedFont> {
  const key = `${fontId}:${weight}`;
  const cached = fontCache.get(key);
  if (cached) return cached;
  const loading = (async () => {
    const path = await resolveBundledFontPath(fontId, weight);
    try {
      const bytes = await readFile(path);
      return opentype.parse(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      ) as unknown as LoadedFont;
    } catch (error) {
      throw new FontResolutionError(
        `Approved font ${fontId} could not be loaded: ${String(error)}`,
      );
    }
  })();
  fontCache.set(key, loading);
  return loading;
}

/**
 * Avoids browser-bundler resolution of binary WOFF files. Deployments may set
 * PREPRESS_FONT_ROOT to the directory containing their bundled @fontsource packages.
 */
async function resolveBundledFontPath(fontId: string, weight: 400 | 700): Promise<string> {
  if (!['inter', 'oswald', 'playfair-display'].includes(fontId)) {
    throw new FontResolutionError(`Unsupported production font ${fontId}.`);
  }
  const filename = `${fontId}-latin-${weight}-normal.woff`;
  const root = process.cwd();
  const candidates = [
    process.env.PREPRESS_FONT_ROOT,
    join(root, 'packages', 'prepress', 'node_modules'),
    join(root, 'apps', 'web', 'node_modules'),
    join(root, 'node_modules'),
  ].filter((candidate): candidate is string => Boolean(candidate));
  for (const base of candidates) {
    const path = join(base, '@fontsource', fontId, 'files', filename);
    try {
      await access(path);
      return path;
    } catch {
      // Try the next explicitly bundled package location.
    }
  }
  throw new FontResolutionError(`Approved font ${fontId} weight ${weight} is unavailable.`);
}

export interface PhysicalLayerGeometry {
  xPx: number;
  yPx: number;
  widthPx: number;
  heightPx: number;
  widthInches: number;
  heightInches: number;
  rotationDegrees: number;
}

/** Layers are normalized to the print area; centre rotation is clockwise. */
export function normalizedToPhysical(
  layer: EditorLayer,
  profile: ProductionProfile,
): PhysicalLayerGeometry {
  return {
    xPx: layer.x * profile.targetWidthPx,
    yPx: layer.y * profile.targetHeightPx,
    widthPx: layer.width * profile.targetWidthPx,
    heightPx: layer.height * profile.targetHeightPx,
    widthInches: layer.width * profile.physicalWidthInches,
    heightInches: layer.height * profile.physicalHeightInches,
    rotationDegrees: layer.rotation,
  };
}

export interface EffectiveDpi {
  horizontal: number;
  vertical: number;
  minimum: number;
}

export function calculateEffectiveDpi(input: {
  sourceWidth: number;
  sourceHeight: number;
  crop?: { x: number; y: number; width: number; height: number };
  layer: EditorLayer;
  profile: ProductionProfile;
}): EffectiveDpi {
  const crop = input.crop ?? { x: 0, y: 0, width: 1, height: 1 };
  const geometry = normalizedToPhysical(input.layer, input.profile);
  const horizontal = (input.sourceWidth * crop.width) / geometry.widthInches;
  const vertical = (input.sourceHeight * crop.height) / geometry.heightInches;
  return { horizontal, vertical, minimum: Math.min(horizontal, vertical) };
}

export interface PrepressFinding {
  category:
    | 'RESOLUTION'
    | 'PLACEMENT'
    | 'TRANSPARENCY'
    | 'BACKGROUND'
    | 'CONTRAST'
    | 'COMPATIBILITY'
    | 'ARTIFACT'
    | 'SOURCE'
    | 'FONT'
    | 'MODERATION';
  code: string;
  severity: PrepressSeverity;
  message: string;
  layerId?: string;
  evidence: Record<string, unknown>;
}

export interface PrintabilityScore {
  total: number;
  band: PrepressBand;
  components: {
    resolution: number;
    placement: number;
    transparency: number;
    edgeBackground: number;
    contrast: number;
    providerCompatibility: number;
    artifactDetection: number;
  };
  blockers: PrepressFinding[];
  warnings: PrepressFinding[];
}

export interface PreflightResult {
  findings: PrepressFinding[];
  score: PrintabilityScore;
  readiness: Extract<PrepressRunStatus, 'PASSED' | 'REVIEW_REQUIRED' | 'BLOCKED'>;
}

export interface PreflightInput {
  document: EditorDocumentV1;
  profile: ProductionProfile;
  master: RenderedProductionMaster;
  productColorCode: string;
  moderationStatus?: 'ALLOW' | 'BLOCK' | 'REVIEW' | 'UNKNOWN';
}

export function validatePreflight(input: PreflightInput): PreflightResult {
  const findings: PrepressFinding[] = [];
  if (
    input.master.width !== input.profile.targetWidthPx ||
    input.master.height !== input.profile.targetHeightPx
  ) {
    findings.push(
      finding(
        'RESOLUTION',
        'OUTPUT_DIMENSIONS_INVALID',
        'BLOCKER',
        'The print file has the wrong dimensions.',
        {
          expected: [input.profile.targetWidthPx, input.profile.targetHeightPx],
          actual: [input.master.width, input.master.height],
        },
      ),
    );
  }
  if (input.profile.requiresTransparency && !input.master.hasTransparency) {
    findings.push(
      finding(
        'TRANSPARENCY',
        'MISSING_TRANSPARENT_BACKGROUND',
        'BLOCKER',
        'This design needs a transparent background before it can be printed.',
        { requiresTransparency: true },
      ),
    );
  } else {
    findings.push(
      finding(
        'TRANSPARENCY',
        input.master.hasPartialTransparency ? 'PARTIAL_TRANSPARENCY_PRESENT' : 'TRANSPARENCY_OK',
        'INFO',
        'Transparency has been checked for this print file.',
        {
          hasTransparency: input.master.hasTransparency,
          hasPartialTransparency: input.master.hasPartialTransparency,
        },
      ),
    );
  }
  for (const layer of input.document.layers.filter((candidate) => candidate.visible)) {
    validateLayerPlacement(input.document, layer, findings);
  }
  for (const asset of input.master.sourceAssets) {
    const layer = input.document.layers.find((candidate) => candidate.id === asset.layerId);
    if (!layer) continue;
    if (!asset.isVector && (!asset.sourceWidth || !asset.sourceHeight)) {
      findings.push(
        finding(
          'SOURCE',
          'SOURCE_DIMENSIONS_UNAVAILABLE',
          'BLOCKER',
          'An image used in this design cannot be prepared safely.',
          { assetId: asset.assetId },
          layer.id,
        ),
      );
      continue;
    }
    if (!asset.isVector && layer.type !== 'text' && asset.sourceWidth && asset.sourceHeight) {
      const dpi = calculateEffectiveDpi({
        sourceWidth: asset.sourceWidth,
        sourceHeight: asset.sourceHeight,
        layer,
        profile: input.profile,
        ...(layer.crop ? { crop: layer.crop } : {}),
      });
      const severity: PrepressSeverity =
        dpi.minimum < input.profile.dpiBlockThreshold
          ? 'BLOCKER'
          : dpi.minimum < input.profile.dpiWarningThreshold
            ? 'WARNING'
            : 'INFO';
      findings.push(
        finding(
          'RESOLUTION',
          severity === 'INFO' ? 'EFFECTIVE_DPI_OK' : 'LOW_EFFECTIVE_DPI',
          severity,
          severity === 'INFO'
            ? 'Image quality looks suitable for this print size.'
            : 'Image quality may be too low for this print size.',
          {
            dpi,
            targetDpi: input.profile.targetDpi,
            warningThreshold: input.profile.dpiWarningThreshold,
            blockThreshold: input.profile.dpiBlockThreshold,
          },
          layer.id,
        ),
      );
    }
    if (!asset.isVector && asset.hasAlpha === false) {
      findings.push(
        finding(
          'BACKGROUND',
          'OPAQUE_SOURCE_BACKGROUND',
          'WARNING',
          'This image may include a solid background when printed.',
          { assetId: asset.assetId },
          layer.id,
        ),
      );
    }
  }
  const contrast = detectContrast(input.document, input.productColorCode);
  if (contrast) findings.push(contrast);
  if (input.profile.qualificationStatus !== 'APPROVED') {
    findings.push(
      finding(
        'COMPATIBILITY',
        'PROFILE_UNQUALIFIED',
        'WARNING',
        'This product profile still needs production testing.',
        {
          qualificationStatus: input.profile.qualificationStatus,
          developmentOnly: input.profile.developmentOnly,
        },
      ),
    );
  }
  findings.push(
    finding(
      'BACKGROUND',
      'EDGE_HEURISTICS_LIMITED',
      'INFO',
      'Background-edge checks use conservative development rules until this profile is qualified.',
      { developmentOnly: true },
    ),
  );
  findings.push(
    finding(
      'ARTIFACT',
      'ARTIFACT_HEURISTICS_LIMITED',
      'INFO',
      'Fine-detail and artifact checks are limited until this profile is qualified.',
      { developmentOnly: true },
    ),
  );
  const moderation = input.moderationStatus ?? 'UNKNOWN';
  if (moderation === 'BLOCK')
    findings.push(
      finding(
        'MODERATION',
        'FINAL_MODERATION_BLOCK',
        'BLOCKER',
        'This design cannot move forward until it is reviewed.',
        { status: moderation },
      ),
    );
  else if (moderation !== 'ALLOW')
    findings.push(
      finding(
        'MODERATION',
        'FINAL_MODERATION_PENDING',
        'INFO',
        'Final content review will happen before production.',
        { status: moderation },
      ),
    );
  const score = calculatePrintabilityScore(findings);
  return {
    findings,
    score,
    readiness: score.blockers.length
      ? 'BLOCKED'
      : score.warnings.length
        ? 'REVIEW_REQUIRED'
        : 'PASSED',
  };
}

export function calculatePrintabilityScore(findings: PrepressFinding[]): PrintabilityScore {
  const score = (category: PrepressFinding['category'], full: number, warning: number) => {
    const matches = findings.filter((finding) => finding.category === category);
    return matches.some((finding) => finding.severity === 'BLOCKER')
      ? 0
      : matches.some((finding) => finding.severity === 'WARNING')
        ? warning
        : full;
  };
  const components = {
    resolution: score('RESOLUTION', 25, 16),
    placement: score('PLACEMENT', 20, 10),
    transparency: score('TRANSPARENCY', 15, 9),
    edgeBackground: score('BACKGROUND', 10, 6),
    contrast: score('CONTRAST', 10, 6),
    providerCompatibility: score('COMPATIBILITY', 10, 6),
    artifactDetection: score('ARTIFACT', 10, 7),
  };
  const total = Object.values(components).reduce((sum, value) => sum + value, 0);
  const blockers = findings.filter((finding) => finding.severity === 'BLOCKER');
  const warnings = findings.filter((finding) => finding.severity === 'WARNING');
  return {
    total,
    band: total >= 90 ? 'GREEN' : total >= 75 ? 'AMBER' : 'RED',
    components,
    blockers,
    warnings,
  };
}

function validateLayerPlacement(
  document: EditorDocumentV1,
  layer: EditorLayer,
  findings: PrepressFinding[],
): void {
  const bounds = layerBounds(layer);
  const outsidePrint =
    bounds.x < 0 || bounds.y < 0 || bounds.x + bounds.width > 1 || bounds.y + bounds.height > 1;
  const safe = document.printArea.safeBounds;
  const outsideSafe =
    bounds.x < safe.x ||
    bounds.y < safe.y ||
    bounds.x + bounds.width > safe.x + safe.width ||
    bounds.y + bounds.height > safe.y + safe.height;
  if (outsidePrint)
    findings.push(
      finding(
        'PLACEMENT',
        'PRINT_AREA_CLIPPING',
        'BLOCKER',
        'Part of your design is outside the printable area.',
        { bounds },
        layer.id,
      ),
    );
  else if (outsideSafe)
    findings.push(
      finding(
        'PLACEMENT',
        'SAFE_AREA_VIOLATION',
        'BLOCKER',
        'Move your design inside the marked print area.',
        { bounds, safeBounds: safe },
        layer.id,
      ),
    );
}

function detectContrast(
  document: EditorDocumentV1,
  productColorCode: string,
): PrepressFinding | undefined {
  const garment =
    productColorCode === 'white' ? '#ffffff' : productColorCode === 'navy' ? '#17294b' : '#111111';
  const garmentLuminance = luminance(garment);
  const lowContrast = document.layers
    .filter((layer): layer is TextLayer => layer.visible && layer.type === 'text')
    .find((layer) => contrastRatio(layer.fill, garmentLuminance) < 2.2);
  return lowContrast
    ? finding(
        'CONTRAST',
        'LOW_GARMENT_CONTRAST',
        'WARNING',
        'This design may be hard to see on this shirt color.',
        { garmentColor: productColorCode, textColor: lowContrast.fill },
        lowContrast.id,
      )
    : undefined;
}

function contrastRatio(color: string, backgroundLuminance: number): number {
  const foreground = luminance(color);
  return (
    (Math.max(foreground, backgroundLuminance) + 0.05) /
    (Math.min(foreground, backgroundLuminance) + 0.05)
  );
}

function luminance(color: string): number {
  const parsed = /^#([0-9a-f]{6})$/i.exec(color);
  if (!parsed) return 0;
  const values = [0, 2, 4].map(
    (offset) => Number.parseInt(parsed[1]!.slice(offset, offset + 2), 16) / 255,
  );
  const linear = values.map((value) =>
    value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * (linear[0] ?? 0) + 0.7152 * (linear[1] ?? 0) + 0.0722 * (linear[2] ?? 0);
}

function finding(
  category: PrepressFinding['category'],
  code: string,
  severity: PrepressSeverity,
  message: string,
  evidence: Record<string, unknown>,
  layerId?: string,
): PrepressFinding {
  return { category, code, severity, message, evidence, ...(layerId ? { layerId } : {}) };
}

function safeColor(value: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(value))
    throw new Error('Unsupported text color for production rendering.');
  return value;
}

function assertProfile(profile: ProductionProfile): void {
  if (
    profile.targetWidthPx !== Math.round(profile.physicalWidthInches * profile.targetDpi) ||
    profile.targetHeightPx !== Math.round(profile.physicalHeightInches * profile.targetDpi)
  )
    throw new Error('Production profile dimensions do not match its target DPI.');
}

/** Future provider adapters consume this contract; Milestone 4 deliberately provides no provider implementation. */
export interface ProviderProductionAdapter {
  createDerivative(input: {
    productionMasterAssetId: string;
    profile: ProductionProfile;
  }): Promise<{ derivativeAssetId: string }>;
}
