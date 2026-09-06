'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ChangeEvent,
  KeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from 'react';

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
type ColorId =
  | 'black'
  | 'white'
  | 'navy'
  | 'forest'
  | 'burgundy'
  | 'sand'
  | 'heather'
  | 'red'
  | 'sage'
  | 'sky'
  | 'rose'
  | 'lavender'
  | 'mustard'
  | 'teal'
  | 'orange'
  | 'chocolate';
type SizeId = 'xs' | 's' | 'm' | 'l' | 'xl' | '2xl' | '3xl';
type EditorTransform = {
  x: number;
  y: number;
  scale: number;
  rotation: number;
};
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
  // Additional prototype fixtures for reviewing the expanded color grid.
  { id: 'sage', name: 'Sage', swatch: '#a3b598' },
  { id: 'sky', name: 'Sky', swatch: '#a0bdd7' },
  { id: 'rose', name: 'Rose', swatch: '#dab0b9' },
  { id: 'lavender', name: 'Lavender', swatch: '#b9acd3' },
  { id: 'mustard', name: 'Mustard', swatch: '#c99b31' },
  { id: 'teal', name: 'Teal', swatch: '#287778' },
  { id: 'orange', name: 'Orange', swatch: '#dc7137' },
  { id: 'chocolate', name: 'Chocolate', swatch: '#614238' },
];
const SIZES: { id: SizeId; name: string; label: string }[] = [
  { id: 'xs', name: 'XS', label: 'X-Small · XS' },
  { id: 's', name: 'S', label: 'Small · S' },
  { id: 'm', name: 'M', label: 'Medium · M' },
  { id: 'l', name: 'L', label: 'Large · L' },
  { id: 'xl', name: 'XL', label: 'X-Large · XL' },
  { id: '2xl', name: '2XL', label: '2X-Large · 2XL' },
  { id: '3xl', name: '3XL', label: '3X-Large · 3XL' },
];
const BASE_PRICE_CENTS = 3999;
// Replace these prototype-only fixtures when the final large-size pricing is approved.
const SIZE_SURCHARGE_CENTS: Record<SizeId, number> = {
  xs: 0,
  s: 0,
  m: 0,
  l: 0,
  xl: 0,
  '2xl': 300,
  '3xl': 500,
};
const RETRY_CREDIT_COST = 1;
const PROTOTYPE_CREDIT_PACK_SIZE = 3;
const DEFAULT_EDITOR_TRANSFORM: EditorTransform = {
  x: 50,
  y: 50,
  scale: 1,
  rotation: 0,
};
const USD_FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

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
function artworkCopy(prompt: string) {
  return prompt
    .replace(/[^a-zA-Z0-9À-ž\s]/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 5)
    .join(' ');
}
function shirtPrice(size: SizeId | null) {
  const surcharge = size ? SIZE_SURCHARGE_CENTS[size] : 0;
  return USD_FORMATTER.format((BASE_PRICE_CENTS + surcharge) / 100);
}
function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

export function CreateExperience() {
  const [step, setStep] = useState<'idea' | 'style' | 'product' | 'generate' | 'editor'>('idea');
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
  const [selectionSheet, setSelectionSheet] = useState<'color' | 'size' | 'credits' | null>(null);
  const [productInfoOpen, setProductInfoOpen] = useState(false);
  const [generationStatus, setGenerationStatus] = useState<'idle' | 'creating' | 'ready'>('idle');
  const [generationVersion, setGenerationVersion] = useState(0);
  const [generatedCreativeSignature, setGeneratedCreativeSignature] = useState<string | null>(null);
  const [appliedProduct, setAppliedProduct] = useState<{
    color: ColorId;
    size: SizeId;
  } | null>(null);
  const [previewUpdating, setPreviewUpdating] = useState(false);
  const [credits, setCredits] = useState(1);
  const [editorTransform, setEditorTransform] = useState<EditorTransform>(DEFAULT_EDITOR_TRANSFORM);
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
  const creativeSignature = [
    prompt.trim(),
    reference?.url ?? '',
    style ?? '',
    tone,
    effectiveLook?.id ?? '',
  ].join('|');
  const hasGeneratedDesign = generatedCreativeSignature !== null;
  const creativeInputsChanged =
    hasGeneratedDesign && generatedCreativeSignature !== creativeSignature;
  const productConfigurationChanged = Boolean(
    appliedProduct && (appliedProduct.color !== color || appliedProduct.size !== size),
  );
  const productActionLabel = !hasGeneratedDesign
    ? 'Create My Shirt'
    : creativeInputsChanged
      ? 'Regenerate design'
      : productConfigurationChanged
        ? 'Apply changes'
        : 'Back to preview';
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
    const scrollY = window.scrollY;
    const previousStyle = document.body.getAttribute('style');
    Object.assign(document.body.style, {
      position: 'fixed',
      top: `-${scrollY}px`,
      width: '100%',
      overflow: 'hidden',
    });
    return () => {
      if (previousStyle === null) document.body.removeAttribute('style');
      else document.body.setAttribute('style', previousStyle);
      window.scrollTo({ top: scrollY, behavior: 'instant' });
    };
  }, [selectionSheet]);
  useEffect(() => {
    window.requestAnimationFrame(() => window.scrollTo({ top: 0 }));
    setProductInfoOpen(false);
  }, [step]);
  useEffect(() => {
    if (step !== 'generate' || generationStatus !== 'creating') return;
    const timer = window.setTimeout(() => setGenerationStatus('ready'), 1900);
    return () => window.clearTimeout(timer);
  }, [generationStatus, generationVersion, step]);
  useEffect(() => {
    if (!previewUpdating) return;
    const timer = window.setTimeout(() => setPreviewUpdating(false), 650);
    return () => window.clearTimeout(timer);
  }, [previewUpdating]);
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
    const nextProduct = { color, size };
    const requiresGeneration =
      generatedCreativeSignature === null || generatedCreativeSignature !== creativeSignature;

    setAppliedProduct(nextProduct);
    if (!requiresGeneration) {
      setGenerationStatus('ready');
      setPreviewUpdating(productConfigurationChanged);
      setStep('generate');
      return;
    }

    if (generatedCreativeSignature !== null) {
      setGenerationVersion((version) => version + 1);
    }
    setEditorTransform(DEFAULT_EDITOR_TRANSFORM);
    setGeneratedCreativeSignature(creativeSignature);
    setPreviewUpdating(false);
    setGenerationStatus('creating');
    setStep('generate');
  };
  const regenerate = () => {
    if (credits < RETRY_CREDIT_COST) {
      setSelectionSheet('credits');
      return;
    }
    setCredits((balance) => balance - RETRY_CREDIT_COST);
    setPreviewUpdating(false);
    setEditorTransform(DEFAULT_EDITOR_TRANSFORM);
    setGeneratedCreativeSignature(creativeSignature);
    if (size) setAppliedProduct({ color, size });
    setGenerationVersion((version) => version + 1);
    setGenerationStatus('creating');
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
                <span aria-live="polite">
                  {size ? shirtPrice(size) : `from ${shirtPrice(null)}`}
                </span>
              </div>
            </section>
            <section className="product-selection-cards" aria-label="Product configuration">
              <button
                aria-expanded={selectionSheet === 'color'}
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
                  {selectedColor.name} <i aria-hidden="true" className="selection-card-chevron" />
                </span>
              </button>
              <button
                aria-expanded={selectionSheet === 'size'}
                aria-haspopup="dialog"
                aria-invalid={Boolean(sizeError || availabilityMessage)}
                className="selection-card"
                onClick={() => setSelectionSheet('size')}
                type="button"
              >
                <span className="selection-card-label">Size</span>
                <span className={`selection-card-value ${size ? '' : 'is-empty'}`}>
                  {size ? SIZES.find((item) => item.id === size)?.name : 'Select size'}
                  <i aria-hidden="true" className="selection-card-chevron" />
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
                {productActionLabel}{' '}
                <Icon>{!hasGeneratedDesign || creativeInputsChanged ? '✦' : '→'}</Icon>
              </button>
            </div>
            <p className="reassurance product-reassurance">
              Free to create <span>·</span> Pay when you order
            </p>
          </div>
        ) : step === 'generate' ? (
          <GenerateStep
            color={color}
            garmentAsset={garmentAsset}
            generationStatus={generationStatus}
            generationVersion={generationVersion}
            previewUpdating={previewUpdating}
            prompt={prompt}
            credits={credits}
            size={size}
            style={style}
            tone={tone}
            back={() => {
              setPreviewUpdating(false);
              setStep('product');
            }}
            openEditor={() => {
              setPreviewUpdating(false);
              setStep('editor');
            }}
            regenerate={regenerate}
          />
        ) : (
          <EditorStep
            color={color}
            garmentAsset={garmentAsset}
            generationVersion={generationVersion}
            prompt={prompt}
            size={size}
            style={style}
            tone={tone}
            transform={editorTransform}
            onBack={() => setStep('generate')}
            onReset={() => setEditorTransform(DEFAULT_EDITOR_TRANSFORM)}
            onTransformChange={setEditorTransform}
          />
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
      {selectionSheet === 'credits' ? (
        <CreditPurchaseSheet
          close={() => setSelectionSheet(null)}
          purchase={() => {
            setCredits((balance) => balance + PROTOTYPE_CREDIT_PACK_SIZE);
            setSelectionSheet(null);
          }}
        />
      ) : null}
    </main>
  );
}

function GenerateStep({
  color,
  credits,
  garmentAsset,
  generationStatus,
  generationVersion,
  previewUpdating,
  prompt,
  size,
  style,
  tone,
  back,
  openEditor,
  regenerate,
}: {
  color: ColorId;
  credits: number;
  garmentAsset: string;
  generationStatus: 'idle' | 'creating' | 'ready';
  generationVersion: number;
  previewUpdating: boolean;
  prompt: string;
  size: SizeId | null;
  style: StyleId | null;
  tone: ToneId;
  back: () => void;
  openEditor: () => void;
  regenerate: () => void;
}) {
  const selectedColor = [...POPULAR_COLORS, ...MORE_COLORS].find((item) => item.id === color)!;
  const selectedSize = SIZES.find((item) => item.id === size);
  const isCreating = generationStatus !== 'ready';

  if (isCreating) {
    return (
      <div className="generation-flow generation-loading" aria-live="polite">
        <div className={`generation-garment-stage garment-color-${color}`} aria-hidden="true">
          <img alt="" src={garmentAsset} />
          <span className="generation-scan" />
        </div>
        <section className="generation-copy">
          <p className="eyebrow">Creating your design</p>
          <h1>Making it yours…</h1>
          <p>Combining your idea, style, and shirt color.</p>
          <div
            aria-label="Generating shirt preview"
            aria-valuemax={100}
            aria-valuemin={0}
            className="generation-progress"
            role="progressbar"
          >
            <span />
          </div>
        </section>
      </div>
    );
  }

  return (
    <div
      className={`generation-flow generation-result ${previewUpdating ? 'is-preview-updating' : ''}`}
    >
      <section className="result-intro">
        <p className="eyebrow">Ready to review</p>
        <h1>Your shirt is ready.</h1>
        <p>A first version made from your idea.</p>
      </section>
      <section
        aria-label={`${selectedColor.name} Classic T-Shirt with generated artwork`}
        className={`generation-garment-stage result-garment-stage garment-color-${color}`}
      >
        <div className="result-garment-zoom">
          <img alt={`${selectedColor.name} Classic T-Shirt preview`} src={garmentAsset} />
          <GeneratedArtwork prompt={prompt} style={style} tone={tone} version={generationVersion} />
        </div>
        {previewUpdating ? (
          <span className="preview-update-indicator" role="status">
            Updating preview…
          </span>
        ) : null}
      </section>
      <section className="generation-summary" aria-label="Generated shirt choices">
        <div>
          <strong>Classic T-Shirt</strong>
          <span>{shirtPrice(size)}</span>
        </div>
        <p>
          {selectedColor.name} <span>·</span> {selectedSize?.name ?? 'Size'}
        </p>
      </section>
      <div className="generation-actions">
        <button className="create-button" onClick={openEditor} type="button">
          Continue to editor <Icon>→</Icon>
        </button>
        <div className="generation-secondary-actions">
          <button className="regenerate-button" onClick={regenerate} type="button">
            {credits >= RETRY_CREDIT_COST ? (
              <>
                <span className="regenerate-label">↻ Try another version</span>
                <span className="regenerate-cost">{RETRY_CREDIT_COST} credit</span>
              </>
            ) : (
              'Buy credits to try again'
            )}
          </button>
          <span aria-hidden="true">|</span>
          <button className="generation-back" onClick={back} type="button">
            ← Back to color &amp; size
          </button>
        </div>
      </div>
    </div>
  );
}

function EditorStep({
  color,
  garmentAsset,
  generationVersion,
  prompt,
  size,
  style,
  tone,
  transform,
  onBack,
  onReset,
  onTransformChange,
}: {
  color: ColorId;
  garmentAsset: string;
  generationVersion: number;
  prompt: string;
  size: SizeId | null;
  style: StyleId | null;
  tone: ToneId;
  transform: EditorTransform;
  onBack: () => void;
  onReset: () => void;
  onTransformChange: (transform: EditorTransform) => void;
}) {
  const printAreaRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    clientX: number;
    clientY: number;
    pointerId: number;
    transform: EditorTransform;
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [saveNotice, setSaveNotice] = useState(false);
  const [editorStatus, setEditorStatus] = useState('');
  const selectedColor = [...POPULAR_COLORS, ...MORE_COLORS].find((item) => item.id === color)!;
  const selectedSize = SIZES.find((item) => item.id === size);

  const changeScale = (amount: number) => {
    const scale = clamp(Number((transform.scale + amount).toFixed(2)), 0.7, 1.4);
    onTransformChange({ ...transform, scale });
    setEditorStatus(`Design size ${Math.round(scale * 100)} percent.`);
  };
  const changeRotation = (amount: number) => {
    const rotation = clamp(transform.rotation + amount, -30, 30);
    onTransformChange({ ...transform, rotation });
    setEditorStatus(`Design rotation ${rotation} degrees.`);
  };
  const resetPlacement = () => {
    onReset();
    setSaveNotice(false);
    setEditorStatus('Design placement reset.');
  };
  const finishDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setIsDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setEditorStatus('Design placement updated.');
  };
  const nudgeDesign = (event: KeyboardEvent<HTMLButtonElement>) => {
    const distance = event.shiftKey ? 8 : 4;
    let nextTransform: EditorTransform | null = null;
    switch (event.key) {
      case 'ArrowLeft':
        nextTransform = { ...transform, x: clamp(transform.x - distance, 12, 88) };
        break;
      case 'ArrowRight':
        nextTransform = { ...transform, x: clamp(transform.x + distance, 12, 88) };
        break;
      case 'ArrowUp':
        nextTransform = { ...transform, y: clamp(transform.y - distance, 12, 88) };
        break;
      case 'ArrowDown':
        nextTransform = { ...transform, y: clamp(transform.y + distance, 12, 88) };
        break;
      case '+':
      case '=':
        nextTransform = {
          ...transform,
          scale: clamp(Number((transform.scale + 0.1).toFixed(2)), 0.7, 1.4),
        };
        break;
      case '-':
        nextTransform = {
          ...transform,
          scale: clamp(Number((transform.scale - 0.1).toFixed(2)), 0.7, 1.4),
        };
        break;
      case 'r':
      case 'R':
        event.preventDefault();
        resetPlacement();
        return;
      default:
        return;
    }
    event.preventDefault();
    onTransformChange(nextTransform);
    setEditorStatus('Design placement updated.');
  };

  return (
    <div className="editor-flow">
      <section className="editor-intro" aria-labelledby="editor-heading">
        <p className="eyebrow">Make it yours</p>
        <h1 id="editor-heading">Adjust your design.</h1>
        <p>Place it exactly where you want it printed.</p>
      </section>
      <section
        aria-label={`${selectedColor.name} Classic T-Shirt design editor`}
        className={`editor-canvas garment-color-${color}`}
      >
        <img
          alt={`${selectedColor.name} Classic T-Shirt with editable design`}
          src={garmentAsset}
        />
        <div className="editor-print-area" ref={printAreaRef}>
          <button
            aria-describedby="editor-placement-hint"
            aria-label="Generated design. Drag to move it. Use arrow keys to nudge it, plus and minus to resize, or R to reset."
            className={`editor-artwork-control ${isDragging ? 'is-dragging' : ''}`}
            onClick={() =>
              setEditorStatus('Design selected. Drag it or use the placement controls below.')
            }
            onKeyDown={nudgeDesign}
            onPointerCancel={(event) => finishDrag(event)}
            onPointerDown={(event) => {
              if (!event.isPrimary || event.button !== 0) return;
              event.preventDefault();
              dragRef.current = {
                clientX: event.clientX,
                clientY: event.clientY,
                pointerId: event.pointerId,
                transform,
              };
              event.currentTarget.setPointerCapture(event.pointerId);
              setIsDragging(true);
              setSaveNotice(false);
            }}
            onPointerMove={(event) => {
              const drag = dragRef.current;
              const printArea = printAreaRef.current;
              if (!drag || drag.pointerId !== event.pointerId || !printArea) return;
              const bounds = printArea.getBoundingClientRect();
              if (!bounds.width || !bounds.height) return;
              onTransformChange({
                ...drag.transform,
                x: clamp(
                  drag.transform.x + ((event.clientX - drag.clientX) / bounds.width) * 100,
                  12,
                  88,
                ),
                y: clamp(
                  drag.transform.y + ((event.clientY - drag.clientY) / bounds.height) * 100,
                  12,
                  88,
                ),
              });
            }}
            onPointerUp={finishDrag}
            style={{
              left: `${transform.x}%`,
              top: `${transform.y}%`,
              transform: `translate(-50%, -50%) rotate(${transform.rotation}deg) scale(${transform.scale})`,
            }}
            type="button"
          >
            <GeneratedArtwork
              prompt={prompt}
              style={style}
              tone={tone}
              version={generationVersion}
            />
          </button>
        </div>
      </section>
      <p className="editor-placement-hint" id="editor-placement-hint">
        Drag the design within the dotted print area.
      </p>
      <section className="editor-tools" aria-label="Design placement controls">
        <div className="editor-control-card">
          <span>Scale</span>
          <div className="editor-stepper">
            <button
              aria-label="Make design smaller"
              onClick={() => changeScale(-0.1)}
              type="button"
            >
              <EditorGlyph name="minus" />
            </button>
            <output aria-live="polite">{Math.round(transform.scale * 100)}%</output>
            <button aria-label="Make design larger" onClick={() => changeScale(0.1)} type="button">
              <EditorGlyph name="plus" />
            </button>
          </div>
        </div>
        <div className="editor-control-card">
          <span>Rotate</span>
          <div className="editor-stepper">
            <button
              aria-label="Rotate design left"
              onClick={() => changeRotation(-5)}
              type="button"
            >
              <EditorGlyph name="rotate-left" />
            </button>
            <output aria-live="polite">{transform.rotation}°</output>
            <button
              aria-label="Rotate design right"
              onClick={() => changeRotation(5)}
              type="button"
            >
              <EditorGlyph name="rotate-right" />
            </button>
          </div>
        </div>
        <button className="editor-reset" onClick={resetPlacement} type="button">
          <EditorGlyph name="reset" /> Reset placement
        </button>
      </section>
      <section className="editor-product-summary" aria-label="Selected product">
        <span>
          {selectedColor.name} <b>·</b> {selectedSize?.name ?? 'Size'}
        </span>
        <strong>{shirtPrice(size)}</strong>
      </section>
      <div className="step-actions editor-actions">
        <button className="step-back" onClick={onBack} type="button">
          ← Back to preview
        </button>
        <button
          className="create-button"
          onClick={() => {
            setSaveNotice(true);
            setEditorStatus('Placement saved locally.');
          }}
          type="button"
        >
          Save &amp; continue <Icon>→</Icon>
        </button>
      </div>
      {saveNotice ? (
        <p className="editor-save-notice" role="status">
          Placement saved locally. Cart is the next prototype step.
        </p>
      ) : null}
      <p aria-live="polite" className="sr-only">
        {editorStatus}
      </p>
    </div>
  );
}

function EditorGlyph({
  name,
}: {
  name: 'minus' | 'plus' | 'rotate-left' | 'rotate-right' | 'reset';
}) {
  const pathProps = {
    fill: 'none',
    stroke: 'currentColor',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    strokeWidth: 1.8,
  };

  if (name === 'minus') {
    return (
      <svg viewBox="0 0 24 24">
        <path d="M6 12h12" {...pathProps} />
      </svg>
    );
  }
  if (name === 'plus') {
    return (
      <svg viewBox="0 0 24 24">
        <path d="M12 6v12M6 12h12" {...pathProps} />
      </svg>
    );
  }
  if (name === 'rotate-left') {
    return (
      <svg viewBox="0 0 24 24">
        <path d="M7.2 9.1H3.8V5.7M4.1 9A8 8 0 1 1 5.8 17" {...pathProps} />
      </svg>
    );
  }
  if (name === 'rotate-right') {
    return (
      <svg viewBox="0 0 24 24">
        <path d="M16.8 9.1h3.4V5.7m-.3 3.3A8 8 0 1 0 18.2 17" {...pathProps} />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24">
      <path d="M19 8.5V5h-3.5M19 5a8 8 0 1 0 1.8 8.5" {...pathProps} />
    </svg>
  );
}

function GeneratedArtwork({
  prompt,
  style,
  tone,
  version,
}: {
  prompt: string;
  style: StyleId | null;
  tone: ToneId;
  version: number;
}) {
  return (
    <div
      aria-hidden="true"
      className={`generated-artwork artwork-${style ?? 'auto'} artwork-version-${version % 2}`}
    >
      <span>✦</span>
      <strong>{artworkCopy(prompt) || 'YOUR IDEA'}</strong>
      <small>{tone === 'auto' ? 'ONE OF ONE' : tone.toUpperCase()}</small>
    </div>
  );
}

function SelectionSheet({
  title,
  name,
  children,
  close,
}: {
  title: string;
  name: string;
  children: ReactNode;
  close: () => void;
}) {
  const sheetRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    sheetRef.current?.focus();
    return () => trigger?.focus({ preventScroll: true });
  }, []);
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
      const content = contentRef.current;
      if (content && content.scrollHeight > content.clientHeight) setExpanded(true);
    } else if (distance >= 80) {
      close();
    } else if (distance >= 48 && expanded) {
      setExpanded(false);
    }
  };

  return (
    <div
      className="overlay sheet-overlay"
      role="presentation"
      onClick={(event) => event.target === event.currentTarget && close()}
    >
      <section
        aria-labelledby={`${name}-sheet-title`}
        aria-modal="true"
        className={`bottom-sheet draggable-sheet ${expanded ? 'is-expanded' : ''} ${
          dragging ? 'is-dragging' : ''
        }`}
        role="dialog"
        ref={sheetRef}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape') close();
          if (event.key !== 'Tab') return;
          const buttons =
            event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
          const first = buttons[0];
          const last = buttons[buttons.length - 1];
          if (
            event.shiftKey &&
            (document.activeElement === first || document.activeElement === sheetRef.current)
          ) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
        style={{ transform: `translateY(${dragOffset}px)` }}
      >
        <button
          aria-label={`Close ${name} selection or drag down to dismiss`}
          className="sheet-handle"
          onClick={() => {
            if (movedDuringDrag.current) {
              movedDuringDrag.current = false;
              return;
            }
            close();
          }}
          onPointerCancel={() => {
            dragStartY.current = null;
            setDragging(false);
            setDragOffset(0);
          }}
          onPointerDown={(event) => {
            if (!event.isPrimary || event.button !== 0) return;
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
          <h2 id={`${name}-sheet-title`}>{title}</h2>
          <button aria-label={`Close ${name} selection`} onClick={close} type="button">
            ×
          </button>
        </div>
        <div className="sheet-content" ref={contentRef}>
          {children}
        </div>
      </section>
    </div>
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
  const [showAllColors, setShowAllColors] = useState(false);
  const visibleColors = showAllColors ? colors : colors.slice(0, 8);
  return (
    <SelectionSheet title="Choose a color" name="color" close={close}>
      <div className="color-list" id="color-options" role="group" aria-label="Choose a color">
        {visibleColors.map((item) => (
          <button
            aria-pressed={color === item.id}
            key={item.id}
            onClick={() => chooseColor(item.id)}
            type="button"
          >
            <i aria-hidden="true" className="sheet-swatch" style={{ background: item.swatch }}>
              {color === item.id ? <b>✓</b> : null}
            </i>
            <span>{item.name}</span>
          </button>
        ))}
      </div>
      {colors.length > 8 ? (
        <button
          className="sheet-more-colors"
          aria-controls="color-options"
          aria-expanded={showAllColors}
          onClick={() => setShowAllColors((value) => !value)}
          type="button"
        >
          {showAllColors ? '− fewer colors' : '+ more colors'}
        </button>
      ) : null}
    </SelectionSheet>
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
    <SelectionSheet title="Choose your size" name="size" close={close}>
      <div className="size-list" role="group" aria-label="Choose a size">
        {SIZES.map((item) => {
          const unavailable = unavailableSize(item.id);
          const surcharge = SIZE_SURCHARGE_CENTS[item.id];
          return (
            <button
              aria-pressed={size === item.id}
              disabled={unavailable}
              key={item.id}
              onClick={() => chooseSize(item.id)}
              type="button"
            >
              <span>{item.name}</span>
              {unavailable ? (
                <small>Unavailable</small>
              ) : surcharge > 0 ? (
                <small className="size-surcharge">+ {USD_FORMATTER.format(surcharge / 100)}</small>
              ) : null}
            </button>
          );
        })}
      </div>
    </SelectionSheet>
  );
}

function CreditPurchaseSheet({ close, purchase }: { close: () => void; purchase: () => void }) {
  return (
    <SelectionSheet title="You’re out of credits" name="credits" close={close}>
      <div className="credit-purchase-content">
        <p>Another version costs 1 credit. Add credits to keep creating.</p>
        <div className="credit-pack-preview">
          <div>
            <strong>{PROTOTYPE_CREDIT_PACK_SIZE} credits</strong>
            <span>Prototype credit pack</span>
          </div>
          <b>Price TBD</b>
        </div>
        <button className="create-button" onClick={purchase} type="button">
          Buy credits <Icon>→</Icon>
        </button>
        <small>Prototype only — no payment will be taken.</small>
      </div>
    </SelectionSheet>
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
