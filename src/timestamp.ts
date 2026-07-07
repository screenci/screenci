import { getActiveHideRecorder } from './timelineBlock.js'

/**
 * Marks a named point in the recording timeline.
 *
 * The marker has no effect on the rendered output: it only records the current
 * moment under the given `name` so the web editor can surface it on its own
 * timeline row. Call it as many times as you like; reusing a name is allowed
 * (each call is a distinct marker).
 *
 * @example
 * ```ts
 * await timestamp('checkout-opened')
 * await page.getByRole('button', { name: 'Pay' }).click()
 * await timestamp('payment-done')
 * ```
 */
export async function timestamp(name: string): Promise<void> {
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new Error('timestamp() name must be a non-empty string')
  }
  const recorder = getActiveHideRecorder()
  recorder.addTimestamp(name)
}
