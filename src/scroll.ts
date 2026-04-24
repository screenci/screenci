import type { Locator } from '@playwright/test'
import type { ElementRect, FocusChangeEvent } from './events.js'
import type { AutoZoomOptions, Easing } from './types.js'
import {
  getAutoZoomState,
  setCurrentZoomViewport,
  setLastZoomLocation,
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

type MouseMovePlan = Omit<
  MouseMoveRequest,
  'duration' | 'speed' | 'defaultDuration' | 'context'
> & {
  duration: number
  startMs: number
}

type MouseMoveResult = FocusChangeEvent

type FocusChangeZoom = NonNullable<FocusChangeEvent['zoom']>

type ResolvedAutoZoomConfig = {
  easing: Easing
  duration: number
  amount: number
  centering: number
  allowZoomingOut: boolean
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function resolveCenteringValue(centering: number | undefined): number {
  if (centering === undefined) return 1
  return clamp(centering, 0, 1)
}

function assertDurationOrSpeed(
  duration: number | undefined,
  speed: number | undefined,
  context: string
): void {
  if (duration !== undefined && speed !== undefined) {
    throw new Error(
      `[screenci] ${context} accepts either duration or speed, not both.`
    )
  }
  if (duration !== undefined && (!Number.isFinite(duration) || duration < 0)) {
    throw new Error(
      `[screenci] ${context} duration must be a finite number >= 0.`
    )
  }
  if (speed !== undefined && (!Number.isFinite(speed) || speed <= 0)) {
    throw new Error(`[screenci] ${context} speed must be a finite number > 0.`)
  }
}

function resolveMouseMoveDuration(
  startPos: { x: number; y: number },
  targetX: number,
  targetY: number,
  options: {
    duration: number | undefined
    speed: number | undefined
    defaultDuration: number | undefined
    context: string
  }
): number {
  const { duration, speed, defaultDuration, context } = options
  assertDurationOrSpeed(duration, speed, context)
  if (speed !== undefined) {
    const distancePx = Math.hypot(targetX - startPos.x, targetY - startPos.y)
    return (distancePx / speed) * 1000
  }
  return duration ?? defaultDuration ?? 0
}

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

async function animateMouseMove(plan: MouseMovePlan): Promise<MouseMoveResult> {
  const {
    mouseMoveInternal,
    startPos,
    targetPos,
    duration,
    easing,
    startMs,
    elementRect,
  } = plan
  const targetX = targetPos.x
  const targetY = targetPos.y

  if (duration > 0) {
    const frameMs = 1000 / 60
    const steps = Math.max(1, Math.floor(duration / frameMs))
    const stepMs = duration / steps

    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const easedT = evaluateEasingAtT(t, easing)
      const x = startPos.x + easedT * (targetX - startPos.x)
      const y = startPos.y + easedT * (targetY - startPos.y)
      await mouseMoveInternal(x, y)
      if (i < steps) {
        await new Promise<void>((resolve) => setTimeout(resolve, stepMs))
      }
    }
  } else {
    await mouseMoveInternal(targetX, targetY)
  }

  return {
    type: 'focusChange',
    x: targetX,
    y: targetY,
    mouse: {
      startMs,
      endMs: Date.now(),
      ...(duration > 0 ? { easing } : {}),
    },
    ...(elementRect !== undefined ? { elementRect } : {}),
  }
}

function getViewportSize(locator: Locator): { width: number; height: number } {
  const viewport = locator.page().viewportSize()
  if (viewport) return viewport
  throw new Error(
    '[screenci] Unable to resolve page viewport size for auto zoom.'
  )
}

function resolveAutoZoomConfig(
  state: ReturnType<typeof getAutoZoomState>,
  options: AutoZoomOptions
): ResolvedAutoZoomConfig {
  const useZoomAnimation =
    state.insideAutoZoom && state.lastZoomLocation !== null

  return {
    easing:
      options.easing ??
      (useZoomAnimation ? (state.easing ?? 'ease-in-out') : 'ease-in-out'),
    duration:
      options.duration ?? (useZoomAnimation ? (state.duration ?? 0) : 0),
    amount: options.amount ?? state.amount ?? (state.insideAutoZoom ? 0.5 : 1),
    centering:
      options.centering !== undefined
        ? resolveCenteringValue(options.centering)
        : (state.centering ?? 1),
    allowZoomingOut: options.allowZoomingOut ?? state.allowZoomingOut ?? true,
  }
}

function clampZoomViewport(
  point: { x: number; y: number },
  size: { widthPx: number; heightPx: number },
  viewport: { width: number; height: number }
): FocusChangeZoom['end'] {
  const widthPx = Math.min(
    viewport.width,
    Math.max(1, Math.round(size.widthPx))
  )
  const heightPx = Math.min(
    viewport.height,
    Math.max(1, Math.round(size.heightPx))
  )
  return {
    pointPx: {
      x: clamp(Math.round(point.x), 0, Math.max(0, viewport.width - widthPx)),
      y: clamp(Math.round(point.y), 0, Math.max(0, viewport.height - heightPx)),
    },
    size: {
      widthPx,
      heightPx,
    },
  }
}

function computeZoomTarget(
  locatorRect: ElementRect,
  viewport: { width: number; height: number },
  config: ResolvedAutoZoomConfig
): FocusChangeZoom['end'] {
  const targetRect = {
    x: locatorRect.x,
    y: locatorRect.y,
    width: locatorRect.width,
    height: locatorRect.height,
  }

  let widthPx = viewport.width * config.amount
  let heightPx = viewport.height * config.amount

  if (config.allowZoomingOut) {
    widthPx = Math.max(widthPx, targetRect.width)
    heightPx = Math.max(heightPx, targetRect.height)
  }

  const xBias = (widthPx - targetRect.width) * config.centering * 0.5
  const yBias = (heightPx - targetRect.height) * config.centering * 0.5

  return clampZoomViewport(
    {
      x: targetRect.x + targetRect.width / 2 - widthPx / 2 + xBias,
      y: targetRect.y + targetRect.height / 2 - heightPx / 2 + yBias,
    },
    { widthPx, heightPx },
    viewport
  )
}

function buildZoomEvent(params: {
  locatorRect: ElementRect
  viewport: { width: number; height: number }
  config: ResolvedAutoZoomConfig
  startMs: number
  isFirstInteraction: boolean
  currentZoomEnd: FocusChangeZoom['end'] | undefined
}): FocusChangeZoom | undefined {
  const {
    locatorRect,
    viewport,
    config,
    startMs,
    isFirstInteraction,
    currentZoomEnd,
  } = params
  if (config.amount >= 1 && !isFirstInteraction) {
    return undefined
  }

  const end = computeZoomTarget(locatorRect, viewport, config)
  if (
    currentZoomEnd !== undefined &&
    currentZoomEnd.pointPx.x === end.pointPx.x &&
    currentZoomEnd.pointPx.y === end.pointPx.y &&
    currentZoomEnd.size.widthPx === end.size.widthPx &&
    currentZoomEnd.size.heightPx === end.size.heightPx
  ) {
    return undefined
  }

  return {
    startMs,
    endMs: startMs + config.duration,
    ...(config.duration > 0 ? { easing: config.easing } : {}),
    end,
  }
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
  scrollStartMs: number
  scrollEndMs: number
  scrollElapsedMs: number
  mouseMoveEvent?: FocusChangeEvent
  zoomEvent?: FocusChangeZoom
  resolvedAutoZoomConfig: ResolvedAutoZoomConfig
  isFirstAutoZoomInteraction: boolean
  shouldScrollBeforeMouseMove: boolean
  isInsideAutoZoom: boolean
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
      ? (() => {
          const targetX = previewLocatorRect.x + mouseMove.targetPos.x
          const targetY = previewLocatorRect.y + mouseMove.targetPos.y
          const resolvedDuration = resolveMouseMoveDuration(
            mouseMove.startPos,
            targetX,
            targetY,
            {
              duration: mouseMove.duration,
              speed: mouseMove.speed,
              defaultDuration: mouseMove.defaultDuration,
              context: mouseMove.context,
            }
          )

          return animateMouseMove({
            page: mouseMove.page,
            mouseMoveInternal: mouseMove.mouseMoveInternal,
            startPos: mouseMove.startPos,
            targetPos: { x: targetX, y: targetY },
            duration: resolvedDuration,
            easing: mouseMove.easing,
            startMs: scrollStartMs,
            ...(mouseMove.elementRect !== undefined
              ? { elementRect: mouseMove.elementRect }
              : {}),
          })
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

  return {
    locatorRect: finalLocatorRect,
    scrollStartMs,
    scrollEndMs,
    scrollElapsedMs: Math.max(0, scrollEndMs - scrollStartMs),
    ...(finalMouseMoveEvent !== undefined
      ? { mouseMoveEvent: finalMouseMoveEvent }
      : {}),
    ...(zoomEvent !== undefined ? { zoomEvent } : {}),
    resolvedAutoZoomConfig,
    isFirstAutoZoomInteraction: isFirstInteraction,
    shouldScrollBeforeMouseMove: isFirstInteraction,
    isInsideAutoZoom: state.insideAutoZoom,
  }
}
