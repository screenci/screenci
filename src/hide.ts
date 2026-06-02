import type { IEventRecorder } from './events.js'
import { setRuntimeHideRecorder } from './runtimeContext.js'
import { getActiveHideRecorder, runTimelineBlock } from './timelineBlock.js'

export function setActiveHideRecorder(recorder: IEventRecorder | null): void {
  setRuntimeHideRecorder(recorder)
}

export { POST_HIDE_PAUSE, isInsideHide } from './timelineBlock.js'

/**
 * Runs `fn` while suppressing recording. The hidden section is cut from the
 * final video — viewers never see it.
 *
 * Use it for logins, navigations, page loads, and any setup that would bore
 * a human to tears. Especially useful at the very start of a video so you
 * jump straight into the live app.
 *
 * @example
 * ```ts
 * await hide(async () => {
 *   await page.goto('/login')
 *   await page.fill('input[type="email"]', 'admin@example.com')
 *   await page.fill('input[type="password"]', 'secret')
 *   await page.click('[type="submit"]')
 *   await page.waitForURL('/dashboard')
 * })
 * // video starts here — dashboard is already open
 * ```
 */
export async function hide(fn: () => Promise<void> | void): Promise<void> {
  const activeRecorder = getActiveHideRecorder()
  await runTimelineBlock({
    type: 'hide',
    recorder: activeRecorder,
    emitStart: (recorder) => recorder.addHideStart(),
    emitEnd: (recorder) => recorder.addHideEnd(),
    fn,
  })
}
