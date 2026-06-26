import { getActiveHideRecorder } from './timelineBlock.js'

/**
 * Hides the narration (camera PIP) from this point on.
 *
 * Call {@link showNarration} to make it visible again.
 *
 * @example
 * ```ts
 * await hideNarration()
 * await page.getByRole('button', { name: 'Submit' }).click()
 * await showNarration()
 * ```
 */
export async function hideNarration(): Promise<void> {
  const recorder = getActiveHideRecorder()
  recorder.addNarrationHide()
}

/**
 * Shows the narration (camera PIP) after it was hidden by {@link hideNarration}.
 * No-op when the narration is already visible.
 */
export async function showNarration(): Promise<void> {
  const recorder = getActiveHideRecorder()
  recorder.addNarrationShow()
}
