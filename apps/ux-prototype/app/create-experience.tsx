'use client';

import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';

const COPY = {
  headline: 'Turn your idea into a shirt worth wearing.',
  supporting: 'Describe what you want. We’ll handle the rest.',
};

const COLORS = [
  { id: 'black', label: 'Black', hex: '#171717', asset: '/garments/classic-tee-black.png' },
  { id: 'navy', label: 'Navy', hex: '#182b4f', asset: '/garments/classic-tee-navy.png' },
  { id: 'white', label: 'White', hex: '#f7f6f2', asset: '/garments/classic-tee-white.png' },
] as const;

const SIZES = ['S', 'M', 'L', 'XL', '2XL'] as const;
const UNAVAILABLE: Record<(typeof COLORS)[number]['id'], readonly string[]> = {
  black: [],
  navy: ['M'],
  white: ['2XL'],
};

const THEMES = {
  a: { name: 'A — Ink / Bone / Vermilion', className: 'theme-a' },
  b: { name: 'B — Ink / Porcelain / Cobalt', className: 'theme-b' },
  c: { name: 'C — Warm Black / Cream / Oxblood', className: 'theme-c' },
} as const;

type ColorId = (typeof COLORS)[number]['id'];
type Sheet = 'color' | 'size' | 'guide' | null;
type ThemeId = keyof typeof THEMES;

function Icon({ children }: { children: string }) {
  return <span aria-hidden="true">{children}</span>;
}

export function CreateExperience() {
  const [theme, setTheme] = useState<ThemeId>('a');
  const [previewWidth, setPreviewWidth] = useState('390');
  const [color, setColor] = useState<ColorId>('black');
  const [size, setSize] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [reference, setReference] = useState<{ name: string; url: string } | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [errors, setErrors] = useState({ prompt: '', size: '' });
  const [notice, setNotice] = useState('');
  const [cartCount, setCartCount] = useState(0);
  const triggerRef = useRef<HTMLElement | null>(null);
  const dialogCloseRef = useRef<HTMLButtonElement | null>(null);

  const selectedColor = COLORS.find((item) => item.id === color) ?? COLORS[0];
  const unavailableSizes = UNAVAILABLE[color];

  useEffect(() => {
    if (!sheet && !drawerOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogCloseRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [drawerOpen, sheet]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }
      if (sheet) {
        closeSheet();
      } else if (drawerOpen) {
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

  function openSheet(nextSheet: Exclude<Sheet, null>, trigger: HTMLElement) {
    triggerRef.current = trigger;
    setSheet(nextSheet);
  }

  function closeSheet() {
    setSheet(null);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }

  function openDrawer(trigger: HTMLElement) {
    triggerRef.current = trigger;
    setDrawerOpen(true);
  }

  function closeDrawer() {
    setDrawerOpen(false);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }

  function chooseColor(nextColor: ColorId) {
    const nextUnavailable = UNAVAILABLE[nextColor];
    if (size && nextUnavailable.includes(size)) {
      setSize(null);
      setErrors((current) => ({
        ...current,
        size: `${size} isn’t available in ${labelFor(nextColor)}. Choose another size.`,
      }));
    }
    setColor(nextColor);
    closeSheet();
  }

  function chooseSize(nextSize: string) {
    setSize(nextSize);
    setErrors((current) => ({ ...current, size: '' }));
    closeSheet();
  }

  function labelFor(id: ColorId) {
    return COLORS.find((item) => item.id === id)?.label ?? id;
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
    const nextErrors = {
      prompt: prompt.trim() ? '' : 'Tell us what you’d like on your shirt to continue.',
      size: size ? '' : 'Choose your size to continue.',
    };
    setErrors(nextErrors);
    if (nextErrors.prompt || nextErrors.size) {
      setNotice('');
      return;
    }
    setCartCount(1);
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
        className="phone-stage"
        style={{ '--preview-width': `${previewWidth}px` } as React.CSSProperties}
      >
        <header className="mobile-header">
          <button
            aria-label="Open menu"
            className="header-button"
            onClick={(event) => openDrawer(event.currentTarget)}
            type="button"
          >
            <Icon>☰</Icon>
          </button>
          <strong className="wordmark">LET IT BE</strong>
          <button aria-label="View cart" className="cart-button" type="button">
            Cart
            {cartCount > 0 ? <span className="cart-badge">{cartCount}</span> : null}
          </button>
        </header>

        <div className="create-flow">
          <section className="intro" aria-labelledby="create-heading">
            <p className="eyebrow">Make it yours</p>
            <h1 id="create-heading">{COPY.headline}</h1>
            <p>{COPY.supporting}</p>
          </section>

          <section
            className="garment-section"
            aria-label={`${selectedColor.label} Classic T-Shirt preview`}
          >
            <div className="garment-stage">
              <img alt={`Blank ${selectedColor.label} Classic T-Shirt`} src={selectedColor.asset} />
            </div>
            <div className="product-summary">
              <strong>Classic T-Shirt</strong>
              <span>$39.99</span>
            </div>
          </section>

          <div className="configuration">
            <button
              className="config-button"
              onClick={(event) => openSheet('color', event.currentTarget)}
              type="button"
            >
              <span>Color</span>
              <strong>
                <i className="color-dot" style={{ backgroundColor: selectedColor.hex }} />
                {selectedColor.label}
              </strong>
              <Icon>›</Icon>
            </button>
            <button
              className={`config-button ${errors.size ? 'has-error' : ''}`}
              onClick={(event) => openSheet('size', event.currentTarget)}
              type="button"
            >
              <span>Size</span>
              <strong>{size ?? 'Select'}</strong>
              <Icon>›</Icon>
            </button>
          </div>
          {errors.size ? (
            <p className="field-error" role="alert">
              {errors.size}
            </p>
          ) : null}

          <section className="prompt-section">
            <label htmlFor="shirt-prompt">What should we put on your shirt?</label>
            <div className={`composer ${errors.prompt ? 'has-error' : ''}`}>
              <textarea
                id="shirt-prompt"
                maxLength={280}
                onChange={(event) => {
                  setPrompt(event.target.value);
                  if (errors.prompt) setErrors((current) => ({ ...current, prompt: '' }));
                }}
                onKeyDown={handlePromptKeyDown}
                placeholder="A funny Viking drinking coffee..."
                rows={4}
                value={prompt}
              />
              <span>{prompt.length}/280</span>
            </div>
            {errors.prompt ? (
              <p className="field-error" role="alert">
                {errors.prompt}
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
            Create My Shirt <Icon>→</Icon>
          </button>
          {notice ? (
            <p className="completion-notice" role="status">
              {notice}
            </p>
          ) : null}
          <p className="reassurance">
            Free to create <span>·</span> Pay when you order
          </p>
        </div>
      </section>

      {drawerOpen ? <NavigationDrawer close={closeDrawer} closeRef={dialogCloseRef} /> : null}
      {sheet ? (
        <BottomSheet
          close={closeSheet}
          closeRef={dialogCloseRef}
          title={
            sheet === 'color'
              ? 'Choose a color'
              : sheet === 'size'
                ? 'Choose your size'
                : 'Size guide'
          }
        >
          {sheet === 'color' ? <ColorSheet color={color} chooseColor={chooseColor} /> : null}
          {sheet === 'size' ? (
            <SizeSheet
              color={color}
              chooseSize={chooseSize}
              openGuide={(trigger) => openSheet('guide', trigger)}
              unavailableSizes={unavailableSizes}
            />
          ) : null}
          {sheet === 'guide' ? <SizeGuide /> : null}
        </BottomSheet>
      ) : null}
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

function BottomSheet({
  children,
  close,
  closeRef,
  title,
}: {
  children: React.ReactNode;
  close: () => void;
  closeRef: React.RefObject<HTMLButtonElement | null>;
  title: string;
}) {
  return (
    <div
      className="overlay sheet-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section
        aria-labelledby="sheet-title"
        aria-modal="true"
        className="bottom-sheet"
        role="dialog"
      >
        <div className="sheet-handle" />
        <div className="sheet-header">
          <h2 id="sheet-title">{title}</h2>
          <button aria-label={`Close ${title}`} onClick={close} ref={closeRef} type="button">
            ×
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

function ColorSheet({
  chooseColor,
  color,
}: {
  chooseColor: (color: ColorId) => void;
  color: ColorId;
}) {
  return (
    <div className="color-list">
      {COLORS.map((item) => (
        <button
          aria-pressed={color === item.id}
          key={item.id}
          onClick={() => chooseColor(item.id)}
          type="button"
        >
          <i className="sheet-swatch" style={{ backgroundColor: item.hex }} />
          <span>{item.label}</span>
          <b>{color === item.id ? 'Selected' : ''}</b>
        </button>
      ))}
    </div>
  );
}

function SizeSheet({
  chooseSize,
  color,
  openGuide,
  unavailableSizes,
}: {
  chooseSize: (size: string) => void;
  color: ColorId;
  openGuide: (trigger: HTMLElement) => void;
  unavailableSizes: readonly string[];
}) {
  return (
    <>
      <p className="sheet-description">Choose the fit that feels right for you.</p>
      <div className="size-list">
        {SIZES.map((item) => (
          <button
            disabled={unavailableSizes.includes(item)}
            key={item}
            onClick={() => chooseSize(item)}
            type="button"
          >
            {item}
            {unavailableSizes.includes(item) ? (
              <small>Unavailable in {labelForColor(color)}</small>
            ) : null}
          </button>
        ))}
      </div>
      <button
        className="size-guide-link"
        onClick={(event) => openGuide(event.currentTarget)}
        type="button"
      >
        Size guide <Icon>›</Icon>
      </button>
    </>
  );
}

function SizeGuide() {
  return (
    <div className="size-guide">
      <p>Mock sizing for prototype review.</p>
      <div className="guide-table">
        <span>Size</span>
        <span>Chest</span>
        <span>Length</span>
        <span>S</span>
        <span>34–36 in</span>
        <span>28 in</span>
        <span>M</span>
        <span>38–40 in</span>
        <span>29 in</span>
        <span>L</span>
        <span>42–44 in</span>
        <span>30 in</span>
        <span>XL</span>
        <span>46–48 in</span>
        <span>31 in</span>
        <span>2XL</span>
        <span>50–52 in</span>
        <span>32 in</span>
      </div>
      <section>
        <h3>How to measure</h3>
        <p>
          Lay a shirt that fits you flat. Measure across the chest, then from the highest shoulder
          point to the hem.
        </p>
      </section>
    </div>
  );
}

function labelForColor(color: ColorId) {
  return COLORS.find((item) => item.id === color)?.label ?? color;
}
