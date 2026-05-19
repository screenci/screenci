import type { Locator } from '@playwright/test'
import type { ElementRect, FocusChangeEvent } from './events.js'
import type { AutoZoomOptions, Easing } from './types.js'
type ScrollRectLike = {
  top: number
  left: number
  width: number
  height: number
}
export type MouseMoveRequest = {
  targetPosInElement?:
    | {
        x: number
        y: number
      }
    | undefined
  duration?: number
  speed?: number
  easing: Easing
}
type ViewportSize = {
  width: number
  height: number
}
type Point = {
  x: number
  y: number
}
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
  finalLocatorRect: ElementRect
  ancestorScrollPlans: ScrollPlan[]
  pageScrollPlan: PageScrollPlan
  scrollNeeded: boolean
  zoomNeeded: boolean
  finalFocusPoint: Point
  optimalOffset: Point
}
type ScrollAndZoomTimingPlan = {
  startDelay: number
  duration: number
}
export declare function resolveFixedFocusViewportSize(
  viewport: ViewportSize,
  amount: number
): ViewportSize
export declare function resolveIdealFocusOriginForAxis(params: {
  rectStart: number
  rectSize: number
  focusSize: number
  centering: number
}): number
export declare function resolveIdealFocusOrigin(
  rect: ElementRect,
  focusViewport: ViewportSize,
  centering: number
): Point
export declare function resolveOptimalOffset(ideal: Point, actual: Point): Point
export declare function resolveScrollAndZoomTimingPlan(params: {
  viewportSize: ViewportSize
  target: Point
  startViewportPos: Point
  duration: number
  easing: Easing
  cursorTriggerEdgeThreshold: number
  cursorTriggerMaxProgress: number
}): ScrollAndZoomTimingPlan
export declare function resolveTargetRectPosition(params: {
  containerSize: ViewportSize
  rect: ElementRect
  amount: number
  centering: number
}): Point
export declare function buildAncestorScrollPlans(params: {
  snapshot: FocusSnapshot
  projectedRectRangeX: AxisRange
  projectedRectRangeY: AxisRange
}): {
  plans: ScrollPlan[]
  accumulatedDelta: Point
  projectedRect: ElementRect
}
export declare function buildPageScrollPlan(
  snapshot: FocusSnapshot,
  ancestorProjection: {
    accumulatedDelta: Point
    projectedRect: ElementRect
  },
  options: {
    targetRectPositionInViewport: Point
    residualOnly?: {
      x: number
      y: number
    }
  }
): {
  plan: PageScrollPlan
  finalLocatorRect: ElementRect
}
export declare function combineFocusPlan(params: {
  snapshot: FocusSnapshot
  amount: number
  centering: number
  currentZoomEnd: NonNullable<FocusChangeEvent['zoom']>['end']
}): UnifiedFocusPlan
export declare function changeFocus(
  locator: Locator,
  options?: AutoZoomOptions,
  mouseMove?: MouseMoveRequest
): Promise<FocusChangeEvent>
export {}
