export const LightColors = {
  black: '#0A0A0A',
  white: '#FFFFFF',
  yellow: '#FFD000',
  yellowDark: '#E5C000',
  yellowLight: '#FFFDE7',
  offWhite: '#F5F5F0',
  gray100: '#F0F0F0',
  gray200: '#E0E0E0',
  gray400: '#AAAAAA',
  gray600: '#666666',
  gray800: '#333333',
};

export const DarkColors = {
  black: '#FFFFFF',
  white: '#111111',
  yellow: '#FFD000',
  yellowDark: '#E5C000',
  yellowLight: 'rgba(255,208,0,0.10)',
  offWhite: '#080808',
  gray100: '#1E1E1E',
  gray200: '#2A2A2A',
  gray400: '#8E8E93',
  gray600: '#AEAEB2',
  gray800: '#C7C7CC',
};

export type ThemeColors = typeof LightColors;

export const Colors = LightColors;

export const Gradients = {
  yellow: ['#FFD000', '#E5C000'] as const,
  dark: ['#0A0A0A', '#1C1C1C'] as const,
  yellowSubtle: ['#FFFDE7', '#FFF9CC'] as const,
};

export const Radius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 18,
  pill: 100,
};

// Neobrutalist flat offset shadow — hard edge, no blur
export const Shadow = {
  card: {
    shadowColor: '#0A0A0A',
    shadowOffset: { width: 3, height: 3 },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: 4,
  },
  strong: {
    shadowColor: '#0A0A0A',
    shadowOffset: { width: 5, height: 5 },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: 6,
  },
  yellow: {
    shadowColor: '#FFD000',
    shadowOffset: { width: 4, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: 5,
  },
};

export const Border = {
  neo: {
    borderWidth: 2,
    borderColor: '#0A0A0A',
  },
};

export const TAB_BAR_CLEARANCE = 120;

export const Typography = {
  display: {
    fontFamily: 'TitanOne_400Regular',
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
  },
  h2: { fontFamily: 'Inter_700Bold', letterSpacing: -0.5 },
  h3: { fontFamily: 'Inter_600SemiBold' },
  body: { fontFamily: 'Inter_400Regular' },
  caption: { fontFamily: 'Inter_300Light' },
};
