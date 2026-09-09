'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type {
  ChangeEvent,
  CSSProperties,
  KeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from 'react';

import { FeedbackIcon, InlineFeedback, type FeedbackTone } from './feedback-system';

const NEUTRAL_GARMENT_ASSET = '/garments/classic-tee-white.png';
const GARMENT_ASSETS = {
  black: '/garments/classic-tee-black.png',
  navy: '/garments/classic-tee-navy.png',
  white: NEUTRAL_GARMENT_ASSET,
} as const;
// Kept off-screen while the Look-recommendation direction is being revisited.
const SHOW_LOOK_RECOMMENDATION = false;
// Kept off-screen while the after-sale referral direction is being revisited.
const SHOW_REFERRAL_CARD = false;
const OTP_AUTOFILL_PREVIEW_CODE = '482916';
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
export type StyleId = (typeof STYLES)[number]['id'];
export type ToneId = (typeof TONES)[number]['id'];
type ExplicitTone = Exclude<ToneId, 'auto'>;
type Look = { id: string; name: string };
export type ColorId =
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
export type SizeId = 's' | 'm' | 'l' | 'xl' | '2xl' | '3xl' | '4xl';
export type EditorTransform = {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  flipped: boolean;
};
export type CartItem = {
  id: string;
  prompt: string;
  style: StyleId | null;
  tone: ToneId;
  color: ColorId;
  size: SizeId;
  generationVersion: number;
  generatedPreviewUrl?: string;
  transform: EditorTransform;
  quantity: number;
  unitPriceCents: number;
};
type ResizeCorner = 'north-west' | 'north-east' | 'south-east' | 'south-west';
type CartIconVariant = 'bag' | 'basket' | 'cart';
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
  name: 'Classic T-Shirt',
} as const;

const US_STATES = [
  ['AL', 'Alabama'],
  ['AK', 'Alaska'],
  ['AZ', 'Arizona'],
  ['AR', 'Arkansas'],
  ['CA', 'California'],
  ['CO', 'Colorado'],
  ['CT', 'Connecticut'],
  ['DE', 'Delaware'],
  ['FL', 'Florida'],
  ['GA', 'Georgia'],
  ['HI', 'Hawaii'],
  ['ID', 'Idaho'],
  ['IL', 'Illinois'],
  ['IN', 'Indiana'],
  ['IA', 'Iowa'],
  ['KS', 'Kansas'],
  ['KY', 'Kentucky'],
  ['LA', 'Louisiana'],
  ['ME', 'Maine'],
  ['MD', 'Maryland'],
  ['MA', 'Massachusetts'],
  ['MI', 'Michigan'],
  ['MN', 'Minnesota'],
  ['MS', 'Mississippi'],
  ['MO', 'Missouri'],
  ['MT', 'Montana'],
  ['NE', 'Nebraska'],
  ['NV', 'Nevada'],
  ['NH', 'New Hampshire'],
  ['NJ', 'New Jersey'],
  ['NM', 'New Mexico'],
  ['NY', 'New York'],
  ['NC', 'North Carolina'],
  ['ND', 'North Dakota'],
  ['OH', 'Ohio'],
  ['OK', 'Oklahoma'],
  ['OR', 'Oregon'],
  ['PA', 'Pennsylvania'],
  ['RI', 'Rhode Island'],
  ['SC', 'South Carolina'],
  ['SD', 'South Dakota'],
  ['TN', 'Tennessee'],
  ['TX', 'Texas'],
  ['UT', 'Utah'],
  ['VT', 'Vermont'],
  ['VA', 'Virginia'],
  ['WA', 'Washington'],
  ['WV', 'West Virginia'],
  ['WI', 'Wisconsin'],
  ['WY', 'Wyoming'],
] as const;

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
const CREDIT_PACK_SIZE = 3;
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

function CartGlyph({ variant = 'bag' }: { variant?: CartIconVariant }) {
  const pathProps = {
    fill: 'none',
    stroke: 'currentColor',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    strokeWidth: 1.7,
  };

  if (variant === 'basket') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path
          d="M5 10h14l-1.2 9H6.2zM8.5 10 12 5.5l3.5 4.5M9 13v3.2M12 13v3.2M15 13v3.2"
          {...pathProps}
        />
      </svg>
    );
  }

  if (variant === 'cart') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M3.5 5h2.2l1.7 9.2h9.8l1.5-6.4H6.2M9 18.5h.01M16 18.5h.01" {...pathProps} />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M5.5 8.5h13l-1 11h-11zM9 9V6.8a3 3 0 0 1 6 0V9" {...pathProps} />
    </svg>
  );
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
  return USD_FORMATTER.format(shirtPriceCents(size) / 100);
}
function shirtPriceCents(size: SizeId | null) {
  return BASE_PRICE_CENTS + (size ? SIZE_SURCHARGE_CENTS[size] : 0);
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

function releaseReferenceUrl(reference: ReferenceImageState | null): void {
  if (reference?.url.startsWith('blob:')) URL.revokeObjectURL(reference.url);
}

export interface CreateExperienceProps {
  creditBalance?: number;
  /** Lets the production host route account access to its real passwordless flow. */
  onAccountAccess?: () => void;
  /** Clears the production draft when starting another independent design. */
  onCreateAnotherDesign?: () => void;
  initialCart?: CartItem[];
  initialCreation?: {
    step: 'idea' | 'style' | 'product';
    prompt: string;
    reference: ReferenceImageState | null;
    style: StyleId | null;
    tone: ToneId;
    color: ColorId;
    size: SizeId | null;
  };
  onContinueFromIdea?: (prompt: string) => Promise<void>;
  onContinueFromStyle?: (selection: { style: StyleId; tone: ToneId }) => Promise<void>;
  onContinueFromProduct?: (selection: { color: ColorId; size: SizeId }) => Promise<void>;
  onGenerateDesign?: (
    input: { prompt: string; referenceAssetIds: string[] },
    reportPhase: (phase: GenerationLifecyclePhase) => void,
  ) => Promise<GenerationLifecycleResult>;
  onAddToCart?: (input: {
    generationId: string;
    size: SizeId;
    transform: EditorTransform;
  }) => Promise<CartPersistenceResult>;
  onCartQuantityChange?: (itemId: string, quantity: number) => Promise<CartPersistenceResult>;
  onCartRemove?: (itemId: string) => Promise<void>;
  onReferenceRemoved?: (assetId: string) => Promise<void>;
  onReferenceSelected?: (file: File) => Promise<ReferenceImageState>;
  onCheckoutCompleted?: (input: CheckoutCompletionInput) => Promise<CheckoutCompletionResult>;
}

export type GenerationLifecyclePhase = 'queued' | 'processing' | 'validating';

export interface GenerationLifecycleResult {
  creditBalance: number;
  generationId: string;
  previewAssetId: string;
  previewUrl: string;
}

export interface CartPersistenceResult {
  id: string;
  quantity: number;
  unitPriceCents: number;
  previewUrl: string;
}

export interface ReferenceImageState {
  assetId?: string;
  name: string;
  url: string;
}

export interface CheckoutCompletionInput {
  email: string;
  firstName: string;
  lastName: string;
  address: string;
  apartment: string;
  city: string;
  state: string;
  zip: string;
  mobile: string;
  saveAddress: boolean;
}

export interface CheckoutCompletionResult {
  orderNumber: string;
  pricing: {
    subtotalCents: number;
    shippingCents: number;
    taxCents: number;
    totalCents: number;
  };
}

export function CreateExperience({
  creditBalance,
  initialCart,
  initialCreation,
  onAccountAccess,
  onCreateAnotherDesign,
  onAddToCart,
  onCartQuantityChange,
  onCartRemove,
  onContinueFromIdea,
  onContinueFromProduct,
  onContinueFromStyle,
  onCheckoutCompleted,
  onGenerateDesign,
  onReferenceRemoved,
  onReferenceSelected,
}: CreateExperienceProps) {
  const [step, setStep] = useState<
    'idea' | 'style' | 'product' | 'generate' | 'checkout' | 'editor'
  >(initialCreation?.step ?? 'idea');
  const [prompt, setPrompt] = useState(initialCreation?.prompt ?? '');
  const [reference, setReference] = useState<ReferenceImageState | null>(
    initialCreation?.reference ?? null,
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [cart, setCart] = useState<CartItem[]>(initialCart ?? []);
  const [cartAdded, setCartAdded] = useState(false);
  const [cartSaving, setCartSaving] = useState(false);
  const [cartError, setCartError] = useState('');
  const cartIcon: CartIconVariant = 'bag';
  const [promptError, setPromptError] = useState('');
  const [savingIdea, setSavingIdea] = useState(false);
  const [savingReference, setSavingReference] = useState(false);
  const [referenceError, setReferenceError] = useState('');
  const [savingStyle, setSavingStyle] = useState(false);
  const [styleError, setStyleError] = useState('');
  const [style, setStyle] = useState<StyleId | null>(initialCreation?.style ?? null);
  const [tone, setTone] = useState<ToneId>(initialCreation?.tone ?? 'auto');
  const [manualLook, setManualLook] = useState<string | null>(null);
  const [lookPickerOpen, setLookPickerOpen] = useState(false);
  const [color, setColor] = useState<ColorId>(initialCreation?.color ?? 'black');
  const [size, setSize] = useState<SizeId | null>(initialCreation?.size ?? null);
  const [selectionSheet, setSelectionSheet] = useState<'color' | 'size' | 'credits' | null>(null);
  const [productInfoOpen, setProductInfoOpen] = useState(false);
  const [generationStatus, setGenerationStatus] = useState<
    'idle' | 'creating' | 'ready' | 'failed'
  >('idle');
  const [generationPhase, setGenerationPhase] = useState<GenerationLifecyclePhase>('queued');
  const [generationError, setGenerationError] = useState('');
  const [generatedPreviewUrl, setGeneratedPreviewUrl] = useState<string | null>(null);
  const [generatedGenerationId, setGeneratedGenerationId] = useState<string | null>(null);
  const [generationVersion, setGenerationVersion] = useState(0);
  const [generatedCreativeSignature, setGeneratedCreativeSignature] = useState<string | null>(null);
  const [appliedProduct, setAppliedProduct] = useState<{
    color: ColorId;
    size: SizeId;
  } | null>(null);
  const [previewUpdating, setPreviewUpdating] = useState(false);
  const [credits, setCredits] = useState(creditBalance ?? 1);
  const [editorTransform, setEditorTransform] = useState<EditorTransform>(DEFAULT_EDITOR_TRANSFORM);
  const [reviewNotice, setReviewNotice] = useState('');
  const [sizeError, setSizeError] = useState('');
  const [savingProduct, setSavingProduct] = useState(false);
  const [availabilityMessage, setAvailabilityMessage] = useState('');
  const [checkoutHelpOpen, setCheckoutHelpOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountPageOpen, setAccountPageOpen] = useState(false);
  const [authStage, setAuthStage] = useState<'email' | 'code'>('email');
  const [authEmail, setAuthEmail] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [authError, setAuthError] = useState('');
  const [authNotice, setAuthNotice] = useState('');
  const [signedInEmail, setSignedInEmail] = useState<string | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const cartCloseRef = useRef<HTMLButtonElement | null>(null);
  const authEmailRef = useRef<HTMLInputElement | null>(null);
  const verificationCodeRef = useRef<HTMLInputElement | null>(null);
  const toneSectionRef = useRef<HTMLElement | null>(null);
  const productInfoRef = useRef<HTMLDivElement | null>(null);
  const checkoutHelpRef = useRef<HTMLDivElement | null>(null);
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
      releaseReferenceUrl(reference);
    },
    [reference],
  );
  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    if (search.get('menu') !== '1') return;
    setDrawerOpen(true);
    search.delete('menu');
    const suffix = search.size ? `?${search.toString()}` : '';
    window.history.replaceState(null, '', `${window.location.pathname}${suffix}`);
  }, []);
  useEffect(() => {
    if (!drawerOpen && !cartOpen && !accountOpen && !accountPageOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (drawerOpen) closeRef.current?.focus();
    if (cartOpen) cartCloseRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [accountOpen, accountPageOpen, cartOpen, drawerOpen]);
  useEffect(() => {
    if (!accountOpen) return;
    const frame = window.requestAnimationFrame(() => {
      if (authStage === 'email') authEmailRef.current?.focus();
      else verificationCodeRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [accountOpen, authStage]);
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
    setCheckoutHelpOpen(false);
  }, [step]);
  useEffect(() => {
    if (onGenerateDesign || step !== 'generate' || generationStatus !== 'creating') return;
    const timer = window.setTimeout(() => setGenerationStatus('ready'), 1900);
    return () => window.clearTimeout(timer);
  }, [generationStatus, generationVersion, onGenerateDesign, step]);
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
  useEffect(() => {
    if (!checkoutHelpOpen) return;
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setCheckoutHelpOpen(false);
    };
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !checkoutHelpRef.current?.contains(event.target)) {
        setCheckoutHelpOpen(false);
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => {
      window.removeEventListener('keydown', closeOnEscape);
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
    };
  }, [checkoutHelpOpen]);
  const openMenu = (element: HTMLButtonElement) => {
    triggerRef.current = element;
    setDrawerOpen(true);
  };
  const closeDrawer = () => {
    setDrawerOpen(false);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  };
  const startNewDesignFromMenu = () => {
    setDrawerOpen(false);
    resetDesign();
  };
  const openCartFromMenu = () => {
    setDrawerOpen(false);
    setCartOpen(true);
  };
  const openAccountFromMenu = () => {
    if (onAccountAccess) {
      onAccountAccess();
      return;
    }
    setDrawerOpen(false);
    if (signedInEmail) {
      setAccountPageOpen(true);
      return;
    }
    setAccountOpen(true);
    setAuthStage('email');
    setAuthError('');
    setAuthNotice('');
    setVerificationCode('');
  };
  const closeAccountPage = () => {
    setAccountPageOpen(false);
    setDrawerOpen(true);
  };
  const returnToMenuFromAccount = () => {
    setAccountOpen(false);
    setAuthError('');
    setAuthNotice('');
    setDrawerOpen(true);
  };
  const continueWithEmail = () => {
    const normalizedEmail = authEmail.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      setAuthError('Enter a valid email address to continue.');
      return;
    }
    setAuthEmail(normalizedEmail);
    setAuthError('');
    setAuthNotice('');
    setVerificationCode('');
    setAuthStage('code');
  };
  const changeAuthEmail = () => {
    setAuthStage('email');
    setAuthError('');
    setAuthNotice('');
    setVerificationCode('');
  };
  const updateVerificationCode = (value: string) => {
    setVerificationCode(value.replace(/\D/g, '').slice(0, 6));
    if (authError) setAuthError('');
  };
  const verifyCode = () => {
    if (verificationCode.length !== 6) {
      setAuthError('Enter the 6-digit code to continue.');
      return;
    }
    setSignedInEmail(authEmail);
    setAccountOpen(false);
    setAuthError('');
    setAuthNotice('');
    setDrawerOpen(true);
  };
  const closeCart = () => {
    setCartOpen(false);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  };
  const resetDesign = () => {
    onCreateAnotherDesign?.();
    releaseReferenceUrl(reference);
    setPrompt('');
    setReference(null);
    setPromptError('');
    setReferenceError('');
    setStyleError('');
    setStyle(null);
    setTone('auto');
    setManualLook(null);
    setLookPickerOpen(false);
    setColor('black');
    setSize(null);
    setSelectionSheet(null);
    setGenerationStatus('idle');
    setGenerationPhase('queued');
    setGenerationError('');
    setGeneratedPreviewUrl(null);
    setGeneratedGenerationId(null);
    setGeneratedCreativeSignature(null);
    setAppliedProduct(null);
    setPreviewUpdating(false);
    setGenerationVersion(0);
    setEditorTransform(DEFAULT_EDITOR_TRANSFORM);
    setReviewNotice('');
    setSizeError('');
    setAvailabilityMessage('');
    setCartAdded(false);
    setStep('idea');
  };
  const addCurrentDesignToCart = () => {
    if (!style || !size) return;
    const localItem: CartItem = {
      id: `cart-${Date.now()}-${generationVersion}`,
      prompt,
      style,
      tone,
      color,
      size,
      generationVersion,
      ...(generatedPreviewUrl ? { generatedPreviewUrl } : {}),
      transform: editorTransform,
      quantity: 1,
      unitPriceCents: shirtPriceCents(size),
    };
    setCartError('');
    if (!onAddToCart) {
      setCart((items) => [...items, localItem]);
      setReviewNotice('');
      setCartAdded(true);
      return;
    }
    if (!generatedGenerationId) {
      setCartError('The delivered design is not ready yet. Try again.');
      return;
    }
    setCartSaving(true);
    void onAddToCart({ generationId: generatedGenerationId, size, transform: editorTransform })
      .then((saved) => {
        setCart((items) => [
          ...items.filter((item) => item.id !== saved.id),
          {
            ...localItem,
            id: saved.id,
            quantity: saved.quantity,
            unitPriceCents: saved.unitPriceCents,
            generatedPreviewUrl: saved.previewUrl,
          },
        ]);
        setReviewNotice('');
        setCartAdded(true);
      })
      .catch((error: unknown) =>
        setCartError(
          error instanceof Error
            ? error.message
            : 'We couldn’t prepare this shirt for your cart. Please try again.',
        ),
      )
      .finally(() => setCartSaving(false));
  };
  const removeCartItem = (id: string) => {
    setCartError('');
    if (!onCartRemove) {
      setCart((items) => items.filter((item) => item.id !== id));
      setCartAdded(false);
      return;
    }
    setCartSaving(true);
    void onCartRemove(id)
      .then(() => {
        setCart((items) => items.filter((item) => item.id !== id));
        setCartAdded(false);
      })
      .catch((error: unknown) =>
        setCartError(error instanceof Error ? error.message : 'We couldn’t remove that item.'),
      )
      .finally(() => setCartSaving(false));
  };
  const changeCartItemQuantity = (id: string, delta: number) => {
    const current = cart.find((item) => item.id === id);
    if (!current) return;
    const quantity = Math.max(1, current.quantity + delta);
    if (!onCartQuantityChange) {
      setCart((items) => items.map((item) => (item.id === id ? { ...item, quantity } : item)));
      return;
    }
    setCartError('');
    setCartSaving(true);
    void onCartQuantityChange(id, quantity)
      .then((saved) =>
        setCart((items) =>
          items.map((item) =>
            item.id === id
              ? {
                  ...item,
                  quantity: saved.quantity,
                  unitPriceCents: saved.unitPriceCents,
                  generatedPreviewUrl: saved.previewUrl,
                }
              : item,
          ),
        ),
      )
      .catch((error: unknown) =>
        setCartError(error instanceof Error ? error.message : 'We couldn’t update the quantity.'),
      )
      .finally(() => setCartSaving(false));
  };
  const startCheckout = () => {
    setCartOpen(false);
    setStep('checkout');
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
    if (!onContinueFromIdea) {
      setStep('style');
      return;
    }
    setSavingIdea(true);
    void onContinueFromIdea(prompt.trim())
      .then(() => setStep('style'))
      .catch(() => setPromptError('We couldn’t save your idea. Please try again.'))
      .finally(() => setSavingIdea(false));
  };
  const submitStyle = () => {
    if (!style) {
      setStyleError('Choose a style to continue.');
      return;
    }
    setStyleError('');
    if (!onContinueFromStyle) {
      setStep('product');
      return;
    }
    setSavingStyle(true);
    void onContinueFromStyle({ style, tone })
      .then(() => setStep('product'))
      .catch(() => setStyleError('We couldn’t save your style. Please try again.'))
      .finally(() => setSavingStyle(false));
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
    if (!onContinueFromProduct) {
      completeProductSubmission(size);
      return;
    }
    setSavingProduct(true);
    void onContinueFromProduct({ color, size })
      .then(() => completeProductSubmission(size))
      .catch(() => setSizeError('We couldn’t save your color and size. Please try again.'))
      .finally(() => setSavingProduct(false));
  };
  const runGeneration = (signature: string) => {
    setGenerationPhase('queued');
    setGenerationError('');
    setGenerationStatus('creating');
    setStep('generate');
    if (!onGenerateDesign) {
      setGeneratedCreativeSignature(signature);
      return;
    }
    void onGenerateDesign(
      {
        prompt: prompt.trim(),
        referenceAssetIds: reference?.assetId ? [reference.assetId] : [],
      },
      setGenerationPhase,
    )
      .then((result) => {
        setGeneratedCreativeSignature(signature);
        setGeneratedPreviewUrl(result.previewUrl);
        setGeneratedGenerationId(result.generationId);
        setCredits(result.creditBalance);
        setGenerationStatus('ready');
      })
      .catch((error: unknown) => {
        setGenerationError(
          error instanceof Error
            ? error.message
            : 'We couldn’t create this version. Your credit wasn’t used.',
        );
        setGenerationStatus('failed');
      });
  };
  const completeProductSubmission = (selectedSize: SizeId) => {
    const nextProduct = { color, size: selectedSize };
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
    setPreviewUpdating(false);
    runGeneration(creativeSignature);
  };
  const regenerate = () => {
    if (credits < RETRY_CREDIT_COST) {
      setSelectionSheet('credits');
      return;
    }
    setCartAdded(false);
    if (!onGenerateDesign) setCredits((balance) => balance - RETRY_CREDIT_COST);
    setReviewNotice('');
    setPreviewUpdating(false);
    setEditorTransform(DEFAULT_EDITOR_TRANSFORM);
    if (size) setAppliedProduct({ color, size });
    setGenerationVersion((version) => version + 1);
    runGeneration(creativeSignature);
  };
  const changeReference = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = '';
    setReferenceError('');
    if (!onReferenceSelected) {
      releaseReferenceUrl(reference);
      setReference({ name: file.name, url: URL.createObjectURL(file) });
      return;
    }
    setSavingReference(true);
    void onReferenceSelected(file)
      .then((saved) => {
        releaseReferenceUrl(reference);
        setReference(saved);
      })
      .catch((error: unknown) =>
        setReferenceError(
          error instanceof Error ? error.message : 'We couldn’t save that image. Please try again.',
        ),
      )
      .finally(() => setSavingReference(false));
  };
  const removeReference = () => {
    if (!reference) return;
    setReferenceError('');
    if (!reference.assetId || !onReferenceRemoved) {
      releaseReferenceUrl(reference);
      setReference(null);
      return;
    }
    setSavingReference(true);
    void onReferenceRemoved(reference.assetId)
      .then(() => {
        releaseReferenceUrl(reference);
        setReference(null);
      })
      .catch(() => setReferenceError('We couldn’t remove that image. Please try again.'))
      .finally(() => setSavingReference(false));
  };
  const cartQuantity = cart.reduce((total, item) => total + item.quantity, 0);

  return (
    <main className="prototype theme-a composer-fade">
      <section className="phone-stage composition-canvas">
        {step === 'checkout' ? (
          <header className="menu-header menu-header-brand checkout-context-header">
            <button
              aria-label="Back to cart"
              className="checkout-context-back"
              onClick={() => {
                setStep('idea');
                setCartOpen(true);
              }}
              type="button"
            >
              <Icon>←</Icon>
            </button>
            <span className="menu-wordmark">LET IT BE</span>
            <div className="checkout-help-control" ref={checkoutHelpRef}>
              <button
                aria-controls="checkout-help-popover"
                aria-expanded={checkoutHelpOpen}
                aria-label="Checkout help"
                className="checkout-help-trigger"
                onClick={() => setCheckoutHelpOpen((open) => !open)}
                type="button"
              >
                ?
              </button>
              {checkoutHelpOpen ? (
                <section
                  aria-label="Checkout help"
                  className="checkout-help-popover"
                  id="checkout-help-popover"
                  role="dialog"
                >
                  <strong>Need help?</strong>
                  <p>Review your order or contact us before placing it.</p>
                  <button onClick={() => setCheckoutHelpOpen(false)} type="button">
                    Got it
                  </button>
                </section>
              ) : null}
            </div>
          </header>
        ) : (
          <header className="menu-header menu-header-brand">
            <button
              aria-label="Open menu"
              className="menu-trigger"
              onClick={(event) => openMenu(event.currentTarget)}
              type="button"
            >
              <Icon>☰</Icon>
            </button>
            <span className="menu-wordmark">LET IT BE</span>
            <button
              aria-label={`Open cart${cartQuantity ? `, ${cartQuantity} item${cartQuantity === 1 ? '' : 's'}` : ''}`}
              className="menu-cart-button"
              onClick={(event) => {
                triggerRef.current = event.currentTarget;
                setCartOpen(true);
              }}
              type="button"
            >
              <CartGlyph variant={cartIcon} />
              {cartQuantity ? (
                <span className="menu-cart-badge" key={cartQuantity}>
                  {cartQuantity}
                </span>
              ) : null}
            </button>
          </header>
        )}
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
                <InlineFeedback
                  className="prompt-error"
                  id="shirt-prompt-error"
                  role="alert"
                  tone="error"
                >
                  {promptError}
                </InlineFeedback>
              ) : null}
            </section>
            <section className="reference-section" aria-label="Optional reference image">
              {reference ? (
                <div className="reference-preview">
                  <img alt="Selected reference preview" src={reference.url} />
                  <div>
                    <strong>{reference.name}</strong>
                    <button disabled={savingReference} onClick={removeReference} type="button">
                      {savingReference ? 'Removing…' : 'Remove'}
                    </button>
                  </div>
                </div>
              ) : (
                <label className="reference-picker">
                  <input
                    accept="image/png,image/jpeg,image/webp"
                    disabled={savingReference}
                    onChange={changeReference}
                    type="file"
                  />
                  <span>
                    <b>+</b> {savingReference ? 'Saving image…' : 'Add a reference image'}
                  </span>
                  <small>Optional</small>
                </label>
              )}
              {referenceError ? (
                <InlineFeedback className="prompt-error" role="alert" tone="error">
                  {referenceError}
                </InlineFeedback>
              ) : null}
            </section>
            <button
              aria-busy={savingIdea}
              className="create-button"
              disabled={savingIdea}
              onClick={submitIdea}
              type="button"
            >
              Choose a Style <Icon>→</Icon>
            </button>
            <div className="creation-meta">
              <span className="credit-copy">
                {credits} {credits === 1 ? 'credit' : 'credits'} available
              </span>
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
                <InlineFeedback className="style-error" role="alert" tone="reminder">
                  {styleError}
                </InlineFeedback>
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
              <button
                aria-busy={savingStyle}
                className="create-button"
                disabled={savingStyle}
                onClick={submitStyle}
                type="button"
              >
                Continue to color &amp; size <Icon>→</Icon>
              </button>
              <div className="secondary-action-row is-single">
                <button className="step-back" onClick={() => setStep('idea')} type="button">
                  ← Back to idea
                </button>
              </div>
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
                  {size && SIZE_SURCHARGE_CENTS[size] > 0 ? (
                    <small className="selection-card-surcharge">
                      + {USD_FORMATTER.format(SIZE_SURCHARGE_CENTS[size] / 100)}
                    </small>
                  ) : null}
                  <i aria-hidden="true" className="selection-card-chevron" />
                </span>
              </button>
            </section>
            {availabilityMessage ? (
              <InlineFeedback className="availability-message" role="alert" tone="warning">
                {availabilityMessage}
              </InlineFeedback>
            ) : null}
            {sizeError ? (
              <InlineFeedback className="size-error" role="alert" tone="reminder">
                {sizeError}
              </InlineFeedback>
            ) : null}
            <div className="step-actions product-actions">
              <button
                aria-busy={savingProduct}
                className={`create-button ${productActionLabel === 'Back to preview' ? 'is-back-action' : ''}`}
                disabled={savingProduct}
                onClick={submitProduct}
                type="button"
              >
                {productActionLabel}{' '}
                <Icon>{!hasGeneratedDesign || creativeInputsChanged ? '✦' : '→'}</Icon>
              </button>
              <div className="secondary-action-row is-single">
                <button className="step-back" onClick={() => setStep('style')} type="button">
                  ← Back to style
                </button>
              </div>
            </div>
          </div>
        ) : step === 'generate' ? (
          <GenerateStep
            cartAdded={cartAdded}
            cartError={cartError}
            cartSaving={cartSaving}
            color={color}
            garmentAsset={garmentAsset}
            generatedPreviewUrl={generatedPreviewUrl}
            generationError={generationError}
            generationPhase={generationPhase}
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
              setCartAdded(false);
              setStep('product');
            }}
            addToCart={addCurrentDesignToCart}
            checkout={startCheckout}
            createAnother={resetDesign}
            openEditor={() => {
              setPreviewUpdating(false);
              setReviewNotice('');
              setStep('editor');
            }}
            reviewNotice={reviewNotice}
            regenerate={regenerate}
          />
        ) : step === 'checkout' ? (
          <CheckoutStep
            cart={cart}
            createAnother={resetDesign}
            {...(onCheckoutCompleted ? { onCheckoutCompleted } : {})}
            onComplete={() => {
              setCart([]);
              setCartAdded(false);
            }}
          />
        ) : (
          <EditorStep
            color={color}
            garmentAsset={garmentAsset}
            generatedPreviewUrl={generatedPreviewUrl}
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
      {drawerOpen ? (
        <NavigationDrawer
          cartQuantity={cartQuantity}
          close={closeDrawer}
          closeRef={closeRef}
          openAccount={openAccountFromMenu}
          openCart={openCartFromMenu}
          signedInEmail={signedInEmail}
          signOut={() => setSignedInEmail(null)}
          startNewDesign={startNewDesignFromMenu}
        />
      ) : null}
      {accountOpen ? (
        <PasswordlessSignInPage
          authEmail={authEmail}
          authEmailRef={authEmailRef}
          authError={authError}
          authNotice={authNotice}
          close={returnToMenuFromAccount}
          changeEmail={changeAuthEmail}
          continueWithEmail={continueWithEmail}
          onAuthEmailChange={(value) => {
            setAuthEmail(value);
            if (authError) setAuthError('');
          }}
          onVerificationCodeChange={updateVerificationCode}
          resendCode={() => setAuthNotice('A new code is on its way.')}
          suggestedCode={OTP_AUTOFILL_PREVIEW_CODE}
          stage={authStage}
          verificationCode={verificationCode}
          verificationCodeRef={verificationCodeRef}
          verifyCode={verifyCode}
        />
      ) : null}
      {accountPageOpen ? (
        <AccountPage
          credits={credits}
          close={closeAccountPage}
          getMoreCredits={() => {
            setAccountPageOpen(false);
            setSelectionSheet('credits');
          }}
          signedInEmail={signedInEmail ?? 'alex.morgan@example.com'}
        />
      ) : null}
      {cartOpen ? (
        <CartDrawer
          cart={cart}
          checkout={startCheckout}
          close={closeCart}
          closeRef={cartCloseRef}
          changeQuantity={changeCartItemQuantity}
          cartError={cartError}
          cartSaving={cartSaving}
          cartIcon={cartIcon}
          removeItem={removeCartItem}
        />
      ) : null}
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
            setCredits((balance) => balance + CREDIT_PACK_SIZE);
            setSelectionSheet(null);
          }}
        />
      ) : null}
    </main>
  );
}

function GenerateStep({
  cartAdded,
  cartError,
  cartSaving,
  color,
  credits,
  garmentAsset,
  generatedPreviewUrl,
  generationError,
  generationPhase,
  generationStatus,
  generationVersion,
  previewUpdating,
  prompt,
  size,
  style,
  tone,
  addToCart,
  back,
  checkout,
  createAnother,
  openEditor,
  reviewNotice,
  regenerate,
}: {
  cartAdded: boolean;
  cartError: string;
  cartSaving: boolean;
  color: ColorId;
  credits: number;
  garmentAsset: string;
  generatedPreviewUrl: string | null;
  generationError: string;
  generationPhase: GenerationLifecyclePhase;
  generationStatus: 'idle' | 'creating' | 'ready' | 'failed';
  generationVersion: number;
  previewUpdating: boolean;
  prompt: string;
  size: SizeId | null;
  style: StyleId | null;
  tone: ToneId;
  addToCart: () => void;
  back: () => void;
  checkout: () => void;
  createAnother: () => void;
  openEditor: () => void;
  reviewNotice: string;
  regenerate: () => void;
}) {
  const selectedColor = PRODUCT_COLORS.find((item) => item.id === color)!;
  const selectedSize = SIZES.find((item) => item.id === size);
  const isCreating = generationStatus === 'idle' || generationStatus === 'creating';

  if (generationStatus === 'failed') {
    return (
      <div className="generation-flow generation-loading" aria-live="polite">
        <div
          className={`generation-garment-stage ${garmentPreviewClass(selectedColor)}`}
          style={garmentPreviewStyle(selectedColor)}
          aria-hidden="true"
        >
          <img alt="" src={garmentAsset} />
        </div>
        <section className="generation-copy">
          <p className="eyebrow">Generation paused</p>
          <h1>Let’s try that again.</h1>
          <InlineFeedback role="alert" tone="error">
            {generationError || 'We couldn’t create this version. Your credit wasn’t used.'}
          </InlineFeedback>
          <button className="create-button" onClick={regenerate} type="button">
            Try again <Icon>↻</Icon>
          </button>
          <button className="step-back" onClick={back} type="button">
            ← Back to color &amp; size
          </button>
        </section>
      </div>
    );
  }

  if (isCreating) {
    const lifecycleCopy = generationLifecycleCopy(generationPhase);
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
          <p className="eyebrow">{lifecycleCopy.eyebrow}</p>
          <h1>{lifecycleCopy.title}</h1>
          <p>{lifecycleCopy.description}</p>
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
          <img
            alt={`${selectedColor.name} ${PRODUCT_PROFILE.name} preview`}
            className="result-garment-image"
            src={garmentAsset}
          />
          <ArtworkPreview
            generatedPreviewUrl={generatedPreviewUrl}
            prompt={prompt}
            style={style}
            tone={tone}
            version={generationVersion}
          />
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
        {cartAdded ? (
          <section className="cart-added-panel" aria-live="polite">
            <div className="cart-added-message">
              <span aria-hidden="true">✓</span>
              <p>
                <strong>Added to your cart</strong>
                <small>Your design is saved and ready whenever you are.</small>
              </p>
            </div>
            <div className="cart-added-action-row">
              <button className="cart-added-secondary" onClick={createAnother} type="button">
                Create another design
              </button>
              <button className="create-button checkout-button" onClick={checkout} type="button">
                Checkout <Icon>→</Icon>
              </button>
            </div>
          </section>
        ) : (
          <button
            aria-busy={cartSaving}
            className="create-button"
            disabled={cartSaving}
            onClick={addToCart}
            type="button"
          >
            {cartSaving ? 'Preparing your print…' : `Add to cart · ${shirtPrice(size)}`}{' '}
            <Icon>{cartSaving ? '·' : '→'}</Icon>
          </button>
        )}
        {cartError ? (
          <InlineFeedback role="alert" tone="error">
            {cartError}
          </InlineFeedback>
        ) : null}
        {reviewNotice ? (
          <InlineFeedback className="review-notice" tone="info">
            {reviewNotice}
          </InlineFeedback>
        ) : null}
        {!cartAdded ? (
          <div className="generation-secondary-actions is-three" aria-label="Other design actions">
            <button className="generation-back" onClick={back} type="button">
              <span>← Back to</span>
              <span>color &amp; size</span>
            </button>
            <span aria-hidden="true">|</span>
            <button className="generation-edit" onClick={openEditor} type="button">
              <EditorGlyph name="edit" />
              <span>Edit design</span>
            </button>
            <span aria-hidden="true">|</span>
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
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CartSummaryLine({ item }: { item: CartItem }) {
  const itemColor = PRODUCT_COLORS.find((color) => color.id === item.color)!;
  const itemSize = SIZES.find((size) => size.id === item.size)!;
  return (
    <div className="checkout-order-summary">
      <div className="checkout-product-art" aria-label="Your generated artwork">
        <ArtworkPreview
          generatedPreviewUrl={item.generatedPreviewUrl ?? null}
          prompt={item.prompt}
          style={item.style}
          tone={item.tone}
          version={item.generationVersion}
        />
      </div>
      <div>
        <div className="checkout-item-title">
          <strong>{PRODUCT_PROFILE.name}</strong>
          <span className="checkout-quantity">×{item.quantity}</span>
        </div>
        <span>
          {itemColor.name} · {itemSize.name}
        </span>
      </div>
      <b>{USD_FORMATTER.format((item.unitPriceCents * item.quantity) / 100)}</b>
    </div>
  );
}

function CheckoutStep({
  cart,
  createAnother,
  onCheckoutCompleted,
  onComplete,
}: {
  cart: CartItem[];
  createAnother: () => void;
  onCheckoutCompleted?: (input: CheckoutCompletionInput) => Promise<CheckoutCompletionResult>;
  onComplete: () => void;
}) {
  const [shippingMethod, setShippingMethod] = useState<'economy' | 'standard' | 'priority'>(
    'standard',
  );
  const [complete, setComplete] = useState(false);
  const [orderedCart, setOrderedCart] = useState<CartItem[] | null>(null);
  const [orderSummaryOpen, setOrderSummaryOpen] = useState(false);
  const [referralOpen, setReferralOpen] = useState(false);
  const [referralMessage, setReferralMessage] = useState<{
    copy: string;
    tone: FeedbackTone;
  } | null>(null);
  const [newsletterSubscribed, setNewsletterSubscribed] = useState(false);
  const [smsSubscribed, setSmsSubscribed] = useState(false);
  const [saveAddress, setSaveAddress] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [termsError, setTermsError] = useState('');
  const [checkoutError, setCheckoutError] = useState('');
  const [submittingOrder, setSubmittingOrder] = useState(false);
  const [completedOrder, setCompletedOrder] = useState<CheckoutCompletionResult | null>(null);
  const [details, setDetails] = useState({
    email: 'alex.morgan@example.com',
    firstName: 'Alex',
    lastName: 'Morgan',
    address: '123 Palm Avenue',
    apartment: 'Apt 4B',
    city: 'Miami',
    state: 'FL',
    zip: '33130',
    mobile: '',
    card: '4242 4242 4242 4242',
    expiry: '12 / 30',
    securityCode: '123',
  });
  const cartItems = orderedCart ?? cart;
  const shipping = {
    economy: { name: 'Economy', time: '4–8 business days', cents: 399 },
    standard: { name: 'Standard', time: '2–5 business days', cents: 475 },
    priority: { name: 'Priority', time: '2–3 business days', cents: null },
  } as const;
  const selectedShipping = shipping[shippingMethod];
  const hasMobileNumber = details.mobile.replace(/\D/g, '').length === 10;
  const subtotalCents = cartItems.reduce(
    (total, item) => total + item.unitPriceCents * item.quantity,
    0,
  );
  const itemCount = cartItems.reduce((total, item) => total + item.quantity, 0);
  // Kept at zero until discounts are connected to a future checkout source.
  const discountCents = 0;
  const estimatedTotal =
    selectedShipping.cents === null ? null : subtotalCents + selectedShipping.cents - discountCents;
  const referralLink = 'https://letitbe.co/r/ALEXMORGAN';
  const updateDetail = (field: keyof typeof details, value: string) => {
    setDetails((current) => ({ ...current, [field]: value }));
  };
  const completeCheckout = () => {
    if (!termsAccepted) {
      setTermsError('Accept the terms to continue.');
      return;
    }
    if (!onCheckoutCompleted) {
      window.scrollTo({ top: 0 });
      setOrderedCart(cart);
      onComplete();
      setComplete(true);
      return;
    }
    setCheckoutError('');
    setSubmittingOrder(true);
    void onCheckoutCompleted({ ...details, saveAddress })
      .then((result) => {
        window.scrollTo({ top: 0 });
        setCompletedOrder(result);
        setOrderedCart(cart);
        onComplete();
        setComplete(true);
      })
      .catch((error: unknown) =>
        setCheckoutError(
          error instanceof Error
            ? error.message
            : 'We couldn’t complete your order. Please try again.',
        ),
      )
      .finally(() => setSubmittingOrder(false));
  };
  const moveToNextField = (
    event: KeyboardEvent<HTMLInputElement | HTMLSelectElement>,
    nextFieldId: string,
  ) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    document.getElementById(nextFieldId)?.focus();
  };
  const copyReferralLink = async () => {
    if (!navigator.clipboard) {
      setReferralMessage({ copy: 'Select the link above to copy it.', tone: 'info' });
      return;
    }
    try {
      await navigator.clipboard.writeText(referralLink);
      setReferralMessage({ copy: 'Link copied.', tone: 'success' });
    } catch {
      setReferralMessage({ copy: 'Select the link above to copy it.', tone: 'info' });
    }
  };
  const shareReferralLink = async () => {
    if (!navigator.share) {
      await copyReferralLink();
      return;
    }
    try {
      await navigator.share({
        title: 'Make your own shirt with LET IT BE',
        text: 'Get 15% off your first custom shirt.',
        url: referralLink,
      });
      setReferralMessage({ copy: 'Thanks for sharing.', tone: 'success' });
    } catch {
      // Closing the native share sheet is an expected user action.
    }
  };

  if (complete) {
    return (
      <div className="checkout-flow checkout-confirmation" aria-live="polite">
        <div className="checkout-success-mark" aria-hidden="true">
          <FeedbackIcon tone="success" />
        </div>
        <p className="eyebrow">Thank you</p>
        <h1>We’ve got it, {details.firstName}.</h1>
        <p className="checkout-thank-you-copy">
          We’ll send your confirmation and delivery updates to <strong>{details.email}</strong>.
        </p>
        <section className="checkout-confirmation-reference" aria-label="Order reference">
          <span>Order reference</span>
          <strong>{completedOrder?.orderNumber ?? '#LIB-1042'}</strong>
        </section>
        <section
          className="checkout-cart-summary checkout-thank-you-summary"
          aria-label="Order summary"
        >
          {cartItems.map((item) => (
            <CartSummaryLine item={item} key={item.id} />
          ))}
          <div className="checkout-cart-summary-total">
            <span>Total</span>
            <strong>
              {completedOrder
                ? USD_FORMATTER.format(completedOrder.pricing.totalCents / 100)
                : estimatedTotal === null
                  ? `${USD_FORMATTER.format(subtotalCents / 100)} + shipping`
                  : USD_FORMATTER.format(estimatedTotal / 100)}
            </strong>
          </div>
          <p className="checkout-cart-summary-note">Includes product, shipping, and taxes.</p>
        </section>
        {SHOW_REFERRAL_CARD ? (
          <section className="referral-card" aria-labelledby="referral-heading">
            <p className="referral-kicker">Pass it on</p>
            <h2 id="referral-heading">Give 15% off. Get $10 credit.</h2>
            <p>
              Share your link with a friend. When they order their first shirt, your credit is on
              us.
            </p>
            {referralOpen ? (
              <div className="referral-actions">
                <label htmlFor="referral-link">Your personal link</label>
                <input id="referral-link" readOnly value={referralLink} />
                <div>
                  <button onClick={() => void copyReferralLink()} type="button">
                    Copy link
                  </button>
                  <button onClick={() => void shareReferralLink()} type="button">
                    Share
                  </button>
                </div>
                {referralMessage ? (
                  <InlineFeedback className="referral-message" tone={referralMessage.tone}>
                    {referralMessage.copy}
                  </InlineFeedback>
                ) : null}
              </div>
            ) : (
              <button
                className="referral-reveal"
                onClick={() => setReferralOpen(true)}
                type="button"
              >
                Get your link <Icon>→</Icon>
              </button>
            )}
          </section>
        ) : null}
        <button className="create-button" onClick={createAnother} type="button">
          Create another design <Icon>→</Icon>
        </button>
      </div>
    );
  }

  return (
    <div className="checkout-flow">
      <section className="checkout-intro" aria-labelledby="checkout-heading">
        <h1 id="checkout-heading">Checkout</h1>
        <p>
          {cartItems.length === 1
            ? 'Your design is ready to make.'
            : 'Your designs are ready to make.'}
        </p>
      </section>
      <section
        className={`checkout-order-disclosure ${orderSummaryOpen ? 'is-open' : ''}`}
        aria-label="Order summary"
      >
        <button
          aria-controls="checkout-order-items"
          aria-expanded={orderSummaryOpen}
          className="checkout-order-disclosure-trigger"
          onClick={() => setOrderSummaryOpen((current) => !current)}
          type="button"
        >
          <span className="checkout-order-disclosure-copy">
            <strong>Order summary</strong>
            <small>
              {itemCount} {itemCount === 1 ? 'item' : 'items'}
            </small>
          </span>
          <span className="checkout-order-disclosure-value">
            <strong>
              {estimatedTotal === null
                ? `${USD_FORMATTER.format(subtotalCents / 100)} + shipping`
                : USD_FORMATTER.format(estimatedTotal / 100)}
            </strong>
            <i aria-hidden="true" />
          </span>
        </button>
        <div
          aria-hidden={!orderSummaryOpen}
          className="checkout-order-disclosure-panel"
          id="checkout-order-items"
        >
          <div>
            <div className="checkout-cart-summary">
              {cartItems.map((item) => (
                <CartSummaryLine item={item} key={item.id} />
              ))}
            </div>
          </div>
        </div>
      </section>
      <form
        className="checkout-form"
        onSubmit={(event) => {
          event.preventDefault();
          completeCheckout();
        }}
      >
        <section
          className="checkout-section-divider checkout-section-tone is-light"
          aria-labelledby="checkout-contact-heading"
        >
          <h2 id="checkout-contact-heading">Contact</h2>
          <label className="checkout-label" htmlFor="checkout-email">
            Email
          </label>
          <input
            autoComplete="email"
            enterKeyHint="next"
            id="checkout-email"
            onChange={(event) => updateDetail('email', event.target.value)}
            onKeyDown={(event) => moveToNextField(event, 'checkout-first-name')}
            placeholder="you@example.com"
            required
            type="email"
            value={details.email}
          />
          <label className="checkout-consent checkout-newsletter">
            <input
              checked={newsletterSubscribed}
              onChange={(event) => setNewsletterSubscribed(event.target.checked)}
              type="checkbox"
            />
            <span>Send me new drops, offers, and occasional design inspiration.</span>
          </label>
        </section>
        <section
          className="checkout-section-divider checkout-section-tone is-dark"
          aria-labelledby="checkout-delivery-heading"
        >
          <h2 id="checkout-delivery-heading">Delivery</h2>
          <div className="checkout-grid-two">
            <div>
              <label className="checkout-label" htmlFor="checkout-first-name">
                First name
              </label>
              <input
                autoCapitalize="words"
                autoComplete="given-name"
                enterKeyHint="next"
                id="checkout-first-name"
                onChange={(event) => updateDetail('firstName', event.target.value)}
                onKeyDown={(event) => moveToNextField(event, 'checkout-last-name')}
                placeholder="Jane"
                required
                value={details.firstName}
              />
            </div>
            <div>
              <label className="checkout-label" htmlFor="checkout-last-name">
                Last name
              </label>
              <input
                autoCapitalize="words"
                autoComplete="family-name"
                enterKeyHint="next"
                id="checkout-last-name"
                onChange={(event) => updateDetail('lastName', event.target.value)}
                onKeyDown={(event) => moveToNextField(event, 'checkout-address')}
                placeholder="Doe"
                required
                value={details.lastName}
              />
            </div>
          </div>
          <label className="checkout-label" htmlFor="checkout-address">
            Address
          </label>
          <input
            autoCapitalize="words"
            autoComplete="street-address"
            enterKeyHint="next"
            id="checkout-address"
            onChange={(event) => updateDetail('address', event.target.value)}
            onKeyDown={(event) => moveToNextField(event, 'checkout-apartment')}
            placeholder="123 Main Street"
            required
            value={details.address}
          />
          <label className="checkout-label" htmlFor="checkout-apartment">
            Apartment, suite, etc. <span>Optional</span>
          </label>
          <input
            autoCapitalize="characters"
            autoComplete="address-line2"
            enterKeyHint="next"
            id="checkout-apartment"
            onChange={(event) => updateDetail('apartment', event.target.value)}
            onKeyDown={(event) => moveToNextField(event, 'checkout-city')}
            placeholder="Apt 4B"
            value={details.apartment}
          />
          <div className="checkout-grid-two checkout-city-row">
            <div>
              <label className="checkout-label" htmlFor="checkout-city">
                City
              </label>
              <input
                autoCapitalize="words"
                autoComplete="address-level2"
                enterKeyHint="next"
                id="checkout-city"
                onChange={(event) => updateDetail('city', event.target.value)}
                onKeyDown={(event) => moveToNextField(event, 'checkout-state')}
                placeholder="Austin"
                required
                value={details.city}
              />
            </div>
            <div>
              <label className="checkout-label" htmlFor="checkout-state">
                State
              </label>
              <select
                autoComplete="address-level1"
                id="checkout-state"
                onChange={(event) => updateDetail('state', event.target.value)}
                onKeyDown={(event) => moveToNextField(event, 'checkout-zip')}
                required
                value={details.state}
              >
                <option value="">Select</option>
                {US_STATES.map(([code, label]) => (
                  <option key={code} value={code}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <label className="checkout-label" htmlFor="checkout-zip">
            ZIP code
          </label>
          <input
            autoComplete="postal-code"
            enterKeyHint="next"
            id="checkout-zip"
            inputMode="numeric"
            maxLength={10}
            onChange={(event) =>
              updateDetail('zip', event.target.value.replace(/[^0-9-]/g, '').slice(0, 10))
            }
            onKeyDown={(event) => moveToNextField(event, 'checkout-card-number')}
            pattern="[0-9]{5}(-[0-9]{4})?"
            placeholder="12345"
            required
            value={details.zip}
          />
          <label className="checkout-label" htmlFor="checkout-mobile">
            Mobile number <span>Optional</span>
          </label>
          <input
            autoComplete="tel-national"
            enterKeyHint="next"
            id="checkout-mobile"
            inputMode="tel"
            maxLength={14}
            onChange={(event) => {
              const digits = event.target.value.replace(/\D/g, '').slice(0, 10);
              const formatted =
                digits.length > 6
                  ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
                  : digits.length > 3
                    ? `(${digits.slice(0, 3)}) ${digits.slice(3)}`
                    : digits;
              updateDetail('mobile', formatted);
              if (digits.length < 10) setSmsSubscribed(false);
            }}
            onKeyDown={(event) => moveToNextField(event, 'checkout-card-number')}
            placeholder="(305) 555-0123"
            type="tel"
            value={details.mobile}
          />
          <div
            className={`checkout-consent checkout-sms-consent ${hasMobileNumber ? '' : 'is-disabled'}`}
          >
            <input
              checked={smsSubscribed}
              disabled={!hasMobileNumber}
              id="checkout-sms-opt-in"
              onChange={(event) => setSmsSubscribed(event.target.checked)}
              type="checkbox"
            />
            <label htmlFor="checkout-sms-opt-in">
              <span className="checkout-sms-consent-title">
                Send me promotional SMS &amp; WhatsApp messages from LET IT BE.
              </span>
              <small>
                {hasMobileNumber
                  ? 'Message frequency varies. Message and data rates may apply. Reply STOP to opt out or HELP for help. Consent is not a condition of purchase. '
                  : 'Add a valid mobile number to opt in. '}
                <a
                  href="/terms"
                  onClick={(event) => event.stopPropagation()}
                  rel="noreferrer"
                  target="_blank"
                >
                  Terms &amp; Conditions
                </a>{' '}
                &amp;{' '}
                <a
                  href="/privacy"
                  onClick={(event) => event.stopPropagation()}
                  rel="noreferrer"
                  target="_blank"
                >
                  Privacy Policy
                </a>
              </small>
            </label>
          </div>
          <label className="checkout-consent checkout-save-address">
            <input
              checked={saveAddress}
              onChange={(event) => setSaveAddress(event.target.checked)}
              type="checkbox"
            />
            <span>Save this delivery address to my account.</span>
          </label>
        </section>
        <section
          className="checkout-section-divider checkout-section-tone is-light"
          aria-labelledby="checkout-shipping-heading"
        >
          <h2 id="checkout-shipping-heading">Shipping method</h2>
          <div className="checkout-shipping-options" role="group" aria-label="Shipping method">
            {(Object.keys(shipping) as Array<keyof typeof shipping>).map((method) => {
              const option = shipping[method];
              const selected = shippingMethod === method;
              return (
                <button
                  aria-pressed={selected}
                  className={`checkout-shipping-option ${selected ? 'is-selected' : ''}`}
                  key={method}
                  onClick={() => setShippingMethod(method)}
                  type="button"
                >
                  <span aria-hidden="true" className="checkout-radio">
                    {selected ? '•' : ''}
                  </span>
                  <span>
                    <strong>{option.name}</strong>
                    <small>{option.time}</small>
                  </span>
                  <b>
                    {option.cents === null
                      ? 'Calculated'
                      : USD_FORMATTER.format(option.cents / 100)}
                  </b>
                </button>
              );
            })}
          </div>
          <p className="checkout-helper">
            Carrier is selected after fulfillment based on destination and availability.
          </p>
        </section>
        <section
          className="checkout-section-divider checkout-section-tone is-dark"
          aria-labelledby="checkout-payment-heading"
        >
          <h2 id="checkout-payment-heading">Payment</h2>
          <div className="checkout-payment-method">
            <span aria-hidden="true">▰</span>
            <div>
              <strong>Credit or debit card</strong>
            </div>
          </div>
          <label className="checkout-label" htmlFor="checkout-card-number">
            Card number
          </label>
          <input
            autoComplete="cc-number"
            enterKeyHint="next"
            id="checkout-card-number"
            inputMode="numeric"
            maxLength={19}
            onChange={(event) =>
              updateDetail(
                'card',
                event.target.value
                  .replace(/\D/g, '')
                  .slice(0, 16)
                  .replace(/(.{4})/g, '$1 ')
                  .trim(),
              )
            }
            onKeyDown={(event) => moveToNextField(event, 'checkout-expiry')}
            placeholder="0000 0000 0000 0000"
            required
            value={details.card}
          />
          <div className="checkout-grid-two checkout-card-row">
            <div>
              <label className="checkout-label" htmlFor="checkout-expiry">
                Expiration date
              </label>
              <input
                autoComplete="cc-exp"
                enterKeyHint="next"
                id="checkout-expiry"
                inputMode="numeric"
                maxLength={7}
                onChange={(event) => {
                  const digits = event.target.value.replace(/\D/g, '').slice(0, 4);
                  updateDetail(
                    'expiry',
                    digits.length > 2 ? `${digits.slice(0, 2)} / ${digits.slice(2)}` : digits,
                  );
                }}
                onKeyDown={(event) => moveToNextField(event, 'checkout-security-code')}
                placeholder="MM / YY"
                required
                value={details.expiry}
              />
            </div>
            <div>
              <label className="checkout-label" htmlFor="checkout-security-code">
                Security code
              </label>
              <input
                autoComplete="cc-csc"
                enterKeyHint="done"
                id="checkout-security-code"
                inputMode="numeric"
                maxLength={4}
                onChange={(event) =>
                  updateDetail('securityCode', event.target.value.replace(/\D/g, '').slice(0, 4))
                }
                onKeyDown={(event) => moveToNextField(event, 'checkout-terms')}
                placeholder="123"
                required
                value={details.securityCode}
              />
            </div>
          </div>
        </section>
        <section className="checkout-total" aria-label="Order total">
          <div>
            <span>Subtotal</span>
            <strong>{USD_FORMATTER.format(subtotalCents / 100)}</strong>
          </div>
          <div>
            <span>Shipping</span>
            <strong>
              {selectedShipping.cents === null
                ? 'Calculated'
                : USD_FORMATTER.format(selectedShipping.cents / 100)}
            </strong>
          </div>
          {discountCents > 0 ? (
            <div className="checkout-discount">
              <span>Discount</span>
              <strong>{USD_FORMATTER.format(-discountCents / 100)}</strong>
            </div>
          ) : null}
          <div className="checkout-total-final">
            <span>Estimated total</span>
            <strong>
              {estimatedTotal === null
                ? `${USD_FORMATTER.format(subtotalCents / 100)} + shipping`
                : USD_FORMATTER.format(estimatedTotal / 100)}
            </strong>
          </div>
          <p>Taxes will be calculated after delivery address verification.</p>
        </section>
        <div className="checkout-submit-area">
          <div className={`checkout-terms-group ${termsError ? 'has-reminder' : ''}`}>
            <div className="checkout-consent checkout-terms-consent">
              <input
                aria-describedby={termsError ? 'checkout-terms-reminder' : undefined}
                aria-invalid={termsError ? true : undefined}
                checked={termsAccepted}
                id="checkout-terms"
                onChange={(event) => {
                  setTermsAccepted(event.target.checked);
                  setTermsError('');
                }}
                onInvalid={(event) => {
                  event.preventDefault();
                  setTermsError('Accept the terms to continue.');
                }}
                required
                type="checkbox"
              />
              <label htmlFor="checkout-terms">
                I agree to the{' '}
                <a
                  href="/terms"
                  onClick={(event) => event.stopPropagation()}
                  rel="noreferrer"
                  target="_blank"
                >
                  Terms &amp; Conditions
                </a>{' '}
                and{' '}
                <a
                  href="/privacy"
                  onClick={(event) => event.stopPropagation()}
                  rel="noreferrer"
                  target="_blank"
                >
                  Privacy Policy
                </a>
                .
              </label>
            </div>
            {termsError ? (
              <InlineFeedback
                className="checkout-terms-reminder"
                id="checkout-terms-reminder"
                tone="reminder"
              >
                {termsError}
              </InlineFeedback>
            ) : null}
          </div>
          <button
            aria-busy={submittingOrder}
            className="create-button checkout-submit"
            disabled={submittingOrder}
            type="submit"
          >
            {submittingOrder ? 'Completing order…' : 'Place order'} <Icon>→</Icon>
          </button>
          {checkoutError ? (
            <InlineFeedback role="alert" tone="error">
              {checkoutError}
            </InlineFeedback>
          ) : null}
        </div>
      </form>
    </div>
  );
}

function EditorStep({
  color,
  garmentAsset,
  generatedPreviewUrl,
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
  generatedPreviewUrl: string | null;
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
              <ArtworkPreview
                generatedPreviewUrl={generatedPreviewUrl}
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
      <div className="step-actions editor-actions">
        <button className="create-button is-back-action" onClick={onBack} type="button">
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

function ArtworkPreview({
  generatedPreviewUrl,
  prompt,
  style,
  tone,
  version,
}: {
  generatedPreviewUrl: string | null;
  prompt: string;
  style: StyleId | null;
  tone: ToneId;
  version: number;
}) {
  if (generatedPreviewUrl) {
    return (
      <img
        alt=""
        aria-hidden="true"
        className="generated-artwork generated-preview-image"
        src={generatedPreviewUrl}
      />
    );
  }
  return <GeneratedArtwork prompt={prompt} style={style} tone={tone} version={version} />;
}

function generationLifecycleCopy(phase: GenerationLifecyclePhase) {
  if (phase === 'processing') {
    return {
      eyebrow: 'Creating your design',
      title: 'Making it yours…',
      description: 'Combining your idea, style, and shirt color.',
    };
  }
  if (phase === 'validating') {
    return {
      eyebrow: 'Checking your design',
      title: 'Finishing the details…',
      description: 'Making sure your artwork is ready to review.',
    };
  }
  return {
    eyebrow: 'Preparing your design',
    title: 'Getting everything ready…',
    description: 'Your design request is safely in the queue.',
  };
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
            <strong>{CREDIT_PACK_SIZE} credits</strong>
            <span>Credit pack</span>
          </div>
          <b>Price TBD</b>
        </div>
        <button className="create-button" onClick={purchase} type="button">
          Buy credits <Icon>→</Icon>
        </button>
      </div>
    </SelectionSheet>
  );
}

function CartDrawer({
  cart,
  cartError,
  cartIcon,
  cartSaving,
  checkout,
  close,
  closeRef,
  changeQuantity,
  removeItem,
}: {
  cart: CartItem[];
  cartError: string;
  cartIcon: CartIconVariant;
  cartSaving: boolean;
  checkout: () => void;
  close: () => void;
  closeRef: React.RefObject<HTMLButtonElement | null>;
  changeQuantity: (id: string, delta: number) => void;
  removeItem: (id: string) => void;
}) {
  const itemCount = cart.reduce((total, item) => total + item.quantity, 0);
  const subtotalCents = cart.reduce(
    (total, item) => total + item.unitPriceCents * item.quantity,
    0,
  );
  return (
    <div
      className="overlay cart-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <aside
        aria-labelledby="cart-title"
        aria-modal="true"
        className="drawer cart-drawer"
        role="dialog"
      >
        <div className="drawer-header">
          <strong id="cart-title">Your cart{itemCount ? ` · ${itemCount}` : ''}</strong>
          <button aria-label="Close cart" onClick={close} ref={closeRef} type="button">
            ×
          </button>
        </div>
        {cart.length ? (
          <>
            {cartError ? (
              <InlineFeedback role="alert" tone="error">
                {cartError}
              </InlineFeedback>
            ) : null}
            <div className="cart-item-list">
              {cart.map((item) => {
                const itemColor = PRODUCT_COLORS.find((color) => color.id === item.color)!;
                const itemSize = SIZES.find((size) => size.id === item.size)!;
                return (
                  <article className="cart-item" key={item.id}>
                    <div
                      aria-label="Saved design preview"
                      className="cart-item-art"
                    >
                      <ArtworkPreview
                        generatedPreviewUrl={item.generatedPreviewUrl ?? null}
                        prompt={item.prompt}
                        style={item.style}
                        tone={item.tone}
                        version={item.generationVersion}
                      />
                    </div>
                    <div className="cart-item-copy">
                      <strong>{PRODUCT_PROFILE.name}</strong>
                      <span>
                        {itemColor.name} · {itemSize.name}
                      </span>
                      <b>{USD_FORMATTER.format((item.unitPriceCents * item.quantity) / 100)}</b>
                      <div className="cart-item-actions">
                        <div className="cart-item-quantity" aria-label="Quantity">
                          <button
                            aria-label={`Decrease ${PRODUCT_PROFILE.name} quantity`}
                            disabled={cartSaving || item.quantity === 1}
                            onClick={() => changeQuantity(item.id, -1)}
                            type="button"
                          >
                            −
                          </button>
                          <output
                            aria-live="polite"
                            aria-label={`${item.quantity} ${item.quantity === 1 ? 'item' : 'items'}`}
                          >
                            {item.quantity}
                          </output>
                          <button
                            aria-label={`Increase ${PRODUCT_PROFILE.name} quantity`}
                            disabled={cartSaving}
                            onClick={() => changeQuantity(item.id, 1)}
                            type="button"
                          >
                            +
                          </button>
                        </div>
                        <button
                          className="cart-item-remove"
                          disabled={cartSaving}
                          onClick={() => removeItem(item.id)}
                          type="button"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
            <div className="cart-subtotal">
              <span>Subtotal</span>
              <strong>{USD_FORMATTER.format(subtotalCents / 100)}</strong>
            </div>
            <p className="cart-shipping-note">Shipping and taxes are calculated at checkout.</p>
            <button className="create-button checkout-button" onClick={checkout} type="button">
              Checkout <Icon>→</Icon>
            </button>
          </>
        ) : (
          <div className="cart-empty">
            <CartGlyph variant={cartIcon} />
            <h2>Your cart is empty.</h2>
            <p>
              Save a design when it’s ready, then come back here whenever you want to check out.
            </p>
            <button onClick={close} type="button">
              Continue creating
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}

function NavigationDrawer({
  cartQuantity,
  close,
  closeRef,
  openAccount,
  openCart,
  signedInEmail,
  signOut,
  startNewDesign,
}: {
  cartQuantity: number;
  close: () => void;
  closeRef: React.RefObject<HTMLButtonElement | null>;
  openAccount: () => void;
  openCart: () => void;
  signedInEmail: string | null;
  signOut: () => void;
  startNewDesign: () => void;
}) {
  return (
    <div className="overlay fullscreen-menu-overlay" role="presentation">
      <nav
        aria-label="Main navigation"
        aria-modal="true"
        className="fullscreen-menu"
        onKeyDown={(event) => {
          if (event.key === 'Escape') close();
        }}
        role="dialog"
      >
        <div className="fullscreen-menu-header">
          <strong>LET IT BE</strong>
          <button aria-label="Close menu" onClick={close} ref={closeRef} type="button">
            ×
          </button>
        </div>
        <div className="fullscreen-menu-links">
          <button className="fullscreen-menu-primary" onClick={startNewDesign} type="button">
            <span>Make a shirt</span>
            <span aria-hidden="true">→</span>
          </button>
          <button type="button">My designs</button>
          <button onClick={openCart} type="button">
            <span>My cart</span>
            {cartQuantity ? <b>{cartQuantity}</b> : null}
          </button>
          <button type="button">How it works</button>
          <a href="/faq">Help &amp; support</a>
        </div>
        <footer className="fullscreen-menu-footer">
          {signedInEmail ? (
            <div className="fullscreen-menu-account">
              <span>Signed in as {signedInEmail}</span>
              <button onClick={openAccount} type="button">
                My account
              </button>
              <button onClick={signOut} type="button">
                Sign out
              </button>
            </div>
          ) : (
            <button className="fullscreen-menu-sign-in" onClick={openAccount} type="button">
              Sign in
            </button>
          )}
          <div aria-label="Helpful links" className="fullscreen-menu-utility-links">
            <a href="/shipping">Shipping</a>
            <a href="/payments">Payments</a>
            <a href="/returns">Returns</a>
            <a href="/faq">FAQ</a>
            <a href="/contact">Contact</a>
            <a href="/terms">Terms</a>
            <a href="/privacy">Privacy</a>
          </div>
        </footer>
      </nav>
    </div>
  );
}

function PasswordlessSignInPage({
  authEmail,
  authEmailRef,
  authError,
  authNotice,
  changeEmail,
  close,
  continueWithEmail,
  onAuthEmailChange,
  onVerificationCodeChange,
  resendCode,
  stage,
  suggestedCode,
  verificationCode,
  verificationCodeRef,
  verifyCode,
}: {
  authEmail: string;
  authEmailRef: React.RefObject<HTMLInputElement | null>;
  authError: string;
  authNotice: string;
  changeEmail: () => void;
  close: () => void;
  continueWithEmail: () => void;
  onAuthEmailChange: (value: string) => void;
  onVerificationCodeChange: (value: string) => void;
  resendCode: () => void;
  stage: 'email' | 'code';
  suggestedCode: string;
  verificationCode: string;
  verificationCodeRef: React.RefObject<HTMLInputElement | null>;
  verifyCode: () => void;
}) {
  const isEmailStage = stage === 'email';
  const feedbackId = isEmailStage ? 'signin-email-feedback' : 'signin-code-feedback';
  return (
    <div className="overlay account-overlay" role="presentation">
      <section
        aria-label="Passwordless sign in"
        aria-modal="true"
        className="account-page"
        onKeyDown={(event) => {
          if (event.key === 'Escape') close();
        }}
        role="dialog"
      >
        <header className="account-page-header">
          <button aria-label="Back to menu" className="account-back" onClick={close} type="button">
            <Icon>←</Icon>
          </button>
          <strong>LET IT BE</strong>
          <span aria-hidden="true" />
        </header>
        <div className="account-page-content">
          <p className="account-kicker">Passwordless sign in</p>
          {isEmailStage ? (
            <form
              className="account-form"
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                continueWithEmail();
              }}
            >
              <h1>Good to see you.</h1>
              <p>Enter your email and we’ll send a secure sign-in code.</p>
              <label htmlFor="signin-email">Email address</label>
              <input
                aria-describedby={authError ? feedbackId : undefined}
                aria-invalid={authError ? true : undefined}
                autoComplete="email"
                enterKeyHint="next"
                id="signin-email"
                inputMode="email"
                onChange={(event) => onAuthEmailChange(event.target.value)}
                placeholder="you@example.com"
                ref={authEmailRef}
                type="email"
                value={authEmail}
              />
              {authError ? (
                <InlineFeedback id={feedbackId} role="alert" tone="reminder">
                  {authError}
                </InlineFeedback>
              ) : null}
              <button className="create-button account-submit" type="submit">
                Continue with email <Icon>→</Icon>
              </button>
              <p className="account-helper">
                New here? We’ll create your passwordless account automatically after you verify your
                email.
              </p>
              <p className="account-legal">
                By continuing, you agree to our{' '}
                <a href="/terms" rel="noreferrer" target="_blank">
                  Terms &amp; Conditions
                </a>{' '}
                and{' '}
                <a href="/privacy" rel="noreferrer" target="_blank">
                  Privacy Policy
                </a>
                .
              </p>
            </form>
          ) : (
            <form
              className="account-form"
              onSubmit={(event) => {
                event.preventDefault();
                verifyCode();
              }}
            >
              <h1>Enter your code.</h1>
              <p>We sent a six-digit code to:</p>
              <button className="account-email-change" onClick={changeEmail} type="button">
                {authEmail} <span>· Change email</span>
              </button>
              <label htmlFor="signin-code">Verification code</label>
              <div className="otp-field" data-filled={verificationCode.length}>
                <div aria-hidden="true" className="otp-slots">
                  {Array.from({ length: 6 }, (_, index) => (
                    <span
                      className={[
                        verificationCode[index] ? 'is-filled' : '',
                        index === verificationCode.length ? 'is-active' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      key={index}
                    >
                      {verificationCode[index] ?? ''}
                    </span>
                  ))}
                </div>
                <input
                  aria-describedby={authError ? feedbackId : undefined}
                  aria-invalid={authError ? true : undefined}
                  aria-label="Verification code"
                  autoComplete="one-time-code"
                  enterKeyHint="done"
                  id="signin-code"
                  inputMode="numeric"
                  maxLength={6}
                  name="one-time-code"
                  onChange={(event) => onVerificationCodeChange(event.target.value)}
                  pattern="[0-9]*"
                  ref={verificationCodeRef}
                  type="text"
                  value={verificationCode}
                />
              </div>
              <button
                aria-label={`Autofill code ${suggestedCode}`}
                className="otp-autofill-suggestion"
                onClick={() => onVerificationCodeChange(suggestedCode)}
                type="button"
              >
                <span aria-hidden="true">✦</span>
                <span>One-time code</span>
                <strong>{suggestedCode}</strong>
              </button>
              {authError ? (
                <InlineFeedback id={feedbackId} role="alert" tone="reminder">
                  {authError}
                </InlineFeedback>
              ) : null}
              <button className="create-button account-submit" type="submit">
                Sign in <Icon>→</Icon>
              </button>
              <p className="account-resend">
                Didn’t receive it?{' '}
                <button onClick={resendCode} type="button">
                  Resend code
                </button>
              </p>
              {authNotice ? <InlineFeedback tone="info">{authNotice}</InlineFeedback> : null}
              <p className="account-helper">The code expires in 10 minutes. Keep it private.</p>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}

function AccountPage({
  credits,
  close,
  getMoreCredits,
  signedInEmail,
}: {
  credits: number;
  close: () => void;
  getMoreCredits: () => void;
  signedInEmail: string;
}) {
  const [view, setView] = useState<
    | 'overview'
    | 'personal'
    | 'addresses'
    | 'designs'
    | 'design-detail'
    | 'credits'
    | 'orders'
    | 'order-detail'
  >('overview');
  const [name, setName] = useState('Alex Morgan');
  const [addresses, setAddresses] = useState(['245 Ocean Drive, Miami, FL 33139']);
  const [draftAddress, setDraftAddress] = useState('');
  const [designs, setDesigns] = useState(['Coastal dreams', 'More sun']);
  const [selectedDesign, setSelectedDesign] = useState('Coastal dreams');
  const heading =
    view === 'overview'
      ? 'My account'
      : view === 'personal'
        ? 'Personal details'
        : view === 'addresses'
          ? 'Addresses'
          : view === 'designs' || view === 'design-detail'
            ? 'Saved designs'
            : view === 'credits'
              ? 'Design credits'
              : 'Orders';
  const returnBack = () => (view === 'overview' ? close() : setView('overview'));
  const openDesign = (design: string) => {
    setSelectedDesign(design);
    setView('design-detail');
  };
  return (
    <div className="overlay account-overlay" role="presentation">
      <section
        aria-label={heading}
        aria-modal="true"
        className="account-page account-hub"
        role="dialog"
      >
        <header className="account-page-header">
          <button aria-label="Back" className="account-back" onClick={returnBack} type="button">
            <Icon>←</Icon>
          </button>
          <strong>LET IT BE</strong>
          <span aria-hidden="true" />
        </header>
        <div className="account-hub-content">
          <p className="account-kicker">{heading}</p>
          {view === 'overview' ? (
            <>
              <h1>Hi, {name.split(' ')[0]}.</h1>
              <p className="account-email">{signedInEmail}</p>
              <AccountSection
                title="Personal & addresses"
                action="Edit"
                onAction={() => setView('personal')}
              >
                <button
                  className="account-summary-card"
                  onClick={() => setView('addresses')}
                  type="button"
                >
                  <b>{name}</b>
                  <span>
                    {addresses[0] ?? 'Add a delivery address'} <em>›</em>
                  </span>
                </button>
              </AccountSection>
              <AccountSection
                title="Saved designs"
                action="View all"
                onAction={() => setView('designs')}
              >
                <div className="account-design-grid">
                  {designs.slice(0, 2).map((design) => (
                    <button key={design} onClick={() => openDesign(design)} type="button">
                      <span>{design}</span>
                      <b>Ready to customise</b>
                    </button>
                  ))}
                </div>
              </AccountSection>
              <AccountSection
                title="Design credits"
                action="View history"
                onAction={() => setView('credits')}
              >
                <button
                  className="account-credits-card"
                  onClick={() => setView('credits')}
                  type="button"
                >
                  <span>Available to create</span>
                  <b>{credits} credits</b>
                  <small>
                    Generated “Coastal dreams” <strong>−1</strong>
                  </small>
                  <em>Sep 8, 2026 · 11:42 AM</em>
                </button>
              </AccountSection>
              <AccountSection title="Orders" action="View all" onAction={() => setView('orders')}>
                <button
                  className="account-summary-card"
                  onClick={() => setView('order-detail')}
                  type="button"
                >
                  <b>#LIB-1042</b>
                  <span>
                    1 custom shirt · In production <em>›</em>
                  </span>
                </button>
              </AccountSection>
            </>
          ) : null}
          {view === 'personal' ? (
            <form
              className="account-editor"
              onSubmit={(event) => {
                event.preventDefault();
                setView('overview');
              }}
            >
              <h1>Your details.</h1>
              <label htmlFor="account-name">Full name</label>
              <input
                id="account-name"
                onChange={(event) => setName(event.target.value)}
                value={name}
              />
              <label htmlFor="account-email-edit">Email</label>
              <input id="account-email-edit" readOnly value={signedInEmail} />
              <button className="create-button" type="submit">
                Save changes <Icon>→</Icon>
              </button>
              <button
                className="account-text-action"
                onClick={() => setView('addresses')}
                type="button"
              >
                Manage addresses
              </button>
            </form>
          ) : null}
          {view === 'addresses' ? (
            <div className="account-editor">
              <h1>Your addresses.</h1>
              {addresses.map((address, index) => (
                <div className="account-address-card" key={address}>
                  <b>{index === 0 ? 'Default delivery address' : 'Saved address'}</b>
                  <span>
                    {name}
                    <br />
                    {address}
                  </span>
                  <button
                    onClick={() =>
                      setAddresses((items) => items.filter((item) => item !== address))
                    }
                    type="button"
                  >
                    Remove
                  </button>
                </div>
              ))}
              <label htmlFor="new-address">Add an address</label>
              <input
                id="new-address"
                onChange={(event) => setDraftAddress(event.target.value)}
                placeholder="Street, city, state, ZIP"
                value={draftAddress}
              />
              <button
                className="create-button"
                onClick={() => {
                  if (draftAddress.trim()) {
                    setAddresses((items) => [...items, draftAddress.trim()]);
                    setDraftAddress('');
                  }
                }}
                type="button"
              >
                Add address <Icon>→</Icon>
              </button>
            </div>
          ) : null}
          {view === 'designs' ? (
            <div className="account-list-view">
              <h1>Your designs.</h1>
              {designs.map((design) => (
                <button
                  className="account-list-row"
                  key={design}
                  onClick={() => openDesign(design)}
                  type="button"
                >
                  <b>{design}</b>
                  <span>Saved design · Ready to customise</span>
                  <em>›</em>
                </button>
              ))}
            </div>
          ) : null}
          {view === 'design-detail' ? (
            <div className="account-list-view">
              <h1>{selectedDesign}.</h1>
              <div className="account-design-preview">{selectedDesign}</div>
              <p>Saved design ready for another shirt.</p>
              <button className="create-button" onClick={() => setView('overview')} type="button">
                Use this design <Icon>→</Icon>
              </button>
              <button
                className="account-text-action"
                onClick={() => {
                  setDesigns((items) => items.filter((item) => item !== selectedDesign));
                  setView('designs');
                }}
                type="button"
              >
                Remove design
              </button>
            </div>
          ) : null}
          {view === 'credits' ? (
            <div className="account-list-view">
              <h1>{credits} design credits.</h1>
              <button className="create-button" onClick={getMoreCredits} type="button">
                Get more credits <Icon>→</Icon>
              </button>
              <h2>History</h2>
              <AccountLog
                label="Generated “Coastal dreams”"
                timestamp="Sep 8, 2026 · 11:42 AM"
                value="−1"
              />
              <AccountLog label="Credit pack added" timestamp="Sep 7, 2026 · 4:18 PM" value="+5" />
            </div>
          ) : null}
          {view === 'orders' ? (
            <div className="account-list-view">
              <h1>Your orders.</h1>
              <button
                className="account-list-row"
                onClick={() => setView('order-detail')}
                type="button"
              >
                <b>#LIB-1042</b>
                <span>Sep 8 · In production</span>
                <em>›</em>
              </button>
            </div>
          ) : null}
          {view === 'order-detail' ? (
            <div className="account-list-view">
              <h1>Order #LIB-1042.</h1>
              <AccountLog label="Classic T-Shirt · Black · M" value="$29.00" />
              <AccountLog label="Shipping to" value="Miami, FL" />
              <AccountLog label="Order total" value="$36.48" />
              <p className="account-status">In production</p>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function AccountSection({
  title,
  action,
  onAction,
  children,
}: {
  title: string;
  action: string;
  onAction: () => void;
  children: ReactNode;
}) {
  return (
    <section className="account-section">
      <div>
        <h2>{title}</h2>
        <button onClick={onAction} type="button">
          {action}
        </button>
      </div>
      {children}
    </section>
  );
}
function AccountLog({
  label,
  timestamp,
  value,
}: {
  label: string;
  timestamp?: string;
  value: string;
}) {
  return (
    <div className="account-log">
      <span>
        {label}
        {timestamp ? <small>{timestamp}</small> : null}
      </span>
      <b>{value}</b>
    </div>
  );
}
