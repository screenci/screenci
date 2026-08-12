import { getActiveHideRecorder } from './timelineBlock.js'
import {
  narrationVisibilityUpdate,
  type OverlayTransitionOptions,
} from './overlayUpdates.js'

/**
 * Hides the narration (camera PIP) from this point on. Pass a `duration` to
 * fade it out instead of an instant cut.
 *
 * Call {@link showNarration} to make it visible again.
 *
 * @example
 * ```ts
 * await hideNarration({ duration: 300 })
 * await page.getByRole('button', { name: 'Submit' }).click()
 * await showNarration({ duration: 300 })
 * ```
 */
export async function hideNarration(
  options?: OverlayTransitionOptions
): Promise<void> {
  const recorder = getActiveHideRecorder()
  narrationVisibilityUpdate('hideNarration', false, options, recorder)
}

/**
 * Shows the narration (camera PIP) after it was hidden by {@link hideNarration}.
 * No-op when the narration is already visible. Pass a `duration` to fade it in.
 */
export async function showNarration(
  options?: OverlayTransitionOptions
): Promise<void> {
  const recorder = getActiveHideRecorder()
  narrationVisibilityUpdate('showNarration', true, options, recorder)
}
