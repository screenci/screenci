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

type ScrollToOptions = {
  amount: number
  /** 0..1 visibility bias: 0 = barely visible, 1 = centered. */
  centering: number
  allowZoomingOut: boolean
  easing?: Easing
  duration?: number
  legacyHeight?: number
}

/**
 * Best-effort scroll helper used by instrumentation.
 * Scrolls the nearest nested scroll container first, then the page viewport,
 * and returns the final bounding rect if it can be measured.
 *
 * Pass `amount` as `getZoomAmount() ?? 1` when inside an auto-zoom session,
 * or `1` otherwise.
 */
export async function scrollTo(
  locator: Locator,
  height: number,
  amount: number,
  easing?: Easing,
  duration?: number
): Promise<ElementRect | undefined> {
  return scrollToWithOptions(locator, {
    amount,
    centering: 1,
    allowZoomingOut: true,
    legacyHeight: height,
    ...(easing !== undefined && { easing }),
    ...(duration !== undefined && { duration }),
  })
}

async function scrollToWithOptions(
  locator: Locator,
  options: ScrollToOptions
): Promise<ElementRect | undefined> {
  const initialBb = await locator.boundingBox()
  if (!initialBb) return undefined

  await locator.evaluate(
    (element, opts) =>
      new Promise<void>((resolve) => {
        const frameMs = 1000 / 60
        const durationMs = opts.duration ?? 600

        const clampValue = (value: number, min: number, max: number): number =>
          Math.min(max, Math.max(min, value))

        // Duplicated below the serialization boundary; locator.evaluate
        // sends the callback as a string and cannot close over outer functions.
        const easingAtT = (t: number, easing: Easing): number => {
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

        const doc = element.ownerDocument
        const win = doc.defaultView as ScrollWindow | null
        if (!win) {
          resolve()
          return
        }

        const viewportHeight =
          win.innerHeight || doc.documentElement.clientHeight
        const viewportWidth = win.innerWidth || doc.documentElement.clientWidth
        const elementRect = element.getBoundingClientRect()

        const isScrollable = (node: unknown): node is ScrollableElement => {
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
          const el = node as ScrollableElement
          const style = win.getComputedStyle(node as Element)
          return (
            ((style.overflowY === 'auto' ||
              style.overflowY === 'scroll' ||
              style.overflowY === 'overlay') &&
              el.scrollHeight > el.clientHeight) ||
            ((style.overflowX === 'auto' ||
              style.overflowX === 'scroll' ||
              style.overflowX === 'overlay') &&
              el.scrollWidth > el.clientWidth)
          )
        }

        // Returns the desired edge offset (top or left) of the element within a
        // container, for one axis at a time. Closes over elementRect and opts.
        const resolveDesiredOffset = (
          rectSize: number,
          containerSize: number,
          containerWidth: number,
          containerHeight: number
        ): number => {
          if (opts.legacyHeight !== undefined) {
            return clampValue(
              Math.min(opts.legacyHeight, containerSize / 2 - rectSize / 2),
              0,
              Math.max(0, containerSize - rectSize)
            )
          }
          const effectiveAmount = clampValue(
            Math.max(
              opts.allowZoomingOut
                ? Math.max(
                    opts.amount,
                    elementRect.width / Math.max(1, containerWidth),
                    elementRect.height / Math.max(1, containerHeight)
                  )
                : opts.amount,
              0
            ),
            0,
            1
          )
          const visibleSize = containerSize * effectiveAmount
          const cropStart = Math.max(0, (containerSize - visibleSize) / 2)
          return clampValue(
            cropStart + ((visibleSize - rectSize) * opts.centering) / 2,
            0,
            Math.max(0, containerSize - rectSize)
          )
        }

        type ScrollPlan = {
          element: ScrollableElement
          startTop: number
          startLeft: number
          targetTop: number
          targetLeft: number
        }

        // Walks up the DOM collecting scroll plans for every scrollable ancestor
        // (excluding the document root, which is handled by planPageScroll).
        // Returns the plans and the accumulated viewport-space delta the element
        // will shift once all inner containers have scrolled — needed so each
        // outer container can project where the element will actually land.
        const buildAncestorScrollPlans = (): {
          plans: ScrollPlan[]
          accDeltaTop: number
          accDeltaLeft: number
        } => {
          const plans: ScrollPlan[] = []
          let accDeltaTop = 0
          let accDeltaLeft = 0

          for (
            let current: Element | null = element.parentElement;
            current;
            current = current.parentElement
          ) {
            if (
              !isScrollable(current) ||
              current === doc.documentElement ||
              current === doc.body
            ) {
              continue
            }

            const containerRect = current.getBoundingClientRect()
            const projectedTop = elementRect.top - accDeltaTop
            const projectedLeft = elementRect.left - accDeltaLeft
            const startTop = current.scrollTop
            const startLeft = current.scrollLeft

            const targetTop = clampValue(
              startTop +
                (projectedTop -
                  containerRect.top -
                  resolveDesiredOffset(
                    elementRect.height,
                    current.clientHeight,
                    current.clientWidth,
                    current.clientHeight
                  )),
              0,
              Math.max(0, current.scrollHeight - current.clientHeight)
            )
            const targetLeft = clampValue(
              startLeft +
                (projectedLeft -
                  containerRect.left -
                  resolveDesiredOffset(
                    elementRect.width,
                    current.clientWidth,
                    current.clientWidth,
                    current.clientHeight
                  )),
              0,
              Math.max(0, current.scrollWidth - current.clientWidth)
            )

            plans.push({
              element: current,
              startTop,
              startLeft,
              targetTop,
              targetLeft,
            })
            accDeltaTop += targetTop - startTop
            accDeltaLeft += targetLeft - startLeft
          }

          return { plans, accDeltaTop, accDeltaLeft }
        }

        // Plans the window-level scroll, accounting for how far the element will
        // have moved once all nested ancestor scrolls are applied.
        const planPageScroll = (
          accDeltaTop: number,
          accDeltaLeft: number
        ): {
          startY: number
          startX: number
          targetY: number
          targetX: number
        } => {
          const scrollHeight = Math.max(
            doc.documentElement.scrollHeight,
            doc.body?.scrollHeight ?? 0
          )
          const scrollWidth = Math.max(
            doc.documentElement.scrollWidth,
            doc.body?.scrollWidth ?? 0
          )
          const startY = win.scrollY
          const startX = win.scrollX
          const projectedTop = elementRect.top - accDeltaTop
          const projectedLeft = elementRect.left - accDeltaLeft
          return {
            startY,
            startX,
            targetY: clampValue(
              startY +
                (projectedTop -
                  resolveDesiredOffset(
                    elementRect.height,
                    viewportHeight,
                    viewportWidth,
                    viewportHeight
                  )),
              0,
              Math.max(0, scrollHeight - viewportHeight)
            ),
            targetX: clampValue(
              startX +
                (projectedLeft -
                  resolveDesiredOffset(
                    elementRect.width,
                    viewportWidth,
                    viewportWidth,
                    viewportHeight
                  )),
              0,
              Math.max(0, scrollWidth - viewportWidth)
            ),
          }
        }

        const {
          plans: ancestorScrollPlans,
          accDeltaTop,
          accDeltaLeft,
        } = buildAncestorScrollPlans()
        const { startY, startX, targetY, targetX } = planPageScroll(
          accDeltaTop,
          accDeltaLeft
        )

        const needsNestedScroll = ancestorScrollPlans.some(
          (plan) =>
            plan.targetTop !== plan.startTop ||
            plan.targetLeft !== plan.startLeft
        )
        const needsPageScroll = targetY !== startY || targetX !== startX

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

        const tick = (): void => {
          step += 1
          const easedT = easingAtT(step / steps, opts.easing ?? 'ease-in-out')

          for (const plan of ancestorScrollPlans) {
            plan.element.scrollTop =
              plan.startTop + (plan.targetTop - plan.startTop) * easedT
            plan.element.scrollLeft =
              plan.startLeft + (plan.targetLeft - plan.startLeft) * easedT
          }

          win.scrollTo({
            top: startY + (targetY - startY) * easedT,
            left: startX + (targetX - startX) * easedT,
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
    const locatorRect = await scrollToWithOptions(locator, {
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
