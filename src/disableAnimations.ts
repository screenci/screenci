import type { Page } from '@playwright/test'
import type { CaptureKind } from './runtimeContext.js'

/**
 * CSS that neutralizes every CSS animation and transition on the page. Zeroing
 * the durations (rather than removing the rules) makes elements jump straight to
 * their end state, so nothing waits on an in-flight animation.
 *
 * This matters most for screenshots: a still has no timeline, so animating the
 * UI only slows the interactions that drive the page into position. Every
 * Playwright action blocks on actionability, which waits for an element to stop
 * moving; component libraries that animate dialogs / dropdowns open and closed
 * (and disable pointer events mid-animation) turn each open/close into seconds
 * of wait. Collapsing the durations to zero removes that cost.
 */
export const DISABLE_ANIMATIONS_CSS = `*, *::before, *::after {
  animation-duration: 0s !important;
  animation-delay: 0s !important;
  animation-iteration-count: 1 !important;
  transition-duration: 0s !important;
  transition-delay: 0s !important;
  scroll-behavior: auto !important;
}`

/**
 * Resolve whether animations should be disabled for a capture.
 *
 * The `disableAnimations` record option is an explicit override. When it is left
 * unset it defaults to `true` for screenshots (a still has no timeline, so
 * animating only slows the interaction waits) and `false` for video (motion is
 * usually the point of the recording). Either default can be overridden by
 * setting the option, so a screenshot that genuinely needs a mid-animation state
 * can opt back in with `disableAnimations: false`.
 */
export function resolveDisableAnimations(
  disableAnimations: boolean | undefined,
  captureKind: CaptureKind
): boolean {
  return disableAnimations ?? captureKind === 'screenshot'
}

/**
 * Install a page-init stylesheet that neutralizes CSS animations and
 * transitions. Injected via `addInitScript` so it is re-applied on every
 * navigation and takes effect before the app's own scripts run.
 */
export async function installAnimationDisabling(page: Page): Promise<void> {
  await page.addInitScript((css: string) => {
    const inject = (): void => {
      const style = document.createElement('style')
      style.setAttribute('data-screenci-disable-animations', '')
      style.textContent = css
      // `document.head` may not exist yet when the init script runs; the root
      // element always does, and a <style> anywhere in the tree still applies.
      ;(document.head ?? document.documentElement).appendChild(style)
    }
    inject()
  }, DISABLE_ANIMATIONS_CSS)
}
