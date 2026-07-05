import type {
  AspectRatio,
  AutoZoomOptions,
  FPS,
  Quality,
  RecordUploadPolicy,
  RecordOptions,
  VideoEncoderPreset,
} from './types.js'

// DOCS_SYNC:
// If you change any default here, update the docs that surface user-visible
// defaults, especially:
// - docs/configuration.md
// - docs/camera-and-zooming.md
// - README.md
export const DEFAULT_ZOOM_OPTIONS: Required<AutoZoomOptions> = {
  easing: 'ease-out',
  duration: 750,
  zoomOutDuration: 600,
  amount: 0.72,
  padding: 0.2,
  centering: 1,
  preZoomDelay: 0,
  postZoomDelay: 200,
}

/**
 * Comfort-band inset used when a plain interaction (click, tap, hover, fill, ...)
 * scrolls a target into view WITHOUT zooming. Placement uses the single unified
 * direction-aware comfort band shared by every focus operation: the target is
 * moved the MINIMUM needed to bring it into the band, so a target reached by
 * scrolling down rests near the bottom, one reached by scrolling up rests near
 * the top, and an already-comfortable target is not moved at all. `0` reveals the
 * target at the nearest edge (pure minimal reveal), `1` collapses the band so it
 * always centers, and `0.2` keeps a comfortable margin at the framing edges. An
 * explicit per-interaction `autoZoomOptions: { centering }` overrides this value
 * and is itself run through the band (so it stays direction-aware).
 */
export const DEFAULT_SCROLL_CENTERING = 0.2

/**
 * Comfort-band inset used when `autoZoom` frames the interacted element (as
 * opposed to `zoomTo`, which centers at `1`). Placement uses the same
 * direction-aware comfort band as every other focus operation: the target is
 * moved only as far as needed to enter the band, so it settles slightly toward
 * the edge it came from rather than dead center. `0.6` keeps auto-zoom framing
 * tight while leaving a little breathing room on the entering side. Override per
 * zoom with `autoZoomOptions: { centering }`.
 */
export const DEFAULT_AUTO_ZOOM_CENTERING = 0.6

/**
 * Default cursor move duration for click-like actions, in milliseconds.
 */
export const DEFAULT_CLICK_MOUSE_MOVE_DURATION: number = 900

/**
 * Minimum number of intermediate cursor dispatches spread across the drag phase
 * of `dragTo`. The normal cursor throttle (`DEFAULT_MOUSE_FRAME_SKIP`) keeps
 * recorded cursor dispatches sparse because the cursor is redrawn at render time,
 * but a drag needs a denser stream of real mouse-move events so the browser
 * tracks the gesture (a slider thumb following the pointer, drag-and-drop hit
 * testing). Applied over the drag duration, so a longer drag still dispatches at
 * least this many moves. Override per call with `dragTo`'s `dragSteps` option.
 */
export const DEFAULT_DRAG_STEPS = 24

/**
 * Default aspect ratio for recording and output
 */
export const DEFAULT_ASPECT_RATIO: AspectRatio = '16:9'

/**
 * Default resolution quality preset
 */
export const DEFAULT_QUALITY: Quality = '1080p'

/**
 * Default device scale factor (DPR) for screenshots. Stills default to 2 so they
 * are crisp; override with `recordOptions.deviceScaleFactor`. Video ignores this
 * (the screencast encoder needs frames at the viewport resolution).
 */
export const DEFAULT_SCREENSHOT_DEVICE_SCALE_FACTOR = 2

/**
 * Default frames per second for video recording
 */
export const DEFAULT_FPS: FPS = 60

/**
 * Default directory for recordings (videos and screenshots)
 */
export const DEFAULT_RECORDING_DIR: string = './recordings'

/**
 * Default upload policy for `screenci record`
 */
export const DEFAULT_RECORD_UPLOAD_POLICY: RecordUploadPolicy = 'passed-only'

/**
 * Default test timeout in milliseconds (30 minutes)
 */
export const DEFAULT_TIMEOUT: number = 30 * 60 * 1000

/**
 * Default action timeout in milliseconds (30 seconds)
 *
 * Keeps individual actions (click, fill, etc.) at a sane timeout
 * independent of the long test timeout.
 */
export const DEFAULT_ACTION_TIMEOUT: number = 30_000

/**
 * Default navigation timeout in milliseconds (30 seconds)
 *
 * Keeps page navigations at a sane timeout independent of the long test timeout.
 */
export const DEFAULT_NAVIGATION_TIMEOUT: number = 30_000

/**
 * Default capture encoder preset. `'fast'` is the safest baseline (lightest
 * encode, never falls behind realtime on weak runners). The `init`-scaffolded
 * config opts into `'sharp'` locally for crisper text and keeps `'fast'` in CI.
 */
export const DEFAULT_VIDEO_ENCODER: VideoEncoderPreset = 'fast'

/**
 * Default video options combining all video-related defaults
 */
export const DEFAULT_VIDEO_OPTIONS: RecordOptions = {
  aspectRatio: DEFAULT_ASPECT_RATIO,
  quality: DEFAULT_QUALITY,
  fps: DEFAULT_FPS,
  encoder: DEFAULT_VIDEO_ENCODER,
}
