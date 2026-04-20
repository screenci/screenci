import type { Locator } from '@playwright/test'
import type { ElementRect } from './events.js'
import type { Easing } from './types.js'

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
export async function scrollTo(
  locator: Locator,
  height: number,
  easing: Easing = 'ease-in-out',
  duration = SCROLL_DURATION_MS
): Promise<ElementRect | undefined> {
  if (!Number.isFinite(height)) {
    throw new Error('[screenci] scrollTo height must be a finite number.')
  }

  const initialBb = await locator.boundingBox()
  if (!initialBb) return undefined

  await locator.evaluate(
    (element, opts) =>
      new Promise<void>((resolve) => {
        const frameMs = 1000 / 60
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
          const desiredTopWithinContainer = clampValue(
            Math.min(
              opts.height,
              ancestor.clientHeight / 2 - elementRect.height / 2
            ),
            0,
            Math.max(0, ancestor.clientHeight - elementRect.height)
          )
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
              (projectedRectLeft +
                elementRect.width / 2 -
                containerRect.left -
                containerRect.width / 2),
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
        const targetScrollY = clampValue(
          win.scrollY + (projectedRectTop - opts.height),
          0,
          Math.max(0, scrollHeight - viewportHeight)
        )
        const targetScrollX = clampValue(
          win.scrollX +
            (projectedRectLeft + rect.width / 2 - viewportWidth / 2),
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

        const steps = Math.max(1, Math.floor(opts.duration / frameMs))
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
          const easedT = evaluateScrollEasingAtT(t, opts.easing)

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
    { height, easing, duration }
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
