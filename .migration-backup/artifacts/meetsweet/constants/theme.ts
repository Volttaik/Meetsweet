/**
 * MeetSweet authenticated-app design tokens.
 * Visual identity: Pure black background, pure white foreground.
 * No transparency, no blur, no glassmorphism.
 */
export const T = {
  // Backgrounds
  BG: '#000000',
  SURFACE: '#111111',
  SURFACE_2: '#1A1A1A',

  // Borders
  BORDER: 'rgba(255,255,255,0.07)',
  BORDER_2: 'rgba(255,255,255,0.12)',

  // Text
  TEXT: '#FFFFFF',
  TEXT_2: 'rgba(255,255,255,0.45)',
  TEXT_3: 'rgba(255,255,255,0.2)',

  // Status
  SUCCESS: '#22C55E',
  ERROR: '#EF4444',

  // Typography (Poppins loaded in root layout)
  FONT: {
    regular: 'Poppins_400Regular' as const,
    medium: 'Poppins_500Medium' as const,
    semibold: 'Poppins_600SemiBold' as const,
    bold: 'Poppins_700Bold' as const,
  },

  // Border radius scale
  RADIUS: {
    xs: 6,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
    full: 999,
  },
} as const;
