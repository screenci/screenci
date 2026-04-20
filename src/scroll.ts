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
  easing: Easing = 'ease-in-out'
): Promise<ElementRect | undefined> {
  if (!Number.isFinite(height)) {
    throw new Error('[screenci] scrollTo height must be a finite number.')
  }

  const initialBb = await locator.boundingBox()
  if (!initialBb) return undefined

  await locator.evaluate(
    (element, opts) =>
      new Promise<void>((resolve) => {
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
        const isScrollableElement = (
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
        const win = doc.defaultView
        if (!win) {
          resolve()
          return
        }

        const viewportHeight =
          win.innerHeight || doc.documentElement.clientHeight
        const viewportWidth = win.innerWidth || doc.documentElement.clientWidth

        let nearestScrollable: ScrollableElement | null = null
        for (let current: Element | null = element.parentElement; current; ) {
          if (
            isScrollableElement(current) &&
            current !== doc.documentElement &&
            current !== doc.body
          ) {
            nearestScrollable = current
            break
          }
          current = current.parentElement
        }

        if (nearestScrollable) {
          const containerRect = nearestScrollable.getBoundingClientRect()
          const elementRect = element.getBoundingClientRect()
          const targetTop = clampValue(
            nearestScrollable.scrollTop +
              (elementRect.top - containerRect.top - opts.height),
            0,
            Math.max(
              0,
              nearestScrollable.scrollHeight - nearestScrollable.clientHeight
            )
          )
          const targetLeft = clampValue(
            nearestScrollable.scrollLeft +
              (elementRect.left +
                elementRect.width / 2 -
                containerRect.left -
                containerRect.width / 2),
            0,
            Math.max(
              0,
              nearestScrollable.scrollWidth - nearestScrollable.clientWidth
            )
          )
          nearestScrollable.scrollTop = targetTop
          nearestScrollable.scrollLeft = targetLeft
        }

        const rect = element.getBoundingClientRect()
        const scrollHeight = Math.max(
          doc.documentElement.scrollHeight,
          doc.body?.scrollHeight ?? 0
        )
        const scrollWidth = Math.max(
          doc.documentElement.scrollWidth,
          doc.body?.scrollWidth ?? 0
        )
        const targetScrollY = clampValue(
          win.scrollY + (rect.top - opts.height),
          0,
          Math.max(0, scrollHeight - viewportHeight)
        )
        const targetScrollX = clampValue(
          win.scrollX + (rect.left + rect.width / 2 - viewportWidth / 2),
          0,
          Math.max(0, scrollWidth - viewportWidth)
        )

        win.scrollTo({
          top: targetScrollY,
          left: targetScrollX,
          behavior: 'auto',
        })
        resolve()
      }),
    { height, easing }
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
