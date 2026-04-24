import type { Locator } from '@playwright/test'
import type { ElementRect, FocusChangeEvent } from './events.js'
import { evaluateEasingAtT } from './easing.js'
import type { AutoZoomOptions, Easing } from './types.js'
import { performMouseMove, resolveMouseMoveDuration } from './mouse.js'
import {
  getAutoZoomState,
  setCurrentZoomViewport,
  setLastZoomLocation,
} from './autoZoom.js'
import { buildZoomEvent, resolveAutoZoomConfig } from './zoom.js'

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

type MouseMoveRequest = {
  page: object
  mouseMoveInternal: (x: number, y: number) => Promise<void>
  startPos: { x: number; y: number }
  targetPos: { x: number; y: number }
  duration?: number
  speed?: number
  defaultDuration?: number
  context: string
  easing: Easing
  elementRect?: ElementRect
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getViewportSize(locator: Locator): { width: number; height: number } {
  const viewport = locator.page().viewportSize()
  if (viewport) return viewport
  throw new Error(
    '[screenci] Unable to resolve page viewport size for auto zoom.'
  )
}

async function scrollTo(
  locator: Locator,
  options: Pick<
    AutoZoomOptions,
    'amount' | 'centering' | 'easing' | 'duration'
  > & { previewOnly?: boolean }
): Promise<ElementRect | undefined> {
  const opts = {
    amount: options.amount ?? 1,
    centering: options.centering ?? 0,
    evaluateEasingAtTSource: evaluateEasingAtT.toString(),
    ...(options.easing !== undefined && { easing: options.easing }),
    ...(options.duration !== undefined && { duration: options.duration }),
    ...(options.previewOnly !== undefined
      ? { previewOnly: options.previewOnly }
      : {}),
  }

  const initialBb = await locator.boundingBox()
  if (!initialBb) return undefined

  const previewRect = await locator.evaluate(
    (element, opts) =>
      new Promise<ElementRect | undefined>((resolve) => {
        const frameMs = 1000 / 60
        const durationMs = opts.duration ?? 600

        const clampValue = (value: number, min: number, max: number): number =>
          Math.min(max, Math.max(min, value))

        const evaluateEasingAtT = Function(
          `return (${opts.evaluateEasingAtTSource})`
        )() as (t: number, easing: Easing) => number

        const doc = element.ownerDocument
        const win = doc.defaultView as ScrollWindow | null
        if (!win) {
          resolve(undefined)
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

        if (opts.previewOnly) {
          resolve({
            x: elementRect.left - accDeltaLeft - (targetX - startX),
            y: elementRect.top - accDeltaTop - (targetY - startY),
            width: elementRect.width,
            height: elementRect.height,
          })
          return
        }

        if (!needsNestedScroll && !needsPageScroll) {
          resolve(undefined)
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
          const easedT = evaluateEasingAtT(
            step / steps,
            opts.easing ?? 'ease-in-out'
          )

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
            resolve(undefined)
            return
          }

          scheduleNextFrame()
        }

        tick()
      }),
    { ...opts, previewOnly: options.previewOnly }
  )

  if (opts.previewOnly) {
    return previewRect
  }

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
  focusChange?: FocusChangeEvent
}

export async function scroll(
  locator: Locator,
  options: AutoZoomOptions = {},
  mouseMove?: MouseMoveRequest
): Promise<ZoomScrollResult> {
  const state = getAutoZoomState()
  const isFirstInteraction =
    state.insideAutoZoom && state.lastZoomLocation === null
  const resolvedAutoZoomConfig = resolveAutoZoomConfig(state, options)

  if (isFirstInteraction && (state.preZoomDelay ?? 0) > 0) {
    await sleep(state.preZoomDelay ?? 0)
  }

  const previewLocatorRect = await scrollTo(locator, {
    amount: resolvedAutoZoomConfig.amount,
    centering: resolvedAutoZoomConfig.centering,
    easing: resolvedAutoZoomConfig.easing,
    ...(resolvedAutoZoomConfig.duration !== undefined
      ? { duration: resolvedAutoZoomConfig.duration }
      : {}),
    previewOnly: true,
  })

  const scrollStartMs = Date.now()
  const movePromise = mouseMove
    ? previewLocatorRect !== undefined
      ? (async () => {
          const targetX = previewLocatorRect.x + mouseMove.targetPos.x
          const targetY = previewLocatorRect.y + mouseMove.targetPos.y
          const resolvedDuration = resolveMouseMoveDuration(
            mouseMove.page,
            targetX,
            targetY,
            {
              duration: mouseMove.duration,
              speed: mouseMove.speed,
              defaultDuration: mouseMove.defaultDuration,
              context: mouseMove.context,
            }
          )

          await performMouseMove({
            page: mouseMove.page,
            mouseMoveInternal: mouseMove.mouseMoveInternal,
            targetX,
            targetY,
            duration: resolvedDuration,
            easing: mouseMove.easing,
          })

          return {
            type: 'focusChange' as const,
            x: targetX,
            y: targetY,
            mouse: {
              startMs: scrollStartMs,
              endMs: Date.now(),
              ...(resolvedDuration > 0 ? { easing: mouseMove.easing } : {}),
            },
            ...(mouseMove.elementRect !== undefined
              ? { elementRect: mouseMove.elementRect }
              : {}),
          }
        })()
      : undefined
    : undefined
  const scrollPromise = scrollTo(locator, {
    amount: resolvedAutoZoomConfig.amount,
    centering: resolvedAutoZoomConfig.centering,
    easing: resolvedAutoZoomConfig.easing,
    ...(resolvedAutoZoomConfig.duration !== undefined
      ? { duration: resolvedAutoZoomConfig.duration }
      : {}),
  })
  const [locatorRect, mouseMoveEvent] = await Promise.all([
    scrollPromise,
    movePromise ?? Promise.resolve(undefined),
  ])
  const scrollEndMs = Date.now()
  const finalLocatorRect = locatorRect ?? previewLocatorRect
  const finalMouseMoveEvent =
    mouseMoveEvent && finalLocatorRect
      ? { ...mouseMoveEvent, elementRect: finalLocatorRect }
      : mouseMoveEvent
  const viewport =
    state.insideAutoZoom && finalLocatorRect
      ? getViewportSize(locator)
      : undefined
  const focusPoint =
    viewport === undefined
      ? undefined
      : finalMouseMoveEvent
        ? { x: finalMouseMoveEvent.x, y: finalMouseMoveEvent.y }
        : {
            x: finalLocatorRect!.x + finalLocatorRect!.width / 2,
            y: finalLocatorRect!.y + finalLocatorRect!.height / 2,
          }
  const zoomStartMs = isFirstInteraction ? scrollEndMs : scrollStartMs
  const zoomEvent =
    state.insideAutoZoom && finalLocatorRect && viewport !== undefined
      ? buildZoomEvent({
          locatorRect: finalLocatorRect,
          viewport,
          config: resolvedAutoZoomConfig,
          startMs: zoomStartMs,
          isFirstInteraction,
          currentZoomEnd: state.currentZoomViewport?.end,
        })
      : undefined
  const focusChange =
    !finalMouseMoveEvent && !zoomEvent && scrollEndMs <= scrollStartMs
      ? undefined
      : {
          type: 'focusChange' as const,
          x:
            finalMouseMoveEvent?.x ??
            (finalLocatorRect
              ? finalLocatorRect.x + finalLocatorRect.width / 2
              : 0),
          y:
            finalMouseMoveEvent?.y ??
            (finalLocatorRect
              ? finalLocatorRect.y + finalLocatorRect.height / 2
              : 0),
          ...(finalMouseMoveEvent?.mouse !== undefined
            ? { mouse: finalMouseMoveEvent.mouse }
            : {}),
          ...(scrollEndMs > scrollStartMs
            ? {
                scroll: {
                  startMs: scrollStartMs,
                  endMs: scrollEndMs,
                  easing: resolvedAutoZoomConfig.easing,
                },
              }
            : {}),
          ...(zoomEvent !== undefined ? { zoom: zoomEvent } : {}),
          ...(finalMouseMoveEvent?.elementRect !== undefined
            ? { elementRect: finalMouseMoveEvent.elementRect }
            : finalLocatorRect !== undefined
              ? { elementRect: finalLocatorRect }
              : {}),
          ...(!finalMouseMoveEvent &&
          (zoomEvent !== undefined || scrollEndMs > scrollStartMs)
            ? { focusOnly: true }
            : {}),
        }

  if (state.insideAutoZoom && finalLocatorRect) {
    setLastZoomLocation({
      x: focusPoint?.x ?? finalLocatorRect.x + finalLocatorRect.width / 2,
      y: focusPoint?.y ?? finalLocatorRect.y + finalLocatorRect.height / 2,
      elementRect: finalLocatorRect,
      eventType: 'click',
    })
    if (
      zoomEvent !== undefined &&
      viewport !== undefined &&
      focusPoint !== undefined
    ) {
      setCurrentZoomViewport({
        focusPoint,
        elementRect: finalLocatorRect,
        end: zoomEvent.end,
        viewportSize: viewport,
        ...(zoomEvent.optimalOffset !== undefined
          ? { optimalOffset: zoomEvent.optimalOffset }
          : {}),
      })
    }
  }

  const remainingZoomAnimationMs = Math.max(
    0,
    zoomEvent?.endMs !== undefined ? zoomEvent.endMs - Date.now() : 0
  )
  const trailingZoomHoldMs =
    remainingZoomAnimationMs +
    (state.insideAutoZoom && !isFirstInteraction
      ? (state.preZoomDelay ?? 0)
      : 0)
  if (trailingZoomHoldMs > 0) {
    await sleep(trailingZoomHoldMs)
  }

  return {
    locatorRect: finalLocatorRect,
    ...(focusChange !== undefined ? { focusChange } : {}),
  }
}
