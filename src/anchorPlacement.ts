/**
 * Pure geometry for overlays anchored to a live element: where a box of a
 * given content size lands beside (or over) an element, which side it ends up
 * on after flipping away from the viewport edge, and how far it slides to
 * stay inside the viewport. All values are CSS px of the recording viewport.
 * No browser, no Playwright: the caller reads the element box and the viewport
 * and feeds them in, so the math is unit testable.
 */

export type OverlaySide = 'top' | 'bottom' | 'left' | 'right' | 'over'
export type OverlayAlign = 'start' | 'center' | 'end'

export type Box = { x: number; y: number; width: number; height: number }
export type Size = { width: number; height: number }

export type AnchorSpec = {
  /** The element's raw bounding box. */
  element: Box
  /** The recording viewport. */
  viewport: Size
  side: OverlaySide
  align: OverlayAlign
  /** Distance between the element box and the content box (not for `over`). */
  gap: number
  /** Inflation of the element box on every side (only for `over`). */
  margin: number
  /** Transparent padding captured around the content, so shadows survive. */
  bleed: number
  /** Move to the opposite side when the content does not fit on the side axis. */
  flip: boolean
  /** Slide along the align axis so the content stays inside the viewport. */
  keepInViewport: boolean
}

export type AnchorResolution = {
  /** The recorded box: the content box inflated by `bleed` on every side. */
  box: Box
  /** The visible content box, without bleed. */
  content: Box
  /** The side actually used, after any flip. */
  side: OverlaySide
  flipped: boolean
}

export const SIDES: readonly OverlaySide[] = [
  'top',
  'bottom',
  'left',
  'right',
  'over',
]
export const ALIGNS: readonly OverlayAlign[] = ['start', 'center', 'end']

export function isOverlaySide(value: unknown): value is OverlaySide {
  return typeof value === 'string' && (SIDES as string[]).includes(value)
}

export function isOverlayAlign(value: unknown): value is OverlayAlign {
  return typeof value === 'string' && (ALIGNS as string[]).includes(value)
}

export function oppositeSide(side: OverlaySide): OverlaySide {
  switch (side) {
    case 'top':
      return 'bottom'
    case 'bottom':
      return 'top'
    case 'left':
      return 'right'
    case 'right':
      return 'left'
    case 'over':
      return 'over'
    default:
      side satisfies never
      throw new Error(`[screenci] Unknown overlay side: ${String(side)}`)
  }
}

/**
 * The element box inflated by the margin and clamped to the viewport: the
 * content box of an `over` placement (identical to `overlayRect`'s `pixels`).
 */
export function overContentBox(
  element: Box,
  viewport: Size,
  margin: number
): Box {
  const left = Math.max(0, element.x - margin)
  const top = Math.max(0, element.y - margin)
  const right = Math.min(viewport.width, element.x + element.width + margin)
  const bottom = Math.min(viewport.height, element.y + element.height + margin)
  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  }
}

function inflate(box: Box, by: number): Box {
  return {
    x: box.x - by,
    y: box.y - by,
    width: box.width + 2 * by,
    height: box.height + 2 * by,
  }
}

/** Position along the align axis for a content extent next to an element extent. */
function alignedStart(
  align: OverlayAlign,
  elementStart: number,
  elementExtent: number,
  contentExtent: number
): number {
  switch (align) {
    case 'start':
      return elementStart
    case 'center':
      return elementStart + (elementExtent - contentExtent) / 2
    case 'end':
      return elementStart + elementExtent - contentExtent
    default:
      align satisfies never
      throw new Error(`[screenci] Unknown overlay align: ${String(align)}`)
  }
}

function placeOnSide(
  side: Exclude<OverlaySide, 'over'>,
  spec: AnchorSpec,
  content: Size
): Box {
  const { element, align, gap } = spec
  switch (side) {
    case 'top':
      return {
        x: alignedStart(align, element.x, element.width, content.width),
        y: element.y - gap - content.height,
        width: content.width,
        height: content.height,
      }
    case 'bottom':
      return {
        x: alignedStart(align, element.x, element.width, content.width),
        y: element.y + element.height + gap,
        width: content.width,
        height: content.height,
      }
    case 'left':
      return {
        x: element.x - gap - content.width,
        y: alignedStart(align, element.y, element.height, content.height),
        width: content.width,
        height: content.height,
      }
    case 'right':
      return {
        x: element.x + element.width + gap,
        y: alignedStart(align, element.y, element.height, content.height),
        width: content.width,
        height: content.height,
      }
    default:
      side satisfies never
      throw new Error(`[screenci] Unknown overlay side: ${String(side)}`)
  }
}

/** How far a box overflows the viewport on the given side's axis (0 = fits). */
function overflowOnSideAxis(
  side: Exclude<OverlaySide, 'over'>,
  box: Box,
  viewport: Size
): number {
  switch (side) {
    case 'top':
      return Math.max(0, -box.y)
    case 'bottom':
      return Math.max(0, box.y + box.height - viewport.height)
    case 'left':
      return Math.max(0, -box.x)
    case 'right':
      return Math.max(0, box.x + box.width - viewport.width)
    default:
      side satisfies never
      throw new Error(`[screenci] Unknown overlay side: ${String(side)}`)
  }
}

function slideIntoViewport(
  side: Exclude<OverlaySide, 'over'>,
  box: Box,
  viewport: Size
): Box {
  // Only the align axis moves: sliding on the side axis would cover the element.
  if (side === 'top' || side === 'bottom') {
    const maxX = Math.max(0, viewport.width - box.width)
    return { ...box, x: Math.min(Math.max(0, box.x), maxX) }
  }
  const maxY = Math.max(0, viewport.height - box.height)
  return { ...box, y: Math.min(Math.max(0, box.y), maxY) }
}

/**
 * Resolves where content of the given size lands for an anchor spec. For
 * `over`, the content is the element box plus margin (the given size is
 * ignored). For the other sides the content sits `gap` px away, aligned along
 * the shared edge; when it overflows the viewport on that axis and `flip` is
 * on, the opposite side is used if it has more room; `keepInViewport` then
 * slides it along the align axis. The recorded `box` adds the bleed.
 */
export function resolveAnchoredBox(
  spec: AnchorSpec,
  contentSize: Size
): AnchorResolution {
  if (spec.side === 'over') {
    const content = overContentBox(spec.element, spec.viewport, spec.margin)
    return {
      box: inflate(content, spec.bleed),
      content,
      side: 'over',
      flipped: false,
    }
  }
  let side: Exclude<OverlaySide, 'over'> = spec.side
  let content = placeOnSide(side, spec, contentSize)
  let flipped = false
  if (spec.flip) {
    const overflow = overflowOnSideAxis(side, content, spec.viewport)
    if (overflow > 0) {
      const other = oppositeSide(side) as Exclude<OverlaySide, 'over'>
      const candidate = placeOnSide(other, spec, contentSize)
      if (overflowOnSideAxis(other, candidate, spec.viewport) < overflow) {
        side = other
        content = candidate
        flipped = true
      }
    }
  }
  if (spec.keepInViewport) {
    content = slideIntoViewport(side, content, spec.viewport)
  }
  return { box: inflate(content, spec.bleed), content, side, flipped }
}
