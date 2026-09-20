// Single source of truth for the overlays in these docs videos. The values are
// screenci.com's own theme (the site's --primary, --card, --foreground, and
// --radius tokens), so every overlay looks like the product it is drawn over.
// Change values here, never in a component.
export const theme = {
  accent: 'oklch(0.705 0.213 47.604)',
  accentSoft: 'oklch(0.705 0.213 47.604 / 0.22)',
  surface: 'oklch(0.216 0.006 56.043)',
  text: 'oklch(0.985 0.001 106.423)',
  muted: 'oklch(0.709 0.01 56.259)',
  radius: 12,
  ringWidth: 3,
  fontFamily: 'inherit',
} as const
