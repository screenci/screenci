import type { Locator, Page } from '@playwright/test'
import { invalidOptionError, ScreenciError } from './errors.js'

/** A manual clip region, in CSS pixels of the recording viewport (top-left origin). */
export type ClipRegion = {
  x: number
  y: number
  width: number
  height: number
}

/** Target for {@link clip}: a Playwright locator or an explicit pixel region. */
export type ClipTarget = Locator | ClipRegion

/**
 * Crop padding in CSS px. Either a single value applied to every side, or an
 * object with per-side values (omitted sides default to `0`), like CSS padding.
 */
export type ClipPadding =
  | number
  | { top?: number; right?: number; bottom?: number; left?: number }

export type ClipOptions = {
  /**
   * Padding in CSS px added around the clip so the shot has breathing room before
   * it is framed on the background. A single value pads every side equally, or
   * pass `{ top, right, bottom, left }` for uneven padding. Defaults to `0`.
   */
  padding?: ClipPadding
}

/**
 * Crop rect recorded for a screenshot: CSS pixels of the recording viewport. The
 * compositor maps these against the captured image (which may be higher-DPI) at
 * render time.
 */
export type ScreenshotClip = {
  x: number
  y: number
  width: number
  height: number
}

/** Per-side clip padding in CSS px, fully resolved (no omitted sides). */
export type ResolvedClipPadding = {
  top: number
  right: number
  bottom: number
  left: number
}

/**
 * A clip as recorded into `renderOptions.screenshot.clip`. The renderer derives
 * the effective clip by expanding `box` by `padding` (CSS px on each side) and
 * clamping to the captured viewport.
 *
 * `source` drives Studio editability:
 * - `'locator'`: `box` is the element's bounding box and is locked (it re-resolves
 *   from the locator on every capture). Only `padding` is editable in Studio.
 * - `'region'`: `box` is a free rectangle (an explicit region, with any `padding`
 *   already folded in) and is fully editable in Studio; `padding` is zero.
 */
export type ScreenshotClipRecord = {
  box: ScreenshotClip
  padding: ResolvedClipPadding
  source: 'locator' | 'region'
}

function isLocator(target: ClipTarget): target is Locator {
  return (
    typeof target === 'object' &&
    target !== null &&
    'boundingBox' in target &&
    typeof (target as Locator).boundingBox === 'function'
  )
}

/** Normalize {@link ClipPadding} to explicit per-side CSS px values. */
function normalizePadding(padding: ClipPadding): ResolvedClipPadding {
  if (typeof padding === 'number') {
    return { top: padding, right: padding, bottom: padding, left: padding }
  }
  return {
    top: padding.top ?? 0,
    right: padding.right ?? 0,
    bottom: padding.bottom ?? 0,
    left: padding.left ?? 0,
  }
}

/**
 * Expand a pixel clip by `padding` (uniform or per-side CSS px) and clamp the
 * result to the viewport bounds. Pure and exported for testing. `padding === 0`
 * simply clamps the rect to the viewport.
 */
export function applyClipPadding(
  rect: ScreenshotClip,
  padding: ClipPadding,
  viewport: { width: number; height: number }
): ScreenshotClip {
  const p = normalizePadding(padding)
  const left = Math.max(0, rect.x - p.left)
  const top = Math.max(0, rect.y - p.top)
  const right = Math.min(viewport.width, rect.x + rect.width + p.right)
  const bottom = Math.min(viewport.height, rect.y + rect.height + p.bottom)
  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  }
}

export function assertValidRegion(region: ClipRegion): void {
  const ok = (v: number): boolean => Number.isFinite(v) && v >= 0
  if (
    !ok(region.x) ||
    !ok(region.y) ||
    !ok(region.width) ||
    !ok(region.height)
  ) {
    throw invalidOptionError({
      api: 'clip',
      option: 'region',
      expectation:
        'x, y, width, and height must be non-negative CSS pixel values',
      value: region,
    })
  }
  if (region.width === 0 || region.height === 0) {
    throw invalidOptionError({
      api: 'clip',
      option: 'region',
      expectation: 'width and height must be greater than 0',
      value: region,
    })
  }
}

function assertValidPadding(padding: ClipPadding): void {
  const sides =
    typeof padding === 'number'
      ? [padding]
      : [padding.top, padding.right, padding.bottom, padding.left]
  for (const value of sides) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
      throw invalidOptionError({
        api: 'clip',
        option: 'padding',
        expectation:
          'must be non-negative CSS px (a number, or per-side { top, right, bottom, left })',
        value: padding,
      })
    }
  }
}

async function resolveViewportSize(page: Page): Promise<{
  width: number
  height: number
}> {
  const viewport = page.viewportSize()
  if (viewport !== null) return viewport
  return page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }))
}

/**
 * Resolve a clip target to a pixel region (CSS px of the recording viewport).
 *
 * Pass a Playwright locator to frame an element, or an explicit `{ x, y, width,
 * height }` region (CSS pixels of the recording viewport). The returned clip is
 * what the compositor places (plus any `padding`) on the configured background
 * with the branded frame and shadow.
 *
 * Pure aside from reading the live `page` (a locator's bounding box and the
 * viewport size). It does not record any global state: callers store the result
 * where it belongs (the `screenshot()` fixture's per-test clip, or a `video()`
 * still's metadata).
 *
 * @example
 * await resolveClip(page.getByTestId('revenue-card'), page, { padding: 48 })
 * await resolveClip(page.getByTestId('chart'), page, {
 *   padding: { top: 24, bottom: 64, left: 24, right: 24 },
 * })
 * await resolveClip({ x: 128, y: 256, width: 1024, height: 768 }, page)
 */
export async function resolveClip(
  target: ClipTarget,
  page: Page,
  options: ClipOptions = {}
): Promise<ScreenshotClipRecord> {
  const padding = options.padding ?? 0
  assertValidPadding(padding)

  const viewport = await resolveViewportSize(page)

  if (isLocator(target)) {
    const box = await target.boundingBox()
    if (box === null) {
      throw new ScreenciError(
        'clip(locator): the target element has no bounding box (it may be hidden or detached).'
      )
    }
    // The element box is the locked anchor; padding stays separate so Studio can
    // edit the breathing room without desyncing the clip from the locator. The
    // renderer expands the box by padding and clamps to the captured viewport.
    return {
      box: { x: box.x, y: box.y, width: box.width, height: box.height },
      padding: normalizePadding(padding),
      source: 'locator',
    }
  }

  assertValidRegion(target)
  // An explicit region has no element to track, so it is a free rectangle in
  // Studio. Fold any padding into the box now (clamped to the viewport) and keep
  // padding zero: the box itself is what gets edited.
  const box = applyClipPadding(
    { x: target.x, y: target.y, width: target.width, height: target.height },
    padding,
    viewport
  )
  return {
    box,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    source: 'region',
  }
}
