import { ScreenciError } from './errors.js'
import { getActiveHideRecorder } from './timelineBlock.js'
import {
  getRuntimeRecordingSize,
  setRuntimeRecordingSize,
} from './runtimeContext.js'
import type { Easing } from './types.js'

/**
 * Full-screen size: the recording fills the output frame, with one side
 * touching the background edge.
 */
const FULL_SCREEN_SIZE = 1

function assertValidSize(size: number): void {
  if (!Number.isFinite(size) || size <= 0 || size > 1) {
    throw new ScreenciError(
      `resizeRecording(size) requires size in (0, 1]; received ${size}`
    )
  }
}

export type ResizeRecordingOptions = {
  /** Transition duration in milliseconds. 0 or omitted = instant cut. */
  duration?: number
  /** Easing function for the transition. Defaults to 'ease-out'. */
  easing?: Easing
}

/**
 * Shrinks the recording to a limited size, revealing the styled background
 * around it from this point on.
 *
 * `size` is a 0-1 fraction of the full frame: `1` is full screen, `0.8` shows
 * the recording at 80% of the frame, centered. Call {@link resetRecordingSize}
 * to return to full screen.
 *
 * Pass `duration` to animate the transition over that many milliseconds.
 * Use `easing` to control the animation curve (defaults to `'ease-out'`).
 *
 * @example
 * ```ts
 * await resizeRecording(0.8, { duration: 400, easing: 'ease-in-out' })
 * await page.getByRole('button', { name: 'Continue' }).click()
 * await resetRecordingSize()
 * ```
 */
export async function resizeRecording(
  size: number,
  options?: ResizeRecordingOptions
): Promise<void> {
  assertValidSize(size)
  const recorder = getActiveHideRecorder()
  if (options !== undefined) {
    recorder.addRecordingSizeStart(size, options)
  } else {
    recorder.addRecordingSizeStart(size)
  }
  setRuntimeRecordingSize(size)
}

/**
 * Returns the recording to full screen (size 1) from this point on. No-op when
 * the recording is already full screen.
 */
export async function resetRecordingSize(): Promise<void> {
  if (getRuntimeRecordingSize() === FULL_SCREEN_SIZE) return
  const recorder = getActiveHideRecorder()
  recorder.addRecordingSizeEnd()
  setRuntimeRecordingSize(FULL_SCREEN_SIZE)
}
