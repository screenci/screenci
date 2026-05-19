import type { Locator } from '@playwright/test'
import type {
  ElementRect,
  MouseDownEvent,
  MouseHideEvent,
  MouseUpEvent,
} from './events.js'
import type { Easing } from './types.js'
type ViewportMousePosition = {
  x: number
  y: number
}
type MouseMoveInternal = (
  x: number,
  y: number,
  options?: {
    steps?: number
  }
) => Promise<void>
type MouseClickOptions = {
  button?: 'left' | 'right' | 'middle'
  clickCount?: number
  delay?: number
}
type MouseClickInternal = (
  x: number,
  y: number,
  options?: MouseClickOptions
) => Promise<void>
type LocatorMouseActionOptions = MouseClickOptions & {
  position?: {
    x: number
    y: number
  }
  trial?: boolean
}
type LocatorMouseActionInternal = (
  options?: LocatorMouseActionOptions
) => Promise<void>
type LocatorSelectActionValues = Parameters<Locator['selectOption']>[0]
type LocatorSelectActionOptions = Parameters<Locator['selectOption']>[1]
type LocatorSelectActionInternal = (
  values: LocatorSelectActionValues,
  options?: LocatorSelectActionOptions
) => Promise<string[]>
export type MouseClickInteractionType =
  | 'click'
  | 'tap'
  | 'check'
  | 'uncheck'
  | 'select'
type PerformMouseClickActionOptions = {
  locator: Locator
  doClick: LocatorMouseActionInternal
  supportsTrial: boolean
  targetX: number
  targetY: number
  clickOptions?: LocatorMouseActionOptions
  easing?: Easing
} & (
  | {
      mode: 'singleBefore' | 'tripleBefore'
      shouldHideMouse?: boolean
    }
  | {
      mode: 'singleDuring'
      shouldHideMouse?: never
    }
)
export type MouseClickActionResult = {
  elementRect?: ElementRect
  events: Array<MouseDownEvent | MouseHideEvent | MouseUpEvent>
}
type MouseDownUpOptions = {
  button?: 'left' | 'right' | 'middle'
  clickCount?: number
}
type MouseDownInternal = (options?: MouseDownUpOptions) => Promise<void>
type MouseUpInternal = (options?: MouseDownUpOptions) => Promise<void>
type MouseVisibilityInternal = () => void
export declare const CLICK_DURATION_MS = 200
export declare const CURSOR_FRAME_INTERVAL_MS: number
export declare function getMousePosition(
  page: object
): ViewportMousePosition | undefined
export declare function setMousePosition(
  page: object,
  pos: ViewportMousePosition
): void
export declare function isMouseVisible(page: object): boolean
export declare function setMouseVisible(page: object, visible: boolean): void
export declare function getOriginalMouseMove(
  page: object,
  fallback: MouseMoveInternal
): MouseMoveInternal
export declare function setOriginalMouseMove(
  page: object,
  move: MouseMoveInternal
): void
export declare function getOriginalMouseClick(
  page: object,
  fallback: MouseClickInternal
): MouseClickInternal
export declare function setOriginalMouseClick(
  page: object,
  click: MouseClickInternal
): void
export declare function getOriginalMouseDown(
  page: object,
  fallback: MouseDownInternal
): MouseDownInternal
export declare function setOriginalMouseDown(
  page: object,
  down: MouseDownInternal
): void
export declare function getOriginalMouseUp(
  page: object,
  fallback: MouseUpInternal
): MouseUpInternal
export declare function setOriginalMouseUp(
  page: object,
  up: MouseUpInternal
): void
export declare function getOriginalMouseShow(
  page: object,
  fallback: MouseVisibilityInternal
): MouseVisibilityInternal
export declare function setOriginalMouseShow(
  page: object,
  show: MouseVisibilityInternal
): void
export declare function getOriginalMouseHide(
  page: object,
  fallback: MouseVisibilityInternal
): MouseVisibilityInternal
export declare function setOriginalMouseHide(
  page: object,
  hide: MouseVisibilityInternal
): void
export declare function setOriginalLocatorClick(
  locator: object,
  action: LocatorMouseActionInternal
): void
export declare function getOriginalLocatorClick(
  locator: object
): LocatorMouseActionInternal | undefined
export declare function setOriginalLocatorTap(
  locator: object,
  action: LocatorMouseActionInternal
): void
export declare function getOriginalLocatorTap(
  locator: object
): LocatorMouseActionInternal | undefined
export declare function setOriginalLocatorCheck(
  locator: object,
  action: LocatorMouseActionInternal
): void
export declare function getOriginalLocatorCheck(
  locator: object
): LocatorMouseActionInternal | undefined
export declare function setOriginalLocatorUncheck(
  locator: object,
  action: LocatorMouseActionInternal
): void
export declare function getOriginalLocatorUncheck(
  locator: object
): LocatorMouseActionInternal | undefined
export declare function setOriginalLocatorSelect(
  locator: object,
  action: LocatorSelectActionInternal
): void
export declare function getOriginalLocatorSelect(
  locator: object
): LocatorSelectActionInternal | undefined
export declare function assertDurationOrSpeed(
  duration: number | undefined,
  speed: number | undefined,
  context: string
): void
export declare function resolveMouseMoveDuration(
  page: object,
  targetX: number,
  targetY: number,
  options: {
    duration: number | undefined
    speed: number | undefined
    defaultDuration: number | undefined
    defaultSpeed?: number | undefined
    context: string
  }
): number
export declare function performMouseMove(options: {
  page: object
  targetX: number
  targetY: number
  duration: number
  easing: Easing
}): Promise<{
  startMs: number
  endMs: number
}>
export declare function buildMouseDownEvent(options: {
  startMs: number
  endMs: number
  easing?: Easing
}): MouseDownEvent
export declare function buildMouseUpEvent(options: {
  startMs: number
  endMs: number
  easing?: Easing
}): MouseUpEvent
export declare function performMouseClickAction(
  options: PerformMouseClickActionOptions
): Promise<MouseClickActionResult>
export declare function performMouseDown(options: {
  mouseDownInternal: MouseDownInternal
  downOptions?: MouseDownUpOptions
}): Promise<void>
export declare function performMouseUp(options: {
  mouseUpInternal: MouseUpInternal
  upOptions?: MouseDownUpOptions
}): Promise<void>
export declare function performMouseShow(options: {
  mouseShowInternal: MouseVisibilityInternal
  page: object
}): void
export declare function performMouseHide(options: {
  mouseHideInternal: MouseVisibilityInternal
  page: object
}): void
export {}
