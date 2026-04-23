import type { Locator } from '@playwright/test'
import type { ElementRect } from './events.js'
import type { AutoZoomOptions, Easing } from './types.js'
import { getAutoZoomState } from './autoZoom.js'

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

async function scrollTo(
  locator: Locator,
  options: Pick<AutoZoomOptions, 'amount' | 'centering' | 'easing' | 'duration'>
): Promise<ElementRect | undefined> {
  const opts = {
    amount: options.amount ?? 1,
    centering: options.centering ?? 0,
    ...(options.easing !== undefined && { easing: options.easing }),
    ...(options.duration !== undefined && { duration: options.duration }),
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
          const effectiveAmount = clampValue(
            Math.max(
              opts.amount,
              elementRect.width / Math.max(1, containerWidth),
              elementRect.height / Math.max(1, containerHeight)
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
    opts
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
  isInsideAutoZoom: boolean
}

export async function scroll(
  locator: Locator,
  options: AutoZoomOptions = {}
): Promise<ZoomScrollResult> {
  const state = getAutoZoomState()
  const isFirstInteraction =
    state.insideAutoZoom && state.lastZoomLocation === null
  const useZoomAnimation = state.insideAutoZoom && !isFirstInteraction

  const easing =
    options.easing ??
    (useZoomAnimation ? (state.easing ?? 'ease-in-out') : 'ease-in-out')
  const duration =
    options.duration ??
    (useZoomAnimation ? (state.duration ?? undefined) : undefined)
  const amount =
    options.amount ?? state.amount ?? (state.insideAutoZoom ? 0.5 : 1)
  const centering =
    options.centering !== undefined
      ? resolveCenteringValue(options.centering)
      : (state.centering ?? 1)

  const scrollStartMs = Date.now()
  const locatorRect = await scrollTo(locator, {
    amount,
    centering,
    easing,
    ...(duration !== undefined && { duration }),
  })
  const scrollEndMs = Date.now()

  return {
    locatorRect,
    scrollStartMs,
    scrollEndMs,
    scrollElapsedMs: Math.max(0, scrollEndMs - scrollStartMs),
    isFirstAutoZoomInteraction: isFirstInteraction,
    shouldScrollBeforeMouseMove: isFirstInteraction,
    isInsideAutoZoom: state.insideAutoZoom,
  }
}
