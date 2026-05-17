export const LightColors = {
  black: '#0A0A0A',
  white: '#FFFFFF',
  yellow: '#FCC10C',
  yellowDark: '#E5A800',
  yellowLight: '#FFF9CC',
  offWhite: '#F7F7F7',
  gray100: '#F0F0F0',
  gray200: '#E0E0E0',
  gray400: '#AAAAAA',
  gray600: '#666666',
  gray800: '#333333',
};

export const DarkColors = {
  black: '#FFFFFF',
  white: '#111111',
  yellow: '#FCC10C',
  yellowDark: '#E5A800',
  yellowLight: 'rgba(252,193,12,0.10)',
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
  yellow: ['#FCC10C', '#E5A800'] as const,
  dark: ['#0A0A0A', '#1C1C1C'] as const,
  yellowSubtle: ['#FFFDE7', '#FFF9CC'] as const,
};

export const Radius = {
  sm: 10,
  md: 16,
  lg: 20,
  xl: 28,
  pill: 100,
};

export const Shadow = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 4,
  },
  strong: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.22,
    shadowRadius: 20,
    elevation: 8,
  },
  yellow: {
    shadowColor: '#FCC10C',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
};

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
