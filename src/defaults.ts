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
 * Default cursor move duration for click-like actions, in milliseconds.
 */
export const DEFAULT_CLICK_MOUSE_MOVE_DURATION: number = 900

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
