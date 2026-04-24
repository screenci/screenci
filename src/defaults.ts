import type {
  AspectRatio,
  Easing,
  FPS,
  Quality,
  Trace,
  RecordOptions,
} from './types.js'

/**
 * Default zoom amount (fraction of output dimensions for the zoomed viewport)
 */
export const DEFAULT_ZOOM_AMOUNT: number = 0.5

/**
 * Default zoom transition duration in milliseconds
 */
export const DEFAULT_ZOOM_DURATION: number = 500

/**
 * Default delay in milliseconds after zoom-in and zoom-out animations
 */
export const DEFAULT_POST_ZOOM_IN_OUT_DELAY: number = 1000

/**
 * Default zoom transition easing function
 */
export const DEFAULT_ZOOM_EASING: Easing = 'ease-out'

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
