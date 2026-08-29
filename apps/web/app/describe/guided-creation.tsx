'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';

interface StyleVisual {
  accent: string;
  accentSecondary: string;
}

interface StylePreset {
  id: string;
  displayName: string;
  description: string;
  version: number;
  visual: StyleVisual;
}

interface StyleFamily {
  id: string;
  displayName: string;
  description: string;
  visual: StyleVisual;
  presets: StylePreset[];
}

interface ProjectSelection {
  selectionMode: 'MANUAL' | 'AUTO';
  styleFamilyId: string | null;
  presetId: string | null;
  presetVersion: number | null;
}

interface Project {
  id: string;
  revision: number;
  selectedColorCode: string;
  styleSelection: ProjectSelection;
}

export function GuidedCreation({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<Project>();
  const [styles, setStyles] = useState<StyleFamily[]>([]);
  const [selectedFamilyId, setSelectedFamilyId] = useState<string>();
  const [selectedPresetId, setSelectedPresetId] = useState<string>();
  const [idea, setIdea] = useState('');
  const [status, setStatus] = useState('Loading your guided style choices…');
  const [error, setError] = useState<string>();
  const [savingStyle, setSavingStyle] = useState(false);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    void Promise.all([
      fetch(`/api/projects/${encodeURIComponent(projectId)}`).then(readJson<{ project: Project }>),
      fetch('/api/styles').then(readJson<{ styles: StyleFamily[] }>),
    ])
      .then(([projectPayload, stylePayload]) => {
        setProject(projectPayload.project);
        setStyles(stylePayload.styles);
        setSelectedFamilyId(
          projectPayload.project.styleSelection.styleFamilyId ?? stylePayload.styles[0]?.id,
        );
        setSelectedPresetId(projectPayload.project.styleSelection.presetId ?? undefined);
        setStatus('');
      })
      .catch((reason) => {
        setError(messageFor(reason));
        setStatus('');
      });
  }, [projectId]);

  const selectedFamily = useMemo(
    () => styles.find((family) => family.id === selectedFamilyId),
    [selectedFamilyId, styles],
  );
  const selectedPreset = selectedFamily?.presets.find((preset) => preset.id === selectedPresetId);
  const autoSelected = project?.styleSelection.selectionMode === 'AUTO';
  const canGenerate =
    !!idea.trim() &&
    !!project &&
    (autoSelected ||
      (project.styleSelection.styleFamilyId === selectedFamilyId &&
        project.styleSelection.presetId === selectedPresetId));

  async function choosePreset(family: StyleFamily, preset: StylePreset): Promise<void> {
    if (!project || savingStyle) return;
    setSavingStyle(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/style`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          selectionMode: 'MANUAL',
          styleFamilyId: family.id,
          presetId: preset.id,
          expectedRevision: project.revision,
        }),
      });
      const payload = await readJson<{ project: Project }>(response);
      setProject(payload.project);
      setSelectedFamilyId(family.id);
      setSelectedPresetId(preset.id);
      setStatus(`${family.displayName} / ${preset.displayName} selected.`);
    } catch (reason) {
      setError(messageFor(reason));
    } finally {
      setSavingStyle(false);
    }
  }

  async function chooseAuto(): Promise<void> {
    if (!project || savingStyle) return;
    setSavingStyle(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/style`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ selectionMode: 'AUTO', expectedRevision: project.revision }),
      });
      const payload = await readJson<{ project: Project }>(response);
      setProject(payload.project);
      setSelectedPresetId(undefined);
      setStatus('Let AI Decide is selected. We will choose a style that fits your idea.');
    } catch (reason) {
      setError(messageFor(reason));
    } finally {
      setSavingStyle(false);
    }
  }

  async function generate(): Promise<void> {
    if (!canGenerate || generating) return;
    setGenerating(true);
    setError(undefined);
    setStatus('Creating your design…');
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/generations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: idea }),
      });
      const payload = await readJson<{ generation: { id: string } }>(response);
      await waitForGeneration(projectId, payload.generation.id, setStatus);
      window.location.assign(
        `/editor?project=${encodeURIComponent(projectId)}&generation=${encodeURIComponent(payload.generation.id)}`,
      );
    } catch (reason) {
      setError(messageFor(reason));
      setGenerating(false);
      setStatus('');
    }
  }

  return (
    <section className="guided-creation" aria-labelledby="guided-title">
      <div className="guided-intro">
        <p className="eyebrow">Step 2 of 5 · Describe Your Idea</p>
        <h1 id="guided-title">Start with what you have in mind.</h1>
        <p>
          Tell us the idea. Then choose a look you like—we’ll handle the design details for your{' '}
          {project?.selectedColorCode ?? 'selected'} tee.
        </p>
      </div>
      <label className="idea-input">
        <span>What would you like on your T-shirt?</span>
        <textarea
          maxLength={2000}
          onChange={(event) => setIdea(event.target.value)}
          placeholder={'Try “Funny Viking drinking coffee” or “Minimal Anubis line art”.'}
          value={idea}
        />
      </label>
      <section aria-labelledby="family-title" className="style-section">
        <div className="style-heading">
          <div>
            <p className="step-label">Choose a look</p>
            <h2 id="family-title">Pick a style family</h2>
          </div>
          <button
            aria-pressed={autoSelected}
            className="auto-style"
            disabled={!project || savingStyle}
            onClick={() => void chooseAuto()}
            type="button"
          >
            Let AI Decide
          </button>
        </div>
        <div className="style-family-grid">
          {styles.map((family) => (
            <button
              aria-pressed={!autoSelected && family.id === selectedFamilyId}
              className="style-family-card"
              key={family.id}
              onClick={() => {
                setSelectedFamilyId(family.id);
                setSelectedPresetId(undefined);
                setStatus(`Choose a ${family.displayName} look below.`);
              }}
              style={styleBackground(family.visual)}
              type="button"
            >
              <span aria-hidden="true" className="style-art">
                ✦
              </span>
              <strong>{family.displayName}</strong>
              <small>{family.description}</small>
            </button>
          ))}
        </div>
      </section>
      <section aria-labelledby="preset-title" className="style-section">
        <div className="style-heading">
          <div>
            <p className="step-label">Make it yours</p>
            <h2 id="preset-title">
              {selectedFamily
                ? `Choose a ${selectedFamily.displayName} direction`
                : 'Choose a direction'}
            </h2>
          </div>
          {selectedPreset ? (
            <p className="style-picked">{selectedPreset.displayName} selected</p>
          ) : null}
        </div>
        <div className="style-preset-grid">
          {selectedFamily?.presets.map((preset) => (
            <button
              aria-pressed={!autoSelected && selectedPresetId === preset.id}
              className="style-preset-card"
              disabled={!project || savingStyle}
              key={preset.id}
              onClick={() => void choosePreset(selectedFamily, preset)}
              style={styleBackground(preset.visual)}
              type="button"
            >
              <span aria-hidden="true" className="preset-art">
                ●
              </span>
              <strong>{preset.displayName}</strong>
              <small>{preset.description}</small>
            </button>
          ))}
        </div>
      </section>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {status ? (
        <p className="guided-status" role="status">
          {status}
        </p>
      ) : null}
      <button
        className="continue guided-generate"
        disabled={!canGenerate || generating}
        onClick={() => void generate()}
        type="button"
      >
        {generating ? 'Creating Your T-Shirt…' : 'Create Your T-Shirt'}
      </button>
    </section>
  );
}

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? 'Something went wrong. Please try again.');
  return body;
}

async function waitForGeneration(
  projectId: string,
  generationId: string,
  setStatus: (value: string) => void,
): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 500));
    const response = await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/generations/${encodeURIComponent(generationId)}`,
    );
    const payload = await readJson<{ generation: { status: string } }>(response);
    if (payload.generation.status === 'SUCCEEDED') return;
    if (['FAILED', 'REJECTED_INTERNAL', 'CANCELLED'].includes(payload.generation.status)) {
      throw new Error('We could not create a design from that idea. Please try again.');
    }
    setStatus('Creating your design…');
  }
  throw new Error('Your design is taking longer than expected. Please try again.');
}

function messageFor(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'Something went wrong. Please try again.';
}

function styleBackground(visual: StyleVisual): CSSProperties {
  return {
    '--style-accent': visual.accent,
    '--style-accent-secondary': visual.accentSecondary,
  } as CSSProperties;
}
