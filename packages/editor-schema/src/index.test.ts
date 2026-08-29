import { describe, expect, it } from 'vitest';

import {
  applyEditorCommand,
  commitEditorCommand,
  createEditorHistory,
  createEmptyEditorDocument,
  hasInvalidPlacement,
  layerBounds,
  migrateEditorDocument,
  redoEditorHistory,
  snapLayerToGuides,
  serializeEditorDocument,
  undoEditorHistory,
} from './index.js';

const textLayer = {
  id: 'text-1',
  type: 'text' as const,
  x: 0.5,
  y: 0.5,
  width: 0.2,
  height: 0.1,
  rotation: 0,
  opacity: 1,
  visible: true,
  locked: false,
  zIndex: 0,
  text: 'CREATE KINDLY',
  fontId: 'inter' as const,
  fontWeight: 700 as const,
  fontSize: 56,
  fill: '#102030',
  alignment: 'center' as const,
};

describe('editor schema', () => {
  it('migrates the Milestone 1 placeholder to a valid versioned document', () => {
    const document = migrateEditorDocument({ canvas: {}, printArea: {}, layers: [] });
    expect(document.version).toBe(1);
    expect(document.printArea.developmentOnly).toBe(true);
  });

  it('uses viewport-independent normalized geometry and accounts for rotation', () => {
    const document = createEmptyEditorDocument();
    const rotated = { ...textLayer, rotation: 90 };
    expect(layerBounds(rotated).width).toBeCloseTo(0.1);
    expect(layerBounds(rotated).height).toBeCloseTo(0.2);
    expect(hasInvalidPlacement({ ...document, layers: [rotated] })).toBe(false);
    const nearSafeEdge = {
      ...textLayer,
      x: document.printArea.safeBounds.x + textLayer.width / 2 + 0.01,
    };
    expect(snapLayerToGuides(document, nearSafeEdge).x).toBeCloseTo(
      document.printArea.safeBounds.x + textLayer.width / 2,
    );
  });

  it('preserves exact text, fonts, crop, and generated asset identity through serialization', () => {
    const document = applyEditorCommand(createEmptyEditorDocument(), {
      type: 'add-layer',
      layer: {
        ...textLayer,
        text: 'Exact, Punctuation!',
        stroke: { color: '#ffffff', width: 0.01 },
      },
    });
    const withGenerated = applyEditorCommand(document, {
      type: 'add-layer',
      layer: {
        id: 'generated-1',
        type: 'generated',
        x: 0.5,
        y: 0.5,
        width: 0.3,
        height: 0.3,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        zIndex: 1,
        assetId: 'preview-1',
        generationId: 'generation-1',
        crop: { x: 0, y: 0, width: 1, height: 1 },
      },
    });
    expect(serializeEditorDocument(withGenerated)).toContain('Exact, Punctuation!');
    expect(serializeEditorDocument(withGenerated)).toContain('preview-1');
  });

  it('blocks mutations of locked layers and tracks undo/redo as committed actions', () => {
    let history = createEditorHistory(
      applyEditorCommand(createEmptyEditorDocument(), { type: 'add-layer', layer: textLayer }),
    );
    history = commitEditorCommand(history, {
      type: 'update-layer',
      layerId: 'text-1',
      changes: { x: 0.6 },
    });
    expect(history.present.layers[0]?.x).toBe(0.6);
    history = undoEditorHistory(history);
    expect(history.present.layers[0]?.x).toBe(0.5);
    history = redoEditorHistory(history);
    expect(history.present.layers[0]?.x).toBe(0.6);
    const locked = applyEditorCommand(history.present, {
      type: 'set-lock',
      layerId: 'text-1',
      locked: true,
    });
    expect(() => applyEditorCommand(locked, { type: 'delete-layer', layerId: 'text-1' })).toThrow(
      'Unlock',
    );
  });

  it('persists an invalid draft state instead of destroying an out-of-bounds edit', () => {
    const document = applyEditorCommand(createEmptyEditorDocument(), {
      type: 'add-layer',
      layer: { ...textLayer, x: 0.05 },
    });
    expect(document.placementStatus).toBe('INVALID');
    expect(document.layers).toHaveLength(1);
  });
});
