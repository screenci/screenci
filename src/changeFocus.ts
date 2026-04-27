import type { Locator } from '@playwright/test'
import type { ElementRect, FocusChangeEvent } from './events.js'
import { evaluateEasingAtT } from './easing.js'
import type { AutoZoomOptions, Easing } from './types.js'
import { performMouseMove, resolveMouseMoveDuration } from './mouse.js'
import { getAutoZoomState, setCurrentZoomViewport } from './autoZoom.js'
import {
  buildZoomEvent,
  resolveAutoZoomOptions,
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

type AxisRange = {
  min: number
  max: number
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
  return {
    width: viewport.width * amount,
    height: viewport.height * amount,
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

function resolveTargetRectStartForAxis(params: {
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

export function resolveTargetRectPosition(params: {
  containerSize: ViewportSize
  rect: ElementRect
  amount: number
  centering: number
}): Point {
  const { containerSize, rect, amount, centering } = params
  const targetViewport = resolveFixedFocusViewportSize(containerSize, amount)

  return {
    x: resolveTargetRectStartForAxis({
      containerSize: containerSize.width,
      rectSize: rect.width,
      focusSize: targetViewport.width,
      centering,
    }),
    y: resolveTargetRectStartForAxis({
      containerSize: containerSize.height,
      rectSize: rect.height,
      focusSize: targetViewport.height,
      centering,
    }),
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

function resolveProjectedRectAcceptableRangeForAxis(params: {
  pageScrollStart: number
  pageScrollMax: number
  viewportSize: number
  targetViewportSize: number
  targetRectStartInViewport: number
}): AxisRange {
  const {
    pageScrollStart,
    pageScrollMax,
    viewportSize,
    targetViewportSize,
    targetRectStartInViewport,
  } = params
  const maxZoomOrigin = Math.max(0, viewportSize - targetViewportSize)

  return {
    min: targetRectStartInViewport - pageScrollStart,
    max:
      targetRectStartInViewport +
      maxZoomOrigin +
      (pageScrollMax - pageScrollStart),
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
    const projectedRect = projectRectFromAncestorPlans(params.snapshot, nextPlans)
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

export function combineFocusPlan(params: {
  snapshot: FocusSnapshot
  amount: number
  centering: number
  currentZoomEnd: NonNullable<FocusChangeEvent['zoom']>['end'] | undefined
  insideAutoZoom: boolean
}): UnifiedFocusPlan {
  const targetViewport = resolveFixedFocusViewportSize(
    params.snapshot.viewportSize,
    params.amount
  )
  // Resolve the desired zoom viewport and where the visible locator rect should sit inside it.
  const initialTargetRectPositionInViewport = resolveTargetRectPosition({
    containerSize: params.snapshot.viewportSize,
    rect: params.snapshot.locatorRect,
    amount: params.amount,
    centering: params.centering,
  })
  // Reveal the locator through nested scroll containers using minimal scrolling,
  // plus only the extra needed when page scroll and zoom would otherwise be unable to frame it.
  const ancestorResult = buildAncestorScrollPlans({
    snapshot: params.snapshot,
    projectedRectRangeX: resolveProjectedRectAcceptableRangeForAxis({
      pageScrollStart: params.snapshot.page.scrollX,
      pageScrollMax: Math.max(
        0,
        params.snapshot.page.scrollWidth - params.snapshot.viewportSize.width
      ),
      viewportSize: params.snapshot.viewportSize.width,
      targetViewportSize: targetViewport.width,
      targetRectStartInViewport: initialTargetRectPositionInViewport.x,
    }),
    projectedRectRangeY: resolveProjectedRectAcceptableRangeForAxis({
      pageScrollStart: params.snapshot.page.scrollY,
      pageScrollMax: Math.max(
        0,
        params.snapshot.page.scrollHeight - params.snapshot.viewportSize.height
      ),
      viewportSize: params.snapshot.viewportSize.height,
      targetViewportSize: targetViewport.height,
      targetRectStartInViewport: initialTargetRectPositionInViewport.y,
    }),
  })
  const targetRectPositionInViewport = resolveTargetRectPosition({
    containerSize: params.snapshot.viewportSize,
    rect: ancestorResult.projectedRect,
    amount: params.amount,
    centering: params.centering,
  })
  // Resolve where the locator rect should sit inside the zoom viewport itself.
  const targetRectPositionInZoomViewport = resolveTargetRectPosition({
    containerSize: targetViewport,
    rect: ancestorResult.projectedRect,
    amount: 1,
    centering: params.centering,
  })
  // Let zoom do the primary framing work before considering any page scroll.
  const zoomTargetWithoutPageScroll = resolveZoomTarget(
    ancestorResult.projectedRect,
    params.snapshot.viewportSize,
    {
      targetViewport,
      targetRectPositionInZoomViewport,
    }
  )
  const pageScrollCanBeSkipped =
    params.insideAutoZoom &&
    Math.round(zoomTargetWithoutPageScroll.optimalOffset.x) === 0 &&
    Math.round(zoomTargetWithoutPageScroll.optimalOffset.y) === 0
  // Use page scroll only for the framing residual that zoom cannot absorb.
  const pageResult = buildPageScrollPlan(params.snapshot, ancestorResult, {
    targetRectPositionInViewport,
    ...(params.insideAutoZoom
      ? {
          residualOnly: {
            x: zoomTargetWithoutPageScroll.optimalOffset.x,
            y: zoomTargetWithoutPageScroll.optimalOffset.y,
          },
        }
      : {}),
  })
  // When zoom can fully absorb the framing, keep the page fixed.
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

  // Recompute the final zoom target after any page scroll has been applied.
  const zoomTarget = resolveZoomTarget(
    resolvedPageResult.finalLocatorRect,
    params.snapshot.viewportSize,
    {
      targetViewport,
      targetRectPositionInZoomViewport,
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
            if (
              !positionsDiffer(plan.startTop, plan.targetTop) &&
              !positionsDiffer(plan.startLeft, plan.targetLeft)
            ) {
              continue
            }
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
  const resolvedAutoZoomOptions = resolveAutoZoomOptions(state, options)
  const snapshot = await captureFocusSnapshot(locator)

  const plan = combineFocusPlan({
    snapshot,
    amount: resolvedAutoZoomOptions.amount,
    centering: resolvedAutoZoomOptions.centering,
    currentZoomEnd: state.currentZoomViewport?.end,
    insideAutoZoom: state.insideAutoZoom,
  })

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

  if (resolvedAutoZoomOptions.preZoomDelay > 0) {
    await sleep(resolvedAutoZoomOptions.preZoomDelay)
  }

  const focusStartMs = Date.now()
  const focusEndMs = focusStartMs + resolvedAutoZoomOptions.duration

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
    duration: resolvedAutoZoomOptions.duration,
    easing: resolvedAutoZoomOptions.easing,
  })
  const zoomWindowPromise =
    state.insideAutoZoom && plan.zoomNeeded && !plan.scrollNeeded
      ? sleep(resolvedAutoZoomOptions.duration)
      : Promise.resolve()

  const [mouseMoveEvent] = await Promise.all([
    mousePromise,
    scrollPromise,
    zoomWindowPromise,
  ])

  if (resolvedAutoZoomOptions.postZoomDelay > 0) {
    await sleep(resolvedAutoZoomOptions.postZoomDelay)
  }

  const viewport = state.insideAutoZoom
    ? resolveViewportSize(locator)
    : undefined
  const zoomTarget =
    state.insideAutoZoom && viewport !== undefined
      ? resolveZoomTarget(plan.finalLocatorRect, viewport, {
          targetViewport: resolveFixedFocusViewportSize(
            viewport,
            resolvedAutoZoomOptions.amount
          ),
          targetRectPositionInZoomViewport: resolveTargetRectPosition({
            containerSize: resolveFixedFocusViewportSize(
              viewport,
              resolvedAutoZoomOptions.amount
            ),
            rect: plan.finalLocatorRect,
            amount: 1,
            centering: resolvedAutoZoomOptions.centering,
          }),
        })
      : undefined
  const zoomEvent =
    state.insideAutoZoom && viewport !== undefined && zoomTarget !== undefined
      ? buildZoomEvent({
          target: zoomTarget,
          config: resolvedAutoZoomOptions,
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
                  ...(resolvedAutoZoomOptions.duration > 0
                    ? { easing: resolvedAutoZoomOptions.easing }
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

  return {
    locatorRect: plan.finalLocatorRect,
    ...(focusChange !== undefined ? { focusChange } : {}),
  }
}
