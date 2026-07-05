import type { Locator } from '@playwright/test'
import type { ElementRect, FocusChangeEvent } from './events.js'
import { evaluateEasingAtT } from './easing.js'
import {
  DEFAULT_AUTO_ZOOM_CENTERING,
  DEFAULT_CLICK_MOUSE_MOVE_DURATION,
  DEFAULT_SCROLL_CENTERING,
} from './defaults.js'
import type { AutoZoomOptions, Easing } from './types.js'
import {
  getMousePosition,
  getScrollDispatchIntervalMs,
  performMouseMove,
  resolveMouseMoveDuration,
} from './mouse.js'
import { getAutoZoomState, setCurrentZoomViewport } from './autoZoom.js'
import { logger } from './logger.js'
import {
  buildZoomEvent,
  resolveAutoZoomOptions,
  resolveEffectiveDuration,
  resolveZoomTarget,
} from './zoom.js'
import {
  isTimingDebugEnabled,
  resolveRecordingTimingDuration,
} from './runtimeMode.js'

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

export type MouseMoveRequest = {
  targetPosInElement?: { x: number; y: number } | undefined
  duration?: number
  speed?: number
  easing: Easing
}

type ViewportSize = { width: number; height: number }
type Point = { x: number; y: number }

type ViewportSide = 'left' | 'right' | 'top' | 'bottom'

type FocusSnapshot = {
  locatorRect: ElementRect
  isFixedPosition: boolean
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

type AxisRange = {
  min: number
  max: number
}

type UnifiedFocusPlan = {
  finalLocatorRect: ElementRect
  ancestorScrollPlans: ScrollPlan[]
  pageScrollPlan: PageScrollPlan
  scrollNeeded: boolean
  zoomNeeded: boolean
  finalFocusPoint: Point
  optimalOffset: Point
  targetViewport: ViewportSize
  targetRectPositionInZoomViewport: Point
}

type ScrollAndZoomTimingPlan = {
  startDelay: number
  duration: number
}

const POSITION_EPSILON_PX = 0.5
const CURSOR_TRIGGER_EDGE_THRESHOLD = 0.3
const CURSOR_TRIGGER_MAX_PROGRESS = 0.6

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) =>
    setTimeout(resolve, resolveRecordingTimingDuration(ms))
  )
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function positionsDiffer(start: number, target: number): boolean {
  return Math.abs(target - start) > POSITION_EPSILON_PX
}

function clampToRange(value: number, range: AxisRange): number {
  return clamp(value, range.min, range.max)
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

export function resolveFixedFocusViewportSize(
  viewport: ViewportSize,
  amount: number
): ViewportSize {
  return {
    width: viewport.width * amount,
    height: viewport.height * amount,
  }
}

export function resolveLocatorFocusViewport(params: {
  viewport: ViewportSize
  rect: ElementRect
  amount: number
  padding: number
}): ViewportSize {
  const paddedWidth = params.rect.width * (1 + params.padding)
  const paddedHeight = params.rect.height * (1 + params.padding)
  const fittedAmount = clamp(
    Math.max(
      paddedWidth / params.viewport.width,
      paddedHeight / params.viewport.height
    ),
    1 / Math.max(params.viewport.width, params.viewport.height),
    1
  )

  return resolveFixedFocusViewportSize(
    params.viewport,
    Math.max(params.amount, fittedAmount)
  )
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

function resolveNearestViewportSide(
  point: Point,
  viewportSize: ViewportSize
): ViewportSide {
  const distances = [
    { side: 'left' as const, distance: point.x },
    { side: 'right' as const, distance: viewportSize.width - point.x },
    { side: 'top' as const, distance: point.y },
    { side: 'bottom' as const, distance: viewportSize.height - point.y },
  ]

  return distances.reduce((nearest, current) =>
    current.distance < nearest.distance ? current : nearest
  ).side
}

function resolveCursorTriggerCoordinate(params: {
  side: ViewportSide
  viewportSize: ViewportSize
  target: Point
  threshold: number
}): number {
  const { side, viewportSize, target, threshold } = params

  switch (side) {
    case 'left':
      return Math.max(target.x, viewportSize.width * threshold)
    case 'right':
      return Math.min(target.x, viewportSize.width * (1 - threshold))
    case 'top':
      return Math.max(target.y, viewportSize.height * threshold)
    case 'bottom':
      return Math.min(target.y, viewportSize.height * (1 - threshold))
  }
}

function hasReachedCursorTrigger(params: {
  side: ViewportSide
  point: Point
  triggerCoordinate: number
}): boolean {
  const { side, point, triggerCoordinate } = params

  switch (side) {
    case 'left':
      return point.x <= triggerCoordinate
    case 'right':
      return point.x >= triggerCoordinate
    case 'top':
      return point.y <= triggerCoordinate
    case 'bottom':
      return point.y >= triggerCoordinate
  }
}

export function resolveScrollAndZoomTimingPlan(params: {
  viewportSize: ViewportSize
  target: Point
  startViewportPos: Point
  duration: number
  easing: Easing
  cursorTriggerEdgeThreshold: number
  cursorTriggerMaxProgress: number
}): ScrollAndZoomTimingPlan {
  const {
    viewportSize,
    target,
    startViewportPos,
    duration,
    easing,
    cursorTriggerEdgeThreshold,
    cursorTriggerMaxProgress,
  } = params

  if (duration <= 0) {
    return { startDelay: 0, duration: Math.max(0, duration) }
  }

  const latestStartDelay = duration * cursorTriggerMaxProgress

  const side = resolveNearestViewportSide(target, viewportSize)
  const triggerCoordinate = resolveCursorTriggerCoordinate({
    side,
    viewportSize,
    target,
    threshold: cursorTriggerEdgeThreshold,
  })

  if (
    hasReachedCursorTrigger({
      side,
      point: startViewportPos,
      triggerCoordinate,
    })
  ) {
    return { startDelay: 0, duration }
  }

  const frameMs = 1000 / 60
  const steps = Math.max(1, Math.floor(duration / frameMs))

  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps
    const easedT = evaluateEasingAtT(t, easing)
    const point = {
      x: startViewportPos.x + (target.x - startViewportPos.x) * easedT,
      y: startViewportPos.y + (target.y - startViewportPos.y) * easedT,
    }

    if (hasReachedCursorTrigger({ side, point, triggerCoordinate })) {
      const startDelay = Math.min(duration * t, latestStartDelay)
      return {
        startDelay,
        duration: Math.max(0, duration - startDelay),
      }
    }
  }

  return {
    startDelay: latestStartDelay,
    duration: Math.max(0, duration - latestStartDelay),
  }
}

function resolveTargetRectStartForAxis(params: {
  containerSize: number
  rectSize: number
  focusSize: number
  centering: number
}): number {
  const { containerSize, rectSize, focusSize, centering } = params
  const focusWindowStart = Math.max(0, (containerSize - focusSize) / 2)

  if (rectSize <= focusSize) {
    // centering = 0 keeps the rect edge-aligned; centering = 1 centers it.
    const edgeAlignedStart = focusWindowStart
    const centeredStart = focusWindowStart + (focusSize - rectSize) / 2
    return edgeAlignedStart + (centeredStart - edgeAlignedStart) * centering
  }

  return focusWindowStart + focusSize / 2 - rectSize / 2
}

function resolveTargetRectBandForAxis(params: {
  containerSize: number
  rectSize: number
  focusSize: number
  centering: number
}): AxisRange {
  const { containerSize, rectSize, focusSize, centering } = params
  const focusWindowStart = Math.max(0, (containerSize - focusSize) / 2)

  if (rectSize >= focusSize) {
    // Target taller/wider than the focus window: fall back to the centered
    // placement (a degenerate band whose min and max both center the rect).
    const centered = focusWindowStart + focusSize / 2 - rectSize / 2
    return { min: centered, max: centered }
  }

  const slack = focusSize - rectSize
  // Treat `centering` as a symmetric comfort-band inset. The band's top edge
  // lines up with the fixed-target placement (`resolveTargetRectStartForAxis`),
  // and the bottom edge extends the acceptable landing zone toward the far edge
  // the target enters from, so the eventual clamp is a direction-aware minimal
  // reveal. `centering = 0` accepts the whole slack (pure minimal reveal);
  // `centering = 1` collapses the band to the centered position.
  return {
    min: focusWindowStart + (slack * centering) / 2,
    max: focusWindowStart + slack * (1 - centering / 2),
  }
}

function resolveTargetRectBandForViewport(params: {
  containerSize: ViewportSize
  rect: ElementRect
  focusViewport: ViewportSize
  centering: number
}): { x: AxisRange; y: AxisRange } {
  const { containerSize, rect, focusViewport, centering } = params
  return {
    x: resolveTargetRectBandForAxis({
      containerSize: containerSize.width,
      rectSize: rect.width,
      focusSize: focusViewport.width,
      centering,
    }),
    y: resolveTargetRectBandForAxis({
      containerSize: containerSize.height,
      rectSize: rect.height,
      focusSize: focusViewport.height,
      centering,
    }),
  }
}

export function resolveTargetRectPosition(params: {
  containerSize: ViewportSize
  rect: ElementRect
  amount: number
  centering: number
}): Point {
  return resolveTargetRectPositionForViewport({
    containerSize: params.containerSize,
    rect: params.rect,
    focusViewport: resolveFixedFocusViewportSize(
      params.containerSize,
      params.amount
    ),
    centering: params.centering,
  })
}

export function resolveTargetRectPositionForViewport(params: {
  containerSize: ViewportSize
  rect: ElementRect
  focusViewport: ViewportSize
  centering: number
}): Point {
  const { containerSize, rect, focusViewport, centering } = params

  return {
    x: resolveTargetRectStartForAxis({
      containerSize: containerSize.width,
      rectSize: rect.width,
      focusSize: focusViewport.width,
      centering,
    }),
    y: resolveTargetRectStartForAxis({
      containerSize: containerSize.height,
      rectSize: rect.height,
      focusSize: focusViewport.height,
      centering,
    }),
  }
}

/**
 * Resolve the zoom placement that frames a bare viewport POINT (as opposed to a
 * located element). A point has no size, so it is treated as a zero-size rect at
 * `point`, zoomed to `amount` of the viewport and placed with `centering`. Shared
 * by `zoomTo({ x, y })` and by the auto-zoom cursor-follow that runs when a raw
 * `page.mouse.move`/`click` happens inside an `autoZoom()` block.
 */
export function resolvePointFocusZoom(params: {
  point: Point
  viewportSize: ViewportSize
  amount: number
  centering: number
  currentZoomEnd: NonNullable<FocusChangeEvent['zoom']>['end']
}): {
  zoomTarget:
    | {
        end: NonNullable<FocusChangeEvent['zoom']>['end']
        optimalOffset: Point
      }
    | undefined
  targetViewport: ViewportSize
  end: NonNullable<FocusChangeEvent['zoom']>['end']
  optimalOffset: Point
} {
  const targetViewport = resolveFixedFocusViewportSize(
    params.viewportSize,
    params.amount
  )
  const zoomTarget = resolveZoomTarget({
    locatorRect: { x: params.point.x, y: params.point.y, width: 0, height: 0 },
    viewport: params.viewportSize,
    targetViewport,
    targetRectPositionInZoomViewport: resolveTargetRectPosition({
      containerSize: targetViewport,
      rect: { x: 0, y: 0, width: 0, height: 0 },
      amount: 1,
      centering: params.centering,
    }),
    currentZoomEnd: params.currentZoomEnd,
  })
  const fullViewportEnd = {
    pointPx: { x: 0, y: 0 },
    size: {
      widthPx: params.viewportSize.width,
      heightPx: params.viewportSize.height,
    },
  }
  return {
    zoomTarget,
    targetViewport,
    end: zoomTarget?.end ?? fullViewportEnd,
    optimalOffset: zoomTarget?.optimalOffset ?? { x: 0, y: 0 },
  }
}

async function captureFocusSnapshot(locator: Locator): Promise<FocusSnapshot> {
  return locator.evaluate((element) => {
    const doc = element.ownerDocument
    const win = doc.defaultView as ScrollWindow | null
    if (!win) {
      throw new Error(
        '[screenci] Unable to resolve window while capturing focus snapshot.'
      )
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

    const rect = element.getBoundingClientRect()
    const elementStyle = win.getComputedStyle(element)
    const hasFixedAncestor = (() => {
      for (
        let current: Element | null = element.parentElement;
        current;
        current = current.parentElement
      ) {
        if (win.getComputedStyle(current).position === 'fixed') return true
      }
      return false
    })()
    const isFixedPosition =
      elementStyle.position === 'fixed' || hasFixedAncestor
    const viewportHeight = win.innerHeight || doc.documentElement.clientHeight
    const viewportWidth = win.innerWidth || doc.documentElement.clientWidth
    const ancestors: FocusSnapshot['ancestors'] = []

    if (!isFixedPosition) {
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
    }

    return {
      locatorRect: {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      },
      isFixedPosition,
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

function resolveMinimalVisibleScrollTargetForAxis(params: {
  scrollStart: number
  rectStart: number
  rectSize: number
  containerSize: number
  scrollSize: number
}): number {
  const { scrollStart, rectStart, rectSize, containerSize, scrollSize } = params
  const maxScroll = Math.max(0, scrollSize - containerSize)
  const rectEnd = rectStart + rectSize

  if (rectSize <= containerSize) {
    if (rectStart < 0) {
      return clamp(scrollStart + rectStart, 0, maxScroll)
    }
    if (rectEnd > containerSize) {
      return clamp(scrollStart + (rectEnd - containerSize), 0, maxScroll)
    }
    return scrollStart
  }

  if (rectStart > 0) {
    return clamp(scrollStart + rectStart, 0, maxScroll)
  }
  if (rectEnd < containerSize) {
    return clamp(scrollStart + (rectEnd - containerSize), 0, maxScroll)
  }

  return scrollStart
}

function resolveVisibleScrollTargetRangeForAxis(params: {
  scrollStart: number
  rectStart: number
  rectSize: number
  containerSize: number
  scrollSize: number
}): AxisRange {
  const { scrollStart, rectStart, rectSize, containerSize, scrollSize } = params
  const maxScroll = Math.max(0, scrollSize - containerSize)
  const deltaAtStartEdge = rectStart
  const deltaAtEndEdge = rectStart + rectSize - containerSize

  return {
    min: clamp(
      scrollStart + Math.min(deltaAtStartEdge, deltaAtEndEdge),
      0,
      maxScroll
    ),
    max: clamp(
      scrollStart + Math.max(deltaAtStartEdge, deltaAtEndEdge),
      0,
      maxScroll
    ),
  }
}

function projectRectFromAncestorPlans(
  snapshot: FocusSnapshot,
  plans: ScrollPlan[]
): ElementRect {
  const accumulatedDelta = plans.reduce(
    (delta, plan, index) => ({
      x: delta.x + (plan.targetLeft - snapshot.ancestors[index]!.scrollLeft),
      y: delta.y + (plan.targetTop - snapshot.ancestors[index]!.scrollTop),
    }),
    { x: 0, y: 0 }
  )

  return shiftRect(
    snapshot.locatorRect,
    -accumulatedDelta.x,
    -accumulatedDelta.y
  )
}

function resolveAcceptableRangeForAxis(params: {
  pageScrollStart: number
  pageScrollMax: number
  viewportSize: number
  targetViewportSize: number
  band: AxisRange
}): AxisRange {
  // Acceptable projected-rect positions are those that page scroll AND zoom
  // framing can bring INTO the comfort band. Below the band scrolls up toward
  // `bandMax`, above it scrolls down toward `bandMin`, and anything already
  // reachable inside stays put. The zoom viewport can additionally shift framing
  // by up to `maxZoomOrigin`, widening the range on both ends for a zoom.
  const maxZoomOrigin = Math.max(
    0,
    params.viewportSize - params.targetViewportSize
  )

  return {
    min: params.band.min - params.pageScrollStart - maxZoomOrigin,
    max:
      params.band.max +
      maxZoomOrigin +
      (params.pageScrollMax - params.pageScrollStart),
  }
}

function refineAncestorPlansForProjectedRectRange(params: {
  snapshot: FocusSnapshot
  plans: ScrollPlan[]
  projectedRectRangeX: AxisRange
  projectedRectRangeY: AxisRange
}): ScrollPlan[] {
  const nextPlans = params.plans.map((plan) => ({ ...plan }))

  for (let sweep = 0; sweep < params.snapshot.ancestors.length; sweep += 1) {
    const projectedRect = projectRectFromAncestorPlans(
      params.snapshot,
      nextPlans
    )
    let remainingScrollLeft =
      projectedRect.x -
      clampToRange(projectedRect.x, params.projectedRectRangeX)
    let remainingScrollTop =
      projectedRect.y -
      clampToRange(projectedRect.y, params.projectedRectRangeY)

    if (
      Math.round(remainingScrollLeft) === 0 &&
      Math.round(remainingScrollTop) === 0
    ) {
      break
    }

    let changed = false

    for (
      let index = params.snapshot.ancestors.length - 1;
      index >= 0;
      index -= 1
    ) {
      const ancestor = params.snapshot.ancestors[index]!
      const accumulatedDeltaBeforeAncestor = nextPlans.slice(0, index).reduce(
        (delta, plan, planIndex) => ({
          x:
            delta.x +
            (plan.targetLeft -
              params.snapshot.ancestors[planIndex]!.scrollLeft),
          y:
            delta.y +
            (plan.targetTop - params.snapshot.ancestors[planIndex]!.scrollTop),
        }),
        { x: 0, y: 0 }
      )
      const targetRectBeforeAncestorScroll = shiftRect(
        params.snapshot.locatorRect,
        -accumulatedDeltaBeforeAncestor.x,
        -accumulatedDeltaBeforeAncestor.y
      )
      const targetRectInAncestor: ElementRect = {
        x: targetRectBeforeAncestorScroll.x - ancestor.rect.left,
        y: targetRectBeforeAncestorScroll.y - ancestor.rect.top,
        width: targetRectBeforeAncestorScroll.width,
        height: targetRectBeforeAncestorScroll.height,
      }
      const targetLeftRange = resolveVisibleScrollTargetRangeForAxis({
        scrollStart: ancestor.scrollLeft,
        rectStart: targetRectInAncestor.x,
        rectSize: targetRectInAncestor.width,
        containerSize: ancestor.clientWidth,
        scrollSize: ancestor.scrollWidth,
      })
      const targetTopRange = resolveVisibleScrollTargetRangeForAxis({
        scrollStart: ancestor.scrollTop,
        rectStart: targetRectInAncestor.y,
        rectSize: targetRectInAncestor.height,
        containerSize: ancestor.clientHeight,
        scrollSize: ancestor.scrollHeight,
      })
      const plan = nextPlans[index]!
      const nextTargetLeft = clamp(
        plan.targetLeft + remainingScrollLeft,
        targetLeftRange.min,
        targetLeftRange.max
      )
      const nextTargetTop = clamp(
        plan.targetTop + remainingScrollTop,
        targetTopRange.min,
        targetTopRange.max
      )
      const appliedScrollLeft = nextTargetLeft - plan.targetLeft
      const appliedScrollTop = nextTargetTop - plan.targetTop

      if (
        !positionsDiffer(plan.targetLeft, nextTargetLeft) &&
        !positionsDiffer(plan.targetTop, nextTargetTop)
      ) {
        continue
      }

      plan.targetLeft = nextTargetLeft
      plan.targetTop = nextTargetTop
      remainingScrollLeft -= appliedScrollLeft
      remainingScrollTop -= appliedScrollTop
      changed = true
    }

    if (!changed) {
      break
    }
  }

  return nextPlans
}

export function buildAncestorScrollPlans(params: {
  snapshot: FocusSnapshot
  projectedRectRangeX: AxisRange
  projectedRectRangeY: AxisRange
}): {
  plans: ScrollPlan[]
  accumulatedDelta: Point
  projectedRect: ElementRect
} {
  if (params.snapshot.isFixedPosition) {
    return {
      plans: [],
      accumulatedDelta: { x: 0, y: 0 },
      projectedRect: params.snapshot.locatorRect,
    }
  }

  const { snapshot, projectedRectRangeX, projectedRectRangeY } = params
  const plans: ScrollPlan[] = []
  let accumulatedDelta = { x: 0, y: 0 }

  for (const ancestor of snapshot.ancestors) {
    const targetRectBeforeAncestorScroll = shiftRect(
      snapshot.locatorRect,
      -accumulatedDelta.x,
      -accumulatedDelta.y
    )
    const targetRectInAncestor: ElementRect = {
      x: targetRectBeforeAncestorScroll.x - ancestor.rect.left,
      y: targetRectBeforeAncestorScroll.y - ancestor.rect.top,
      width: targetRectBeforeAncestorScroll.width,
      height: targetRectBeforeAncestorScroll.height,
    }
    const targetTop = resolveMinimalVisibleScrollTargetForAxis({
      scrollStart: ancestor.scrollTop,
      rectStart: targetRectInAncestor.y,
      rectSize: targetRectInAncestor.height,
      containerSize: ancestor.clientHeight,
      scrollSize: ancestor.scrollHeight,
    })
    const targetLeft = resolveMinimalVisibleScrollTargetForAxis({
      scrollStart: ancestor.scrollLeft,
      rectStart: targetRectInAncestor.x,
      rectSize: targetRectInAncestor.width,
      containerSize: ancestor.clientWidth,
      scrollSize: ancestor.scrollWidth,
    })

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

  const refinedPlans = refineAncestorPlansForProjectedRectRange({
    snapshot,
    plans,
    projectedRectRangeX,
    projectedRectRangeY,
  })
  const projectedRect = projectRectFromAncestorPlans(snapshot, refinedPlans)
  const refinedAccumulatedDelta = {
    x: snapshot.locatorRect.x - projectedRect.x,
    y: snapshot.locatorRect.y - projectedRect.y,
  }

  return {
    plans: refinedPlans,
    accumulatedDelta: refinedAccumulatedDelta,
    projectedRect,
  }
}

export function buildPageScrollPlan(
  snapshot: FocusSnapshot,
  ancestorProjection: { accumulatedDelta: Point; projectedRect: ElementRect },
  options: {
    targetRectPositionInViewport: Point
    residualOnly?: {
      x: number
      y: number
    }
  }
): { plan: PageScrollPlan; finalLocatorRect: ElementRect } {
  const targetY =
    options.residualOnly !== undefined
      ? clamp(
          snapshot.page.scrollY + options.residualOnly.y,
          0,
          Math.max(0, snapshot.page.scrollHeight - snapshot.viewportSize.height)
        )
      : clamp(
          snapshot.page.scrollY +
            (ancestorProjection.projectedRect.y -
              options.targetRectPositionInViewport.y),
          0,
          Math.max(0, snapshot.page.scrollHeight - snapshot.viewportSize.height)
        )
  const targetX =
    options.residualOnly !== undefined
      ? clamp(
          snapshot.page.scrollX + options.residualOnly.x,
          0,
          Math.max(0, snapshot.page.scrollWidth - snapshot.viewportSize.width)
        )
      : clamp(
          snapshot.page.scrollX +
            (ancestorProjection.projectedRect.x -
              options.targetRectPositionInViewport.x),
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

function resolvePagePlan(params: {
  snapshot: FocusSnapshot
  ancestorResult: {
    plans: ScrollPlan[]
    accumulatedDelta: Point
    projectedRect: ElementRect
  }
  targetRectPositionInViewport: Point
  targetViewport: ViewportSize
  targetRectPositionInZoomViewport: Point
  currentZoomEnd: NonNullable<FocusChangeEvent['zoom']>['end']
}): {
  plan: PageScrollPlan
  finalLocatorRect: ElementRect
  scrollNeeded: boolean
} {
  if (params.snapshot.isFixedPosition) {
    return {
      plan: {
        startY: params.snapshot.page.scrollY,
        startX: params.snapshot.page.scrollX,
        targetY: params.snapshot.page.scrollY,
        targetX: params.snapshot.page.scrollX,
      },
      finalLocatorRect: params.ancestorResult.projectedRect,
      scrollNeeded: false,
    }
  }

  const zoomTargetWithoutPageScroll =
    params.currentZoomEnd !== undefined
      ? resolveZoomTarget({
          locatorRect: params.ancestorResult.projectedRect,
          viewport: params.snapshot.viewportSize,
          targetViewport: params.targetViewport,
          targetRectPositionInZoomViewport:
            params.targetRectPositionInZoomViewport,
          currentZoomEnd: params.currentZoomEnd,
        })
      : resolveZoomTarget({
          locatorRect: params.ancestorResult.projectedRect,
          viewport: params.snapshot.viewportSize,
          targetViewport: params.targetViewport,
          targetRectPositionInZoomViewport:
            params.targetRectPositionInZoomViewport,
        })
  const zoomOptimalOffsetWithoutPageScroll =
    zoomTargetWithoutPageScroll?.optimalOffset
  const pageScrollCanBeSkipped =
    zoomOptimalOffsetWithoutPageScroll !== undefined &&
    Math.round(zoomOptimalOffsetWithoutPageScroll.x) === 0 &&
    Math.round(zoomOptimalOffsetWithoutPageScroll.y) === 0
  const pageResult = buildPageScrollPlan(
    params.snapshot,
    params.ancestorResult,
    {
      targetRectPositionInViewport: params.targetRectPositionInViewport,
      ...(zoomOptimalOffsetWithoutPageScroll !== undefined
        ? {
            residualOnly: {
              x: zoomOptimalOffsetWithoutPageScroll.x,
              y: zoomOptimalOffsetWithoutPageScroll.y,
            },
          }
        : {}),
    }
  )
  const resolvedPageResult = pageScrollCanBeSkipped
    ? {
        plan: {
          startY: params.snapshot.page.scrollY,
          startX: params.snapshot.page.scrollX,
          targetY: params.snapshot.page.scrollY,
          targetX: params.snapshot.page.scrollX,
        },
        finalLocatorRect: params.ancestorResult.projectedRect,
      }
    : pageResult

  return {
    ...resolvedPageResult,
    scrollNeeded:
      params.ancestorResult.plans.some(
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
      ),
  }
}

export function combineFocusPlan(params: {
  snapshot: FocusSnapshot
  targetViewport: ViewportSize
  centering: number
  currentZoomEnd: NonNullable<FocusChangeEvent['zoom']>['end']
}): UnifiedFocusPlan {
  // Unified placement: treat `centering` as a symmetric comfort-band inset and
  // move the target the MINIMUM needed to bring it into that band. The band is
  // computed against the focus window (`targetViewport`): the full viewport for
  // a plain no-zoom scroll, or the zoom viewport for a zoom (where the slack is
  // small, so the band is naturally tight). Targets entering from below rest
  // near the bottom, from above near the top, already-comfortable ones do not
  // move, and `centering === 1` (or an oversized target) collapses the band to
  // dead center.
  const band = resolveTargetRectBandForViewport({
    containerSize: params.snapshot.viewportSize,
    rect: params.snapshot.locatorRect,
    focusViewport: params.targetViewport,
    centering: params.centering,
  })
  // Reveal the locator through nested scroll containers using minimal scrolling,
  // plus only the extra needed when page scroll and zoom would otherwise be unable to frame it.
  const ancestorResult = buildAncestorScrollPlans({
    snapshot: params.snapshot,
    projectedRectRangeX: resolveAcceptableRangeForAxis({
      pageScrollStart: params.snapshot.page.scrollX,
      pageScrollMax: Math.max(
        0,
        params.snapshot.page.scrollWidth - params.snapshot.viewportSize.width
      ),
      viewportSize: params.snapshot.viewportSize.width,
      targetViewportSize: params.targetViewport.width,
      band: band.x,
    }),
    projectedRectRangeY: resolveAcceptableRangeForAxis({
      pageScrollStart: params.snapshot.page.scrollY,
      pageScrollMax: Math.max(
        0,
        params.snapshot.page.scrollHeight - params.snapshot.viewportSize.height
      ),
      viewportSize: params.snapshot.viewportSize.height,
      targetViewportSize: params.targetViewport.height,
      band: band.y,
    }),
  })
  // Land the projected rect at the clamp of its CURRENT position into the band,
  // so page scroll (and zoom framing) is a minimal direction-aware reveal.
  const targetRectPositionInViewport = {
    x: clampToRange(ancestorResult.projectedRect.x, band.x),
    y: clampToRange(ancestorResult.projectedRect.y, band.y),
  }
  // Resolve where the locator rect should sit inside the zoom viewport itself.
  // The zoom viewport is the focus window, centered inside the full viewport at
  // `focusWindowStart`, so the zoom-local band position is the viewport-space
  // band position minus that offset. When there is no zoom the offset is 0 and
  // this coincides with the viewport-space band; when zooming, the smaller zoom
  // window makes the band tight (centering 1 stays exactly centered).
  const focusWindowStart = {
    x: Math.max(
      0,
      (params.snapshot.viewportSize.width - params.targetViewport.width) / 2
    ),
    y: Math.max(
      0,
      (params.snapshot.viewportSize.height - params.targetViewport.height) / 2
    ),
  }
  const targetRectPositionInZoomViewport = {
    x: targetRectPositionInViewport.x - focusWindowStart.x,
    y: targetRectPositionInViewport.y - focusWindowStart.y,
  }
  // Use page scroll only for the framing residual that zoom cannot absorb.
  const resolvedPageResult = resolvePagePlan({
    snapshot: params.snapshot,
    ancestorResult,
    targetRectPositionInViewport,
    targetViewport: params.targetViewport,
    targetRectPositionInZoomViewport,
    currentZoomEnd: params.currentZoomEnd,
  })

  // Recompute the final zoom target after any page scroll has been applied.
  const zoomTarget =
    params.currentZoomEnd !== undefined
      ? resolveZoomTarget({
          locatorRect: resolvedPageResult.finalLocatorRect,
          viewport: params.snapshot.viewportSize,
          targetViewport: params.targetViewport,
          targetRectPositionInZoomViewport,
          currentZoomEnd: params.currentZoomEnd,
        })
      : resolveZoomTarget({
          locatorRect: resolvedPageResult.finalLocatorRect,
          viewport: params.snapshot.viewportSize,
          targetViewport: params.targetViewport,
          targetRectPositionInZoomViewport,
        })
  const zoomNeeded =
    zoomTarget !== undefined &&
    (params.currentZoomEnd === undefined ||
      params.currentZoomEnd.pointPx.x !== zoomTarget.end.pointPx.x ||
      params.currentZoomEnd.pointPx.y !== zoomTarget.end.pointPx.y ||
      params.currentZoomEnd.size.widthPx !== zoomTarget.end.size.widthPx ||
      params.currentZoomEnd.size.heightPx !== zoomTarget.end.size.heightPx)

  return {
    finalLocatorRect: resolvedPageResult.finalLocatorRect,
    ancestorScrollPlans: ancestorResult.plans,
    pageScrollPlan: resolvedPageResult.plan,
    scrollNeeded: resolvedPageResult.scrollNeeded,
    zoomNeeded,
    finalFocusPoint: {
      x:
        resolvedPageResult.finalLocatorRect.x +
        resolvedPageResult.finalLocatorRect.width / 2,
      y:
        resolvedPageResult.finalLocatorRect.y +
        resolvedPageResult.finalLocatorRect.height / 2,
    },
    optimalOffset: zoomTarget?.optimalOffset ?? { x: 0, y: 0 },
    targetViewport: params.targetViewport,
    targetRectPositionInZoomViewport,
  }
}

async function executeScrollAndZoomPlan(params: {
  locator: Locator
  ancestorScrollPlans: ScrollPlan[]
  pageScrollPlan: PageScrollPlan
  zoomNeeded: boolean
  duration: number
  easing: Easing
}): Promise<
  | {
      scroll?: NonNullable<FocusChangeEvent['scroll']>
      zoom?: Pick<
        NonNullable<FocusChangeEvent['zoom']>,
        'startMs' | 'endMs' | 'easing'
      >
    }
  | undefined
> {
  const {
    locator,
    ancestorScrollPlans,
    pageScrollPlan,
    zoomNeeded,
    duration,
    easing,
  } = params
  const scrolled =
    ancestorScrollPlans.some(
      (plan) =>
        positionsDiffer(plan.startTop, plan.targetTop) ||
        positionsDiffer(plan.startLeft, plan.targetLeft)
    ) ||
    positionsDiffer(pageScrollPlan.startY, pageScrollPlan.targetY) ||
    positionsDiffer(pageScrollPlan.startX, pageScrollPlan.targetX)
  const zoomed = zoomNeeded

  if (!scrolled && !zoomed) return undefined

  const startMs = Date.now()
  const plannedEndMs = startMs + duration

  if (scrolled) {
    // Drive the scroll from Node, the same way the cursor move is driven,
    // instead of an in-page requestAnimationFrame loop. While the page is being
    // captured the browser pauses/throttles its rAF and timers, which would
    // stretch a ~1s scroll into several seconds. Progress is time-based: a
    // laggy machine renders fewer frames and a fast one renders the full set,
    // and either way the scroll finishes in ~duration.
    const frameMs = getScrollDispatchIntervalMs(locator.page())
    const animStart = Date.now()

    const applyScrollAtProgress = (easedT: number): Promise<unknown> =>
      locator.evaluate(
        (element, args) => {
          const doc = element.ownerDocument
          const win = doc.defaultView as ScrollWindow | null
          if (!win) return
          const positionsDiffer = (start: number, target: number): boolean =>
            Math.abs(target - start) > args.positionEpsilonPx

          if (args.ancestorScrollPlans.length > 0) {
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

            for (const [index, plan] of args.ancestorScrollPlans.entries()) {
              const ancestor = ancestors[index]
              if (!ancestor) continue
              if (
                !positionsDiffer(plan.startTop, plan.targetTop) &&
                !positionsDiffer(plan.startLeft, plan.targetLeft)
              ) {
                continue
              }
              ancestor.scrollTop =
                plan.startTop + (plan.targetTop - plan.startTop) * args.easedT
              ancestor.scrollLeft =
                plan.startLeft +
                (plan.targetLeft - plan.startLeft) * args.easedT
            }
          }

          win.scrollTo({
            top:
              args.pageScrollPlan.startY +
              (args.pageScrollPlan.targetY - args.pageScrollPlan.startY) *
                args.easedT,
            left:
              args.pageScrollPlan.startX +
              (args.pageScrollPlan.targetX - args.pageScrollPlan.startX) *
                args.easedT,
            behavior: 'auto',
          })
        },
        {
          ancestorScrollPlans,
          pageScrollPlan,
          easedT,
          positionEpsilonPx: POSITION_EPSILON_PX,
        }
      )

    let frames = 0
    for (;;) {
      const elapsed = Date.now() - animStart
      const t = duration > 0 ? Math.min(1, elapsed / duration) : 1
      await applyScrollAtProgress(evaluateEasingAtT(t, easing))
      frames += 1
      if (t >= 1) break
      await new Promise<void>((resolve) => setTimeout(resolve, frameMs))
    }
    if (isTimingDebugEnabled()) {
      logger.info(
        `[screenci:timing] scroll=${Date.now() - animStart}ms (planned ~${Math.round(
          duration
        )}ms) frames=${frames}`
      )
    }
  } else if (zoomed && duration > 0) {
    await sleep(duration)
  }

  return {
    ...(scrolled
      ? {
          scroll: {
            startMs,
            endMs: plannedEndMs,
            ...(duration > 0 ? { easing } : {}),
          },
        }
      : {}),
    ...(zoomed
      ? {
          zoom: {
            startMs,
            endMs: plannedEndMs,
            ...(duration > 0 ? { easing } : {}),
          },
        }
      : {}),
  }
}

function resolveMouseMovePlan(params: {
  mouseMove: MouseMoveRequest | undefined
  startViewportPos: Point
  mouseTarget: Point
  viewportSize: ViewportSize
  duration: number
  easing: Easing
  cursorTriggerEdgeThreshold: number
  cursorTriggerMaxProgress: number
}):
  | { mouseTarget: Point; scrollAndZoomTiming: ScrollAndZoomTimingPlan }
  | undefined {
  const { mouseMove, mouseTarget } = params
  if (mouseMove === undefined) return undefined

  return {
    mouseTarget,
    scrollAndZoomTiming: resolveScrollAndZoomTimingPlan({
      viewportSize: params.viewportSize,
      target: mouseTarget,
      startViewportPos: params.startViewportPos,
      duration: params.duration,
      easing: params.easing,
      cursorTriggerEdgeThreshold: params.cursorTriggerEdgeThreshold,
      cursorTriggerMaxProgress: params.cursorTriggerMaxProgress,
    }),
  }
}

function resolveFocusOptions(params: {
  state: ReturnType<typeof getAutoZoomState>
  options: AutoZoomOptions
  viewportSize: ViewportSize
  mouseMove?: MouseMoveRequest
  allowStandaloneZoom?: boolean
}): {
  focusOptions: ReturnType<typeof resolveAutoZoomOptions>
  currentZoomEnd: NonNullable<FocusChangeEvent['zoom']>['end']
  timing: {
    duration: number
    easing: Easing
  }
} {
  const resolvedAutoZoomOptions = resolveAutoZoomOptions(
    params.state,
    params.options
  )
  const currentZoomViewport = params.state.currentZoomViewport

  // Placement is a single unified model: every focus operation resolves the
  // target into a direction-aware comfort band (see combineFocusPlan). Only the
  // centering VALUE fed to the band varies by operation:
  //   - autoZoom framing: DEFAULT_AUTO_ZOOM_CENTERING (0.6), a tight band.
  //   - zoomTo / standalone or active manual zoom: 1 (center).
  //   - plain no-zoom interaction: the configured scroll-centering (0.2).
  // An explicit per-call (or per-autoZoom) `centering` always overrides the
  // default and is itself run through the band.
  const hasExplicitCentering =
    params.options.centering !== undefined ||
    params.state.options.centering !== undefined
  const autoZoomCentering = hasExplicitCentering
    ? resolvedAutoZoomOptions.centering
    : DEFAULT_AUTO_ZOOM_CENTERING

  const focusOptions = params.state.insideAutoZoom
    ? { ...resolvedAutoZoomOptions, centering: autoZoomCentering }
    : params.state.mode === 'manual' &&
        currentZoomViewport !== null &&
        !params.allowStandaloneZoom
      ? {
          ...resolvedAutoZoomOptions,
          amount:
            currentZoomViewport.end.size.widthPx / params.viewportSize.width,
        }
      : params.allowStandaloneZoom
        ? resolvedAutoZoomOptions
        : {
            ...resolvedAutoZoomOptions,
            amount: 1,
            // Not a zoom: just scroll the target into view. Honor an explicitly
            // requested centering so the caller can place the target; otherwise
            // use the gentle configured scroll-centering (default
            // DEFAULT_SCROLL_CENTERING) as the direction-aware comfort-band inset
            // so an already-visible element is not yanked around on every click.
            centering:
              params.options.centering ??
              params.state.scrollCentering ??
              DEFAULT_SCROLL_CENTERING,
          }
  const currentZoomEnd = currentZoomViewport?.end ?? {
    pointPx: { x: 0, y: 0 },
    size: {
      widthPx: params.viewportSize.width,
      heightPx: params.viewportSize.height,
    },
  }

  return {
    focusOptions,
    currentZoomEnd,
    timing: {
      duration: resolveRecordingTimingDuration(focusOptions.duration),
      easing: focusOptions.easing,
    },
  }
}

export async function changeFocus(
  locator: Locator,
  options: AutoZoomOptions = {},
  mouseMove?: MouseMoveRequest,
  allowStandaloneZoom = false
): Promise<FocusChangeEvent> {
  const page = locator.page()
  const state = getAutoZoomState()
  const shouldApplyZoom = state.insideAutoZoom || allowStandaloneZoom
  const shouldSuppressAutoScroll =
    state.mode === 'manual' && !state.insideAutoZoom && !allowStandaloneZoom
  const snapshotStartMs = Date.now()
  const snapshot = await captureFocusSnapshot(locator)
  const snapshotMs = Date.now() - snapshotStartMs
  if (
    shouldApplyZoom &&
    (snapshot.locatorRect.width > snapshot.viewportSize.width ||
      snapshot.locatorRect.height > snapshot.viewportSize.height)
  ) {
    logger.warn(
      '[screenci] Locator is larger than the viewport; using full-viewport framing and centering as much as possible.'
    )
  }
  const startViewportPos = getMousePosition(page) ?? {
    x: snapshot.viewportSize.width / 2,
    y: snapshot.viewportSize.height / 2,
  }
  const {
    focusOptions,
    currentZoomEnd,
    timing: focusTiming,
  } = resolveFocusOptions(
    mouseMove !== undefined
      ? {
          state,
          options,
          viewportSize: snapshot.viewportSize,
          mouseMove,
          allowStandaloneZoom,
        }
      : {
          state,
          options,
          viewportSize: snapshot.viewportSize,
          allowStandaloneZoom,
        }
  )

  const plan = shouldSuppressAutoScroll
    ? {
        finalLocatorRect: snapshot.locatorRect,
        ancestorScrollPlans: [],
        pageScrollPlan: {
          startY: snapshot.page.scrollY,
          startX: snapshot.page.scrollX,
          targetY: snapshot.page.scrollY,
          targetX: snapshot.page.scrollX,
        },
        scrollNeeded: false,
        zoomNeeded: false,
        finalFocusPoint: {
          x: snapshot.locatorRect.x + snapshot.locatorRect.width / 2,
          y: snapshot.locatorRect.y + snapshot.locatorRect.height / 2,
        },
        optimalOffset: { x: 0, y: 0 },
        targetViewport: resolveFixedFocusViewportSize(
          snapshot.viewportSize,
          focusOptions.amount
        ),
        targetRectPositionInZoomViewport: resolveTargetRectPosition({
          containerSize: resolveFixedFocusViewportSize(
            snapshot.viewportSize,
            focusOptions.amount
          ),
          rect: snapshot.locatorRect,
          amount: 1,
          centering: focusOptions.centering,
        }),
      }
    : combineFocusPlan({
        snapshot,
        targetViewport: shouldApplyZoom
          ? resolveLocatorFocusViewport({
              viewport: snapshot.viewportSize,
              rect: snapshot.locatorRect,
              amount: focusOptions.amount,
              padding: focusOptions.padding,
            })
          : resolveFixedFocusViewportSize(
              snapshot.viewportSize,
              focusOptions.amount
            ),
        centering: focusOptions.centering,
        currentZoomEnd,
      })

  const mouseTarget: Point = mouseMove?.targetPosInElement
    ? {
        x: plan.finalLocatorRect.x + mouseMove.targetPosInElement.x,
        y: plan.finalLocatorRect.y + mouseMove.targetPosInElement.y,
      }
    : {
        x: plan.finalLocatorRect.x + plan.finalLocatorRect.width / 2,
        y: plan.finalLocatorRect.y + plan.finalLocatorRect.height / 2,
      }

  const isZoomOut = plan.targetViewport.width >= currentZoomEnd.size.widthPx

  const timing =
    mouseMove !== undefined
      ? {
          duration: resolveMouseMoveDuration(
            page,
            mouseTarget.x,
            mouseTarget.y,
            {
              duration: mouseMove.duration,
              speed: mouseMove.speed,
              defaultDuration: DEFAULT_CLICK_MOUSE_MOVE_DURATION,
              context: 'focus move',
            }
          ),
          easing: mouseMove.easing,
        }
      : {
          ...focusTiming,
          duration: resolveRecordingTimingDuration(
            resolveEffectiveDuration(focusOptions, isZoomOut)
          ),
        }

  const mouseMovePlan = resolveMouseMovePlan({
    mouseMove,
    startViewportPos,
    viewportSize: snapshot.viewportSize,
    duration: timing.duration,
    easing: timing.easing,
    cursorTriggerEdgeThreshold: CURSOR_TRIGGER_EDGE_THRESHOLD,
    cursorTriggerMaxProgress: CURSOR_TRIGGER_MAX_PROGRESS,
    mouseTarget,
  })

  const focusChangeStartMs = Date.now()
  if (focusOptions.preZoomDelay > 0) {
    await sleep(focusOptions.preZoomDelay)
  }

  const mousePromise =
    mouseMovePlan !== undefined
      ? performMouseMove({
          page,
          targetX: mouseMovePlan.mouseTarget.x,
          targetY: mouseMovePlan.mouseTarget.y,
          duration: timing.duration,
          easing: timing.easing,
        })
      : Promise.resolve(undefined)

  const scrollAndZoomPromise =
    mouseMovePlan?.scrollAndZoomTiming.startDelay !== undefined &&
    mouseMovePlan.scrollAndZoomTiming.startDelay > 0
      ? sleep(mouseMovePlan.scrollAndZoomTiming.startDelay).then(() =>
          executeScrollAndZoomPlan({
            locator,
            ancestorScrollPlans: plan.ancestorScrollPlans,
            pageScrollPlan: plan.pageScrollPlan,
            zoomNeeded: plan.zoomNeeded,
            duration: mouseMovePlan.scrollAndZoomTiming.duration,
            easing: timing.easing,
          })
        )
      : executeScrollAndZoomPlan({
          locator,
          ancestorScrollPlans: plan.ancestorScrollPlans,
          pageScrollPlan: plan.pageScrollPlan,
          zoomNeeded: plan.zoomNeeded,
          duration:
            mouseMovePlan?.scrollAndZoomTiming.duration ?? timing.duration,
          easing: timing.easing,
        })

  const [mouseMoveResult, scrollAndZoomResult] = await Promise.all([
    mousePromise,
    scrollAndZoomPromise,
  ])
  const animationMs = Date.now() - focusChangeStartMs

  const zoomTarget = shouldApplyZoom
    ? resolveZoomTarget({
        locatorRect: plan.finalLocatorRect,
        viewport: snapshot.viewportSize,
        targetViewport: plan.targetViewport,
        targetRectPositionInZoomViewport: plan.targetRectPositionInZoomViewport,
        ...(currentZoomEnd !== undefined ? { currentZoomEnd } : {}),
      })
    : undefined
  const zoomEvent = shouldApplyZoom
    ? buildZoomEvent({
        target: zoomTarget,
        currentZoomEnd,
        zoomTiming: scrollAndZoomResult?.zoom,
      })
    : undefined
  const focusPoint = mouseMovePlan?.mouseTarget ?? plan.finalFocusPoint
  const mouseChange =
    mouseMovePlan !== undefined && mouseMoveResult !== undefined
      ? {
          startMs: mouseMoveResult.startMs,
          endMs: mouseMoveResult.endMs,
          ...(timing.duration > 0 ? { easing: timing.easing } : {}),
        }
      : undefined
  if (focusOptions.postZoomDelay > 0) {
    await sleep(focusOptions.postZoomDelay)
  }
  const focusChangeEndMs = Date.now()
  if (isTimingDebugEnabled()) {
    logger.info(
      `[screenci:timing] changeFocus total=${focusChangeEndMs - snapshotStartMs}ms ` +
        `snapshot=${snapshotMs}ms ` +
        `animation=${animationMs}ms (planned ~${Math.round(timing.duration)}ms) ` +
        `postZoom=${focusOptions.postZoomDelay}ms`
    )
  }
  const focusChange = {
    type: 'focusChange' as const,
    startMs: focusChangeStartMs,
    endMs: focusChangeEndMs,
    x: focusPoint.x,
    y: focusPoint.y,
    ...(mouseChange !== undefined ? { mouse: mouseChange } : {}),
    ...(scrollAndZoomResult?.scroll !== undefined
      ? { scroll: scrollAndZoomResult.scroll }
      : {}),
    ...(zoomEvent !== undefined ? { zoom: zoomEvent } : {}),
    elementRect: plan.finalLocatorRect,
  }

  if (shouldApplyZoom) {
    setCurrentZoomViewport({
      focusPoint,
      elementRect: plan.finalLocatorRect,
      end: zoomTarget?.end ?? {
        pointPx: { x: 0, y: 0 },
        size: {
          widthPx: snapshot.viewportSize.width,
          heightPx: snapshot.viewportSize.height,
        },
      },
      viewportSize: snapshot.viewportSize,
      optimalOffset: zoomTarget?.optimalOffset ?? { x: 0, y: 0 },
    })
  }

  return focusChange
}
