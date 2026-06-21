import type { Locator, Page } from '@playwright/test'
import { invalidOptionError, ScreenciError } from './errors.js'

/** A manual crop region, in CSS pixels of the recording viewport (top-left origin). */
export type CropRegion = {
  x: number
  y: number
  width: number
  height: number
}

/** Target for {@link crop}: a Playwright locator or an explicit pixel region. */
export type CropTarget = Locator | CropRegion

/**
 * Crop padding in CSS px. Either a single value applied to every side, or an
 * object with per-side values (omitted sides default to `0`), like CSS padding.
 */
export type CropPadding =
  | number
  | { top?: number; right?: number; bottom?: number; left?: number }

export type CropOptions = {
  /**
   * Padding in CSS px added around the crop so the shot has breathing room before
   * it is framed on the background. A single value pads every side equally, or
   * pass `{ top, right, bottom, left }` for uneven padding. Defaults to `0`.
   */
  padding?: CropPadding
  /**
   * Force the crop to this aspect ratio (`width / height`, e.g. `16 / 9`),
   * applied after {@link padding}. The crop grows along its deficient axis around
   * its centre (capped to the viewport) to reach the ratio exactly. Omit to keep
   * the target's own aspect.
   */
  aspectRatio?: number
}

/**
 * Crop rect recorded for a screenshot: CSS pixels of the recording viewport. The
 * compositor maps these against the captured image (which may be higher-DPI) at
 * render time.
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

/** Normalize {@link CropPadding} to explicit per-side CSS px values. */
function normalizePadding(padding: CropPadding): {
  top: number
  right: number
  bottom: number
  left: number
} {
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
 * Expand a pixel crop by `padding` (uniform or per-side CSS px) and clamp the
 * result to the viewport bounds. Pure and exported for testing. `padding === 0`
 * simply clamps the rect to the viewport.
 */
export function applyCropPadding(
  rect: ScreenshotCrop,
  padding: CropPadding,
  viewport: { width: number; height: number }
): ScreenshotCrop {
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

/**
 * Force a crop to a target aspect ratio (`width / height`) by growing its
 * deficient axis around the crop's centre, capped to the viewport. If the
 * viewport is too small to grow, the other axis shrinks instead so the ratio is
 * still exact. Pure and exported for testing.
 */
export function applyCropAspectRatio(
  rect: ScreenshotCrop,
  aspectRatio: number,
  viewport: { width: number; height: number }
): ScreenshotCrop {
  const centerX = rect.x + rect.width / 2
  const centerY = rect.y + rect.height / 2
  let width = rect.width
  let height = rect.height
  const current = width / height
  if (current < aspectRatio) {
    // Too narrow: widen to the ratio, capping at the viewport (then trim height).
    width = height * aspectRatio
    if (width > viewport.width) {
      width = viewport.width
      height = width / aspectRatio
    }
  } else if (current > aspectRatio) {
    // Too wide: grow height to the ratio, capping at the viewport (then trim width).
    height = width / aspectRatio
    if (height > viewport.height) {
      height = viewport.height
      width = height * aspectRatio
    }
  }
  const x = Math.max(0, Math.min(centerX - width / 2, viewport.width - width))
  const y = Math.max(
    0,
    Math.min(centerY - height / 2, viewport.height - height)
  )
  return { x, y, width, height }
}

function assertValidRegion(region: CropRegion): void {
  const ok = (v: number): boolean => Number.isFinite(v) && v >= 0
  if (
    !ok(region.x) ||
    !ok(region.y) ||
    !ok(region.width) ||
    !ok(region.height)
  ) {
    throw invalidOptionError({
      api: 'crop',
      option: 'region',
      expectation:
        'x, y, width, and height must be non-negative CSS pixel values',
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

function assertValidPadding(padding: CropPadding): void {
  const sides =
    typeof padding === 'number'
      ? [padding]
      : [padding.top, padding.right, padding.bottom, padding.left]
  for (const value of sides) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
      throw invalidOptionError({
        api: 'crop',
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
 * Resolve a crop target to a pixel region (CSS px of the recording viewport).
 *
 * Pass a Playwright locator to frame an element, or an explicit `{ x, y, width,
 * height }` region (CSS pixels of the recording viewport). The returned crop is
 * what the compositor places (plus any `padding`) on the configured background
 * with the branded frame and shadow.
 *
 * Pure aside from reading the live `page` (a locator's bounding box and the
 * viewport size). It does not record any global state: callers store the result
 * where it belongs (the `screenshot()` fixture's per-test crop, or a `video()`
 * still's metadata).
 *
 * @example
 * await resolveCrop(page.getByTestId('revenue-card'), page, { padding: 48 })
 * await resolveCrop(page.getByTestId('chart'), page, {
 *   padding: { top: 24, bottom: 64, left: 24, right: 24 },
 *   aspectRatio: 16 / 9,
 * })
 * await resolveCrop({ x: 128, y: 256, width: 1024, height: 768 }, page)
 */
export async function resolveCrop(
  target: CropTarget,
  page: Page,
  options: CropOptions = {}
): Promise<ScreenshotCrop> {
  const padding = options.padding ?? 0
  assertValidPadding(padding)
  const { aspectRatio } = options
  if (
    aspectRatio !== undefined &&
    (!Number.isFinite(aspectRatio) || aspectRatio <= 0)
  ) {
    throw invalidOptionError({
      api: 'crop',
      option: 'aspectRatio',
      expectation: 'must be a positive number (width / height)',
      value: aspectRatio,
    })
  }

  const viewport = await resolveViewportSize(page)
  let base: ScreenshotCrop
  if (isLocator(target)) {
    const box = await target.boundingBox()
    if (box === null) {
      throw new ScreenciError(
        'crop(locator): the target element has no bounding box (it may be hidden or detached).'
      )
    }
    base = {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
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

  const padded = applyCropPadding(base, padding, viewport)
  // Force the aspect ratio after padding, so padding is included in the framed box.
  return aspectRatio === undefined
    ? padded
    : applyCropAspectRatio(padded, aspectRatio, viewport)
}
