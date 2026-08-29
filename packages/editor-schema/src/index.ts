export const editorDocumentVersion = 1 as const;

export const curatedFonts = [
  { id: 'inter', family: 'Inter', label: 'Clean Sans', weights: [400, 700] as const },
  { id: 'oswald', family: 'Oswald', label: 'Bold Condensed', weights: [400, 700] as const },
  {
    id: 'playfair-display',
    family: 'Playfair Display',
    label: 'Classic Serif',
    weights: [400, 700] as const,
  },
] as const;

export type EditorFontId = (typeof curatedFonts)[number]['id'];
export type FontWeight = 400 | 700;
export type EditorLayerType = 'text' | 'image' | 'generated';
export type PlacementStatus = 'VALID' | 'INVALID';

export interface NormalizedRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EditorCanvas {
  width: number;
  height: number;
}

export interface EditorPrintArea {
  profileId: string;
  developmentOnly: boolean;
  /** Print-area location on the logical garment canvas. */
  bounds: NormalizedRectangle;
  /** Safe rectangle expressed in the print-area's normalized coordinate system. */
  safeBounds: NormalizedRectangle;
}

export type CropRectangle = NormalizedRectangle;

export interface BaseLayer {
  id: string;
  type: EditorLayerType;
  /** Centre position and dimensions, normalized to the print-area bounds. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Clockwise degrees around the layer centre. */
  rotation: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
  zIndex: number;
}

export interface TextLayer extends BaseLayer {
  type: 'text';
  text: string;
  fontId: EditorFontId;
  fontWeight: FontWeight;
  fontSize: number;
  fill: string;
  stroke?: { color: string; width: number };
  alignment: 'left' | 'center' | 'right';
}

export interface ImageLayer extends BaseLayer {
  type: 'image';
  assetId: string;
  crop?: CropRectangle;
}

export interface GeneratedLayer extends BaseLayer {
  type: 'generated';
  assetId: string;
  generationId: string;
  crop?: CropRectangle;
}

export type EditorLayer = TextLayer | ImageLayer | GeneratedLayer;

export interface EditorDocumentV1 {
  version: typeof editorDocumentVersion;
  canvas: EditorCanvas;
  printArea: EditorPrintArea;
  layers: EditorLayer[];
  placementStatus: PlacementStatus;
  /** Read-only compatibility payload for pre-editor Milestone 1 snapshots. */
  legacyMetadata?: Record<string, unknown>;
}

export const developmentTeePrintArea: EditorPrintArea = {
  profileId: 'development-essential-dtg-front-v1',
  developmentOnly: true,
  bounds: { x: 0.14, y: 0.18, width: 0.72, height: 0.64 },
  safeBounds: { x: 0.056, y: 0.078, width: 0.888, height: 0.844 },
};

export function createEmptyEditorDocument(): EditorDocumentV1 {
  return {
    version: editorDocumentVersion,
    canvas: { width: 1000, height: 1400 },
    printArea: clonePrintArea(developmentTeePrintArea),
    layers: [],
    placementStatus: 'VALID',
  };
}

export function createGeneratedLayer(input: {
  layerId: string;
  assetId: string;
  generationId: string;
  zIndex: number;
}): GeneratedLayer {
  return {
    id: input.layerId,
    type: 'generated',
    assetId: input.assetId,
    generationId: input.generationId,
    x: 0.5,
    y: 0.5,
    width: 0.55,
    height: 0.55,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    zIndex: input.zIndex,
  };
}

/** Converts the Milestone 1 placeholder safely without changing older snapshots in storage. */
export function migrateEditorDocument(value: unknown): EditorDocumentV1 {
  if (isRecord(value) && value.version === editorDocumentVersion) {
    try {
      return validateEditorDocument(value);
    } catch {
      // Early Milestone 1 callers were allowed to write a loose placeholder shape.
      // Preserve its snapshot in storage and upgrade future editor reads safely.
      return migrateLegacyPlaceholder(value);
    }
  }
  return migrateLegacyPlaceholder(value);
}

export function validateEditorDocument(value: unknown): EditorDocumentV1 {
  if (!isRecord(value) || value.version !== editorDocumentVersion) {
    throw new Error('Editor document version 1 is required.');
  }
  const canvas = readCanvas(value.canvas);
  const printArea = readPrintArea(value.printArea);
  if (!Array.isArray(value.layers)) throw new Error('Editor document layers are required.');
  const layers = value.layers.map(readLayer).sort((left, right) => left.zIndex - right.zIndex);
  const ids = new Set(layers.map((layer) => layer.id));
  if (ids.size !== layers.length) throw new Error('Editor layer IDs must be unique.');
  const document: EditorDocumentV1 = {
    version: editorDocumentVersion,
    canvas,
    printArea,
    layers,
    placementStatus: value.placementStatus === 'INVALID' ? 'INVALID' : 'VALID',
    ...(isRecord(value.legacyMetadata)
      ? { legacyMetadata: cloneLegacy(value.legacyMetadata) }
      : {}),
  };
  return withPlacementStatus(document);
}

export function canonicalizeEditorDocument(document: EditorDocumentV1): EditorDocumentV1 {
  return withPlacementStatus({
    ...document,
    canvas: { ...document.canvas },
    printArea: clonePrintArea(document.printArea),
    layers: document.layers.map(cloneLayer).sort((left, right) => left.zIndex - right.zIndex),
    ...(document.legacyMetadata ? { legacyMetadata: cloneLegacy(document.legacyMetadata) } : {}),
  });
}

export function serializeEditorDocument(document: EditorDocumentV1): string {
  return JSON.stringify(canonicalizeEditorDocument(document));
}

export function layerBounds(layer: EditorLayer): NormalizedRectangle {
  const radians = (layer.rotation * Math.PI) / 180;
  const halfWidth = layer.width / 2;
  const halfHeight = layer.height / 2;
  const offsets: Array<[number, number]> = [
    [-halfWidth, -halfHeight],
    [halfWidth, -halfHeight],
    [halfWidth, halfHeight],
    [-halfWidth, halfHeight],
  ];
  const corners = offsets.map(([x, y]) => ({
    x: layer.x + x * Math.cos(radians) - y * Math.sin(radians),
    y: layer.y + x * Math.sin(radians) + y * Math.cos(radians),
  }));
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return { x: left, y: top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
}

export function layerIsInsideSafeArea(document: EditorDocumentV1, layer: EditorLayer): boolean {
  if (!layer.visible) return true;
  const bounds = layerBounds(layer);
  const safe = document.printArea.safeBounds;
  return (
    bounds.x >= safe.x &&
    bounds.y >= safe.y &&
    bounds.x + bounds.width <= safe.x + safe.width &&
    bounds.y + bounds.height <= safe.y + safe.height
  );
}

export function hasInvalidPlacement(document: EditorDocumentV1): boolean {
  return document.layers.some((layer) => !layerIsInsideSafeArea(document, layer));
}

export function withPlacementStatus(document: EditorDocumentV1): EditorDocumentV1 {
  return { ...document, placementStatus: hasInvalidPlacement(document) ? 'INVALID' : 'VALID' };
}

export function snapLayer(layer: EditorLayer, threshold = 0.025): EditorLayer {
  const snapped = cloneLayer(layer);
  if (Math.abs(snapped.x - 0.5) <= threshold) snapped.x = 0.5;
  if (Math.abs(snapped.y - 0.5) <= threshold) snapped.y = 0.5;
  return snapped;
}

/** Consumer-friendly snapping to the centre and the visible safe-area edges. */
export function snapLayerToGuides(
  document: EditorDocumentV1,
  layer: EditorLayer,
  threshold = 0.025,
): EditorLayer {
  const snapped = snapLayer(layer, threshold);
  const safe = document.printArea.safeBounds;
  const candidates: Array<{ x?: number; y?: number }> = [
    { x: safe.x + snapped.width / 2 },
    { x: safe.x + safe.width - snapped.width / 2 },
    { y: safe.y + snapped.height / 2 },
    { y: safe.y + safe.height - snapped.height / 2 },
  ];
  for (const candidate of candidates) {
    if (candidate.x !== undefined && Math.abs(snapped.x - candidate.x) <= threshold)
      snapped.x = candidate.x;
    if (candidate.y !== undefined && Math.abs(snapped.y - candidate.y) <= threshold)
      snapped.y = candidate.y;
  }
  return snapped;
}

export type EditorCommand =
  | { type: 'add-layer'; layer: EditorLayer }
  | {
      type: 'update-layer';
      layerId: string;
      changes: Partial<Omit<BaseLayer, 'id' | 'type' | 'zIndex'>> & Record<string, unknown>;
    }
  | { type: 'replace-generated-asset'; layerId: string; assetId: string; generationId: string }
  | { type: 'delete-layer'; layerId: string }
  | { type: 'set-lock'; layerId: string; locked: boolean }
  | { type: 'set-visibility'; layerId: string; visible: boolean }
  | { type: 'reorder-layer'; layerId: string; direction: 'forward' | 'backward' };

export function applyEditorCommand(
  document: EditorDocumentV1,
  command: EditorCommand,
): EditorDocumentV1 {
  const current = canonicalizeEditorDocument(document);
  if (command.type === 'add-layer') {
    if (current.layers.some((layer) => layer.id === command.layer.id))
      throw new Error('Layer ID already exists.');
    return withPlacementStatus({
      ...current,
      layers: [...current.layers, cloneLayer(command.layer)],
    });
  }
  const index = current.layers.findIndex((layer) => layer.id === command.layerId);
  if (index < 0) throw new Error('Layer not found.');
  const layer = current.layers[index];
  if (!layer) throw new Error('Layer not found.');
  if (command.type === 'set-lock')
    return replaceLayer(current, index, { ...layer, locked: command.locked });
  if (command.type === 'set-visibility')
    return replaceLayer(current, index, { ...layer, visible: command.visible });
  if (layer.locked) throw new Error('Unlock this item before changing it.');
  if (command.type === 'delete-layer') {
    return withPlacementStatus({
      ...current,
      layers: current.layers.filter((_, candidate) => candidate !== index),
    });
  }
  if (command.type === 'replace-generated-asset') {
    if (layer.type !== 'generated') throw new Error('Only generated artwork can be regenerated.');
    return replaceLayer(current, index, {
      ...layer,
      assetId: command.assetId,
      generationId: command.generationId,
    });
  }
  if (command.type === 'reorder-layer') {
    const target = command.direction === 'forward' ? index + 1 : index - 1;
    if (target < 0 || target >= current.layers.length) return current;
    const layers = [...current.layers];
    const other = layers[target];
    if (!other) return current;
    layers[index] = { ...other, zIndex: layer.zIndex };
    layers[target] = { ...layer, zIndex: other.zIndex };
    return withPlacementStatus({ ...current, layers });
  }
  return replaceLayer(current, index, {
    ...layer,
    ...sanitizeChanges(command.changes),
  } as EditorLayer);
}

export interface EditorHistory {
  past: EditorDocumentV1[];
  present: EditorDocumentV1;
  future: EditorDocumentV1[];
  limit: number;
}

export function createEditorHistory(document: EditorDocumentV1, limit = 50): EditorHistory {
  return { past: [], present: canonicalizeEditorDocument(document), future: [], limit };
}

export function commitEditorCommand(history: EditorHistory, command: EditorCommand): EditorHistory {
  const next = applyEditorCommand(history.present, command);
  if (serializeEditorDocument(next) === serializeEditorDocument(history.present)) return history;
  return {
    ...history,
    past: [...history.past, history.present].slice(-history.limit),
    present: next,
    future: [],
  };
}

export function undoEditorHistory(history: EditorHistory): EditorHistory {
  const previous = history.past.at(-1);
  if (!previous) return history;
  return {
    ...history,
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redoEditorHistory(history: EditorHistory): EditorHistory {
  const next = history.future[0];
  if (!next) return history;
  return {
    ...history,
    past: [...history.past, history.present].slice(-history.limit),
    present: next,
    future: history.future.slice(1),
  };
}

function replaceLayer(
  document: EditorDocumentV1,
  index: number,
  layer: EditorLayer,
): EditorDocumentV1 {
  const layers = [...document.layers];
  layers[index] = cloneLayer(layer);
  return withPlacementStatus({ ...document, layers });
}

function sanitizeChanges(changes: Record<string, unknown>): Record<string, unknown> {
  const blocked = new Set(['id', 'type', 'zIndex', 'assetId', 'generationId']);
  return Object.fromEntries(Object.entries(changes).filter(([key]) => !blocked.has(key)));
}

function clonePrintArea(value: EditorPrintArea): EditorPrintArea {
  return { ...value, bounds: { ...value.bounds }, safeBounds: { ...value.safeBounds } };
}

function migrateLegacyPlaceholder(value: unknown): EditorDocumentV1 {
  const empty = createEmptyEditorDocument();
  if (!isRecord(value) || !Array.isArray(value.layers)) return empty;
  const layers = value.layers.flatMap((layer) => {
    try {
      return [readLayer(layer)];
    } catch {
      return [];
    }
  });
  return withPlacementStatus({ ...empty, layers, legacyMetadata: cloneLegacy(value) });
}

function cloneLegacy(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function cloneLayer(layer: EditorLayer): EditorLayer {
  return {
    ...layer,
    ...(layer.type === 'text' && layer.stroke ? { stroke: { ...layer.stroke } } : {}),
    ...(layer.type !== 'text' && layer.crop ? { crop: { ...layer.crop } } : {}),
  };
}

function readCanvas(value: unknown): EditorCanvas {
  if (!isRecord(value) || !positive(value.width) || !positive(value.height))
    throw new Error('Editor canvas is invalid.');
  return { width: value.width, height: value.height };
}

function readPrintArea(value: unknown): EditorPrintArea {
  if (
    !isRecord(value) ||
    typeof value.profileId !== 'string' ||
    typeof value.developmentOnly !== 'boolean'
  )
    throw new Error('Editor print area is invalid.');
  return {
    profileId: value.profileId,
    developmentOnly: value.developmentOnly,
    bounds: readRectangle(value.bounds),
    safeBounds: readRectangle(value.safeBounds),
  };
}

function readLayer(value: unknown): EditorLayer {
  if (!isRecord(value) || typeof value.id !== 'string' || !isLayerType(value.type))
    throw new Error('Editor layer is invalid.');
  const base: BaseLayer = {
    id: value.id,
    type: value.type,
    x: readUnit(value.x),
    y: readUnit(value.y),
    width: readUnit(value.width),
    height: readUnit(value.height),
    rotation:
      typeof value.rotation === 'number' && Number.isFinite(value.rotation) ? value.rotation : 0,
    opacity: readUnit(value.opacity),
    visible: value.visible === true,
    locked: value.locked === true,
    zIndex: typeof value.zIndex === 'number' && Number.isInteger(value.zIndex) ? value.zIndex : 0,
  };
  if (value.type === 'text') {
    if (
      typeof value.text !== 'string' ||
      !isFontId(value.fontId) ||
      !isFontWeight(value.fontWeight) ||
      !positive(value.fontSize) ||
      typeof value.fill !== 'string' ||
      !isAlignment(value.alignment)
    )
      throw new Error('Text layer is invalid.');
    return {
      ...base,
      type: 'text',
      text: value.text,
      fontId: value.fontId,
      fontWeight: value.fontWeight,
      fontSize: value.fontSize,
      fill: value.fill,
      alignment: value.alignment,
      ...(value.stroke ? { stroke: readStroke(value.stroke) } : {}),
    };
  }
  if (typeof value.assetId !== 'string') throw new Error('Image layer asset is required.');
  const crop = value.crop ? readCrop(value.crop) : undefined;
  if (value.type === 'generated') {
    if (typeof value.generationId !== 'string')
      throw new Error('Generated layer generation is required.');
    return {
      ...base,
      type: 'generated',
      assetId: value.assetId,
      generationId: value.generationId,
      ...(crop ? { crop } : {}),
    };
  }
  return { ...base, type: 'image', assetId: value.assetId, ...(crop ? { crop } : {}) };
}

function readStroke(value: unknown): { color: string; width: number } {
  if (!isRecord(value) || typeof value.color !== 'string' || !positive(value.width))
    throw new Error('Text outline is invalid.');
  return { color: value.color, width: value.width };
}

function readCrop(value: unknown): CropRectangle {
  const crop = readRectangle(value);
  if (crop.x + crop.width > 1 || crop.y + crop.height > 1)
    throw new Error('Image crop must stay within its source.');
  return crop;
}

function readRectangle(value: unknown): NormalizedRectangle {
  if (!isRecord(value)) throw new Error('Rectangle is invalid.');
  return {
    x: readUnit(value.x),
    y: readUnit(value.y),
    width: readUnit(value.width),
    height: readUnit(value.height),
  };
}

function readUnit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)
    throw new Error('Normalized coordinates must be between zero and one.');
  return value;
}

function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
function isLayerType(value: unknown): value is EditorLayerType {
  return value === 'text' || value === 'image' || value === 'generated';
}
function isFontId(value: unknown): value is EditorFontId {
  return typeof value === 'string' && curatedFonts.some((font) => font.id === value);
}
function isFontWeight(value: unknown): value is FontWeight {
  return value === 400 || value === 700;
}
function isAlignment(value: unknown): value is TextLayer['alignment'] {
  return value === 'left' || value === 'center' || value === 'right';
}
