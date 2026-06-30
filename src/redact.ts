import type { Locator, Page } from '@playwright/test'
import type { RedactHandle, RedactOptions } from './types.js'
import {
  redactApplyConfigSelectors,
  redactControllerBootstrap,
  type RedactWindowApi,
  type ResolvedRedactStyle,
} from './redactController.js'
import { getRuntimePage, getRuntimeRedactState } from './runtimeContext.js'
import { logger } from './logger.js'

/** Default corner radius (px) for the mask. */
export const DEFAULT_REDACT_RADIUS = 12
/** Default mask shadow. Reads as a raised chip so a redaction is obvious. */
export const DEFAULT_REDACT_SHADOW = '0 2px 8px rgba(0,0,0,0.25)'

/**
 * How long `redact()` waits for at least one matching element before masking,
 * so a redact issued just before the element renders does not silently no-op.
 */
export const REDACT_ATTACH_TIMEOUT_MS = 5000

/**
 * Resolve user-facing {@link RedactOptions} to the concrete pixel values the
 * in-page controller applies. Pure (no page access), so it is unit-testable on
 * its own.
 */
export function resolveRedactStyle(
  options?: RedactOptions
): ResolvedRedactStyle {
  const style = options?.style
  return {
    // null means "sample a color from underneath" in the page.
    color: style?.color ?? null,
    radiusPx: style?.radius ?? DEFAULT_REDACT_RADIUS,
    shadow:
      style?.shadow === false ? null : (style?.shadow ?? DEFAULT_REDACT_SHADOW),
    css: style?.css ?? null,
  }
}

type RedactWindow = Window & { __screenci_redact?: RedactWindowApi }

let redactCounter = 0

function nextRedactId(): string {
  redactCounter += 1
  return `__screenci_redact_${redactCounter}`
}

/**
 * Make sure the in-page controller is installed. `addInitScript` covers every
 * future document (registered once per recording); the extra `evaluate` covers
 * the document that is already open when `redact()` is first called. Both are
 * idempotent.
 */
export async function ensureRedactControllerInstalled(
  page: Page
): Promise<void> {
  const state = getRuntimeRedactState()
  if (!state.controllerInstalled) {
    await page.addInitScript(redactControllerBootstrap)
    state.controllerInstalled = true
  }
  await page.evaluate(redactControllerBootstrap)
}

/**
 * Install the in-page controller on a freshly created page, before its first
 * navigation, so masks apply from the first painted frame. Also registers the
 * `recordOptions.redact` first-paint selectors. Called once per page from the
 * video fixture; the runtime flag is set on the passed context (which is not yet
 * the active context at page-creation time).
 */
export async function installRedactController(
  page: Page,
  redactState: { controllerInstalled: boolean },
  configSelectors?: string[]
): Promise<void> {
  await page.addInitScript(redactControllerBootstrap)
  redactState.controllerInstalled = true
  if (configSelectors && configSelectors.length > 0) {
    await page.addInitScript(redactApplyConfigSelectors, {
      selectors: configSelectors,
      style: resolveRedactStyle(),
    })
  }
}

async function applyRedact(
  locator: Locator,
  options?: RedactOptions
): Promise<RedactHandle> {
  const page = locator.page()
  const resolved = resolveRedactStyle(options)
  const id = nextRedactId()

  await ensureRedactControllerInstalled(page)

  // Wait for at least one match so a redact issued a beat before the element
  // renders still masks it instead of silently doing nothing.
  try {
    await locator
      .first()
      .waitFor({ state: 'attached', timeout: REDACT_ATTACH_TIMEOUT_MS })
  } catch {
    logger.warn(
      '[screenci] redact() found no matching element to mask. The selector may be wrong or the element may not have rendered yet.'
    )
  }

  // Register inside the page so the controller receives the real elements
  // (this pierces shadow DOM, which a selector re-query could not). The
  // controller positions the mask synchronously here, so no unmasked frame
  // escapes once this resolves.
  await locator.evaluateAll(
    (elements, arg: { id: string; style: ResolvedRedactStyle }) => {
      const api = (window as RedactWindow).__screenci_redact
      if (api) api.addElements(arg.id, elements, arg.style)
    },
    { id, style: resolved }
  )

  getRuntimeRedactState().activeMasks.set(id, resolved)

  return {
    async unredact(): Promise<void> {
      getRuntimeRedactState().activeMasks.delete(id)
      try {
        await page.evaluate((maskId: string) => {
          const api = (window as RedactWindow).__screenci_redact
          if (api) api.remove(maskId)
        }, id)
      } catch {
        // The page may already be closing; the mask dies with it.
      }
    },
  }
}

/**
 * Mask the element(s) matched by `locator` so the content never enters the
 * recording. The mask is applied client side in the live DOM, so the obscured
 * pixels are never captured and never uploaded to screenci. This is true
 * redaction, unlike {@link cover}, which only hides content in the published
 * output.
 *
 * To hide a secret that is already on screen without a visible flash, register
 * the mask before revealing it (inside `hide()` or via the `recordOptions.redact`
 * config for always-secret elements).
 *
 * @example Persistent
 * ```ts
 * const handle = await redact(page.getByTestId('api-key'))
 * // ... later
 * await handle.unredact()
 * ```
 *
 * @example Scoped
 * ```ts
 * await redact(page.getByTestId('balance'), async () => {
 *   await page.getByRole('button', { name: 'Reveal' }).click()
 * })
 * ```
 */
export function redact(
  locator: Locator,
  options?: RedactOptions
): Promise<RedactHandle>
export function redact(
  locator: Locator,
  fn: () => Promise<void> | void,
  options?: RedactOptions
): Promise<void>
export async function redact(
  locator: Locator,
  optionsOrFn?: RedactOptions | (() => Promise<void> | void),
  maybeOptions?: RedactOptions
): Promise<RedactHandle | void> {
  if (typeof optionsOrFn === 'function') {
    const handle = await applyRedact(locator, maybeOptions)
    try {
      await optionsOrFn()
    } finally {
      await handle.unredact()
    }
    return
  }
  return applyRedact(locator, optionsOrFn)
}

/**
 * Remove every active mask. Called automatically at the end of each recording
 * so masks never leak across recordings that share a browser worker.
 */
export async function unredactAll(): Promise<void> {
  getRuntimeRedactState().activeMasks.clear()
  const page = getRuntimePage()
  if (!page) return
  try {
    await page.evaluate(() => {
      const api = (window as RedactWindow).__screenci_redact
      if (api) api.clear()
    })
  } catch {
    // Best effort; the page may already be closing.
  }
}
