import type { IEventRecorder } from './events.js'
export declare const POST_HIDE_PAUSE = 250
export declare function setActiveHideRecorder(
  recorder: IEventRecorder | null
): void
export declare function isInsideHide(): boolean
/**
 * Runs `fn` while suppressing recording. The hidden section is cut from the
 * final video — viewers never see it.
 *
 * Use it for logins, navigations, page loads, and any setup that would bore
 * a human to tears. Especially useful at the very start of a video so you
 * jump straight into the live app.
 *
 * Cannot be nested — calling `hide()` inside another `hide()` throws.
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
export declare function hide(fn: () => Promise<void> | void): Promise<void>
