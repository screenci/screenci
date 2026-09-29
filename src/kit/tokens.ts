/**
 * The kit's visual constants, in CSS px of the recording viewport (the
 * renderer scales them with the recording, so they stay proportional at every
 * output size). Colours, radius and font come from the theme; everything
 * else that makes the primitives look like one family lives here.
 */
export const KIT = {
  ring: { width: 3, glow: 6, margin: 6, bleed: 16 },
  spotlight: { dim: 0.55, margin: 8 },
  callout: {
    fontSize: 18,
    lineHeight: 1.3,
    fontWeight: 600,
    paddingY: 10,
    paddingX: 14,
    maxWidth: 360,
    pointer: 14,
    gap: 14,
    bleed: 24,
    shadow: '0 10px 30px rgba(0, 0, 0, 0.28)',
  },
  badge: {
    fontSize: 14,
    fontWeight: 600,
    paddingY: 4,
    paddingX: 10,
    letterSpacing: '0.04em',
    gap: 8,
    bleed: 12,
  },
  step: { size: 32, fontSize: 16, fontWeight: 700, gap: 10, bleed: 16 },
  title: {
    titleSize: 56,
    subtitleSize: 24,
    inset: 0.08,
    lightScrim: 'rgba(255, 255, 255, 0.55)',
    darkScrim: 'rgba(0, 0, 0, 0.35)',
  },
  keys: {
    fontSize: 20,
    fontWeight: 600,
    paddingY: 4,
    paddingX: 8,
    radius: 6,
    gap: 8,
    bleed: 12,
  },
  fadeMs: 180,
} as const
