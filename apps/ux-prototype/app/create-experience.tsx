'use client';

import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';

const COPY = {
  headline: 'Turn your idea into a shirt worth wearing.',
  supporting: 'Describe what you want. We’ll handle the rest.',
};

const NEUTRAL_GARMENT_ASSET = '/garments/classic-tee-white.png';

const THEMES = {
  a: { name: 'A — Ink / Bone / Vermilion', className: 'theme-a' },
  b: { name: 'B — Ink / Porcelain / Cobalt', className: 'theme-b' },
  c: { name: 'C — Warm Black / Cream / Oxblood', className: 'theme-c' },
} as const;

type ThemeId = keyof typeof THEMES;
type CompositionVariant = 'canvas' | 'editorial' | 'object';

const COMPOSITION_VARIANTS: Record<CompositionVariant, { label: string; name: string }> = {
  canvas: { label: '1', name: 'Creative canvas' },
  editorial: { label: '2', name: 'Editorial poster' },
  object: { label: '3', name: 'Object-first' },
};

function Icon({ children }: { children: string }) {
  return <span aria-hidden="true">{children}</span>;
}

export function CreateExperience() {
  const [theme, setTheme] = useState<ThemeId>('a');
  const [composition, setComposition] = useState<CompositionVariant>('canvas');
  const [previewWidth, setPreviewWidth] = useState('390');
  const [prompt, setPrompt] = useState('');
  const [reference, setReference] = useState<{ name: string; url: string } | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [promptError, setPromptError] = useState('');
  const [notice, setNotice] = useState('');
  const triggerRef = useRef<HTMLElement | null>(null);
  const dialogCloseRef = useRef<HTMLButtonElement | null>(null);
  const mockCreditBalance = 1;

  useEffect(() => {
    if (!drawerOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogCloseRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [drawerOpen]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }
      if (drawerOpen) {
        closeDrawer();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  useEffect(() => {
    return () => {
      if (reference) {
        URL.revokeObjectURL(reference.url);
      }
    };
  }, [reference]);

  function openDrawer(trigger: HTMLElement) {
    triggerRef.current = trigger;
    setDrawerOpen(true);
  }

  function closeDrawer() {
    setDrawerOpen(false);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }

  function onReferenceChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    if (reference) {
      URL.revokeObjectURL(reference.url);
    }
    setReference({ name: file.name, url: URL.createObjectURL(file) });
    event.target.value = '';
  }

  function removeReference() {
    if (reference) {
      URL.revokeObjectURL(reference.url);
    }
    setReference(null);
  }

  function submit() {
    if (!prompt.trim()) {
      setPromptError('Tell us what you’d like on your shirt to continue.');
      setNotice('');
      return;
    }
    setPromptError('');
    setNotice('Step 1 complete — Style selection coming next.');
  }

  function handlePromptKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Escape') {
      event.currentTarget.blur();
    }
  }

  return (
    <main className={`prototype ${THEMES[theme].className}`}>
      <aside className="prototype-controls" aria-label="Prototype controls">
        <span>Prototype controls</span>
        <div className="theme-controls" role="group" aria-label="Visual direction">
          {(Object.keys(THEMES) as ThemeId[]).map((themeId) => (
            <button
              aria-pressed={theme === themeId}
              key={themeId}
              onClick={() => setTheme(themeId)}
              title={THEMES[themeId].name}
              type="button"
            >
              {themeId.toUpperCase()}
            </button>
          ))}
        </div>
        <div className="composition-controls" role="group" aria-label="Canvas direction">
          <span>Canvas</span>
          {(Object.keys(COMPOSITION_VARIANTS) as CompositionVariant[]).map((variant) => (
            <button
              aria-label={COMPOSITION_VARIANTS[variant].name}
              aria-pressed={composition === variant}
              key={variant}
              onClick={() => setComposition(variant)}
              title={COMPOSITION_VARIANTS[variant].name}
              type="button"
            >
              {COMPOSITION_VARIANTS[variant].label}
            </button>
          ))}
        </div>
        <label className="preview-control">
          Preview width
          <select onChange={(event) => setPreviewWidth(event.target.value)} value={previewWidth}>
            <option value="360">360 px</option>
            <option value="390">390 px</option>
            <option value="430">430 px</option>
          </select>
        </label>
      </aside>

      <section
        className={`phone-stage composition-${composition}`}
        style={{ '--preview-width': `${previewWidth}px` } as React.CSSProperties}
      >
        <button
          aria-label="Open menu"
          className="canvas-menu-button"
          onClick={(event) => openDrawer(event.currentTarget)}
          type="button"
        >
          <Icon>•••</Icon>
        </button>
        {composition === 'editorial' ? (
          <p aria-hidden="true" className="editorial-wordmark">
            <span>LET</span>
            <span>IT</span>
            <span>BE</span>
          </p>
        ) : null}

        <div className="create-flow">
          <section className="intro" aria-labelledby="create-heading">
            <p className="eyebrow">{composition === 'object' ? 'Create / 01' : 'Make it yours'}</p>
            <h1 id="create-heading">
              {composition === 'canvas' ? (
                <>
                  Turn your idea into
                  <br />a shirt worth wearing.
                </>
              ) : (
                COPY.headline
              )}
            </h1>
            <p>{COPY.supporting}</p>
          </section>

          <section className="garment-section" aria-label="Garment preview">
            <div className="garment-stage">
              <img alt="Blank Classic T-Shirt" src={NEUTRAL_GARMENT_ASSET} />
            </div>
          </section>

          <section className="prompt-section">
            <label
              className={composition === 'canvas' ? 'sr-only' : undefined}
              htmlFor="shirt-prompt"
            >
              What should we put on your shirt?
            </label>
            <div className={`composer ${promptError ? 'has-error' : ''}`}>
              <textarea
                id="shirt-prompt"
                maxLength={280}
                onChange={(event) => {
                  setPrompt(event.target.value);
                  if (promptError) setPromptError('');
                }}
                onKeyDown={handlePromptKeyDown}
                placeholder={
                  composition === 'canvas'
                    ? 'Describe your idea...'
                    : 'A funny Viking drinking coffee...'
                }
                rows={4}
                value={prompt}
              />
              <span>{prompt.length}/280</span>
            </div>
            {promptError ? (
              <p className="field-error" role="alert">
                {promptError}
              </p>
            ) : null}
          </section>

          <section className="reference-section" aria-label="Optional reference image">
            {reference ? (
              <div className="reference-preview">
                <img alt="Selected reference preview" src={reference.url} />
                <div>
                  <strong>{reference.name}</strong>
                  <button onClick={removeReference} type="button">
                    Remove
                  </button>
                </div>
              </div>
            ) : (
              <label className="reference-picker">
                <input accept="image/*" onChange={onReferenceChange} type="file" />
                <span>
                  <b>+</b> Add a reference image
                </span>
                <small>Optional</small>
              </label>
            )}
          </section>

          <button className="create-button" onClick={submit} type="button">
            Choose a Style <Icon>→</Icon>
          </button>
          {notice ? (
            <p className="completion-notice" role="status">
              {notice}
            </p>
          ) : null}
          <div className="creation-meta">
            <span className="credit-copy">{mockCreditBalance} credit available</span>
            <p className="reassurance">
              Free to create <span>·</span> Pay when you order
            </p>
          </div>
        </div>
      </section>

      {drawerOpen ? <NavigationDrawer close={closeDrawer} closeRef={dialogCloseRef} /> : null}
    </main>
  );
}

function NavigationDrawer({
  close,
  closeRef,
}: {
  close: () => void;
  closeRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const groups = [
    ['Create', 'Create a shirt', 'My designs', 'My orders'],
    ['Learn', 'How it works', 'Our T-shirts', 'Print quality', 'Size guide'],
    [
      'Help',
      'Shipping & delivery',
      'Returns & reprints',
      'Payments & security',
      'FAQ',
      'Contact',
      'Track order',
    ],
  ];
  return (
    <div
      className="overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <nav aria-label="Prototype navigation" aria-modal="true" className="drawer" role="dialog">
        <div className="drawer-header">
          <strong>LET IT BE</strong>
          <button aria-label="Close menu" onClick={close} ref={closeRef} type="button">
            ×
          </button>
        </div>
        {groups.map(([heading, ...links]) => (
          <section key={heading}>
            <h2>{heading}</h2>
            {links.map((link) => (
              <button key={link} type="button">
                {link}
              </button>
            ))}
          </section>
        ))}
        <button className="sign-in" type="button">
          Sign in
        </button>
      </nav>
    </div>
  );
}
