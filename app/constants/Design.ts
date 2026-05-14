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
  white: '#1C1C1E',
  yellow: '#FCC10C',
  yellowDark: '#E5A800',
  yellowLight: 'rgba(255,246,204,0.08)',
  offWhite: '#0A0A0A',
  gray100: '#2C2C2E',
  gray200: '#3A3A3C',
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
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 3,
  },
  strong: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.14,
    shadowRadius: 16,
    elevation: 6,
  },
};
