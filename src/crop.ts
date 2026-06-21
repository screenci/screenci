import type { Locator, Page } from '@playwright/test'
import { invalidOptionError, ScreenciError } from './errors.js'

/** A manual crop region, expressed as fractions (0..1) of the captured viewport. */
export type CropRegion = {
  x: number
  y: number
  width: number
  height: number
}

/** Target for {@link crop}: a Playwright locator or an explicit fractional region. */
export type CropTarget = Locator | CropRegion

export type CropOptions = {
  /**
   * Padding added around the crop on every side, as a fraction of the crop's
   * longer edge. `0.1` adds 10% breathing room before the shot is framed on the
   * background. Defaults to `0`.
   */
  padding?: number
}

/**
 * Normalized crop rect recorded for a screenshot: fractions (0..1) of the
 * captured image. The compositor multiplies these by the captured pixel size.
 */
export type ScreenshotCrop = {
  x: number
  y: number
  width: number
  height: number
}

function isLocator(target: CropTarget): target is Locator {
  return (
    typeof target === 'object' &&
    target !== null &&
    'boundingBox' in target &&
    typeof (target as Locator).boundingBox === 'function'
  )
}

function clamp01(value: number): number {
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

/**
 * Expand a fractional crop by `padding` (a fraction of its longer edge) on every
 * side and clamp the result to the [0, 1] image bounds. Pure and exported for
 * testing. `padding === 0` simply clamps the rect.
 */
export function applyCropPadding(
  rect: ScreenshotCrop,
  padding: number
): ScreenshotCrop {
  const pad = Math.max(rect.width, rect.height) * padding
  const left = clamp01(rect.x - pad)
  const top = clamp01(rect.y - pad)
  const right = clamp01(rect.x + rect.width + pad)
  const bottom = clamp01(rect.y + rect.height + pad)
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  }
}

function assertValidRegion(region: CropRegion): void {
  const within = (v: number): boolean => Number.isFinite(v) && v >= 0 && v <= 1
  if (
    !within(region.x) ||
    !within(region.y) ||
    !within(region.width) ||
    !within(region.height)
  ) {
    throw invalidOptionError({
      api: 'crop',
      option: 'region',
      expectation: 'x, y, width, and height must be fractions between 0 and 1',
      value: region,
    })
  }
  if (region.width === 0 || region.height === 0) {
    throw invalidOptionError({
      api: 'crop',
      option: 'region',
      expectation: 'width and height must be greater than 0',
      value: region,
    })
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
 * Resolve a crop target to a normalized fractional region.
 *
 * Pass a Playwright locator to frame an element, or an explicit `{ x, y, width,
 * height }` region (fractions of the viewport). The returned crop is what the
 * compositor places (plus any `padding`) on the configured background with the
 * branded frame and shadow.
 *
 * Pure aside from reading the live `page` (a locator's bounding box and the
 * viewport size). It does not record any global state: callers store the result
 * where it belongs (the `screenshot()` fixture's per-test crop, or a `video()`
 * still's metadata).
 *
 * @example
 * await resolveCrop(page.getByTestId('revenue-card'), page, { padding: 0.06 })
 * await resolveCrop({ x: 0.1, y: 0.2, width: 0.8, height: 0.6 }, page)
 */
export async function resolveCrop(
  target: CropTarget,
  page: Page,
  options: CropOptions = {}
): Promise<ScreenshotCrop> {
  const padding = options.padding ?? 0
  if (!Number.isFinite(padding) || padding < 0) {
    throw invalidOptionError({
      api: 'crop',
      option: 'padding',
      expectation: 'must be a non-negative number',
      value: padding,
    })
  }

  let base: ScreenshotCrop
  if (isLocator(target)) {
    const box = await target.boundingBox()
    if (box === null) {
      throw new ScreenciError(
        'crop(locator): the target element has no bounding box (it may be hidden or detached).'
      )
    }
    const viewport = await resolveViewportSize(page)
    base = {
      x: box.x / viewport.width,
      y: box.y / viewport.height,
      width: box.width / viewport.width,
      height: box.height / viewport.height,
    }
  } else {
    assertValidRegion(target)
    base = {
      x: target.x,
      y: target.y,
      width: target.width,
      height: target.height,
    }
  }

  return applyCropPadding(base, padding)
}
