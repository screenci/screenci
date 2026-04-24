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
import {
  buildZoomEvent,
  resolveAutoZoomConfig,
  resolveZoomTarget,
} from './zoom.js'

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

type ViewportSize = { width: number; height: number }
type Point = { x: number; y: number }

type FocusSnapshot = {
  locatorRect: ElementRect
  viewportSize: ViewportSize
  page: {
    scrollY: number
    scrollX: number
    scrollHeight: number
    scrollWidth: number
  }
  ancestors: Array<{
    clientHeight: number
    clientWidth: number
    scrollHeight: number
    scrollWidth: number
    scrollTop: number
    scrollLeft: number
    rect: ScrollRectLike
  }>
}

type ScrollPlan = {
  startTop: number
  startLeft: number
  targetTop: number
  targetLeft: number
}

type PageScrollPlan = {
  startY: number
  startX: number
  targetY: number
  targetX: number
}

type UnifiedFocusPlan = {
  previewLocatorRect: ElementRect
  finalLocatorRect: ElementRect
  ancestorScrollPlans: ScrollPlan[]
  pageScrollPlan: PageScrollPlan
  scrollNeeded: boolean
  zoomNeeded: boolean
  finalFocusPoint: Point
  optimalOffset: Point
}

const POSITION_EPSILON_PX = 0.5

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function isEffectivelyZero(value: number): boolean {
  return Math.abs(value) <= POSITION_EPSILON_PX
}

function positionsDiffer(start: number, target: number): boolean {
  return Math.abs(target - start) > POSITION_EPSILON_PX
}

function shiftRect(
  rect: ElementRect,
  deltaX: number,
  deltaY: number
): ElementRect {
  return {
    x: rect.x + deltaX,
    y: rect.y + deltaY,
    width: rect.width,
    height: rect.height,
  }
}

export function resolveViewportSize(locator: Locator): ViewportSize {
  const viewport = locator.page().viewportSize()
  if (viewport) return viewport
  throw new Error(
    '[screenci] Unable to resolve page viewport size for auto zoom.'
  )
}

export function resolveFixedFocusViewportSize(
  viewport: ViewportSize,
  amount: number
): ViewportSize {
  const resolvedAmount = clamp(amount, 0, 1)
  return {
    width: viewport.width * resolvedAmount,
    height: viewport.height * resolvedAmount,
  }
}

export function resolveIdealFocusOriginForAxis(params: {
  rectStart: number
  rectSize: number
  focusSize: number
  centering: number
}): number {
  const { rectStart, rectSize, focusSize, centering } = params
  if (rectSize <= focusSize) {
    const slack = focusSize - rectSize
    const idealRectOffset = (slack * centering) / 2
    return rectStart - idealRectOffset
  }

  return rectStart + rectSize / 2 - focusSize / 2
}

export function resolveIdealFocusOrigin(
  rect: ElementRect,
  focusViewport: ViewportSize,
  centering: number
): Point {
  return {
    x: resolveIdealFocusOriginForAxis({
      rectStart: rect.x,
      rectSize: rect.width,
      focusSize: focusViewport.width,
      centering,
    }),
    y: resolveIdealFocusOriginForAxis({
      rectStart: rect.y,
      rectSize: rect.height,
      focusSize: focusViewport.height,
      centering,
    }),
  }
}

export function resolveOptimalOffset(ideal: Point, actual: Point): Point {
  return {
    x: ideal.x - actual.x,
    y: ideal.y - actual.y,
  }
}

function resolveDesiredRectStartForAxis(params: {
  containerSize: number
  rectSize: number
  focusSize: number
  centering: number
}): number {
  const { containerSize, rectSize, focusSize, centering } = params
  const focusWindowStart = Math.max(0, (containerSize - focusSize) / 2)

  if (rectSize <= focusSize) {
    return focusWindowStart + ((focusSize - rectSize) * centering) / 2
  }

  return focusWindowStart + focusSize / 2 - rectSize / 2
}

async function captureFocusSnapshot(
  locator: Locator
): Promise<FocusSnapshot | undefined> {
  return locator.evaluate((element) => {
    const doc = element.ownerDocument
    const win = doc.defaultView as ScrollWindow | null
    if (!win) return undefined

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

    const rect = element.getBoundingClientRect()
    const viewportHeight = win.innerHeight || doc.documentElement.clientHeight
    const viewportWidth = win.innerWidth || doc.documentElement.clientWidth
    const ancestors: FocusSnapshot['ancestors'] = []

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
      ancestors.push({
        clientHeight: current.clientHeight,
        clientWidth: current.clientWidth,
        scrollHeight: current.scrollHeight,
        scrollWidth: current.scrollWidth,
        scrollTop: current.scrollTop,
        scrollLeft: current.scrollLeft,
        rect: {
          top: containerRect.top,
          left: containerRect.left,
          width: containerRect.width,
          height: containerRect.height,
        },
      })
    }

    return {
      locatorRect: {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      },
      viewportSize: {
        width: viewportWidth,
        height: viewportHeight,
      },
      page: {
        scrollY: win.scrollY,
        scrollX: win.scrollX,
        scrollHeight: Math.max(
          doc.documentElement.scrollHeight,
          doc.body?.scrollHeight ?? 0
        ),
        scrollWidth: Math.max(
          doc.documentElement.scrollWidth,
          doc.body?.scrollWidth ?? 0
        ),
      },
      ancestors,
    }
  })
}

export function buildAncestorScrollPlans(
  snapshot: FocusSnapshot,
  focusViewport: ViewportSize,
  centering: number
): {
  plans: ScrollPlan[]
  accumulatedDelta: Point
  projectedRect: ElementRect
} {
  const plans: ScrollPlan[] = []
  let accumulatedDelta = { x: 0, y: 0 }

  for (const ancestor of snapshot.ancestors) {
    const projectedRect = shiftRect(
      snapshot.locatorRect,
      -accumulatedDelta.x,
      -accumulatedDelta.y
    )
    const containerRelativeRect: ElementRect = {
      x: projectedRect.x - ancestor.rect.left,
      y: projectedRect.y - ancestor.rect.top,
      width: projectedRect.width,
      height: projectedRect.height,
    }
    const desiredTop = resolveDesiredRectStartForAxis({
      containerSize: ancestor.clientHeight,
      rectSize: containerRelativeRect.height,
      focusSize: focusViewport.height,
      centering,
    })
    const desiredLeft = resolveDesiredRectStartForAxis({
      containerSize: ancestor.clientWidth,
      rectSize: containerRelativeRect.width,
      focusSize: focusViewport.width,
      centering,
    })

    const targetTop = clamp(
      ancestor.scrollTop + (containerRelativeRect.y - desiredTop),
      0,
      Math.max(0, ancestor.scrollHeight - ancestor.clientHeight)
    )
    const targetLeft = clamp(
      ancestor.scrollLeft + (containerRelativeRect.x - desiredLeft),
      0,
      Math.max(0, ancestor.scrollWidth - ancestor.clientWidth)
    )

    plans.push({
      startTop: ancestor.scrollTop,
      startLeft: ancestor.scrollLeft,
      targetTop,
      targetLeft,
    })

    accumulatedDelta = {
      x: accumulatedDelta.x + (targetLeft - ancestor.scrollLeft),
      y: accumulatedDelta.y + (targetTop - ancestor.scrollTop),
    }
  }

  return {
    plans,
    accumulatedDelta,
    projectedRect: shiftRect(
      snapshot.locatorRect,
      -accumulatedDelta.x,
      -accumulatedDelta.y
    ),
  }
}

export function buildPageScrollPlan(
  snapshot: FocusSnapshot,
  focusViewport: ViewportSize,
  centering: number,
  ancestorProjection: { accumulatedDelta: Point; projectedRect: ElementRect },
  options?: {
    residualOnly?: {
      x: number
      y: number
    }
  }
): { plan: PageScrollPlan; finalLocatorRect: ElementRect } {
  const targetY =
    options?.residualOnly !== undefined
      ? clamp(
          snapshot.page.scrollY + options.residualOnly.y,
          0,
          Math.max(0, snapshot.page.scrollHeight - snapshot.viewportSize.height)
        )
      : clamp(
          snapshot.page.scrollY +
            (ancestorProjection.projectedRect.y -
              resolveDesiredRectStartForAxis({
                containerSize: snapshot.viewportSize.height,
                rectSize: ancestorProjection.projectedRect.height,
                focusSize: focusViewport.height,
                centering,
              })),
          0,
          Math.max(0, snapshot.page.scrollHeight - snapshot.viewportSize.height)
        )
  const targetX =
    options?.residualOnly !== undefined
      ? clamp(
          snapshot.page.scrollX + options.residualOnly.x,
          0,
          Math.max(0, snapshot.page.scrollWidth - snapshot.viewportSize.width)
        )
      : clamp(
          snapshot.page.scrollX +
            (ancestorProjection.projectedRect.x -
              resolveDesiredRectStartForAxis({
                containerSize: snapshot.viewportSize.width,
                rectSize: ancestorProjection.projectedRect.width,
                focusSize: focusViewport.width,
                centering,
              })),
          0,
          Math.max(0, snapshot.page.scrollWidth - snapshot.viewportSize.width)
        )
  const finalLocatorRect = shiftRect(
    ancestorProjection.projectedRect,
    -(targetX - snapshot.page.scrollX),
    -(targetY - snapshot.page.scrollY)
  )

  return {
    plan: {
      startY: snapshot.page.scrollY,
      startX: snapshot.page.scrollX,
      targetY,
      targetX,
    },
    finalLocatorRect,
  }
}

export function combineFocusPlan(params: {
  snapshot: FocusSnapshot
  amount: number
  centering: number
  currentZoomEnd: NonNullable<FocusChangeEvent['zoom']>['end'] | undefined
  insideAutoZoom: boolean
}): UnifiedFocusPlan {
  const focusViewport = resolveFixedFocusViewportSize(
    params.snapshot.viewportSize,
    params.amount
  )
  const ancestorResult = buildAncestorScrollPlans(
    params.snapshot,
    focusViewport,
    params.centering
  )
  const zoomTargetWithoutPageScroll = resolveZoomTarget(
    ancestorResult.projectedRect,
    params.snapshot.viewportSize,
    {
      amount: params.amount,
      centering: params.centering,
    }
  )
  const pageScrollCanBeSkipped =
    params.insideAutoZoom &&
    isEffectivelyZero(zoomTargetWithoutPageScroll.optimalOffset.x) &&
    isEffectivelyZero(zoomTargetWithoutPageScroll.optimalOffset.y)
  const pageResult = buildPageScrollPlan(
    params.snapshot,
    focusViewport,
    params.centering,
    ancestorResult,
    params.insideAutoZoom
      ? {
          residualOnly: {
            x: zoomTargetWithoutPageScroll.optimalOffset.x,
            y: zoomTargetWithoutPageScroll.optimalOffset.y,
          },
        }
      : undefined
  )
  const resolvedPageResult = pageScrollCanBeSkipped
    ? {
        plan: {
          startY: params.snapshot.page.scrollY,
          startX: params.snapshot.page.scrollX,
          targetY: params.snapshot.page.scrollY,
          targetX: params.snapshot.page.scrollX,
        },
        finalLocatorRect: ancestorResult.projectedRect,
      }
    : pageResult
  const scrollNeeded =
    ancestorResult.plans.some(
      (plan) =>
        positionsDiffer(plan.startTop, plan.targetTop) ||
        positionsDiffer(plan.startLeft, plan.targetLeft)
    ) ||
    positionsDiffer(
      resolvedPageResult.plan.startY,
      resolvedPageResult.plan.targetY
    ) ||
    positionsDiffer(
      resolvedPageResult.plan.startX,
      resolvedPageResult.plan.targetX
    )

  const zoomTarget = resolveZoomTarget(
    resolvedPageResult.finalLocatorRect,
    params.snapshot.viewportSize,
    {
      amount: params.amount,
      centering: params.centering,
    }
  )
  const zoomNeeded =
    params.insideAutoZoom &&
    (params.currentZoomEnd === undefined ||
      params.currentZoomEnd.pointPx.x !== zoomTarget.end.pointPx.x ||
      params.currentZoomEnd.pointPx.y !== zoomTarget.end.pointPx.y ||
      params.currentZoomEnd.size.widthPx !== zoomTarget.end.size.widthPx ||
      params.currentZoomEnd.size.heightPx !== zoomTarget.end.size.heightPx)

  return {
    previewLocatorRect: resolvedPageResult.finalLocatorRect,
    finalLocatorRect: resolvedPageResult.finalLocatorRect,
    ancestorScrollPlans: ancestorResult.plans,
    pageScrollPlan: resolvedPageResult.plan,
    scrollNeeded,
    zoomNeeded,
    finalFocusPoint: {
      x:
        resolvedPageResult.finalLocatorRect.x +
        resolvedPageResult.finalLocatorRect.width / 2,
      y:
        resolvedPageResult.finalLocatorRect.y +
        resolvedPageResult.finalLocatorRect.height / 2,
    },
    optimalOffset: zoomTarget.optimalOffset,
  }
}

async function executeScrollPlan(params: {
  locator: Locator
  ancestorScrollPlans: ScrollPlan[]
  pageScrollPlan: PageScrollPlan
  duration: number
  easing: Easing
}): Promise<void> {
  const { locator, ancestorScrollPlans, pageScrollPlan, duration, easing } =
    params
  const needsScroll =
    ancestorScrollPlans.some(
      (plan) =>
        positionsDiffer(plan.startTop, plan.targetTop) ||
        positionsDiffer(plan.startLeft, plan.targetLeft)
    ) ||
    positionsDiffer(pageScrollPlan.startY, pageScrollPlan.targetY) ||
    positionsDiffer(pageScrollPlan.startX, pageScrollPlan.targetX)

  if (!needsScroll) return

  await locator.evaluate(
    (element, args) =>
      new Promise<void>((resolve) => {
        const frameMs = 1000 / 60
        const evaluateEasingAtT = Function(
          `return (${args.evaluateEasingAtTSource})`
        )() as (t: number, easing: Easing) => number
        const doc = element.ownerDocument
        const win = doc.defaultView as ScrollWindow | null
        if (!win) {
          resolve()
          return
        }

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

        const ancestors: ScrollableElement[] = []
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
          ancestors.push(current)
        }

        const steps = Math.max(1, Math.floor(args.duration / frameMs))
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
          const easedT = evaluateEasingAtT(step / steps, args.easing)

          for (const [index, plan] of args.ancestorScrollPlans.entries()) {
            const ancestor = ancestors[index]
            if (!ancestor) continue
            ancestor.scrollTop =
              plan.startTop + (plan.targetTop - plan.startTop) * easedT
            ancestor.scrollLeft =
              plan.startLeft + (plan.targetLeft - plan.startLeft) * easedT
          }

          win.scrollTo({
            top:
              args.pageScrollPlan.startY +
              (args.pageScrollPlan.targetY - args.pageScrollPlan.startY) *
                easedT,
            left:
              args.pageScrollPlan.startX +
              (args.pageScrollPlan.targetX - args.pageScrollPlan.startX) *
                easedT,
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
    {
      ancestorScrollPlans,
      pageScrollPlan,
      duration,
      easing,
      evaluateEasingAtTSource: evaluateEasingAtT.toString(),
    }
  )
}

export type ChangeFocusResult = {
  locatorRect: ElementRect | undefined
  focusChange?: FocusChangeEvent
}

export async function changeFocus(
  locator: Locator,
  options: AutoZoomOptions = {},
  mouseMove?: MouseMoveRequest
): Promise<ChangeFocusResult> {
  const state = getAutoZoomState()
  const resolvedAutoZoomConfig = resolveAutoZoomConfig(state, options)
  const preDelayMs = state.insideAutoZoom ? (state.preZoomDelay ?? 0) : 0
  const postDelayMs = state.insideAutoZoom ? (state.postZoomDelay ?? 0) : 0

  if (preDelayMs > 0) {
    await sleep(preDelayMs)
  }

  const snapshot = await captureFocusSnapshot(locator)
  if (!snapshot) {
    if (postDelayMs > 0) {
      await sleep(postDelayMs)
    }
    return { locatorRect: undefined }
  }

  const plan = combineFocusPlan({
    snapshot,
    amount: resolvedAutoZoomConfig.amount,
    centering: resolvedAutoZoomConfig.centering,
    currentZoomEnd: state.currentZoomViewport?.end,
    insideAutoZoom: state.insideAutoZoom,
  })
  const focusStartMs = Date.now()
  const focusEndMs = focusStartMs + resolvedAutoZoomConfig.duration

  const mouseTarget =
    mouseMove !== undefined
      ? {
          x: plan.finalLocatorRect.x + mouseMove.targetPos.x,
          y: plan.finalLocatorRect.y + mouseMove.targetPos.y,
        }
      : undefined
  const mouseDuration =
    mouseTarget !== undefined
      ? resolveMouseMoveDuration(
          mouseMove!.page,
          mouseTarget.x,
          mouseTarget.y,
          {
            duration: mouseMove!.duration,
            speed: mouseMove!.speed,
            defaultDuration: mouseMove!.defaultDuration,
            context: mouseMove!.context,
          }
        )
      : undefined

  const mousePromise =
    mouseTarget !== undefined && mouseDuration !== undefined
      ? performMouseMove({
          page: mouseMove!.page,
          mouseMoveInternal: mouseMove!.mouseMoveInternal,
          targetX: mouseTarget.x,
          targetY: mouseTarget.y,
          duration: mouseDuration,
          easing: mouseMove!.easing,
        }).then(() => ({
          type: 'focusChange' as const,
          x: mouseTarget.x,
          y: mouseTarget.y,
          mouse: {
            startMs: focusStartMs,
            endMs: Date.now(),
            ...(mouseDuration > 0 ? { easing: mouseMove!.easing } : {}),
          },
        }))
      : Promise.resolve(undefined)

  const scrollPromise = executeScrollPlan({
    locator,
    ancestorScrollPlans: plan.ancestorScrollPlans,
    pageScrollPlan: plan.pageScrollPlan,
    duration: resolvedAutoZoomConfig.duration,
    easing: resolvedAutoZoomConfig.easing,
  })
  const zoomWindowPromise =
    state.insideAutoZoom && plan.zoomNeeded && !plan.scrollNeeded
      ? sleep(resolvedAutoZoomConfig.duration)
      : Promise.resolve()

  const [mouseMoveEvent] = await Promise.all([
    mousePromise,
    scrollPromise,
    zoomWindowPromise,
  ])

  const viewport = state.insideAutoZoom
    ? resolveViewportSize(locator)
    : undefined
  const zoomTarget =
    state.insideAutoZoom && viewport !== undefined
      ? resolveZoomTarget(plan.finalLocatorRect, viewport, {
          amount: resolvedAutoZoomConfig.amount,
          centering: resolvedAutoZoomConfig.centering,
        })
      : undefined
  const zoomEvent =
    state.insideAutoZoom && viewport !== undefined && zoomTarget !== undefined
      ? buildZoomEvent({
          target: zoomTarget,
          config: resolvedAutoZoomConfig,
          startMs: focusStartMs,
          currentZoomEnd: state.currentZoomViewport?.end,
        })
      : undefined
  const focusPoint = mouseTarget ?? plan.finalFocusPoint
  const focusChange =
    mouseMoveEvent === undefined &&
    !plan.scrollNeeded &&
    zoomEvent === undefined
      ? undefined
      : {
          type: 'focusChange' as const,
          x: focusPoint.x,
          y: focusPoint.y,
          ...(mouseMoveEvent?.mouse !== undefined
            ? { mouse: mouseMoveEvent.mouse }
            : {}),
          ...(plan.scrollNeeded
            ? {
                scroll: {
                  startMs: focusStartMs,
                  endMs: focusEndMs,
                  ...(resolvedAutoZoomConfig.duration > 0
                    ? { easing: resolvedAutoZoomConfig.easing }
                    : {}),
                },
              }
            : {}),
          ...(zoomEvent !== undefined ? { zoom: zoomEvent } : {}),
          elementRect: plan.finalLocatorRect,
          ...(!mouseMoveEvent && (plan.scrollNeeded || zoomEvent !== undefined)
            ? { focusOnly: true }
            : {}),
        }

  if (state.insideAutoZoom) {
    setLastZoomLocation({
      x: focusPoint.x,
      y: focusPoint.y,
      elementRect: plan.finalLocatorRect,
      eventType: 'click',
    })

    if (viewport !== undefined && zoomTarget !== undefined) {
      setCurrentZoomViewport({
        focusPoint,
        elementRect: plan.finalLocatorRect,
        end: zoomTarget.end,
        viewportSize: viewport,
        optimalOffset: zoomTarget.optimalOffset,
      })
    }
  }

  if (postDelayMs > 0) {
    await sleep(postDelayMs)
  }

  return {
    locatorRect: plan.finalLocatorRect,
    ...(focusChange !== undefined ? { focusChange } : {}),
  }
}
