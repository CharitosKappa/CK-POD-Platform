'use client';

import {
  commitEditorCommand,
  createGeneratedLayer,
  createEditorHistory,
  curatedFonts,
  redoEditorHistory,
  serializeEditorDocument,
  snapLayerToGuides,
  undoEditorHistory,
  type EditorCommand,
  type EditorDocumentV1,
  type EditorLayer,
  type TextLayer,
} from '@let-it-be/editor-schema';
import type Konva from 'konva';
import {
  Group,
  Image as KonvaImage,
  Layer,
  Line,
  Rect,
  Stage,
  Text,
  Transformer,
} from 'react-konva';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

interface ProjectResponse {
  project: {
    id: string;
    productModelId: string;
    selectedColorCode: string;
    revision: number;
  };
}

interface VersionResponse {
  versions: Array<{ editorDocument: EditorDocumentV1 }>;
}

interface GenerationResponse {
  generation: {
    id: string;
    status: string;
    previewAsset: { id: string } | null;
  };
}

const editorColors = ['black', 'white', 'navy'] as const;
const editorUndoLimit = publicNumber(process.env.NEXT_PUBLIC_EDITOR_UNDO_LIMIT, 50);
const editorAutosaveDebounceMs = publicNumber(
  process.env.NEXT_PUBLIC_EDITOR_AUTOSAVE_DEBOUNCE_MS,
  700,
);

export function EditorClient() {
  const search = useSearchParams();
  const projectId = search.get('project');
  const generationId = search.get('generation');
  const [history, setHistory] = useState<ReturnType<typeof createEditorHistory>>();
  const [revision, setRevision] = useState<number>();
  const [colorCode, setColorCode] = useState('black');
  const [productModelId, setProductModelId] = useState('essential-dtg-tee');
  const [selectedLayerId, setSelectedLayerId] = useState<string>();
  const [advanced, setAdvanced] = useState(false);
  const [saveState, setSaveState] = useState<'loading' | 'saved' | 'saving' | 'conflict' | 'error'>(
    'loading',
  );
  const [error, setError] = useState<string>();
  const [refinement, setRefinement] = useState('');
  const loaded = useRef(false);
  const lastSavedDocument = useRef<string | undefined>(undefined);

  const document = history?.present;
  const selected = useMemo(
    () => document?.layers.find((layer) => layer.id === selectedLayerId),
    [document, selectedLayerId],
  );

  useEffect(() => {
    if (!projectId) return;
    void Promise.all([
      fetch(`/api/projects/${encodeURIComponent(projectId)}`).then(readJson<ProjectResponse>),
      fetch(`/api/projects/${encodeURIComponent(projectId)}/versions`).then(
        readJson<VersionResponse>,
      ),
    ])
      .then(([projectPayload, versionPayload]) => {
        const active = versionPayload.versions[0]?.editorDocument;
        if (!active) throw new Error('This project does not have an editable design yet.');
        setHistory(createEditorHistory(active, editorUndoLimit));
        lastSavedDocument.current = serializeEditorDocument(active);
        setRevision(projectPayload.project.revision);
        setColorCode(projectPayload.project.selectedColorCode);
        setProductModelId(projectPayload.project.productModelId);
        setSaveState('saved');
        loaded.current = true;
      })
      .catch((reason) => {
        setError(messageFor(reason));
        setSaveState('error');
      });
  }, [projectId]);

  useEffect(() => {
    if (
      !projectId ||
      !generationId ||
      !history ||
      history.present.layers.some(
        (layer) => layer.type === 'generated' && layer.generationId === generationId,
      )
    )
      return;
    void fetch(
      `/api/projects/${encodeURIComponent(projectId)}/generations/${encodeURIComponent(generationId)}`,
    )
      .then(readJson<GenerationResponse>)
      .then(({ generation }) => {
        if (generation.status !== 'SUCCEEDED' || !generation.previewAsset) return;
        const layer = createGeneratedLayer({
          layerId: `generated-${generation.id}`,
          assetId: generation.previewAsset.id,
          generationId: generation.id,
          zIndex: history.present.layers.length,
        });
        setHistory((current) =>
          current ? commitEditorCommand(current, { type: 'add-layer', layer }) : current,
        );
        setSelectedLayerId(layer.id);
      })
      .catch((reason) => setError(messageFor(reason)));
  }, [generationId, history, projectId]);

  useEffect(() => {
    if (!projectId || !history || revision === undefined || !loaded.current) return;
    const serialized = serializeEditorDocument(history.present);
    if (serialized === lastSavedDocument.current) return;
    const timer = window.setTimeout(() => {
      setSaveState('saving');
      void fetch(`/api/projects/${encodeURIComponent(projectId)}/autosave`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ editorDocument: history.present, expectedRevision: revision }),
      })
        .then(async (response) => {
          const payload = (await response.json()) as {
            project?: { revision: number };
            code?: string;
            error?: string;
          };
          if (!response.ok)
            throw Object.assign(new Error(payload.error ?? 'Could not save your design.'), {
              code: payload.code,
            });
          lastSavedDocument.current = serialized;
          if (payload.project) setRevision(payload.project.revision);
          setSaveState('saved');
        })
        .catch((reason: unknown) => {
          setSaveState(
            (reason as { code?: string }).code === 'STALE_PROJECT' ? 'conflict' : 'error',
          );
          setError(messageFor(reason));
        });
    }, editorAutosaveDebounceMs);
    return () => window.clearTimeout(timer);
  }, [history, projectId, revision]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (
        !history ||
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLSelectElement
      )
        return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        setHistory((current) =>
          current
            ? event.shiftKey
              ? redoEditorHistory(current)
              : undoEditorHistory(current)
            : current,
        );
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedLayerId) {
        event.preventDefault();
        commit({ type: 'delete-layer', layerId: selectedLayerId });
        setSelectedLayerId(undefined);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  function commit(command: EditorCommand): void {
    setError(undefined);
    setHistory((current) => {
      if (!current) return current;
      try {
        return commitEditorCommand(current, command);
      } catch (reason) {
        setError(messageFor(reason));
        return current;
      }
    });
  }

  function addText(): void {
    if (!document) return;
    const id = `text-${crypto.randomUUID()}`;
    commit({
      type: 'add-layer',
      layer: {
        id,
        type: 'text',
        x: 0.5,
        y: 0.5,
        width: 0.5,
        height: 0.12,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        zIndex: document.layers.length,
        text: 'Your words here',
        fontId: 'inter',
        fontWeight: 700,
        fontSize: 64,
        fill: '#ffffff',
        alignment: 'center',
      },
    });
    setSelectedLayerId(id);
  }

  async function changeColor(nextColor: string): Promise<void> {
    if (!projectId || revision === undefined || nextColor === colorCode) return;
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/selection`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ productModelId, colorCode: nextColor, expectedRevision: revision }),
    });
    const payload = (await response.json()) as { project?: { revision: number }; error?: string };
    if (!response.ok || !payload.project) {
      setError(payload.error ?? 'Could not change the T-shirt color.');
      return;
    }
    setColorCode(nextColor);
    setRevision(payload.project.revision);
  }

  async function regenerate(): Promise<void> {
    if (!projectId || !selected || selected.type !== 'generated' || !refinement.trim()) return;
    const response = await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/editor/regenerate`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ layerId: selected.id, prompt: refinement }),
      },
    );
    const payload = (await response.json()) as GenerationResponse & { error?: string };
    if (!response.ok) return setError(payload.error ?? 'Could not refresh this artwork.');
    setRefinement('');
    await waitForGeneration(projectId, payload.generation.id, selected.id);
  }

  async function waitForGeneration(
    currentProjectId: string,
    currentGenerationId: string,
    layerId: string,
  ): Promise<void> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 400));
      const payload = await fetch(
        `/api/projects/${encodeURIComponent(currentProjectId)}/generations/${encodeURIComponent(currentGenerationId)}`,
      ).then(readJson<GenerationResponse>);
      if (payload.generation.status === 'SUCCEEDED' && payload.generation.previewAsset) {
        commit({
          type: 'replace-generated-asset',
          layerId,
          assetId: payload.generation.previewAsset.id,
          generationId: currentGenerationId,
        });
        return;
      }
      if (['FAILED', 'REJECTED_INTERNAL', 'CANCELLED'].includes(payload.generation.status)) {
        setError('That refresh could not be completed. Your current artwork is unchanged.');
        return;
      }
    }
    setError('Your refresh is still working. Your current artwork is unchanged.');
  }

  if (!projectId)
    return <EditorMessage message="Choose a saved T-shirt project before opening the editor." />;
  if (!document || revision === undefined)
    return <EditorMessage message={error ?? 'Loading your design…'} />;

  const canContinue = document.placementStatus === 'VALID';
  const contrastWarning = hasPotentialContrastIssue(document, colorCode);
  return (
    <main className="editor-page">
      <header className="editor-header">
        <div>
          <p className="eyebrow">Step 4 of 5 · Make It Yours</p>
          <h1>Your T-shirt, your way.</h1>
        </div>
        <p className={`editor-save editor-save-${saveState}`} role="status">
          {saveLabel(saveState)}
        </p>
      </header>
      <section className="editor-layout" aria-label="T-shirt editor">
        <div className={`editor-product editor-product-${colorCode}`}>
          <EditorCanvas
            document={document}
            projectId={projectId}
            selectedLayerId={selectedLayerId}
            onSelect={setSelectedLayerId}
            onCommit={commit}
          />
          <p className="editor-boundary-note">
            The dotted area shows where your design will print.
          </p>
        </div>
        <aside className="editor-controls" aria-label="Design controls">
          <div className="editor-mode-row">
            <button
              type="button"
              className={!advanced ? 'editor-active' : ''}
              onClick={() => setAdvanced(false)}
            >
              Simple
            </button>
            <button
              type="button"
              className={advanced ? 'editor-active' : ''}
              onClick={() => setAdvanced(true)}
            >
              More options
            </button>
          </div>
          <div className="editor-actions">
            <button type="button" onClick={addText}>
              Add text
            </button>
            <button
              type="button"
              disabled={!history.past.length}
              onClick={() => setHistory((current) => current && undoEditorHistory(current))}
            >
              Undo
            </button>
            <button
              type="button"
              disabled={!history.future.length}
              onClick={() => setHistory((current) => current && redoEditorHistory(current))}
            >
              Redo
            </button>
          </div>
          <fieldset className="editor-color-picker">
            <legend>T-shirt color</legend>
            {editorColors.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={`Use ${color} T-shirt`}
                aria-pressed={color === colorCode}
                className={`editor-swatch editor-swatch-${color}`}
                onClick={() => void changeColor(color)}
              >
                <span aria-hidden="true" />
                {color}
              </button>
            ))}
          </fieldset>
          {advanced ? (
            <LayersPanel
              document={document}
              selectedLayerId={selectedLayerId}
              onSelect={setSelectedLayerId}
              onCommit={commit}
            />
          ) : null}
          {selected ? (
            <LayerInspector
              layer={selected}
              advanced={advanced}
              onCommit={commit}
              onDelete={() => {
                commit({ type: 'delete-layer', layerId: selected.id });
                setSelectedLayerId(undefined);
              }}
              refinement={refinement}
              setRefinement={setRefinement}
              onRegenerate={() => void regenerate()}
            />
          ) : (
            <p className="editor-help">Tap your artwork or text to make a change.</p>
          )}
          <div
            className={`editor-quality editor-quality-${document.placementStatus.toLowerCase()}`}
          >
            <strong>
              {document.placementStatus === 'VALID'
                ? 'Print placement looks good'
                : 'Move your design inside the dotted area'}
            </strong>
            <span>
              {document.placementStatus === 'VALID'
                ? 'Detailed print checks happen before ordering.'
                : 'You can keep editing and saving, but continue is unavailable until this is fixed.'}
            </span>
          </div>
          {contrastWarning ? (
            <p className="editor-contrast-warning" role="status">
              This text may be hard to see on this T-shirt color. Try a higher-contrast color.
            </p>
          ) : null}
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <button
            className="continue"
            type="button"
            disabled={!canContinue}
            onClick={() => setError('Product preview and ordering arrive in a later milestone.')}
          >
            Continue to preview
          </button>
        </aside>
      </section>
    </main>
  );
}

function LayersPanel({
  document,
  selectedLayerId,
  onSelect,
  onCommit,
}: {
  document: EditorDocumentV1;
  selectedLayerId: string | undefined;
  onSelect: (id: string) => void;
  onCommit: (command: EditorCommand) => void;
}) {
  return (
    <section className="editor-layers" aria-label="Layers">
      <h2>Layers</h2>
      {[...document.layers].reverse().map((layer) => (
        <div className="editor-layer-row" key={layer.id}>
          <button
            type="button"
            className={layer.id === selectedLayerId ? 'editor-layer-selected' : ''}
            onClick={() => onSelect(layer.id)}
          >
            {layer.type === 'text'
              ? layer.text || 'Text'
              : layer.type === 'generated'
                ? 'Generated artwork'
                : 'Image'}
          </button>
          <span>{layer.locked ? 'Locked' : layer.visible ? 'Shown' : 'Hidden'}</span>
          <button
            type="button"
            aria-label={`${layer.visible ? 'Hide' : 'Show'} layer`}
            onClick={() =>
              onCommit({ type: 'set-visibility', layerId: layer.id, visible: !layer.visible })
            }
          >
            {layer.visible ? 'Hide' : 'Show'}
          </button>
        </div>
      ))}
    </section>
  );
}

function EditorCanvas({
  document,
  projectId,
  selectedLayerId,
  onSelect,
  onCommit,
}: {
  document: EditorDocumentV1;
  projectId: string;
  selectedLayerId: string | undefined;
  onSelect: (id: string) => void;
  onCommit: (command: EditorCommand) => void;
}) {
  const [width, setWidth] = useState(460);
  useEffect(() => {
    const update = () =>
      setWidth(window.innerWidth < 700 ? Math.min(340, window.innerWidth - 64) : 460);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  const scale = width / document.canvas.width;
  const height = Math.round(document.canvas.height * scale);
  const bounds = document.printArea.bounds;
  const print = {
    x: bounds.x * document.canvas.width * scale,
    y: bounds.y * document.canvas.height * scale,
    width: bounds.width * document.canvas.width * scale,
    height: bounds.height * document.canvas.height * scale,
  };
  const safe = document.printArea.safeBounds;
  return (
    <Stage width={width} height={height} className="editor-stage">
      <Layer>
        <Rect
          x={print.x}
          y={print.y}
          width={print.width}
          height={print.height}
          stroke="#316f5d"
          dash={[8, 6]}
          strokeWidth={1.5}
          listening={false}
        />
        <Rect
          x={print.x + safe.x * print.width}
          y={print.y + safe.y * print.height}
          width={safe.width * print.width}
          height={safe.height * print.height}
          stroke="#7ea997"
          dash={[4, 6]}
          listening={false}
        />
        <Line
          points={[
            print.x + print.width / 2,
            print.y,
            print.x + print.width / 2,
            print.y + print.height,
          ]}
          stroke="#316f5d"
          opacity={0.28}
          dash={[4, 5]}
          listening={false}
        />
        <Line
          points={[
            print.x,
            print.y + print.height / 2,
            print.x + print.width,
            print.y + print.height / 2,
          ]}
          stroke="#316f5d"
          opacity={0.28}
          dash={[4, 5]}
          listening={false}
        />
        {document.layers
          .filter((layer) => layer.visible)
          .map((layer) => (
            <CanvasLayer
              key={layer.id}
              layer={layer}
              document={document}
              selected={layer.id === selectedLayerId}
              projectId={projectId}
              scale={scale}
              print={print}
              onSelect={onSelect}
              onCommit={onCommit}
            />
          ))}
      </Layer>
    </Stage>
  );
}

function CanvasLayer({
  layer,
  document,
  selected,
  projectId,
  scale,
  print,
  onSelect,
  onCommit,
}: {
  layer: EditorLayer;
  document: EditorDocumentV1;
  selected: boolean;
  projectId: string;
  scale: number;
  print: { x: number; y: number; width: number; height: number };
  onSelect: (id: string) => void;
  onCommit: (command: EditorCommand) => void;
}) {
  const group = useRef<Konva.Group>(null);
  const transformer = useRef<Konva.Transformer>(null);
  const image = usePreviewImage(
    layer.type === 'text'
      ? undefined
      : `/api/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(layer.assetId)}/preview`,
  );
  const width = layer.width * print.width;
  const height = layer.height * print.height;
  const x = print.x + layer.x * print.width;
  const y = print.y + layer.y * print.height;
  useEffect(() => {
    if (selected && group.current && transformer.current) {
      transformer.current.nodes([group.current]);
      transformer.current.getLayer()?.batchDraw();
    }
  }, [selected]);
  const commitTransform = (node: Konva.Group) => {
    const next = snapLayerToGuides(document, {
      ...layer,
      x: (node.x() - print.x) / print.width,
      y: (node.y() - print.y) / print.height,
      width: Math.max(0.03, layer.width * node.scaleX()),
      height: Math.max(0.03, layer.height * node.scaleY()),
      rotation: node.rotation(),
    });
    node.scaleX(1);
    node.scaleY(1);
    onCommit({
      type: 'update-layer',
      layerId: layer.id,
      changes: {
        x: next.x,
        y: next.y,
        width: next.width,
        height: next.height,
        rotation: next.rotation,
      },
    });
  };
  return (
    <>
      <Group
        ref={selected ? group : undefined}
        x={x}
        y={y}
        offsetX={width / 2}
        offsetY={height / 2}
        rotation={layer.rotation}
        draggable={!layer.locked}
        onClick={() => onSelect(layer.id)}
        onTap={() => onSelect(layer.id)}
        onDragEnd={(event) => commitTransform(event.target as Konva.Group)}
        onTransformEnd={(event) => commitTransform(event.target as Konva.Group)}
      >
        {layer.type === 'text' ? (
          <Text
            text={layer.text}
            width={width}
            height={height}
            fontFamily={fontFamily(layer.fontId)}
            fontSize={layer.fontSize * scale}
            fontStyle={layer.fontWeight === 700 ? 'bold' : 'normal'}
            fill={layer.fill}
            {...(layer.stroke
              ? { stroke: layer.stroke.color, strokeWidth: layer.stroke.width * print.width }
              : {})}
            align={layer.alignment}
            verticalAlign="middle"
          />
        ) : image ? (
          <KonvaImage image={image} width={width} height={height} {...cropProps(layer, image)} />
        ) : (
          <Rect width={width} height={height} fill="#d9e3de" cornerRadius={8} />
        )}
        {selected ? (
          <Rect width={width} height={height} stroke="#316f5d" strokeWidth={2} listening={false} />
        ) : null}
      </Group>
      {selected && !layer.locked ? (
        <Transformer
          ref={transformer}
          rotateEnabled
          enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
          boundBoxFunc={(_oldBox, nextBox) =>
            nextBox.width < 20 || nextBox.height < 20 ? _oldBox : nextBox
          }
        />
      ) : null}
    </>
  );
}

function LayerInspector({
  layer,
  advanced,
  onCommit,
  onDelete,
  refinement,
  setRefinement,
  onRegenerate,
}: {
  layer: EditorLayer;
  advanced: boolean;
  onCommit: (command: EditorCommand) => void;
  onDelete: () => void;
  refinement: string;
  setRefinement: (value: string) => void;
  onRegenerate: () => void;
}) {
  const update = (changes: Record<string, unknown>) =>
    onCommit({ type: 'update-layer', layerId: layer.id, changes });
  return (
    <section className="editor-inspector" aria-label="Selected item controls">
      <h2>
        {layer.type === 'text'
          ? 'Edit text'
          : layer.type === 'generated'
            ? 'Your artwork'
            : 'Your image'}
      </h2>
      {layer.type === 'text' ? (
        <>
          <label>
            Words
            <input
              aria-label="Text content"
              value={layer.text}
              onChange={(event) => update({ text: event.target.value })}
            />
          </label>
          <label>
            Font
            <select
              aria-label="Font"
              value={layer.fontId}
              onChange={(event) => update({ fontId: event.target.value })}
            >
              {curatedFonts.map((font) => (
                <option key={font.id} value={font.id}>
                  {font.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Text color
            <input
              aria-label="Text color"
              type="color"
              value={layer.fill}
              onChange={(event) => update({ fill: event.target.value })}
            />
          </label>
        </>
      ) : (
        <button
          type="button"
          onClick={() => update({ crop: { x: 0.05, y: 0.05, width: 0.9, height: 0.9 } })}
        >
          Crop tighter
        </button>
      )}
      <div className="editor-transform-buttons">
        <button type="button" onClick={() => update({ x: 0.5 })}>
          Center across
        </button>
        <button type="button" onClick={() => update({ y: 0.5 })}>
          Center down
        </button>
        <button type="button" onClick={() => update({ rotation: layer.rotation + 15 })}>
          Turn 15°
        </button>
      </div>
      {advanced ? (
        <>
          <div className="editor-advanced-actions">
            <button
              type="button"
              onClick={() =>
                onCommit({ type: 'set-lock', layerId: layer.id, locked: !layer.locked })
              }
            >
              {layer.locked ? 'Unlock item' : 'Lock item'}
            </button>
            <button
              type="button"
              onClick={() =>
                onCommit({ type: 'set-visibility', layerId: layer.id, visible: !layer.visible })
              }
            >
              {layer.visible ? 'Hide item' : 'Show item'}
            </button>
            <button
              type="button"
              onClick={() =>
                onCommit({ type: 'reorder-layer', layerId: layer.id, direction: 'forward' })
              }
            >
              Bring forward
            </button>
            <button
              type="button"
              onClick={() =>
                onCommit({ type: 'reorder-layer', layerId: layer.id, direction: 'backward' })
              }
            >
              Send backward
            </button>
          </div>
          {layer.type === 'text' ? (
            <label>
              Outline color
              <input
                aria-label="Text outline color"
                type="color"
                value={layer.stroke?.color ?? '#ffffff'}
                onChange={(event) =>
                  update({ stroke: { color: event.target.value, width: 0.008 } })
                }
              />
            </label>
          ) : null}
          {layer.type === 'generated' && !layer.locked ? (
            <div className="editor-regenerate">
              <label>
                Change this artwork
                <input
                  aria-label="Change this artwork"
                  value={refinement}
                  onChange={(event) => setRefinement(event.target.value)}
                  placeholder="For example, make it warmer"
                />
              </label>
              <button type="button" disabled={!refinement.trim()} onClick={onRegenerate}>
                Refresh artwork
              </button>
            </div>
          ) : null}
        </>
      ) : null}
      <button className="secondary-action" type="button" disabled={layer.locked} onClick={onDelete}>
        Delete item
      </button>
    </section>
  );
}

function usePreviewImage(source: string | undefined): HTMLImageElement | undefined {
  const [image, setImage] = useState<HTMLImageElement>();
  useEffect(() => {
    if (!source) return;
    const next = new window.Image();
    next.onload = () => setImage(next);
    next.src = source;
    return () => {
      next.onload = null;
    };
  }, [source]);
  return image;
}
function cropProps(layer: EditorLayer, image: HTMLImageElement) {
  if (layer.type === 'text' || !layer.crop) return {};
  return {
    cropX: layer.crop.x * image.naturalWidth,
    cropY: layer.crop.y * image.naturalHeight,
    cropWidth: layer.crop.width * image.naturalWidth,
    cropHeight: layer.crop.height * image.naturalHeight,
  };
}
function fontFamily(id: TextLayer['fontId']): string {
  return curatedFonts.find((font) => font.id === id)?.family ?? 'Inter';
}
async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? 'Something went wrong.');
  return payload;
}
function messageFor(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'Something went wrong. Please try again.';
}
function saveLabel(state: 'loading' | 'saved' | 'saving' | 'conflict' | 'error'): string {
  return {
    loading: 'Loading',
    saved: 'Saved',
    saving: 'Saving…',
    conflict: 'Design changed elsewhere — reload before saving again',
    error: 'Could not save',
  }[state];
}
function EditorMessage({ message }: { message: string }) {
  return (
    <main>
      <section className="foundation-card">
        <p role="status">{message}</p>
      </section>
    </main>
  );
}
function publicNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function hasPotentialContrastIssue(document: EditorDocumentV1, colorCode: string): boolean {
  const darkGarment = colorCode === 'black' || colorCode === 'navy';
  return document.layers.some((layer) => {
    if (layer.type !== 'text' || !layer.visible) return false;
    const color = layer.fill.toLowerCase();
    return darkGarment ? ['#000000', '#182128', '#17294b'].includes(color) : color === '#ffffff';
  });
}
