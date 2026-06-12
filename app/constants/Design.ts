// ── Design tokens — Rustig direction ─────────────────────────────────────────
// Warm, calm, airy. Big radii, soft warm shadows, amber yellow accent.

export const LightColors = {
  // Core
  black: '#25201A',
  white: '#FFFFFF',
  // Accent
  yellow: '#F3B500',
  yellowDark: '#D9A000',
  yellowText: '#8A6500',
  yellowLight: '#FBEDBE',
  // Backgrounds
  offWhite: '#FAF6EF',
  // Surfaces
  gray100: '#F1EBE0',
  gray200: '#E4DBD0',
  gray400: '#8C8275',
  gray600: '#5C5650',
  gray800: '#3A3530',
  // Semantic aliases (use these in components when possible)
  surface: '#FFFFFF',
  surface2: '#F1EBE0',
  surface3: '#F7F2E9',
  hairline: 'rgba(37,32,26,0.07)' as string,
};

export const DarkColors = {
  black: '#F4EFE4',
  white: '#1F1B14',
  yellow: '#F5C033',
  yellowDark: '#D9A000',
  yellowText: '#F5C033',
  yellowLight: 'rgba(245,192,51,0.15)' as string,
  offWhite: '#15120D',
  gray100: '#2A251C',
  gray200: '#3A3228',
  gray400: '#A79E8D',
  gray600: '#C7C2B8',
  gray800: '#E0DBD4',
  surface: '#1F1B14',
  surface2: '#2A251C',
  surface3: '#241F18',
  hairline: 'rgba(255,255,255,0.08)' as string,
};

export type ThemeColors = typeof LightColors;

export const Colors = LightColors;

// ── Tone palette — for list tiles, agenda events, note tags ───────────────────
export const Tones = {
  sage: { lightBg: '#E6EDDD', lightFg: '#5C7351', darkBg: '#283027', darkFg: '#A9C39B' },
  sky:  { lightBg: '#E0E9F1', lightFg: '#46607A', darkBg: '#222E38', darkFg: '#9FC0DA' },
  clay: { lightBg: '#F3E4D5', lightFg: '#8E5F3D', darkBg: '#352819', darkFg: '#D6A576' },
  lav:  { lightBg: '#E9E4F1', lightFg: '#5F5380', darkBg: '#2B2738', darkFg: '#B9AEDC' },
  rose: { lightBg: '#F4E2E2', lightFg: '#8E5151', darkBg: '#352427', darkFg: '#D89E9E' },
  teal: { lightBg: '#DEEBE8', lightFg: '#3F6F66', darkBg: '#1E2E2B', darkFg: '#84C2B7' },
} as const;
export type ToneKey = keyof typeof Tones;
export const TONE_ORDER: ToneKey[] = ['sage', 'sky', 'clay', 'lav', 'rose', 'teal'];

export function getTone(index: number, isDark: boolean) {
  const t = Tones[TONE_ORDER[Math.abs(index) % TONE_ORDER.length]];
  return { bg: isDark ? t.darkBg : t.lightBg, fg: isDark ? t.darkFg : t.lightFg };
}

export const Gradients = {
  yellow: ['#F3B500', '#D9A000'] as const,
  dark: ['#25201A', '#3A3530'] as const,
  yellowSubtle: ['#FBEDBE', '#F7E5A0'] as const,
};

export const Radius = {
  sm: 12,
  md: 16,
  lg: 24,    // card radius
  xl: 28,    // large card / sheet
  pill: 100,
};

export const Shadow = {
  card: {
    shadowColor: '#4A3A1E',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 3,
  },
  strong: {
    shadowColor: '#4A3A1E',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 28,
    elevation: 8,
  },
  yellow: {
    shadowColor: '#F3B500',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.30,
    shadowRadius: 12,
    elevation: 6,
  },
};

export const TAB_BAR_CLEARANCE = 104;

export const Typography = {
  display: {
    fontFamily: 'TitanOne_400Regular',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
  },
  h2: { fontFamily: 'Inter_700Bold', letterSpacing: -0.5 },
  h3: { fontFamily: 'Inter_600SemiBold' },
  body: { fontFamily: 'Inter_400Regular' },
  caption: { fontFamily: 'Inter_300Light' },
};
