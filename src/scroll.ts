import type { Locator } from '@playwright/test'
import type { ElementRect } from './events.js'
import type { Easing } from './types.js'
import {
  getLastZoomLocation,
  getAllowZoomingOut,
  getZoomAmount,
  getZoomDuration,
  getZoomEasing,
  getZoomCentering,
  isInsideAutoZoom,
} from './autoZoom.js'

const SCROLL_DURATION_MS = 600

function evaluateEasingAtT(t: number, easing: Easing): number {
  if (t <= 0) return 0
  if (t >= 1) return 1
  switch (easing) {
    case 'linear':
      return t
    case 'ease-in':
      return t * t * t
    case 'ease-out':
      return 1 - (1 - t) * (1 - t) * (1 - t)
    case 'ease-in-out':
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
    case 'ease-in-strong':
      return t * t * t * t
    case 'ease-out-strong':
      return 1 - (1 - t) * (1 - t) * (1 - t) * (1 - t)
    case 'ease-in-out-strong':
      return t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2
    default: {
      const _: never = easing
      throw new Error(`Unknown easing: ${_}`)
    }
  }
}

type ScrollRectLike = {
  top: number
  left: number
  width: number
  height: number
}

type ScrollableElement = {
  clientHeight: number
  clientWidth: number
  scrollHeight: number
  scrollWidth: number
  scrollTop: number
  scrollLeft: number
  parentElement?: Element | null
  getBoundingClientRect: () => ScrollRectLike
}

type ScrollWindow = Window & {
  scrollY: number
  scrollX: number
  getComputedStyle: (elt: Element) => CSSStyleDeclaration
  requestAnimationFrame?: (callback: FrameRequestCallback) => number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function resolveCenteringValue(centering: number | undefined): number {
  if (centering === undefined) return 1
  return clamp(centering, 0, 1)
}

function isScrollableElement(node: unknown): node is ScrollableElement {
  if (
    !node ||
    typeof node !== 'object' ||
    !('getBoundingClientRect' in node) ||
    !('clientHeight' in node) ||
    !('clientWidth' in node) ||
    !('scrollHeight' in node) ||
    !('scrollWidth' in node) ||
    !('scrollTop' in node) ||
    !('scrollLeft' in node)
  ) {
    return false
  }
  return true
}

/**
 * Best-effort scroll helper used by instrumentation.
 * Scrolls the nearest nested scroll container first, then the page viewport,
 * and returns the final bounding rect if it can be measured.
 */
type ScrollToOptions = {
  amount: number
  centering: number
  allowZoomingOut: boolean
  easing?: Easing
  duration?: number
}

export async function scrollTo(
  locator: Locator,
  height: number,
  easing?: Easing,
  duration?: number
): Promise<ElementRect | undefined>
export async function scrollTo(
  locator: Locator,
  options: ScrollToOptions
): Promise<ElementRect | undefined>
export async function scrollTo(
  locator: Locator,
  arg1: number | ScrollToOptions,
  arg2?: Easing,
  arg3?: number
): Promise<ElementRect | undefined> {
  const options: ScrollToOptions & { legacyHeight?: number } =
    typeof arg1 === 'number'
      ? {
          amount: 1,
          centering: 1,
          allowZoomingOut: true,
          ...(arg2 !== undefined && { easing: arg2 }),
          ...(arg3 !== undefined && { duration: arg3 }),
          legacyHeight: arg1,
        }
      : arg1

  if (!Number.isFinite(options.amount)) {
    throw new Error('[screenci] scrollTo amount must be a finite number.')
  }

  const initialBb = await locator.boundingBox()
  if (!initialBb) return undefined

  await locator.evaluate(
    (element, opts) =>
      new Promise<void>((resolve) => {
        const frameMs = 1000 / 60
        const durationMs = opts.duration ?? 600
        const clampValue = (value: number, min: number, max: number): number =>
          Math.min(max, Math.max(min, value))
        const evaluateScrollEasingAtT = (t: number, easing: Easing): number => {
          if (t <= 0) return 0
          if (t >= 1) return 1
          switch (easing) {
            case 'linear':
              return t
            case 'ease-in':
              return t * t * t
            case 'ease-out':
              return 1 - (1 - t) * (1 - t) * (1 - t)
            case 'ease-in-out':
              return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
            case 'ease-in-strong':
              return t * t * t * t
            case 'ease-out-strong':
              return 1 - (1 - t) * (1 - t) * (1 - t) * (1 - t)
            case 'ease-in-out-strong':
              return t < 0.5
                ? 8 * t * t * t * t
                : 1 - Math.pow(-2 * t + 2, 4) / 2
            default: {
              const _: never = easing
              throw new Error(`Unknown easing: ${_}`)
            }
          }
        }
        const isScrollElementShape = (
          node: unknown
        ): node is ScrollableElement => {
          if (
            !node ||
            typeof node !== 'object' ||
            !('getBoundingClientRect' in node) ||
            !('clientHeight' in node) ||
            !('clientWidth' in node) ||
            !('scrollHeight' in node) ||
            !('scrollWidth' in node) ||
            !('scrollTop' in node) ||
            !('scrollLeft' in node)
          ) {
            return false
          }
          return true
        }
        const doc = element.ownerDocument
        const win = doc.defaultView as ScrollWindow | null
        if (!win) {
          resolve()
          return
        }

        const isActuallyScrollable = (
          node: unknown
        ): node is ScrollableElement => {
          if (!isScrollElementShape(node)) {
            return false
          }

          const style = win.getComputedStyle(node as Element)
          const overflowY = style.overflowY
          const overflowX = style.overflowX
          const canScrollY =
            (overflowY === 'auto' ||
              overflowY === 'scroll' ||
              overflowY === 'overlay') &&
            node.scrollHeight > node.clientHeight
          const canScrollX =
            (overflowX === 'auto' ||
              overflowX === 'scroll' ||
              overflowX === 'overlay') &&
            node.scrollWidth > node.clientWidth

          return canScrollY || canScrollX
        }

        const viewportHeight =
          win.innerHeight || doc.documentElement.clientHeight
        const viewportWidth = win.innerWidth || doc.documentElement.clientWidth

        const scrollableAncestors: ScrollableElement[] = []
        for (let current: Element | null = element.parentElement; current; ) {
          if (
            isActuallyScrollable(current) &&
            current !== doc.documentElement &&
            current !== doc.body
          ) {
            scrollableAncestors.push(current)
          }
          current = current.parentElement
        }

        const ancestorScrollPlans: Array<{
          element: ScrollableElement
          startTop: number
          startLeft: number
          targetTop: number
          targetLeft: number
        }> = []

        let accumulatedNestedDeltaTop = 0
        let accumulatedNestedDeltaLeft = 0
        const elementRect = element.getBoundingClientRect()
        for (const ancestor of scrollableAncestors) {
          const containerRect = ancestor.getBoundingClientRect()
          const projectedRectTop = elementRect.top - accumulatedNestedDeltaTop
          const projectedRectLeft =
            elementRect.left - accumulatedNestedDeltaLeft
          const startTop = ancestor.scrollTop
          const startLeft = ancestor.scrollLeft
          const desiredTopWithinContainer =
            opts.legacyHeight !== undefined
              ? clampValue(
                  Math.min(
                    opts.legacyHeight,
                    ancestor.clientHeight / 2 - elementRect.height / 2
                  ),
                  0,
                  Math.max(0, ancestor.clientHeight - elementRect.height)
                )
              : (() => {
                  const effectiveAmount = clampValue(
                    Math.max(
                      opts.allowZoomingOut
                        ? Math.max(
                            opts.amount,
                            elementRect.width /
                              Math.max(1, ancestor.clientWidth),
                            elementRect.height /
                              Math.max(1, ancestor.clientHeight)
                          )
                        : opts.amount,
                      0
                    ),
                    0,
                    1
                  )
                  const visibleHeight = ancestor.clientHeight * effectiveAmount
                  const cropTop = Math.max(
                    0,
                    (ancestor.clientHeight - visibleHeight) / 2
                  )
                  return clampValue(
                    cropTop +
                      ((visibleHeight - elementRect.height) * opts.centering) /
                        2,
                    0,
                    Math.max(0, ancestor.clientHeight - elementRect.height)
                  )
                })()
          const desiredLeftWithinContainer =
            opts.legacyHeight !== undefined
              ? clampValue(
                  ancestor.clientWidth / 2 - elementRect.width / 2,
                  0,
                  Math.max(0, ancestor.clientWidth - elementRect.width)
                )
              : (() => {
                  const effectiveAmount = clampValue(
                    Math.max(
                      opts.allowZoomingOut
                        ? Math.max(
                            opts.amount,
                            elementRect.width /
                              Math.max(1, ancestor.clientWidth),
                            elementRect.height /
                              Math.max(1, ancestor.clientHeight)
                          )
                        : opts.amount,
                      0
                    ),
                    0,
                    1
                  )
                  const visibleWidth = ancestor.clientWidth * effectiveAmount
                  const cropLeft = Math.max(
                    0,
                    (ancestor.clientWidth - visibleWidth) / 2
                  )
                  return clampValue(
                    cropLeft +
                      ((visibleWidth - elementRect.width) * opts.centering) / 2,
                    0,
                    Math.max(0, ancestor.clientWidth - elementRect.width)
                  )
                })()
          const targetTop = clampValue(
            startTop +
              (projectedRectTop -
                containerRect.top -
                desiredTopWithinContainer),
            0,
            Math.max(0, ancestor.scrollHeight - ancestor.clientHeight)
          )
          const targetLeft = clampValue(
            startLeft +
              (projectedRectLeft -
                containerRect.left -
                desiredLeftWithinContainer),
            0,
            Math.max(0, ancestor.scrollWidth - ancestor.clientWidth)
          )

          ancestorScrollPlans.push({
            element: ancestor,
            startTop,
            startLeft,
            targetTop,
            targetLeft,
          })

          accumulatedNestedDeltaTop += targetTop - startTop
          accumulatedNestedDeltaLeft += targetLeft - startLeft
        }

        const rect = element.getBoundingClientRect()
        const projectedRectTop = rect.top - accumulatedNestedDeltaTop
        const projectedRectLeft = rect.left - accumulatedNestedDeltaLeft
        const scrollHeight = Math.max(
          doc.documentElement.scrollHeight,
          doc.body?.scrollHeight ?? 0
        )
        const scrollWidth = Math.max(
          doc.documentElement.scrollWidth,
          doc.body?.scrollWidth ?? 0
        )
        const desiredTop =
          opts.legacyHeight !== undefined
            ? opts.legacyHeight
            : (() => {
                const effectiveAmount = clampValue(
                  Math.max(
                    opts.allowZoomingOut
                      ? Math.max(
                          opts.amount,
                          rect.width / Math.max(1, viewportWidth),
                          rect.height / Math.max(1, viewportHeight)
                        )
                      : opts.amount,
                    0
                  ),
                  0,
                  1
                )
                const visibleHeight = viewportHeight * effectiveAmount
                const cropTop = Math.max(
                  0,
                  (viewportHeight - visibleHeight) / 2
                )
                return clampValue(
                  cropTop +
                    ((visibleHeight - rect.height) * opts.centering) / 2,
                  0,
                  Math.max(0, viewportHeight - rect.height)
                )
              })()
        const desiredLeft =
          opts.legacyHeight !== undefined
            ? clampValue(
                viewportWidth / 2 - rect.width / 2,
                0,
                Math.max(0, viewportWidth - rect.width)
              )
            : (() => {
                const effectiveAmount = clampValue(
                  Math.max(
                    opts.allowZoomingOut
                      ? Math.max(
                          opts.amount,
                          rect.width / Math.max(1, viewportWidth),
                          rect.height / Math.max(1, viewportHeight)
                        )
                      : opts.amount,
                    0
                  ),
                  0,
                  1
                )
                const visibleWidth = viewportWidth * effectiveAmount
                const cropLeft = Math.max(0, (viewportWidth - visibleWidth) / 2)
                return clampValue(
                  cropLeft + ((visibleWidth - rect.width) * opts.centering) / 2,
                  0,
                  Math.max(0, viewportWidth - rect.width)
                )
              })()
        const targetScrollY = clampValue(
          win.scrollY + (projectedRectTop - desiredTop),
          0,
          Math.max(0, scrollHeight - viewportHeight)
        )
        const targetScrollX = clampValue(
          win.scrollX + (projectedRectLeft - desiredLeft),
          0,
          Math.max(0, scrollWidth - viewportWidth)
        )

        const pageStartY = win.scrollY
        const pageStartX = win.scrollX
        const needsNestedScroll = ancestorScrollPlans.some(
          (plan) =>
            plan.targetTop !== plan.startTop ||
            plan.targetLeft !== plan.startLeft
        )
        const needsPageScroll =
          targetScrollY !== pageStartY || targetScrollX !== pageStartX

        if (!needsNestedScroll && !needsPageScroll) {
          resolve()
          return
        }

        const steps = Math.max(1, Math.floor(durationMs / frameMs))
        let step = 0

        const scheduleNextFrame = (): void => {
          if (typeof win.requestAnimationFrame === 'function') {
            win.requestAnimationFrame(() => tick())
            return
          }
          setTimeout(tick, frameMs)
        }

        const tick = () => {
          step += 1
          const t = step / steps
          const easedT = evaluateScrollEasingAtT(
            t,
            opts.easing ?? 'ease-in-out'
          )

          for (const plan of ancestorScrollPlans) {
            plan.element.scrollTop =
              plan.startTop + (plan.targetTop - plan.startTop) * easedT
            plan.element.scrollLeft =
              plan.startLeft + (plan.targetLeft - plan.startLeft) * easedT
          }

          win.scrollTo({
            top: pageStartY + (targetScrollY - pageStartY) * easedT,
            left: pageStartX + (targetScrollX - pageStartX) * easedT,
            behavior: 'auto',
          })

          if (step >= steps) {
            resolve()
            return
          }

          scheduleNextFrame()
        }

        tick()
      }),
    options
  )

  const finalBb = await locator.boundingBox()
  if (!finalBb) return initialBb
  return {
    x: finalBb.x,
    y: finalBb.y,
    width: finalBb.width,
    height: finalBb.height,
  }
}

export type ZoomScrollResult = {
  locatorRect: ElementRect | undefined
  scrollStartMs: number
  scrollEndMs: number
  scrollElapsedMs: number
  isFirstAutoZoomInteraction: boolean
  shouldScrollBeforeMouseMove: boolean
}

export class ZoomScrollHandler {
  constructor(
    private readonly options: {
      amount?: number
      centering?: number
      allowZoomingOut?: boolean
    } = {}
  ) {}

  readonly isInsideAutoZoom = isInsideAutoZoom()
  readonly lastZoomLocation = getLastZoomLocation()
  readonly isFirstAutoZoomInteraction =
    this.isInsideAutoZoom && this.lastZoomLocation === null
  readonly hadPreviousZoomLocation = this.lastZoomLocation !== null

  private resolveScrollAnimationOptions(): {
    easing: Easing
    duration: number | undefined
  } {
    if (!this.isInsideAutoZoom || this.isFirstAutoZoomInteraction) {
      return { easing: 'ease-in-out', duration: undefined }
    }

    return {
      easing: getZoomEasing() ?? 'ease-in-out',
      duration: getZoomDuration() ?? undefined,
    }
  }

  private resolveScrollBehavior(): {
    amount: number
    centering: number
    allowZoomingOut: boolean
  } {
    const amount =
      this.options.amount ??
      getZoomAmount() ??
      (this.isInsideAutoZoom ? 0.5 : 1)
    const centering =
      this.options.centering !== undefined
        ? resolveCenteringValue(this.options.centering)
        : (getZoomCentering() ?? (this.isInsideAutoZoom ? 1 : 1))
    const allowZoomingOut =
      this.options.allowZoomingOut ?? getAllowZoomingOut() ?? true

    return { amount, centering, allowZoomingOut }
  }

  async scroll(
    locator: Locator,
    centeringOverride?: number
  ): Promise<ZoomScrollResult> {
    const { easing, duration } = this.resolveScrollAnimationOptions()
    const { amount, centering, allowZoomingOut } = this.resolveScrollBehavior()
    const effectiveCentering =
      centeringOverride !== undefined
        ? clamp(centeringOverride, 0, 1)
        : centering
    const scrollStartMs = Date.now()
    const locatorRect = await scrollTo(locator, {
      amount,
      centering: effectiveCentering,
      allowZoomingOut,
      ...(easing !== undefined && { easing }),
      ...(duration !== undefined && { duration }),
    })
    const scrollEndMs = Date.now()

    return {
      locatorRect,
      scrollStartMs,
      scrollEndMs,
      scrollElapsedMs: Math.max(0, scrollEndMs - scrollStartMs),
      isFirstAutoZoomInteraction: this.isFirstAutoZoomInteraction,
      shouldScrollBeforeMouseMove: this.isFirstAutoZoomInteraction,
    }
  }
}
