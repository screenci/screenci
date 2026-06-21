import type { Locator } from '@playwright/test'

/**
 * A locator's on-screen box expressed as normalized 0..1 fractions of the
 * recording area, ready to position an overlay over a live element.
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
 * The full geometry is also available under `normalized` (all four fractions)
 * and `pixels` (the raw viewport box), so a factory can pass it to a component
 * that draws relative to the element (for example a circle around it).
 */
export type OverlayRect = {
  /** Reference box for the placement fields. Defaults to `'recording'`. */
  relativeTo: 'screen' | 'recording'
  /** Left edge as a 0..1 fraction of the reference box. */
  x: number
  /** Top edge as a 0..1 fraction of the reference box. */
  y: number
  /** Width fraction. Present unless `dimension: 'height'` was requested. */
  width?: number
  /** Height fraction. Present only when `dimension: 'height'` was requested. */
  height?: number
  /** All four normalized fractions, regardless of the chosen placement dimension. */
  normalized: { x: number; y: number; width: number; height: number }
  /** The raw viewport box in CSS pixels, as returned by `boundingBox()`. */
  pixels: { x: number; y: number; width: number; height: number }
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
 * Captures a locator's bounding box and converts it to normalized 0..1
 * coordinates in the recording area, so it can position an overlay over the
 * element (and feed the element's geometry into a programmatic overlay's props).
 *
 * The recording context's viewport equals the recording dimensions, so the box
 * is normalized directly against the viewport. `relativeTo` is recorded on the
 * result for spreading into a config; `'screen'` is only meaningful when the
 * recording fills the output frame.
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

  const normalized = {
    x: box.x / viewport.width,
    y: box.y / viewport.height,
    width: box.width / viewport.width,
    height: box.height / viewport.height,
  }
  const relativeTo = options.relativeTo ?? 'recording'
  const dimension = options.dimension ?? 'width'

  return {
    relativeTo,
    x: normalized.x,
    y: normalized.y,
    ...(dimension === 'height'
      ? { height: normalized.height }
      : { width: normalized.width }),
    normalized,
    pixels: { x: box.x, y: box.y, width: box.width, height: box.height },
  }
}
