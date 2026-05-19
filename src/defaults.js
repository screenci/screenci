export const DEFAULT_ZOOM_OPTIONS = {
  easing: 'ease-out',
  duration: 1600,
  amount: 0.65,
  centering: 1,
  preZoomDelay: 0,
  postZoomDelay: 1000,
}
/**
 * Default cursor speed for distance-based cursor movement, in pixels per second.
 */
export const DEFAULT_MOUSE_MOVE_SPEED = 400
/**
 * Default aspect ratio for recording and output
 */
export const DEFAULT_ASPECT_RATIO = '16:9'
/**
 * Default resolution quality preset
 */
export const DEFAULT_QUALITY = '1080p'
/**
 * Default frames per second for video recording
 */
export const DEFAULT_FPS = 30
/**
 * Default trace recording mode
 */
export const DEFAULT_TRACE = 'retain-on-failure'
/**
 * Default directory for video files
 */
export const DEFAULT_VIDEO_DIR = './videos'
/**
 * Default test timeout in milliseconds (30 minutes)
 */
export const DEFAULT_TIMEOUT = 30 * 60 * 1000
/**
 * Default action timeout in milliseconds (30 seconds)
 *
 * Keeps individual actions (click, fill, etc.) at a sane timeout
 * independent of the long test timeout.
 */
export const DEFAULT_ACTION_TIMEOUT = 30_000
/**
 * Default navigation timeout in milliseconds (30 seconds)
 *
 * Keeps page navigations at a sane timeout independent of the long test timeout.
 */
export const DEFAULT_NAVIGATION_TIMEOUT = 30_000
/**
 * Default video options combining all video-related defaults
 */
export const DEFAULT_VIDEO_OPTIONS = {
  aspectRatio: DEFAULT_ASPECT_RATIO,
  quality: DEFAULT_QUALITY,
  fps: DEFAULT_FPS,
}
