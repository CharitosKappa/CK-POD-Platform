import {
  applyEditorCommand,
  createGeneratedLayer,
  type EditorDocumentV1,
  type GeneratedLayer,
} from '@let-it-be/editor-schema';

export function generatedLayerFromDeliveredResult(input: {
  layerId: string;
  assetId: string;
  generationId: string;
  zIndex: number;
}): GeneratedLayer {
  return createGeneratedLayer(input);
}

export function selectedGeneratedLayer(
  document: EditorDocumentV1,
  layerId: string,
): GeneratedLayer {
  const layer = document.layers.find((candidate) => candidate.id === layerId);
  if (!layer || layer.type !== 'generated') {
    throw new Error('Choose generated artwork before regenerating.');
  }
  if (layer.locked) throw new Error('Unlock this item before regenerating it.');
  return layer;
}

/** The caller persists this as a new project version, retaining the former asset reference. */
export function applySuccessfulRegeneration(
  document: EditorDocumentV1,
  input: { layerId: string; assetId: string; generationId: string },
): EditorDocumentV1 {
  selectedGeneratedLayer(document, input.layerId);
  return applyEditorCommand(document, {
    type: 'replace-generated-asset',
    layerId: input.layerId,
    assetId: input.assetId,
    generationId: input.generationId,
  });
}
