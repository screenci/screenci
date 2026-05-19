/**
 * Default values applied to every field of {@link RenderOptions} that has a
 * default. Used by {@link EventRecorder} when writing `data.json` so that the
 * file always contains a fully-resolved set of render options.
 */
export const RENDER_OPTIONS_DEFAULTS = {
  recording: {
    size: 1.0,
    roundness: 0,
    shape: 'rounded',
    dropShadow: 'drop-shadow(0 8px 24px rgba(0,0,0,0.5))',
  },
  narration: {
    size: 0.3,
    roundness: 0,
    shape: 'rounded',
    corner: 'bottom-right',
    padding: 0.04,
    dropShadow: 1,
  },
  mouse: {
    size: 0.05,
  },
  output: {
    aspectRatio: '16:9',
    quality: '1080p',
    background: {
      backgroundCss:
        'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
    },
  },
}
