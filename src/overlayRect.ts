import type { Locator } from '@playwright/test'

/**
 * A locator's on-screen box in CSS pixels of the recording viewport, ready to
 * position an overlay over a live element.
 *
 * The top-level placement fields (`relativeTo`, `x`, `y`, and exactly one of
 * `width`/`height`) spread straight into an overlay config:
 *
 * ```ts
 * const rect = await overlayRect(page.locator('#save'))
 * const overlays = createOverlays({
 *   ring: (p: { rect: OverlayRect }) => ({ element: <Ring />, ...p.rect }),
 * })
 * await overlays.ring({ rect }).start()
 * ```
 *
 * The full geometry (both axes) is also available under `pixels`, so a factory
 * can pass it to a component that draws relative to the element (for example a
 * circle around it).
 */
export type OverlayRect = {
  /** Reference box for the placement fields. Defaults to `'recording'`. */
  relativeTo: 'screen' | 'recording'
  /** Left edge in CSS px of the recording viewport. */
  x: number
  /** Top edge in CSS px of the recording viewport. */
  y: number
  /** Width in CSS px. Present unless `dimension: 'height'` was requested. */
  width?: number
  /** Height in CSS px. Present only when `dimension: 'height'` was requested. */
  height?: number
  /**
   * The full box in CSS pixels (viewport-relative), after any `margin` and
   * clamping to the viewport, carrying both axes. Equals the element's
   * `boundingBox()` when no margin is set.
   */
  pixels: { x: number; y: number; width: number; height: number }
  /**
   * The element's raw `boundingBox()` in CSS pixels, before any `margin` and
   * before clamping to the viewport. Lets a consumer reconstruct the box for a
   * different margin.
   */
  element: { x: number; y: number; width: number; height: number }
}

export type OverlayRectOptions = {
  /** Reference box recorded on the result. Defaults to `'recording'`. */
  relativeTo?: 'screen' | 'recording'
  /**
   * Which placement dimension to expose at the top level. An overlay placement
   * takes exactly one of width/height (the other follows the aspect ratio), so
   * the result carries only the chosen one. Defaults to `'width'`.
   */
  dimension?: 'width' | 'height'
  /**
   * Extra space in CSS px added around the element on every side, so the rect
   * surrounds the element rather than sitting exactly on its edges. The rect is
   * clamped to the viewport. Defaults to `0`.
   */
  margin?: number
}

async function resolveViewportSize(
  locator: Locator
): Promise<{ width: number; height: number }> {
  const page = locator.page()
  const viewport = page.viewportSize()
  if (viewport !== null) return viewport
  // Headless edge: no fixed context viewport. Fall back to the live inner size,
  // which equals the recording dimensions the context was created with.
  return page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }))
}

/**
 * Captures a locator's bounding box in CSS pixels of the recording viewport, so
 * it can position an overlay over the element (and feed the element's geometry
 * into a programmatic overlay's props). `boundingBox()` is already in CSS px, so
 * the box is used directly after applying any `margin` and clamping to the
 * viewport. `relativeTo` is recorded on the result for spreading into a config;
 * `'screen'` is only meaningful when the recording fills the output frame.
 */
export async function overlayRect(
  locator: Locator,
  options: OverlayRectOptions = {}
): Promise<OverlayRect> {
  const box = await locator.boundingBox()
  if (box === null) {
    throw new Error(
      '[screenci] overlayRect: the locator has no bounding box (it is not visible or not attached). Wait for it to be visible before calling overlayRect.'
    )
  }
  const viewport = await resolveViewportSize(locator)
  if (viewport.width <= 0 || viewport.height <= 0) {
    throw new Error(
      '[screenci] overlayRect: could not determine the viewport size to normalize against.'
    )
  }

  // Inflate by the margin (CSS px on every side), then clamp to the viewport so
  // the box stays within the recording area even near the edges.
  const margin = options.margin ?? 0
  const left = Math.max(0, box.x - margin)
  const top = Math.max(0, box.y - margin)
  const right = Math.min(viewport.width, box.x + box.width + margin)
  const bottom = Math.min(viewport.height, box.y + box.height + margin)
  const pixels = {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  }

  const relativeTo = options.relativeTo ?? 'recording'
  const dimension = options.dimension ?? 'width'

  return {
    relativeTo,
    x: pixels.x,
    y: pixels.y,
    ...(dimension === 'height'
      ? { height: pixels.height }
      : { width: pixels.width }),
    pixels,
    element: { x: box.x, y: box.y, width: box.width, height: box.height },
  }
}
