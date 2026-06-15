/**
 * Recording performance tuning.
 *
 * screenci animates the cursor and scroll by dispatching updates to the browser
 * while recording. On a busy renderer (e.g. a heavy page on a slow CI machine)
 * each dispatch queues behind the page's own work, so dispatching on every
 * output frame can stall an interaction for seconds.
 *
 * `recordOptions.performance` controls how many output frames to skip between
 * dispatches, relative to the recording `fps`:
 *
 * - The cursor is re-drawn at render time from a single move event, so skipping
 *   cursor frames does not make it choppy. It defaults to skipping 5 (≈10fps at
 *   60fps).
 * - The scroll is real captured footage, so it defaults to skipping 0 (every
 *   frame) and stays smooth.
 */

export type PerformancePreset = 'smooth' | 'balanced' | 'fast'

export type PerformanceOptions = {
  /** Output frames to skip between cursor dispatches. 0 = every frame. */
  mouseFrameSkip?: number
  /** Output frames to skip between scroll dispatches. 0 = every frame. */
  scrollFrameSkip?: number
}

export type PerformanceOption = PerformancePreset | PerformanceOptions

export type PerformanceIntervals = {
  mouseMs: number
  scrollMs: number
}

/** Cursor frames skipped by default (≈10fps at 60fps). */
export const DEFAULT_MOUSE_FRAME_SKIP = 5
/** Scroll frames skipped by default (every frame; scroll is real footage). */
export const DEFAULT_SCROLL_FRAME_SKIP = 0

/** Mirrors `DEFAULT_FPS`; kept local to avoid an import cycle. */
const DEFAULT_FPS = 60

const PRESET_FRAME_SKIP: Record<PerformancePreset, number> = {
  smooth: 0, // every frame
  balanced: 2, // every 3rd frame
  fast: 5, // every 6th frame (~10fps at 60fps)
}

function frameSkipToIntervalMs(skip: number, fps: number): number {
  const frameMs = 1000 / (fps > 0 ? fps : DEFAULT_FPS)
  const safeSkip = Number.isFinite(skip) ? Math.max(0, Math.round(skip)) : 0
  return (safeSkip + 1) * frameMs
}

/** Cursor dispatch interval (ms) used when no recording context is bound. */
export const DEFAULT_MOUSE_INTERVAL_MS = frameSkipToIntervalMs(
  DEFAULT_MOUSE_FRAME_SKIP,
  DEFAULT_FPS
)
/** Scroll dispatch interval (ms) used when no recording context is bound. */
export const DEFAULT_SCROLL_INTERVAL_MS = frameSkipToIntervalMs(
  DEFAULT_SCROLL_FRAME_SKIP,
  DEFAULT_FPS
)

/**
 * Resolves cursor and scroll dispatch intervals (ms) from the frame-skip config
 * and the recording `fps`.
 */
export function resolvePerformanceIntervals(
  option?: PerformanceOption,
  fps: number = DEFAULT_FPS
): PerformanceIntervals {
  if (option === undefined) {
    return {
      mouseMs: frameSkipToIntervalMs(DEFAULT_MOUSE_FRAME_SKIP, fps),
      scrollMs: frameSkipToIntervalMs(DEFAULT_SCROLL_FRAME_SKIP, fps),
    }
  }

  if (typeof option === 'string') {
    const skip = PRESET_FRAME_SKIP[option]
    return {
      mouseMs: frameSkipToIntervalMs(skip, fps),
      scrollMs: frameSkipToIntervalMs(skip, fps),
    }
  }

  return {
    mouseMs: frameSkipToIntervalMs(
      option.mouseFrameSkip ?? DEFAULT_MOUSE_FRAME_SKIP,
      fps
    ),
    scrollMs: frameSkipToIntervalMs(
      option.scrollFrameSkip ?? DEFAULT_SCROLL_FRAME_SKIP,
      fps
    ),
  }
}
