import type {
  AspectRatio,
  AutoZoomOptions,
  FPS,
  Quality,
  Trace,
  RecordOptions,
} from './types.js'

export const DEFAULT_ZOOM_OPTIONS: Required<AutoZoomOptions> = {
  easing: 'ease-out',
  duration: 500,
  amount: 0.5,
  centering: 1,
  preZoomDelay: 0,
  postZoomDelay: 1000,
}

/**
 * Default aspect ratio for recording and output
 */
export const DEFAULT_ASPECT_RATIO: AspectRatio = '16:9'

/**
 * Default resolution quality preset
 */
export const DEFAULT_QUALITY: Quality = '1080p'

/**
 * Default frames per second for video recording
 */
export const DEFAULT_FPS: FPS = 30

/**
 * Default trace recording mode
 */
export const DEFAULT_TRACE: Trace = 'retain-on-failure'

/**
 * Default setting for sending traces to screenci.com
 */
export const DEFAULT_SEND_TRACES: boolean = true

/**
 * Default directory for video files
 */
export const DEFAULT_VIDEO_DIR: string = './videos'

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
 * Default video options combining all video-related defaults
 */
export const DEFAULT_VIDEO_OPTIONS: RecordOptions = {
  aspectRatio: DEFAULT_ASPECT_RATIO,
  quality: DEFAULT_QUALITY,
  fps: DEFAULT_FPS,
}
