'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';

const NEUTRAL_GARMENT_ASSET = '/garments/classic-tee-white.png';
const GARMENT_ASSETS = {
  black: '/garments/classic-tee-black.png',
  navy: '/garments/classic-tee-navy.png',
  white: NEUTRAL_GARMENT_ASSET,
} as const;
// Kept off-screen while the Look-recommendation direction is being revisited.
const SHOW_LOOK_RECOMMENDATION = false;
const STYLES = [
  { id: 'vintage-retro', name: 'Vintage & Retro', description: 'Bold & nostalgic', art: 'retro' },
  { id: 'illustrated', name: 'Illustrated', description: 'Hand-drawn feel', art: 'illustrated' },
  {
    id: 'streetwear-y2k',
    name: 'Streetwear & Y2K',
    description: 'Graphic energy',
    art: 'streetwear',
  },
  { id: 'typography', name: 'Typography', description: 'Words lead', art: 'typography' },
  {
    id: 'minimal-modern',
    name: 'Minimal & Modern',
    description: 'Quiet confidence',
    art: 'minimal',
  },
  {
    id: 'dark-alternative',
    name: 'Dark & Alternative',
    description: 'Moody & intense',
    art: 'dark',
  },
] as const;
const TONES = [
  {
    id: 'funny',
    name: 'Funny',
    hint: 'Playful and comedic.',
    art: 'funny',
    image: '/tone-icons/funny.png',
  },
  {
    id: 'sarcastic',
    name: 'Sarcastic',
    hint: 'Dry and ironic.',
    art: 'sarcastic',
    image: '/tone-icons/sarcastic.png',
  },
  {
    id: 'bold',
    name: 'Bold',
    hint: 'Confident and edgy.',
    art: 'bold',
    image: '/tone-icons/bold.png',
  },
  {
    id: 'cute',
    name: 'Cute',
    hint: 'Sweet and charming.',
    art: 'cute',
    image: '/tone-icons/cute.png',
  },
  {
    id: 'dark',
    name: 'Dark',
    hint: 'Mysterious and intense.',
    art: 'dark',
    image: '/tone-icons/dark.png',
  },
  {
    id: 'heartfelt',
    name: 'Heartfelt',
    hint: 'Warm and emotional.',
    art: 'heartfelt',
    image: '/tone-icons/heartfelt.png',
  },
  { id: 'auto', name: 'Auto', hint: 'We’ll infer it from your idea.', art: 'auto', image: null },
] as const;
type StyleId = (typeof STYLES)[number]['id'];
type ToneId = (typeof TONES)[number]['id'];
type ExplicitTone = Exclude<ToneId, 'auto'>;
type Look = { id: string; name: string };
type ColorId = 'black' | 'white' | 'navy' | 'forest' | 'burgundy' | 'sand' | 'heather' | 'red';
type SizeId = 's' | 'm' | 'l' | 'xl' | '2xl';
type ColorFixture = {
  id: ColorId;
  name: string;
  swatch: string;
  asset?: keyof typeof GARMENT_ASSETS;
};

const POPULAR_COLORS: ColorFixture[] = [
  { id: 'black', name: 'Black', swatch: '#191917', asset: 'black' },
  { id: 'white', name: 'White', swatch: '#f5f4ef', asset: 'white' },
  { id: 'navy', name: 'Navy', swatch: '#23334d', asset: 'navy' },
  { id: 'forest', name: 'Forest', swatch: '#294b3c' },
  { id: 'burgundy', name: 'Burgundy', swatch: '#6d2731' },
];
const MORE_COLORS: ColorFixture[] = [
  { id: 'sand', name: 'Sand', swatch: '#d7c6a7' },
  { id: 'heather', name: 'Heather', swatch: '#929397' },
  { id: 'red', name: 'Red', swatch: '#bb3430' },
];
const SIZES: { id: SizeId; name: string }[] = [
  { id: 's', name: 'S' },
  { id: 'm', name: 'M' },
  { id: 'l', name: 'L' },
  { id: 'xl', name: 'XL' },
  { id: '2xl', name: '2XL' },
];

const LOOKS: Record<StyleId, Look[]> = {
  'vintage-retro': [
    { id: '70s-retro', name: '70s Retro' },
    { id: '80s-90s-throwback', name: '80s/90s Throwback' },
    { id: 'heritage', name: 'Heritage' },
    { id: 'bootleg-distressed', name: 'Bootleg & Distressed' },
  ],
  illustrated: [
    { id: 'bold-cartoon', name: 'Bold Cartoon' },
    { id: 'hand-drawn', name: 'Hand Drawn' },
    { id: 'comic-manga', name: 'Comic / Manga' },
    { id: 'surreal-psychedelic', name: 'Surreal / Psychedelic' },
  ],
  'streetwear-y2k': [
    { id: 'cyber-y2k', name: 'Cyber Y2K' },
    { id: 'grunge-streetwear', name: 'Grunge Streetwear' },
    { id: 'racing-motorsport', name: 'Racing / Motorsport' },
    { id: 'pop-coquette-y2k', name: 'Pop / Coquette Y2K' },
  ],
  typography: [
    { id: 'bold-statement', name: 'Bold Statement' },
    { id: 'retro-type', name: 'Retro Type' },
    { id: 'hand-lettered', name: 'Hand Lettered' },
    { id: 'experimental-type', name: 'Experimental Type' },
  ],
  'minimal-modern': [
    { id: 'line-art', name: 'Line Art' },
    { id: 'geometric-bauhaus', name: 'Geometric / Bauhaus' },
    { id: 'minimal-symbol', name: 'Minimal Symbol' },
    { id: 'clean-type', name: 'Clean Type' },
  ],
  'dark-alternative': [
    { id: 'gothic-engraving', name: 'Gothic Engraving' },
    { id: 'tattoo-flash', name: 'Tattoo Flash' },
    { id: 'heavy-metal', name: 'Heavy Metal' },
    { id: 'dark-fantasy', name: 'Dark Fantasy' },
  ],
};
const TONE_LOOKS: Record<StyleId, Record<ExplicitTone, string>> = {
  'vintage-retro': {
    funny: '80s-90s-throwback',
    sarcastic: 'bootleg-distressed',
    bold: 'bootleg-distressed',
    cute: '70s-retro',
    dark: 'bootleg-distressed',
    heartfelt: 'heritage',
  },
  illustrated: {
    funny: 'bold-cartoon',
    sarcastic: 'bold-cartoon',
    bold: 'comic-manga',
    cute: 'hand-drawn',
    dark: 'surreal-psychedelic',
    heartfelt: 'hand-drawn',
  },
  'streetwear-y2k': {
    funny: 'pop-coquette-y2k',
    sarcastic: 'grunge-streetwear',
    bold: 'racing-motorsport',
    cute: 'pop-coquette-y2k',
    dark: 'grunge-streetwear',
    heartfelt: 'cyber-y2k',
  },
  typography: {
    funny: 'bold-statement',
    sarcastic: 'retro-type',
    bold: 'bold-statement',
    cute: 'hand-lettered',
    dark: 'experimental-type',
    heartfelt: 'hand-lettered',
  },
  'minimal-modern': {
    funny: 'minimal-symbol',
    sarcastic: 'clean-type',
    bold: 'geometric-bauhaus',
    cute: 'line-art',
    dark: 'geometric-bauhaus',
    heartfelt: 'line-art',
  },
  'dark-alternative': {
    funny: 'tattoo-flash',
    sarcastic: 'gothic-engraving',
    bold: 'heavy-metal',
    cute: 'dark-fantasy',
    dark: 'dark-fantasy',
    heartfelt: 'tattoo-flash',
  },
};
const AUTO_FALLBACK: Record<StyleId, string> = {
  'vintage-retro': 'heritage',
  illustrated: 'hand-drawn',
  'streetwear-y2k': 'cyber-y2k',
  typography: 'clean-type',
  'minimal-modern': 'minimal-symbol',
  'dark-alternative': 'gothic-engraving',
};
const AUTO_RULES: { tone: ExplicitTone; words: string[] }[] = [
  { tone: 'dark', words: ['dark', 'horror', 'metal', 'skull', 'night', 'goth', 'death'] },
  { tone: 'sarcastic', words: ['sarcastic', 'ironic', 'obviously', 'monday', 'office desk'] },
  { tone: 'funny', words: ['funny', 'joke', 'comedy', 'laugh', 'silly'] },
  { tone: 'heartfelt', words: ['love', 'family', 'tribute', 'memory', 'remember'] },
  { tone: 'cute', words: ['cute', 'sweet', 'pet', 'flower', 'puppy', 'kitten'] },
  { tone: 'bold', words: ['power', 'strong', 'racing', 'motor', 'street', 'fearless'] },
];

function Icon({ children }: { children: string }) {
  return <span aria-hidden="true">{children}</span>;
}
function ToneIcon({ tone }: { tone: ToneId }) {
  const lineProps = {
    fill: 'none',
    stroke: 'currentColor',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    strokeWidth: 1.8,
  };

  switch (tone) {
    case 'auto':
      return (
        <svg viewBox="0 0 24 24">
          <path d="m12 3 1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6z" {...lineProps} />
        </svg>
      );
    case 'funny':
      return (
        <svg viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="7.5" {...lineProps} />
          <path d="m8.5 9 2.2 1M15.5 9l-2.2 1M8.5 14c2.1 2 4.9 2 7 0" {...lineProps} />
        </svg>
      );
    case 'sarcastic':
      return (
        <svg viewBox="0 0 24 24">
          <path d="M5 6.5h14v9H10l-4 3v-3H5z" {...lineProps} />
          <path d="M9 10.2h.01M15 10.2h.01M9.5 13c1.4-1 3.4-1 4.8 0" {...lineProps} />
          <path d="m13.7 8.4 2.5-.7" {...lineProps} />
        </svg>
      );
    case 'bold':
      return (
        <svg viewBox="0 0 24 24">
          <path d="m13.5 2.8-8 11h5.8l-.8 7.4 8-11h-5.8z" {...lineProps} />
        </svg>
      );
    case 'cute':
      return (
        <svg viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="2.7" {...lineProps} />
          <path
            d="M12 4.5c2.2-2.8 5.6.6 3.4 3.4 2.8-2.2 6.2 1.2 3.4 3.4 2.8 2.2-.6 5.6-3.4 3.4 2.2 2.8-1.2 6.2-3.4 3.4-2.2 2.8-5.6-.6-3.4-3.4-2.8 2.2-6.2-1.2-3.4-3.4-2.8-2.2.6-5.6 3.4-3.4-2.2-2.8 1.2-6.2 3.4-3.4Z"
            {...lineProps}
          />
        </svg>
      );
    case 'dark':
      return (
        <svg viewBox="0 0 24 24">
          <path d="M18.5 15.7A7.5 7.5 0 0 1 8.3 5.5a7.5 7.5 0 1 0 10.2 10.2Z" {...lineProps} />
          <path d="m18 5 .5 1.1 1.1.5-1.1.5L18 8.2l-.5-1.1-1.1-.5 1.1-.5z" {...lineProps} />
        </svg>
      );
    case 'heartfelt':
      return (
        <svg viewBox="0 0 24 24">
          <path
            d="M12 19.5 5.8 13.8A4.1 4.1 0 0 1 11.5 8L12 8.7l.5-.7a4.1 4.1 0 0 1 5.7 5.8z"
            {...lineProps}
          />
          <path
            d="m5 5 .5 1.1 1.1.5-1.1.5L5 8.2l-.5-1.1-1.1-.5 1.1-.5zM19 15l.4.8.8.4-.8.4-.4.8-.4-.8-.8-.4.8-.4z"
            {...lineProps}
          />
        </svg>
      );
  }
}
function inferredTone(prompt: string) {
  const text = prompt.toLowerCase();
  return AUTO_RULES.find((rule) => rule.words.some((word) => text.includes(word)))?.tone;
}
function recommendedLook(style: StyleId, tone: ToneId, prompt: string) {
  const semanticTone = tone === 'auto' ? inferredTone(prompt) : tone;
  return semanticTone ? TONE_LOOKS[style][semanticTone] : AUTO_FALLBACK[style];
}
function findLook(style: StyleId, id: string): Look {
  return LOOKS[style].find((look) => look.id === id) ?? LOOKS[style][0]!;
}

export function CreateExperience() {
  const [step, setStep] = useState<'idea' | 'style' | 'product' | 'boundary'>('idea');
  const [prompt, setPrompt] = useState('');
  const [reference, setReference] = useState<{ name: string; url: string } | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [promptError, setPromptError] = useState('');
  const [styleError, setStyleError] = useState('');
  const [style, setStyle] = useState<StyleId | null>(null);
  const [tone, setTone] = useState<ToneId>('auto');
  const [manualLook, setManualLook] = useState<string | null>(null);
  const [lookPickerOpen, setLookPickerOpen] = useState(false);
  const [color, setColor] = useState<ColorId>('black');
  const [size, setSize] = useState<SizeId | null>(null);
  const [selectionSheet, setSelectionSheet] = useState<'color' | 'size' | null>(null);
  const [productInfoOpen, setProductInfoOpen] = useState(false);
  const [sizeError, setSizeError] = useState('');
  const [availabilityMessage, setAvailabilityMessage] = useState('');
  const triggerRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const toneSectionRef = useRef<HTMLElement | null>(null);
  const productInfoRef = useRef<HTMLDivElement | null>(null);
  const recommendation = useMemo(
    () => (style ? recommendedLook(style, tone, prompt) : null),
    [style, tone, prompt],
  );
  const effectiveLook =
    style && recommendation ? findLook(style, manualLook ?? recommendation) : null;
  const selectedColor = [...POPULAR_COLORS, ...MORE_COLORS].find((item) => item.id === color)!;
  const garmentAsset = selectedColor.asset
    ? GARMENT_ASSETS[selectedColor.asset]
    : GARMENT_ASSETS.white;
  const unavailableSize = (candidate: SizeId) => color === 'navy' && candidate === 'm';

  useEffect(
    () => () => {
      if (reference) URL.revokeObjectURL(reference.url);
    },
    [reference],
  );
  useEffect(() => {
    if (!drawerOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [drawerOpen]);
  useEffect(() => {
    if (!selectionSheet) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [selectionSheet]);
  useEffect(() => {
    window.requestAnimationFrame(() => window.scrollTo({ top: 0 }));
    setProductInfoOpen(false);
  }, [step]);
  useEffect(() => {
    if (!productInfoOpen) return;
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setProductInfoOpen(false);
    };
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !productInfoRef.current?.contains(event.target)) {
        setProductInfoOpen(false);
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => {
      window.removeEventListener('keydown', closeOnEscape);
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
    };
  }, [productInfoOpen]);
  const openMenu = (element: HTMLButtonElement) => {
    triggerRef.current = element;
    setDrawerOpen(true);
  };
  const closeDrawer = () => {
    setDrawerOpen(false);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  };
  const chooseStyle = (id: StyleId) => {
    setStyle(id);
    setManualLook(null);
    setLookPickerOpen(false);
    setStyleError('');
    window.requestAnimationFrame(() => {
      toneSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };
  const chooseTone = (id: ToneId) => {
    setTone(id);
  };
  const submitIdea = () => {
    if (!prompt.trim()) {
      setPromptError('Tell us what you’d like on your shirt to continue.');
      return;
    }
    setPromptError('');
    setStep('style');
  };
  const submitStyle = () => {
    if (!style) {
      setStyleError('Choose a style to continue.');
      return;
    }
    setStyleError('');
    setStep('product');
  };
  const chooseColor = (id: ColorId) => {
    setColor(id);
    setSelectionSheet(null);
    setAvailabilityMessage('');
    if (id === 'navy' && size === 'm') {
      setSize(null);
      setAvailabilityMessage('M isn’t available in Navy. Choose another size.');
    }
  };
  const chooseSize = (id: SizeId) => {
    if (unavailableSize(id)) return;
    setSize(id);
    setSelectionSheet(null);
    setSizeError('');
    setAvailabilityMessage('');
  };
  const submitProduct = () => {
    if (!size) {
      setSizeError('Choose your size to continue.');
      return;
    }
    setSizeError('');
    setStep('boundary');
  };
  const changeReference = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (reference) URL.revokeObjectURL(reference.url);
    setReference({ name: file.name, url: URL.createObjectURL(file) });
    event.target.value = '';
  };

  return (
    <main className="prototype theme-a composer-fade">
      <section className="phone-stage composition-canvas">
        <header className="menu-header menu-header-brand">
          <span className="menu-wordmark">LET IT BE</span>
          <button
            aria-label="Open menu"
            onClick={(event) => openMenu(event.currentTarget)}
            type="button"
          >
            <Icon>☰</Icon>
          </button>
        </header>
        {step === 'idea' ? (
          <div className="create-flow">
            <section className="intro" aria-labelledby="create-heading">
              <h1 id="create-heading">
                Turn your idea into
                <br />a shirt worth wearing.
              </h1>
              <p>Describe what you want. We’ll handle the rest.</p>
            </section>
            <section className="garment-section" aria-label="Garment preview">
              <div className="garment-stage">
                <img alt="Blank Classic T-Shirt" src={NEUTRAL_GARMENT_ASSET} />
              </div>
            </section>
            <section className="prompt-section">
              <label className="sr-only" htmlFor="shirt-prompt">
                What should we put on your shirt?
              </label>
              <div className={`composer ${promptError ? 'has-error' : ''}`}>
                <textarea
                  aria-describedby={promptError ? 'shirt-prompt-error' : undefined}
                  aria-invalid={Boolean(promptError)}
                  id="shirt-prompt"
                  maxLength={280}
                  onChange={(event) => {
                    setPrompt(event.target.value);
                    if (promptError) setPromptError('');
                  }}
                  onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
                    if (event.key === 'Escape') event.currentTarget.blur();
                  }}
                  placeholder="Describe your idea..."
                  rows={4}
                  value={prompt}
                />
                <span>{prompt.length}/280</span>
              </div>
              {promptError ? (
                <p className="field-error prompt-error" id="shirt-prompt-error" role="alert">
                  <span aria-hidden="true" className="error-icon">
                    !
                  </span>
                  <span>{promptError}</span>
                </p>
              ) : null}
            </section>
            <section className="reference-section" aria-label="Optional reference image">
              {reference ? (
                <div className="reference-preview">
                  <img alt="Selected reference preview" src={reference.url} />
                  <div>
                    <strong>{reference.name}</strong>
                    <button
                      onClick={() => {
                        URL.revokeObjectURL(reference.url);
                        setReference(null);
                      }}
                      type="button"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ) : (
                <label className="reference-picker">
                  <input accept="image/*" onChange={changeReference} type="file" />
                  <span>
                    <b>+</b> Add a reference image
                  </span>
                  <small>Optional</small>
                </label>
              )}
            </section>
            <button className="create-button" onClick={submitIdea} type="button">
              Choose a Style <Icon>→</Icon>
            </button>
            <div className="creation-meta">
              <span className="credit-copy">1 credit available</span>
              <p className="reassurance">
                Free to create <span>·</span> Pay when you order
              </p>
            </div>
          </div>
        ) : step === 'style' ? (
          <div className="style-flow">
            <section className="style-intro" aria-labelledby="style-heading">
              <h1 id="style-heading">Choose the vibe.</h1>
            </section>
            <section aria-labelledby="style-heading-label">
              <h2 className="step-section-heading" id="style-heading-label">
                Choose a style
              </h2>
              <div className="style-family-grid" role="group" aria-label="Choose a style">
                {STYLES.map((item) => (
                  <button
                    aria-pressed={style === item.id}
                    className={`style-family-card ${style === item.id ? 'is-selected' : ''}`}
                    key={item.id}
                    onClick={() => chooseStyle(item.id)}
                    type="button"
                  >
                    <span aria-hidden="true" className={`style-art style-art-${item.art}`} />
                    <strong>{item.name}</strong>
                    <small>{item.description}</small>
                  </button>
                ))}
              </div>
              {styleError ? (
                <p className="field-error style-error" role="alert">
                  {styleError}
                </p>
              ) : null}
            </section>
            <section aria-labelledby="tone-heading" className="tone-section" ref={toneSectionRef}>
              <h2 className="step-section-heading" id="tone-heading">
                Set the tone
              </h2>
              <div className="tone-grid" role="group" aria-label="Set the tone">
                {TONES.map((item) => (
                  <button
                    aria-pressed={tone === item.id}
                    className={`tone-card tone-card-${item.art} ${tone === item.id ? 'is-selected' : ''}`}
                    key={item.id}
                    onClick={() => chooseTone(item.id)}
                    title={item.hint}
                    type="button"
                  >
                    <span
                      aria-hidden="true"
                      className={`tone-art ${item.image ? 'is-illustrated' : ''}`}
                    >
                      {item.image ? <img alt="" src={item.image} /> : <ToneIcon tone={item.id} />}
                    </span>
                    <span>
                      <strong>{item.name}</strong>
                      <small>{item.hint}</small>
                    </span>
                  </button>
                ))}
              </div>
            </section>
            {SHOW_LOOK_RECOMMENDATION ? (
              style && recommendation && effectiveLook ? (
                <section className="look-section" aria-label="Recommended look">
                  <div className={`look-recommendation ${manualLook ? 'is-manual' : ''}`}>
                    <p>{manualLook ? 'Your look' : 'AI-picked look'}</p>
                    <strong>{effectiveLook.name}</strong>
                    <span>
                      {manualLook ? 'Chosen by you.' : 'We think this fits your idea best.'}
                    </span>
                    <button onClick={() => setLookPickerOpen((open) => !open)} type="button">
                      {lookPickerOpen ? 'Close' : manualLook ? 'Change' : 'Change look'}{' '}
                      <Icon>→</Icon>
                    </button>
                  </div>
                  {lookPickerOpen ? (
                    <div className="look-picker">
                      <div>
                        <h2>Choose a look</h2>
                        <p>Optional — the recommendation stays selected unless you change it.</p>
                      </div>
                      <button
                        aria-pressed={!manualLook}
                        className={`look-choice ai-choice ${!manualLook ? 'is-selected' : ''}`}
                        onClick={() => {
                          setManualLook(null);
                          setLookPickerOpen(false);
                        }}
                        type="button"
                      >
                        <strong>Let AI choose</strong>
                        <small>Recommended</small>
                      </button>
                      <div className="look-choice-grid">
                        {LOOKS[style].map((look) => (
                          <button
                            aria-pressed={manualLook === look.id}
                            className={`look-choice ${manualLook === look.id ? 'is-selected' : ''}`}
                            key={look.id}
                            onClick={() => {
                              setManualLook(look.id);
                              setLookPickerOpen(false);
                            }}
                            type="button"
                          >
                            {look.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </section>
              ) : (
                <section className="look-section look-pending">
                  <p>AI-picked look</p>
                  <span>Choose a style to see a recommendation.</span>
                </section>
              )
            ) : null}
            <div className="step-actions">
              <button className="step-back" onClick={() => setStep('idea')} type="button">
                ← Back to idea
              </button>
              <button className="create-button" onClick={submitStyle} type="button">
                Continue to color &amp; size <Icon>→</Icon>
              </button>
            </div>
          </div>
        ) : step === 'product' ? (
          <div className="product-flow">
            <section className="product-intro" aria-labelledby="product-heading">
              <h1 id="product-heading">Choose color &amp; size.</h1>
            </section>
            <section
              className="product-garment"
              aria-label={`${selectedColor.name} Classic T-Shirt preview`}
            >
              <div className={`product-garment-stage garment-color-${color}`}>
                <img alt={`${selectedColor.name} Classic T-Shirt`} src={garmentAsset} />
              </div>
              <div className="product-meta-row">
                <div className="product-name-with-info" ref={productInfoRef}>
                  <strong>Classic T-Shirt</strong>
                  <button
                    aria-controls="classic-tee-info"
                    aria-expanded={productInfoOpen}
                    aria-label="About the Classic T-Shirt"
                    className="product-info-trigger"
                    onClick={() => setProductInfoOpen((open) => !open)}
                    type="button"
                  >
                    !
                  </button>
                  {productInfoOpen ? (
                    <section
                      aria-label="Classic T-Shirt information"
                      className="product-info-bubble"
                      id="classic-tee-info"
                      role="dialog"
                    >
                      <strong>Classic T-Shirt</strong>
                      <p>Soft midweight cotton, a regular unisex fit, and a print-ready surface.</p>
                      <small>Final availability can vary by color and size.</small>
                    </section>
                  ) : null}
                </div>
                <span>from $39.99</span>
              </div>
            </section>
            <section className="product-selection-cards" aria-label="Product configuration">
              <button
                aria-haspopup="dialog"
                className="selection-card"
                onClick={() => setSelectionSheet('color')}
                type="button"
              >
                <span className="selection-card-label">Color</span>
                <span className="selection-card-value">
                  <i
                    aria-hidden="true"
                    className="selection-card-swatch"
                    style={{ background: selectedColor.swatch }}
                  />
                  {selectedColor.name} <Icon>›</Icon>
                </span>
              </button>
              <button
                aria-haspopup="dialog"
                className="selection-card"
                onClick={() => setSelectionSheet('size')}
                type="button"
              >
                <span className="selection-card-label">Size</span>
                <span className={`selection-card-value ${size ? '' : 'is-empty'}`}>
                  {size ? SIZES.find((item) => item.id === size)?.name : 'Select size'}{' '}
                  <Icon>›</Icon>
                </span>
              </button>
            </section>
            {availabilityMessage ? (
              <p className="availability-message" role="alert">
                {availabilityMessage}
              </p>
            ) : null}
            {sizeError ? (
              <p className="field-error size-error" role="alert">
                {sizeError}
              </p>
            ) : null}
            <div className="step-actions product-actions">
              <button className="step-back" onClick={() => setStep('style')} type="button">
                ← Back to style
              </button>
              <button className="create-button" onClick={submitProduct} type="button">
                Create My Shirt <Icon>✦</Icon>
              </button>
            </div>
            <p className="reassurance product-reassurance">
              Free to create <span>·</span> Pay when you order
            </p>
          </div>
        ) : (
          <div className="boundary-flow">
            <p className="eyebrow">Your choices are ready</p>
            <h1>Generation is coming next.</h1>
            <p>This is a local prototype boundary. Nothing has been generated yet.</p>
            <button className="create-button" onClick={() => setStep('product')} type="button">
              Back to color &amp; size <Icon>←</Icon>
            </button>
          </div>
        )}
      </section>
      {drawerOpen ? <NavigationDrawer close={closeDrawer} closeRef={closeRef} /> : null}
      {selectionSheet === 'color' ? (
        <ColorSelectionSheet
          color={color}
          close={() => setSelectionSheet(null)}
          chooseColor={chooseColor}
        />
      ) : null}
      {selectionSheet === 'size' ? (
        <SizeSelectionSheet
          close={() => setSelectionSheet(null)}
          size={size}
          unavailableSize={unavailableSize}
          chooseSize={chooseSize}
        />
      ) : null}
    </main>
  );
}

function ColorSelectionSheet({
  color,
  chooseColor,
  close,
}: {
  color: ColorId;
  chooseColor: (id: ColorId) => void;
  close: () => void;
}) {
  const colors = [...POPULAR_COLORS, ...MORE_COLORS];
  const [expanded, setExpanded] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragStartY = useRef<number | null>(null);
  const movedDuringDrag = useRef(false);

  const releaseHandle = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (dragStartY.current === null) return;
    const distance = event.clientY - dragStartY.current;
    dragStartY.current = null;
    setDragging(false);
    setDragOffset(0);
    if (distance <= -48) {
      setExpanded(true);
    } else if (distance >= 132) {
      close();
    } else if (distance >= 48 && expanded) {
      setExpanded(false);
    }
  };

  return (
    <div
      className="overlay sheet-overlay"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && close()}
    >
      <section
        aria-labelledby="color-sheet-title"
        aria-modal="true"
        className={`bottom-sheet draggable-sheet ${expanded ? 'is-expanded' : ''} ${
          dragging ? 'is-dragging' : ''
        }`}
        role="dialog"
        style={{ transform: `translateY(${dragOffset}px)` }}
      >
        <button
          aria-label={expanded ? 'Collapse color selection' : 'Expand color selection'}
          className="sheet-handle"
          onClick={() => {
            if (movedDuringDrag.current) {
              movedDuringDrag.current = false;
              return;
            }
            setExpanded((value) => !value);
          }}
          onPointerCancel={releaseHandle}
          onPointerDown={(event) => {
            dragStartY.current = event.clientY;
            movedDuringDrag.current = false;
            setDragging(true);
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (dragStartY.current === null) return;
            const distance = event.clientY - dragStartY.current;
            if (Math.abs(distance) > 6) movedDuringDrag.current = true;
            setDragOffset(Math.max(0, distance));
          }}
          onPointerUp={releaseHandle}
          type="button"
        >
          <span aria-hidden="true" />
        </button>
        <div className="sheet-header">
          <h2 id="color-sheet-title">Choose a color</h2>
          <button aria-label="Close color selection" onClick={close} type="button">
            ×
          </button>
        </div>
        <div className="color-list" role="group" aria-label="Choose a color">
          {colors.map((item) => (
            <button
              aria-pressed={color === item.id}
              key={item.id}
              onClick={() => chooseColor(item.id)}
              type="button"
            >
              <i aria-hidden="true" className="sheet-swatch" style={{ background: item.swatch }} />
              <span>{item.name}</span>
              {color === item.id ? <b>Selected</b> : null}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function SizeSelectionSheet({
  size,
  chooseSize,
  unavailableSize,
  close,
}: {
  size: SizeId | null;
  chooseSize: (id: SizeId) => void;
  unavailableSize: (id: SizeId) => boolean;
  close: () => void;
}) {
  return (
    <div
      className="overlay sheet-overlay"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && close()}
    >
      <section
        aria-labelledby="size-sheet-title"
        aria-modal="true"
        className="bottom-sheet"
        role="dialog"
      >
        <div className="sheet-handle" />
        <div className="sheet-header">
          <h2 id="size-sheet-title">Choose your size</h2>
          <button aria-label="Close size selection" onClick={close} type="button">
            ×
          </button>
        </div>
        <div className="size-list" role="group" aria-label="Choose a size">
          {SIZES.map((item) => {
            const unavailable = unavailableSize(item.id);
            return (
              <button
                aria-pressed={size === item.id}
                disabled={unavailable}
                key={item.id}
                onClick={() => chooseSize(item.id)}
                type="button"
              >
                {item.name}
                {unavailable ? <small>Unavailable</small> : null}
              </button>
            );
          })}
        </div>
      </section>
    </div>
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
