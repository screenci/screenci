/**
 * Waits until a freshly navigated document has actually been painted.
 *
 * `page.goto` resolves on the `load` event, which for a client-rendered app
 * comes before the first real paint (hydration, lazy chunks, fonts). The
 * screencast records whatever the compositor shows in the meantime: a blank
 * white document. This wait replaces guessing with a paint signal:
 *
 * 1. `document.fonts.ready`, then two nested `requestAnimationFrame`s. A rAF
 *    only fires once the renderer has produced a frame, so the double rAF
 *    guarantees the new document has been composited at least once.
 * 2. Optionally (inside `hide()`), `networkidle`, capped at `NETWORK_IDLE_TIMEOUT_MS`, for apps that paint
 *    an empty root first and fill it after a fetch. Timing out is fine: the
 *    page simply keeps streaming and we proceed.
 *
 * Every step swallows its own errors (a navigation can race another one, a
 * detached frame throws) so a flaky signal never fails a recording.
 */

export const NETWORK_IDLE_TIMEOUT_MS = 2000
export const PAINT_TIMEOUT_MS = 3000

/** The slice of a Playwright `Page` the wait needs (injectable for tests). */
export type PaintWaitPage = {
  evaluate: (fn: () => Promise<void>) => Promise<unknown>
  waitForLoadState: (
    state: 'networkidle',
    options: { timeout: number }
  ) => Promise<void>
}

/** Runs in the browser: resolves after fonts are ready and two frames painted. */
export function firstPaintScript(): Promise<void> {
  return new Promise<void>((resolve) => {
    const fontsReady: Promise<unknown> =
      document.fonts?.ready ?? Promise.resolve()
    const twoFrames = (): void => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    }
    fontsReady.then(twoFrames, twoFrames)
  })
}

function withTimeout(promise: Promise<unknown>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    promise.then(
      () => {
        clearTimeout(timer)
        resolve()
      },
      () => {
        clearTimeout(timer)
        resolve()
      }
    )
  })
}

export async function waitForNavigationPaint(
  page: PaintWaitPage,
  options: {
    paintTimeoutMs?: number
    networkIdleTimeoutMs?: number
    /**
     * Also wait for network idle. Only worth it inside `hide()`, where the
     * wait is cut from the video; outside it would show as a visible pause.
     */
    waitForNetworkIdle?: boolean
  } = {}
): Promise<void> {
  const paintTimeoutMs = options.paintTimeoutMs ?? PAINT_TIMEOUT_MS
  const networkIdleTimeoutMs =
    options.networkIdleTimeoutMs ?? NETWORK_IDLE_TIMEOUT_MS
  await withTimeout(page.evaluate(firstPaintScript), paintTimeoutMs)
  if (options.waitForNetworkIdle !== true) return
  await page
    .waitForLoadState('networkidle', { timeout: networkIdleTimeoutMs })
    .catch(() => {})
}
