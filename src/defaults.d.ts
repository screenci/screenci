import type {
  AspectRatio,
  AutoZoomOptions,
  FPS,
  Quality,
  Trace,
  RecordOptions,
} from './types.js'
export declare const DEFAULT_ZOOM_OPTIONS: Required<AutoZoomOptions>
/**
 * Default cursor speed for distance-based cursor movement, in pixels per second.
 */
export declare const DEFAULT_MOUSE_MOVE_SPEED: number
/**
 * Default aspect ratio for recording and output
 */
export declare const DEFAULT_ASPECT_RATIO: AspectRatio
/**
 * Default resolution quality preset
 */
export declare const DEFAULT_QUALITY: Quality
/**
 * Default frames per second for video recording
 */
export declare const DEFAULT_FPS: FPS
/**
 * Default trace recording mode
 */
export declare const DEFAULT_TRACE: Trace
/**
 * Default directory for video files
 */
export declare const DEFAULT_VIDEO_DIR: string
/**
 * Default test timeout in milliseconds (30 minutes)
 */
export declare const DEFAULT_TIMEOUT: number
/**
 * Default action timeout in milliseconds (30 seconds)
 *
 * Keeps individual actions (click, fill, etc.) at a sane timeout
 * independent of the long test timeout.
 */
export declare const DEFAULT_ACTION_TIMEOUT: number
/**
 * Default navigation timeout in milliseconds (30 seconds)
 *
 * Keeps page navigations at a sane timeout independent of the long test timeout.
 */
export declare const DEFAULT_NAVIGATION_TIMEOUT: number
/**
 * Default video options combining all video-related defaults
 */
export declare const DEFAULT_VIDEO_OPTIONS: RecordOptions
