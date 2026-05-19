let activeRecorder = null
let insideHide = false
export const POST_HIDE_PAUSE = 250
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
export function setActiveHideRecorder(recorder) {
  activeRecorder = recorder
}
export function isInsideHide() {
  return insideHide
}
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
export async function hide(fn) {
  if (insideHide) {
    throw new Error('Cannot nest hide() calls')
  }
  insideHide = true
  if (activeRecorder !== null) {
    activeRecorder.addHideStart()
  }
  try {
    await fn()
    // Browser rendering/recording has a short delay.
    await sleep(POST_HIDE_PAUSE)
  } finally {
    insideHide = false
  }
  if (activeRecorder !== null) {
    activeRecorder.addHideEnd()
  }
}
