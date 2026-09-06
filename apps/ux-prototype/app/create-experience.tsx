'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type {
  ChangeEvent,
  CSSProperties,
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
  | 'white'
  | 'ivory'
  | 'pepper'
  | 'black'
  | 'mustard'
  | 'yam'
  | 'grey'
  | 'moss'
  | 'light-green'
  | 'chambray'
  | 'flo-blue'
  | 'graphite'
  | 'violet'
  | 'orchid'
  | 'blossom'
  | 'crunchberry'
  | 'berry'
  | 'watermelon'
  | 'bay'
  | 'blue-jean'
  | 'crimson'
  | 'butter'
  | 'chalky-mint'
  | 'blue-spruce'
  | 'brick'
  | 'espresso'
  | 'island-reef'
  | 'lagoon-blue'
  | 'sapphire'
  | 'navy'
  | 'neon-pink'
  | 'chili'
  | 'red';
type SizeId = 's' | 'm' | 'l' | 'xl' | '2xl' | '3xl' | '4xl';
type EditorTransform = {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  flipped: boolean;
};
type ResizeCorner = 'north-west' | 'north-east' | 'south-east' | 'south-west';
type EditorGestureBase = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  transform: EditorTransform;
  lastTransform: EditorTransform;
  moved: boolean;
};
type EditorGesture =
  | (EditorGestureBase & { kind: 'move' })
  | (EditorGestureBase & {
      kind: 'resize';
      anchorX: number;
      anchorY: number;
      areaLeft: number;
      areaTop: number;
      areaWidth: number;
      areaHeight: number;
      baseVectorX: number;
      baseVectorY: number;
    })
  | (EditorGestureBase & {
      kind: 'rotate';
      centerX: number;
      centerY: number;
      startPointerAngle: number;
    });
type ColorFixture = {
  id: ColorId;
  name: string;
  swatch: string;
  asset?: keyof typeof GARMENT_ASSETS;
  isLight?: boolean;
};

const PRODUCT_PROFILE = {
  name: 'Comfort Colors 1717',
} as const;

// Static snapshot of the active Monster Digital catalog for blueprint 706.
// Black, White, and Navy have dedicated local assets; all other swatches use a
// replaceable CSS-tinted white fixture while this app remains backend-free.
const PRODUCT_COLORS: ColorFixture[] = [
  { id: 'white', name: 'White', swatch: '#ffffff', asset: 'white', isLight: true },
  { id: 'ivory', name: 'Ivory', swatch: '#fff7e7', isLight: true },
  { id: 'pepper', name: 'Pepper', swatch: '#5f605b' },
  { id: 'black', name: 'Black', swatch: '#000000', asset: 'black' },
  { id: 'mustard', name: 'Mustard', swatch: '#d0ae6e', isLight: true },
  { id: 'yam', name: 'Yam', swatch: '#c9814f' },
  { id: 'grey', name: 'Grey', swatch: '#7a7f79' },
  { id: 'moss', name: 'Moss', swatch: '#747f66' },
  { id: 'light-green', name: 'Light Green', swatch: '#738874' },
  { id: 'chambray', name: 'Chambray', swatch: '#d9edf5', isLight: true },
  { id: 'flo-blue', name: 'Flo Blue', swatch: '#7682c2' },
  { id: 'graphite', name: 'Graphite', swatch: '#373231' },
  { id: 'violet', name: 'Violet', swatch: '#a88fd7', isLight: true },
  { id: 'orchid', name: 'Orchid', swatch: '#cbb3cc', isLight: true },
  { id: 'blossom', name: 'Blossom', swatch: '#f8d1e2', isLight: true },
  { id: 'crunchberry', name: 'Crunchberry', swatch: '#eb7ca2', isLight: true },
  { id: 'berry', name: 'Berry', swatch: '#775568' },
  { id: 'watermelon', name: 'Watermelon', swatch: '#da807b', isLight: true },
  { id: 'bay', name: 'Bay', swatch: '#c3cfc1', isLight: true },
  { id: 'blue-jean', name: 'Blue Jean', swatch: '#788ca1' },
  { id: 'crimson', name: 'Crimson', swatch: '#b66a74' },
  { id: 'butter', name: 'Butter', swatch: '#f5e1a4', isLight: true },
  { id: 'chalky-mint', name: 'Chalky Mint', swatch: '#a7d9d4', isLight: true },
  { id: 'blue-spruce', name: 'Blue Spruce', swatch: '#536758' },
  { id: 'brick', name: 'Brick', swatch: '#915c5c' },
  { id: 'espresso', name: 'Espresso', swatch: '#846b5b' },
  { id: 'island-reef', name: 'Island Reef', swatch: '#a2d8c2', isLight: true },
  { id: 'lagoon-blue', name: 'Lagoon Blue', swatch: '#89e4ed', isLight: true },
  { id: 'sapphire', name: 'Sapphire', swatch: '#03b2d3' },
  { id: 'navy', name: 'Navy', swatch: '#263040', asset: 'navy' },
  { id: 'neon-pink', name: 'Neon Pink', swatch: '#f57caf', isLight: true },
  { id: 'chili', name: 'Chili', swatch: '#853f44' },
  { id: 'red', name: 'Red', swatch: '#a80d27' },
];
const SIZES: { id: SizeId; name: string; label: string }[] = [
  { id: 's', name: 'S', label: 'Small · S' },
  { id: 'm', name: 'M', label: 'Medium · M' },
  { id: 'l', name: 'L', label: 'Large · L' },
  { id: 'xl', name: 'XL', label: 'X-Large · XL' },
  { id: '2xl', name: '2XL', label: '2X-Large · 2XL' },
  { id: '3xl', name: '3XL', label: '3X-Large · 3XL' },
  { id: '4xl', name: '4XL', label: '4X-Large · 4XL' },
];
const BASE_PRICE_CENTS = 3999;
// Replace these prototype-only fixtures when the final large-size pricing is approved.
const SIZE_SURCHARGE_CENTS: Record<SizeId, number> = {
  s: 0,
  m: 0,
  l: 0,
  xl: 0,
  '2xl': 300,
  '3xl': 500,
  '4xl': 700,
};
type PrintAreaProfile = {
  scale: number;
};
const PRINT_AREAS_BY_SIZE: Record<SizeId, PrintAreaProfile> = {
  s: { scale: 293 / 355.6 },
  m: { scale: 325 / 355.6 },
  l: { scale: 1 },
  xl: { scale: 1 },
  '2xl': { scale: 1 },
  '3xl': { scale: 1 },
  '4xl': { scale: 1 },
};
const UNAVAILABLE_VARIANTS = new Set<string>(['blue-spruce:4xl', 'grey:4xl']);
const RETRY_CREDIT_COST = 1;
const PROTOTYPE_CREDIT_PACK_SIZE = 3;
const DEFAULT_EDITOR_TRANSFORM: EditorTransform = {
  x: 50,
  y: 50,
  scale: 1,
  rotation: 0,
  flipped: false,
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
function unavailableVariant(color: ColorId, size: SizeId) {
  return UNAVAILABLE_VARIANTS.has(`${color}:${size}`);
}
function garmentPreviewClass(color: ColorFixture) {
  return [color.asset ? '' : 'garment-color-fixture', color.isLight ? 'garment-tone-light' : '']
    .filter(Boolean)
    .join(' ');
}
function garmentPreviewStyle(color: ColorFixture) {
  return { '--garment-fixture-color': color.swatch } as CSSProperties;
}
function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

const EDITOR_BOUNDARY_INSET_PX = 3;

function constrainEditorTransform(
  candidate: EditorTransform,
  printArea: HTMLDivElement | null,
  artwork: HTMLElement | null,
) {
  if (!printArea || !artwork || !printArea.clientWidth || !printArea.clientHeight) {
    return {
      ...candidate,
      x: clamp(candidate.x, 12, 88),
      y: clamp(candidate.y, 12, 88),
      scale: clamp(candidate.scale, 0.7, 1.4),
    };
  }

  const radians = (candidate.rotation * Math.PI) / 180;
  const cosine = Math.abs(Math.cos(radians));
  const sine = Math.abs(Math.sin(radians));
  const rotatedWidth = artwork.offsetWidth * cosine + artwork.offsetHeight * sine;
  const rotatedHeight = artwork.offsetWidth * sine + artwork.offsetHeight * cosine;
  const availableWidth = printArea.clientWidth - EDITOR_BOUNDARY_INSET_PX * 2;
  const availableHeight = printArea.clientHeight - EDITOR_BOUNDARY_INSET_PX * 2;
  const geometryMaximumScale = Math.min(
    1.4,
    availableWidth / rotatedWidth,
    availableHeight / rotatedHeight,
  );
  const safeMaximumScale = Math.max(0.1, Math.floor(geometryMaximumScale * 1000) / 1000);
  const safeMinimumScale = Math.min(0.7, safeMaximumScale);
  const scale = clamp(candidate.scale, safeMinimumScale, safeMaximumScale);
  const horizontalExtent =
    (((rotatedWidth * scale) / 2 + EDITOR_BOUNDARY_INSET_PX) / printArea.clientWidth) * 100;
  const verticalExtent =
    (((rotatedHeight * scale) / 2 + EDITOR_BOUNDARY_INSET_PX) / printArea.clientHeight) * 100;

  return {
    ...candidate,
    x: clamp(candidate.x, horizontalExtent, 100 - horizontalExtent),
    y: clamp(candidate.y, verticalExtent, 100 - verticalExtent),
    scale,
  };
}

function editorTransformsMatch(first: EditorTransform, second: EditorTransform) {
  return (
    Math.abs(first.x - second.x) < 0.001 &&
    Math.abs(first.y - second.y) < 0.001 &&
    Math.abs(first.scale - second.scale) < 0.001 &&
    first.rotation === second.rotation &&
    first.flipped === second.flipped
  );
}

function snapEditorTransform(candidate: EditorTransform, threshold = 3) {
  return {
    ...candidate,
    x: Math.abs(candidate.x - 50) <= threshold ? 50 : candidate.x,
    y: Math.abs(candidate.y - 50) <= threshold ? 50 : candidate.y,
  };
}

function normalizeEditorRotation(rotation: number) {
  return ((((rotation + 180) % 360) + 360) % 360) - 180;
}

function snapEditorRotation(rotation: number, threshold = 4) {
  const normalized = normalizeEditorRotation(rotation);
  const targets = [-180, -90, 0, 90, 180];
  const target = targets.find((candidate) => Math.abs(normalized - candidate) <= threshold);
  return target === undefined ? normalized : normalizeEditorRotation(target);
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
  const [reviewNotice, setReviewNotice] = useState('');
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
  const selectedColor = PRODUCT_COLORS.find((item) => item.id === color)!;
  const garmentAsset = selectedColor.asset
    ? GARMENT_ASSETS[selectedColor.asset]
    : GARMENT_ASSETS.white;
  const unavailableSize = (candidate: SizeId) => unavailableVariant(color, candidate);

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
    if (size && unavailableVariant(id, size)) {
      const nextColor = PRODUCT_COLORS.find((item) => item.id === id)!;
      const unavailableSelection = SIZES.find((item) => item.id === size)!;
      setSize(null);
      setAvailabilityMessage(
        `${unavailableSelection.name} isn’t currently available in ${nextColor.name}. Choose another size.`,
      );
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
    setReviewNotice('');
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
    setReviewNotice('');
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
              aria-label={`${selectedColor.name} ${PRODUCT_PROFILE.name} preview`}
            >
              <div
                className={`product-garment-stage ${garmentPreviewClass(selectedColor)}`}
                style={garmentPreviewStyle(selectedColor)}
              >
                <img alt={`${selectedColor.name} ${PRODUCT_PROFILE.name}`} src={garmentAsset} />
              </div>
              <div className="product-meta-row">
                <div className="product-name-with-info" ref={productInfoRef}>
                  <strong>{PRODUCT_PROFILE.name}</strong>
                  <button
                    aria-controls="product-profile-info"
                    aria-expanded={productInfoOpen}
                    aria-label={`About the ${PRODUCT_PROFILE.name}`}
                    className="product-info-trigger"
                    onClick={() => setProductInfoOpen((open) => !open)}
                    type="button"
                  >
                    !
                  </button>
                  {productInfoOpen ? (
                    <section
                      aria-label={`${PRODUCT_PROFILE.name} information`}
                      className="product-info-bubble"
                      id="product-profile-info"
                      role="dialog"
                    >
                      <strong>{PRODUCT_PROFILE.name}</strong>
                      <p>
                        Heavyweight 6.1 oz garment-dyed, ring-spun cotton with a relaxed unisex fit.
                      </p>
                      <small>Color and size availability may vary.</small>
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
              setReviewNotice('');
              setStep('product');
            }}
            continueToCheckout={() =>
              setReviewNotice('Checkout is next. No order has been placed in this prototype.')
            }
            openEditor={() => {
              setPreviewUpdating(false);
              setReviewNotice('');
              setStep('editor');
            }}
            reviewNotice={reviewNotice}
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
            onBack={() => {
              setReviewNotice('');
              setStep('generate');
            }}
            onReset={() => setEditorTransform(DEFAULT_EDITOR_TRANSFORM)}
            onSave={() => {
              setReviewNotice('Design placement saved. Continue to checkout when you’re ready.');
              setStep('generate');
            }}
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
  continueToCheckout,
  openEditor,
  reviewNotice,
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
  continueToCheckout: () => void;
  openEditor: () => void;
  reviewNotice: string;
  regenerate: () => void;
}) {
  const selectedColor = PRODUCT_COLORS.find((item) => item.id === color)!;
  const selectedSize = SIZES.find((item) => item.id === size);
  const isCreating = generationStatus !== 'ready';

  if (isCreating) {
    return (
      <div className="generation-flow generation-loading" aria-live="polite">
        <div
          className={`generation-garment-stage ${garmentPreviewClass(selectedColor)}`}
          style={garmentPreviewStyle(selectedColor)}
          aria-hidden="true"
        >
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
        aria-label={`${selectedColor.name} ${PRODUCT_PROFILE.name} with generated artwork`}
        className={`generation-garment-stage result-garment-stage ${garmentPreviewClass(selectedColor)}`}
        style={garmentPreviewStyle(selectedColor)}
      >
        <div className="result-garment-zoom">
          <img alt={`${selectedColor.name} ${PRODUCT_PROFILE.name} preview`} src={garmentAsset} />
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
          <strong>{PRODUCT_PROFILE.name}</strong>
          <span>{shirtPrice(size)}</span>
        </div>
        <p>
          {selectedColor.name} <span>·</span> {selectedSize?.name ?? 'Size'}
        </p>
      </section>
      <div className="generation-actions">
        <button className="create-button" onClick={continueToCheckout} type="button">
          Continue to checkout <Icon>→</Icon>
        </button>
        <button className="generation-edit" onClick={openEditor} type="button">
          <EditorGlyph name="edit" />
          <span>Edit design</span>
          <small>Optional</small>
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
        {reviewNotice ? (
          <p className="review-notice" role="status">
            {reviewNotice}
          </p>
        ) : null}
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
  onSave,
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
  onSave: () => void;
  onTransformChange: (transform: EditorTransform) => void;
}) {
  const printAreaRef = useRef<HTMLDivElement>(null);
  const artworkRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef(transform);
  transformRef.current = transform;
  const gestureRef = useRef<EditorGesture | null>(null);
  const [activeGesture, setActiveGesture] = useState<EditorGesture['kind'] | null>(null);
  const [artworkSelected, setArtworkSelected] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [snapGuides, setSnapGuides] = useState({ horizontal: false, vertical: false });
  const [undoStack, setUndoStack] = useState<EditorTransform[]>([]);
  const [redoStack, setRedoStack] = useState<EditorTransform[]>([]);
  const [editorStatus, setEditorStatus] = useState('');
  const selectedColor = PRODUCT_COLORS.find((item) => item.id === color)!;
  const selectedSize = SIZES.find((item) => item.id === size);
  const printArea = PRINT_AREAS_BY_SIZE[size ?? 'l'];

  const keepInsideDesignArea = (candidate: EditorTransform) =>
    constrainEditorTransform(candidate, printAreaRef.current, artworkRef.current);

  const commitTransform = (candidate: EditorTransform, status: string) => {
    const constrained = keepInsideDesignArea(candidate);
    if (editorTransformsMatch(transform, constrained)) {
      setEditorStatus(status);
      return constrained;
    }
    setUndoStack((stack) => [...stack.slice(-49), transform]);
    setRedoStack([]);
    onTransformChange(constrained);
    setEditorStatus(status);
    return constrained;
  };

  const undo = () => {
    const previous = undoStack.at(-1);
    if (!previous) return;
    setUndoStack((stack) => stack.slice(0, -1));
    setRedoStack((stack) => [...stack.slice(-49), transform]);
    onTransformChange(keepInsideDesignArea(previous));
    setEditorStatus('Last change undone.');
  };

  const redo = () => {
    const next = redoStack.at(-1);
    if (!next) return;
    setRedoStack((stack) => stack.slice(0, -1));
    setUndoStack((stack) => [...stack.slice(-49), transform]);
    onTransformChange(keepInsideDesignArea(next));
    setEditorStatus('Change restored.');
  };

  useLayoutEffect(() => {
    const area = printAreaRef.current;
    const artwork = artworkRef.current;
    if (!area || !artwork) return;

    const enforceBoundary = () => {
      const current = transformRef.current;
      const constrained = constrainEditorTransform(current, area, artwork);
      if (!editorTransformsMatch(current, constrained)) onTransformChange(constrained);
    };

    enforceBoundary();
    const observer = new ResizeObserver(enforceBoundary);
    observer.observe(area);
    observer.observe(artwork);
    return () => observer.disconnect();
  }, [onTransformChange, size]);

  const changeScale = (amount: number) => {
    const requestedScale = clamp(Number((transform.scale + amount).toFixed(2)), 0.7, 1.4);
    const nextTransform = keepInsideDesignArea({ ...transform, scale: requestedScale });
    commitTransform(
      nextTransform,
      nextTransform.scale < requestedScale
        ? 'Maximum size reached. The design must stay inside the outlined area.'
        : `Design size ${Math.round(nextTransform.scale * 100)} percent.`,
    );
  };
  const changeRotation = (amount: number) => {
    const rotation = normalizeEditorRotation(transform.rotation + amount);
    const nextTransform = keepInsideDesignArea({ ...transform, rotation });
    commitTransform(nextTransform, `Design rotation ${Math.round(rotation)} degrees.`);
  };
  const resetPlacement = () => {
    if (!editorTransformsMatch(transform, DEFAULT_EDITOR_TRANSFORM)) {
      setUndoStack((stack) => [...stack.slice(-49), transform]);
      setRedoStack([]);
      onReset();
    }
    setEditorStatus('Design placement reset.');
  };
  const applyGestureTransform = (gesture: EditorGesture, candidate: EditorTransform) => {
    const constrained = keepInsideDesignArea(candidate);
    gesture.lastTransform = constrained;
    transformRef.current = constrained;
    onTransformChange(constrained);
    return constrained;
  };
  const finishGesture = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    setActiveGesture(null);
    setSnapGuides({ horizontal: false, vertical: false });
    if (gesture.moved && !editorTransformsMatch(gesture.transform, gesture.lastTransform)) {
      setUndoStack((stack) => [...stack.slice(-49), gesture.transform]);
      setRedoStack([]);
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!gesture.moved) {
      setEditorStatus('Design selected. Drag it or use the visible handles.');
    } else if (gesture.kind === 'resize') {
      setEditorStatus(`Design size ${Math.round(gesture.lastTransform.scale * 100)} percent.`);
    } else if (gesture.kind === 'rotate') {
      setEditorStatus(`Design rotation ${Math.round(gesture.lastTransform.rotation)} degrees.`);
    } else {
      setEditorStatus('Design placement updated.');
    }
  };
  const beginResize = (event: ReactPointerEvent<HTMLButtonElement>, corner: ResizeCorner) => {
    const area = printAreaRef.current;
    const artwork = artworkRef.current;
    if (!event.isPrimary || event.button !== 0 || !area || !artwork) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = area.getBoundingClientRect();
    if (!bounds.width || !bounds.height || !artwork.offsetWidth || !artwork.offsetHeight) return;
    const constrainedTransform = keepInsideDesignArea(transform);
    const signX = corner.includes('east') ? 1 : -1;
    const signY = corner.includes('south') ? 1 : -1;
    const radians = (constrainedTransform.rotation * Math.PI) / 180;
    const localX = signX * artwork.offsetWidth;
    const localY = signY * artwork.offsetHeight;
    const baseVectorX = localX * Math.cos(radians) - localY * Math.sin(radians);
    const baseVectorY = localX * Math.sin(radians) + localY * Math.cos(radians);
    const centerX = bounds.left + (constrainedTransform.x / 100) * bounds.width;
    const centerY = bounds.top + (constrainedTransform.y / 100) * bounds.height;
    gestureRef.current = {
      kind: 'resize',
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      transform: constrainedTransform,
      lastTransform: constrainedTransform,
      moved: false,
      anchorX: centerX - (baseVectorX * constrainedTransform.scale) / 2,
      anchorY: centerY - (baseVectorY * constrainedTransform.scale) / 2,
      areaLeft: bounds.left,
      areaTop: bounds.top,
      areaWidth: bounds.width,
      areaHeight: bounds.height,
      baseVectorX,
      baseVectorY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setArtworkSelected(true);
    setActiveGesture('resize');
  };
  const resizeArtwork = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.kind !== 'resize' || gesture.pointerId !== event.pointerId) return;
    const pointerFromAnchorX = event.clientX - gesture.anchorX;
    const pointerFromAnchorY = event.clientY - gesture.anchorY;
    const baseLengthSquared =
      gesture.baseVectorX * gesture.baseVectorX + gesture.baseVectorY * gesture.baseVectorY;
    if (!baseLengthSquared) return;
    const requestedScale = clamp(
      (pointerFromAnchorX * gesture.baseVectorX + pointerFromAnchorY * gesture.baseVectorY) /
        baseLengthSquared,
      0.7,
      1.4,
    );
    const centerX = gesture.anchorX + (gesture.baseVectorX * requestedScale) / 2;
    const centerY = gesture.anchorY + (gesture.baseVectorY * requestedScale) / 2;
    const nextTransform = applyGestureTransform(gesture, {
      ...gesture.transform,
      x: ((centerX - gesture.areaLeft) / gesture.areaWidth) * 100,
      y: ((centerY - gesture.areaTop) / gesture.areaHeight) * 100,
      scale: requestedScale,
    });
    gesture.moved =
      gesture.moved ||
      Math.abs(event.clientX - gesture.startClientX) +
        Math.abs(event.clientY - gesture.startClientY) >
        4;
    gesture.lastTransform = nextTransform;
  };
  const beginRotation = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const area = printAreaRef.current;
    if (!event.isPrimary || event.button !== 0 || !area) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = area.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const constrainedTransform = keepInsideDesignArea(transform);
    const centerX = bounds.left + (constrainedTransform.x / 100) * bounds.width;
    const centerY = bounds.top + (constrainedTransform.y / 100) * bounds.height;
    gestureRef.current = {
      kind: 'rotate',
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      transform: constrainedTransform,
      lastTransform: constrainedTransform,
      moved: false,
      centerX,
      centerY,
      startPointerAngle: Math.atan2(event.clientY - centerY, event.clientX - centerX),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setArtworkSelected(true);
    setActiveGesture('rotate');
  };
  const rotateArtwork = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.kind !== 'rotate' || gesture.pointerId !== event.pointerId) return;
    const pointerAngle = Math.atan2(
      event.clientY - gesture.centerY,
      event.clientX - gesture.centerX,
    );
    const delta = ((pointerAngle - gesture.startPointerAngle) * 180) / Math.PI;
    const rotation = Number(snapEditorRotation(gesture.transform.rotation + delta).toFixed(1));
    const nextTransform = applyGestureTransform(gesture, {
      ...gesture.transform,
      rotation,
    });
    gesture.moved =
      gesture.moved ||
      Math.abs(event.clientX - gesture.startClientX) +
        Math.abs(event.clientY - gesture.startClientY) >
        4;
    gesture.lastTransform = nextTransform;
  };
  const nudgeDesign = (event: KeyboardEvent<HTMLButtonElement>) => {
    const distance = event.shiftKey ? 8 : 4;
    let nextTransform: EditorTransform | null = null;
    switch (event.key) {
      case 'ArrowLeft':
        nextTransform = { ...transform, x: transform.x - distance };
        break;
      case 'ArrowRight':
        nextTransform = { ...transform, x: transform.x + distance };
        break;
      case 'ArrowUp':
        nextTransform = { ...transform, y: transform.y - distance };
        break;
      case 'ArrowDown':
        nextTransform = { ...transform, y: transform.y + distance };
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
    const snappedTransform = snapEditorTransform(nextTransform);
    setSnapGuides({
      horizontal: snappedTransform.y === 50 && nextTransform.y !== transform.y,
      vertical: snappedTransform.x === 50 && nextTransform.x !== transform.x,
    });
    window.setTimeout(() => setSnapGuides({ horizontal: false, vertical: false }), 260);
    commitTransform(snappedTransform, 'Design placement updated.');
  };

  return (
    <div
      className={`editor-flow ${previewMode ? 'is-preview-mode' : ''}`}
      onPointerDown={(event) => {
        if (
          artworkSelected &&
          event.target instanceof Node &&
          !artworkRef.current?.contains(event.target)
        ) {
          setArtworkSelected(false);
          setEditorStatus('Design controls hidden.');
        }
      }}
    >
      <section className="editor-intro" aria-labelledby="editor-heading">
        <p className="eyebrow">Make it yours</p>
        <h1 id="editor-heading">Adjust your design.</h1>
        <p>Place it exactly where you want it printed.</p>
      </section>
      <section
        aria-label={`${selectedColor.name} ${PRODUCT_PROFILE.name} design editor`}
        className={`editor-canvas ${garmentPreviewClass(selectedColor)}`}
        style={garmentPreviewStyle(selectedColor)}
      >
        <img
          alt={`${selectedColor.name} ${PRODUCT_PROFILE.name} with editable design`}
          src={garmentAsset}
        />
        <div
          className="editor-print-area"
          ref={printAreaRef}
          style={{ '--print-area-scale': printArea.scale } as CSSProperties}
        >
          {snapGuides.vertical ? (
            <span aria-hidden="true" className="editor-snap-line is-vertical" />
          ) : null}
          {snapGuides.horizontal ? (
            <span aria-hidden="true" className="editor-snap-line is-horizontal" />
          ) : null}
          <div
            ref={artworkRef}
            className={`editor-artwork-control ${artworkSelected ? 'is-selected' : ''} ${transform.flipped ? 'is-flipped' : ''} ${activeGesture ? `is-${activeGesture}` : ''}`}
            style={
              {
                left: `${transform.x}%`,
                top: `${transform.y}%`,
                transform: `translate(-50%, -50%) rotate(${transform.rotation}deg) scale(${transform.scale})`,
                '--handle-inverse-scale': 1 / transform.scale,
              } as CSSProperties
            }
          >
            <button
              aria-describedby="editor-placement-hint"
              aria-label="Generated design. Tap to show resize and rotation handles. Drag to move it. Use arrow keys to nudge it, plus and minus to resize, or R to reset."
              className="editor-artwork-move"
              onKeyDown={nudgeDesign}
              onPointerCancel={finishGesture}
              onPointerDown={(event) => {
                if (!event.isPrimary || event.button !== 0) return;
                event.preventDefault();
                const constrainedTransform = keepInsideDesignArea(transform);
                gestureRef.current = {
                  kind: 'move',
                  startClientX: event.clientX,
                  startClientY: event.clientY,
                  pointerId: event.pointerId,
                  transform: constrainedTransform,
                  lastTransform: constrainedTransform,
                  moved: false,
                };
                event.currentTarget.setPointerCapture(event.pointerId);
                setArtworkSelected(true);
                setActiveGesture('move');
              }}
              onPointerMove={(event) => {
                const gesture = gestureRef.current;
                const printArea = printAreaRef.current;
                if (
                  !gesture ||
                  gesture.kind !== 'move' ||
                  gesture.pointerId !== event.pointerId ||
                  !printArea
                )
                  return;
                const bounds = printArea.getBoundingClientRect();
                if (!bounds.width || !bounds.height) return;
                const rawTransform = {
                  ...gesture.transform,
                  x:
                    gesture.transform.x +
                    ((event.clientX - gesture.startClientX) / bounds.width) * 100,
                  y:
                    gesture.transform.y +
                    ((event.clientY - gesture.startClientY) / bounds.height) * 100,
                };
                const snappedTransform = snapEditorTransform(rawTransform);
                gesture.moved =
                  gesture.moved ||
                  Math.abs(event.clientX - gesture.startClientX) +
                    Math.abs(event.clientY - gesture.startClientY) >
                    4;
                setSnapGuides({
                  horizontal: snappedTransform.y === 50 && rawTransform.y !== 50,
                  vertical: snappedTransform.x === 50 && rawTransform.x !== 50,
                });
                applyGestureTransform(gesture, snappedTransform);
              }}
              onPointerUp={finishGesture}
              type="button"
            >
              <GeneratedArtwork
                prompt={prompt}
                style={style}
                tone={tone}
                version={generationVersion}
              />
            </button>
            {artworkSelected && !previewMode ? (
              <>
                {(['north-west', 'north-east', 'south-east', 'south-west'] as ResizeCorner[]).map(
                  (corner) => (
                    <button
                      aria-label={`Resize design from ${corner.replace('-', ' ')} corner`}
                      className={`editor-transform-handle editor-resize-handle is-${corner}`}
                      key={corner}
                      onPointerCancel={finishGesture}
                      onPointerDown={(event) => beginResize(event, corner)}
                      onPointerMove={resizeArtwork}
                      onPointerUp={finishGesture}
                      type="button"
                    />
                  ),
                )}
                <button
                  aria-label="Rotate design freely"
                  className="editor-transform-handle editor-rotation-handle"
                  onPointerCancel={finishGesture}
                  onPointerDown={beginRotation}
                  onPointerMove={rotateArtwork}
                  onPointerUp={finishGesture}
                  type="button"
                >
                  <EditorGlyph name="rotate-right" />
                </button>
              </>
            ) : null}
          </div>
        </div>
      </section>
      <p className="editor-placement-hint" id="editor-placement-hint">
        Keep your design inside the outlined area.
      </p>
      {previewMode ? (
        <button
          className="editor-preview-exit"
          onClick={() => {
            setPreviewMode(false);
            setEditorStatus('Editing controls restored.');
          }}
          type="button"
        >
          <EditorGlyph name="edit" /> Back to editing
        </button>
      ) : null}
      <section className="editor-quick-tools" aria-label="Quick design tools">
        <button disabled={undoStack.length === 0} onClick={undo} type="button">
          <EditorGlyph name="undo" />
          <span>Undo</span>
        </button>
        <button disabled={redoStack.length === 0} onClick={redo} type="button">
          <EditorGlyph name="redo" />
          <span>Redo</span>
        </button>
        <button
          onClick={() => commitTransform({ ...transform, x: 50, y: 50 }, 'Design centered.')}
          type="button"
        >
          <EditorGlyph name="center" />
          <span>Center</span>
        </button>
        <button
          aria-pressed={transform.flipped}
          onClick={() =>
            commitTransform(
              { ...transform, flipped: !transform.flipped },
              transform.flipped ? 'Design restored.' : 'Design flipped horizontally.',
            )
          }
          type="button"
        >
          <EditorGlyph name="flip" />
          <span>Flip</span>
        </button>
        <button
          onClick={() => {
            setArtworkSelected(false);
            setPreviewMode(true);
            setEditorStatus('Preview mode. Editing controls are hidden.');
          }}
          type="button"
        >
          <EditorGlyph name="preview" />
          <span>Preview</span>
        </button>
      </section>
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
        <button className="create-button" onClick={onSave} type="button">
          Save &amp; continue <Icon>→</Icon>
        </button>
      </div>
      <p aria-live="polite" className="sr-only">
        {editorStatus}
      </p>
    </div>
  );
}

function EditorGlyph({
  name,
}: {
  name:
    | 'minus'
    | 'plus'
    | 'rotate-left'
    | 'rotate-right'
    | 'reset'
    | 'undo'
    | 'redo'
    | 'center'
    | 'flip'
    | 'preview'
    | 'edit';
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
  if (name === 'undo') {
    return (
      <svg viewBox="0 0 24 24">
        <path d="M9 7 5 11l4 4m-4-4h8a6 6 0 0 1 6 6" {...pathProps} />
      </svg>
    );
  }
  if (name === 'redo') {
    return (
      <svg viewBox="0 0 24 24">
        <path d="m15 7 4 4-4 4m4-4h-8a6 6 0 0 0-6 6" {...pathProps} />
      </svg>
    );
  }
  if (name === 'center') {
    return (
      <svg viewBox="0 0 24 24">
        <path d="M4 9V4h5m6 0h5v5m0 6v5h-5m-6 0H4v-5m8-7v8m-4-4h8" {...pathProps} />
      </svg>
    );
  }
  if (name === 'flip') {
    return (
      <svg viewBox="0 0 24 24">
        <path d="M12 3v18M9 6l-5 6 5 6V6Zm6 0 5 6-5 6V6Z" {...pathProps} />
      </svg>
    );
  }
  if (name === 'preview') {
    return (
      <svg viewBox="0 0 24 24">
        <path d="M3.5 12S6.5 7 12 7s8.5 5 8.5 5-3 5-8.5 5-8.5-5-8.5-5Z" {...pathProps} />
        <circle cx="12" cy="12" r="2.4" {...pathProps} />
      </svg>
    );
  }
  if (name === 'edit') {
    return (
      <svg viewBox="0 0 24 24">
        <path d="m4 20 4.2-1L18.9 8.3l-3.2-3.2L5 15.8 4 20Zm10.5-13.7 3.2 3.2" {...pathProps} />
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
  const colors = PRODUCT_COLORS;
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
      <p className="sheet-description catalog-snapshot-note">{colors.length} colors available</p>
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
      <p className="sheet-description catalog-snapshot-note">
        Some color and size combinations may be unavailable.
      </p>
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
