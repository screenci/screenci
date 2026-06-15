import type { Locator } from '@playwright/test'
import type {
  ElementRect,
  MouseDownEvent,
  MouseHideEvent,
  MouseUpEvent,
} from './events.js'
import type { Easing } from './types.js'
import {
  DEFAULT_MOUSE_INTERVAL_MS,
  DEFAULT_SCROLL_INTERVAL_MS,
  type PerformanceIntervals,
} from './performance.js'
import { evaluateEasingAtT } from './easing.js'
import { logger } from './logger.js'
import {
  isTimingDebugEnabled,
  resolveRecordingTimingDuration,
  shouldSimulateRecordingTimings,
} from './runtimeMode.js'

// Stored mouse coordinates are always viewport coordinates, even when a
// locator action receives an element-relative `position` option.
type ViewportMousePosition = { x: number; y: number }

type MouseMoveInternal = (
  x: number,
  y: number,
  options?: { steps?: number }
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
  position?: { x: number; y: number }
  trial?: boolean
  noWaitAfter?: boolean
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
  selectDuration?: number
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

const mousePositions = new WeakMap<object, ViewportMousePosition>()
const mouseVisibilities = new WeakMap<object, boolean>()
const performanceIntervals = new WeakMap<object, PerformanceIntervals>()
const originalMouseMoves = new WeakMap<object, MouseMoveInternal>()
const originalMouseClicks = new WeakMap<object, MouseClickInternal>()
const originalMouseDowns = new WeakMap<object, MouseDownInternal>()
const originalMouseUps = new WeakMap<object, MouseUpInternal>()
const originalMouseShows = new WeakMap<object, MouseVisibilityInternal>()
const originalMouseHides = new WeakMap<object, MouseVisibilityInternal>()
const originalLocatorClicks = new WeakMap<object, LocatorMouseActionInternal>()
const originalLocatorTaps = new WeakMap<object, LocatorMouseActionInternal>()
const originalLocatorChecks = new WeakMap<object, LocatorMouseActionInternal>()
const originalLocatorUnchecks = new WeakMap<
  object,
  LocatorMouseActionInternal
>()
const originalLocatorSelects = new WeakMap<
  object,
  LocatorSelectActionInternal
>()

export const CLICK_DURATION_MS = 200
export const CURSOR_FRAME_INTERVAL_MS = 1000 / 60

/**
 * If an element takes longer than this to pass Playwright's actionability
 * checks before an interaction, warn that the app or CI machine is slow to
 * respond. This is informational only and does not change the recording.
 */
export const SLOW_INTERACTION_WARN_MS = 1000

export function getMousePosition(
  page: object
): ViewportMousePosition | undefined {
  return mousePositions.get(page)
}

export function setMousePosition(
  page: object,
  pos: ViewportMousePosition
): void {
  mousePositions.set(page, pos)
}

export function setPerformanceIntervals(
  page: object,
  intervals: PerformanceIntervals
): void {
  performanceIntervals.set(page, intervals)
}

export function getMouseDispatchIntervalMs(page: object): number {
  return performanceIntervals.get(page)?.mouseMs ?? DEFAULT_MOUSE_INTERVAL_MS
}

export function getScrollDispatchIntervalMs(page: object): number {
  return performanceIntervals.get(page)?.scrollMs ?? DEFAULT_SCROLL_INTERVAL_MS
}

export function isMouseVisible(page: object): boolean {
  return mouseVisibilities.get(page) ?? true
}

export function setMouseVisible(page: object, visible: boolean): void {
  mouseVisibilities.set(page, visible)
}

export function getOriginalMouseMove(
  page: object,
  fallback: MouseMoveInternal
): MouseMoveInternal {
  return originalMouseMoves.get(page) ?? fallback
}

export function setOriginalMouseMove(
  page: object,
  move: MouseMoveInternal
): void {
  originalMouseMoves.set(page, move)
}

export function getOriginalMouseClick(
  page: object,
  fallback: MouseClickInternal
): MouseClickInternal {
  return originalMouseClicks.get(page) ?? fallback
}

export function setOriginalMouseClick(
  page: object,
  click: MouseClickInternal
): void {
  originalMouseClicks.set(page, click)
}

export function getOriginalMouseDown(
  page: object,
  fallback: MouseDownInternal
): MouseDownInternal {
  return originalMouseDowns.get(page) ?? fallback
}

export function setOriginalMouseDown(
  page: object,
  down: MouseDownInternal
): void {
  originalMouseDowns.set(page, down)
}

export function getOriginalMouseUp(
  page: object,
  fallback: MouseUpInternal
): MouseUpInternal {
  return originalMouseUps.get(page) ?? fallback
}

export function setOriginalMouseUp(page: object, up: MouseUpInternal): void {
  originalMouseUps.set(page, up)
}

export function getOriginalMouseShow(
  page: object,
  fallback: MouseVisibilityInternal
): MouseVisibilityInternal {
  return originalMouseShows.get(page) ?? fallback
}

export function setOriginalMouseShow(
  page: object,
  show: MouseVisibilityInternal
): void {
  originalMouseShows.set(page, show)
}

export function getOriginalMouseHide(
  page: object,
  fallback: MouseVisibilityInternal
): MouseVisibilityInternal {
  return originalMouseHides.get(page) ?? fallback
}

export function setOriginalMouseHide(
  page: object,
  hide: MouseVisibilityInternal
): void {
  originalMouseHides.set(page, hide)
}

export function setOriginalLocatorClick(
  locator: object,
  action: LocatorMouseActionInternal
): void {
  originalLocatorClicks.set(locator, action)
}

export function getOriginalLocatorClick(
  locator: object
): LocatorMouseActionInternal | undefined {
  return originalLocatorClicks.get(locator)
}

export function setOriginalLocatorTap(
  locator: object,
  action: LocatorMouseActionInternal
): void {
  originalLocatorTaps.set(locator, action)
}

export function getOriginalLocatorTap(
  locator: object
): LocatorMouseActionInternal | undefined {
  return originalLocatorTaps.get(locator)
}

export function setOriginalLocatorCheck(
  locator: object,
  action: LocatorMouseActionInternal
): void {
  originalLocatorChecks.set(locator, action)
}

export function getOriginalLocatorCheck(
  locator: object
): LocatorMouseActionInternal | undefined {
  return originalLocatorChecks.get(locator)
}

export function setOriginalLocatorUncheck(
  locator: object,
  action: LocatorMouseActionInternal
): void {
  originalLocatorUnchecks.set(locator, action)
}

export function getOriginalLocatorUncheck(
  locator: object
): LocatorMouseActionInternal | undefined {
  return originalLocatorUnchecks.get(locator)
}

export function setOriginalLocatorSelect(
  locator: object,
  action: LocatorSelectActionInternal
): void {
  originalLocatorSelects.set(locator, action)
}

export function getOriginalLocatorSelect(
  locator: object
): LocatorSelectActionInternal | undefined {
  return originalLocatorSelects.get(locator)
}

export function assertDurationOrSpeed(
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

export function resolveMouseMoveDuration(
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
): number {
  const { duration, speed, defaultDuration, defaultSpeed, context } = options
  assertDurationOrSpeed(duration, speed, context)
  if (!shouldSimulateRecordingTimings()) return 0
  if (speed !== undefined) {
    const startPos = getMousePosition(page) ?? { x: 0, y: 0 }
    const distancePx = Math.hypot(targetX - startPos.x, targetY - startPos.y)
    return (distancePx / speed) * 1000
  }
  if (duration !== undefined) return duration
  if (defaultDuration !== undefined) return defaultDuration
  if (defaultSpeed !== undefined) {
    const startPos = getMousePosition(page) ?? { x: 0, y: 0 }
    const distancePx = Math.hypot(targetX - startPos.x, targetY - startPos.y)
    return (distancePx / defaultSpeed) * 1000
  }
  return 0
}

export async function performMouseMove(options: {
  page: object
  targetX: number
  targetY: number
  duration: number
  easing: Easing
}): Promise<{ startMs: number; endMs: number }> {
  const { page, targetX, targetY, duration, easing } = options
  const mouseMoveInternal = getOriginalMouseMove(page, async () => {
    throw new Error('[screenci] Missing original mouse move for page.')
  })
  const startPos = getMousePosition(page) ?? { x: 0, y: 0 }
  const startMs = Date.now()
  const plannedEndMs = startMs + duration

  if (duration > 0) {
    // The rendered cursor is interpolated at render time from the recorded
    // move event (start/end/easing), so dispatching the real cursor at 60fps
    // does nothing for smoothness and only loads the renderer. Dispatch at the
    // configured interval instead, time-based so a busy page drops dispatches
    // rather than stretching the gesture.
    const intervalMs = getMouseDispatchIntervalMs(page)
    for (;;) {
      const elapsedMs = Date.now() - startMs
      const t = Math.min(1, elapsedMs / duration)
      const easedT = evaluateEasingAtT(t, easing)
      const x = startPos.x + easedT * (targetX - startPos.x)
      const y = startPos.y + easedT * (targetY - startPos.y)
      await mouseMoveInternal(x, y)
      if (t >= 1) break
      await new Promise<void>((resolve) => setTimeout(resolve, intervalMs))
    }
  } else {
    await mouseMoveInternal(targetX, targetY)
  }

  setMousePosition(page, { x: targetX, y: targetY })

  return { startMs, endMs: plannedEndMs }
}

export function buildMouseDownEvent(options: {
  startMs: number
  endMs: number
  easing?: Easing
}): MouseDownEvent {
  return {
    type: 'mouseDown',
    startMs: options.startMs,
    endMs: options.endMs,
    ...(options.easing !== undefined ? { easing: options.easing } : {}),
  }
}

export function buildMouseUpEvent(options: {
  startMs: number
  endMs: number
  easing?: Easing
}): MouseUpEvent {
  return {
    type: 'mouseUp',
    startMs: options.startMs,
    endMs: options.endMs,
    ...(options.easing !== undefined ? { easing: options.easing } : {}),
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) =>
    setTimeout(resolve, resolveRecordingTimingDuration(ms))
  )
}

export async function performMouseClickAction(
  options: PerformMouseClickActionOptions
): Promise<MouseClickActionResult> {
  const page = options.locator.page()
  const halfClickDuration = CLICK_DURATION_MS / 2
  const easing = options.easing ?? 'ease-in-out'
  const events: Array<MouseDownEvent | MouseHideEvent | MouseUpEvent> = []
  const mode = options.mode ?? 'singleDuring'

  if (options.supportsTrial) {
    // Trial run performs Playwright's actionability checks (visible, stable,
    // enabled, receiving events) without clicking. If it takes a long time, the
    // app or CI machine is slow to make the element ready; warn so it can be
    // investigated. screenci does not alter the recording to hide this.
    const trialStartMs = Date.now()
    await options.doClick({
      ...options.clickOptions,
      trial: true,
      noWaitAfter: options.clickOptions?.noWaitAfter ?? true,
    })
    const trialMs = Date.now() - trialStartMs
    if (isTimingDebugEnabled()) {
      logger.info(`[screenci:timing] actionability trial=${trialMs}ms`)
    }
    if (trialMs >= SLOW_INTERACTION_WARN_MS) {
      logger.warn(
        `[screenci] Slow UI response: waited ${trialMs}ms for an element to become ready before an interaction. This is usually a slow CI machine, not screenci. See https://screenci.com/docs/ci-setup#ci-performance`
      )
    }
  }

  const boundingBoxStartMs = Date.now()
  const elementRect = await options.locator.boundingBox()
  if (isTimingDebugEnabled()) {
    logger.info(
      `[screenci:timing] boundingBox=${Date.now() - boundingBoxStartMs}ms`
    )
  }
  if (!elementRect) {
    logger.warn('[screenci] Unable to resolve locator bounds before action.')
  }

  if (mode === 'tripleBefore') {
    const perClickDurationMs =
      options.selectDuration !== undefined
        ? Math.round(options.selectDuration / 3)
        : CLICK_DURATION_MS
    for (let i = 0; i < 3; i++) {
      const startMs = Date.now()
      await sleep(perClickDurationMs)

      const endMs = Date.now()
      const clickTimeMs = startMs + (endMs - startMs) / 2

      events.push(
        buildMouseDownEvent({
          startMs,
          endMs: clickTimeMs,
          easing,
        }),
        buildMouseUpEvent({
          startMs: clickTimeMs,
          endMs,
          easing,
        })
      )
    }

    if (options.shouldHideMouse) {
      if (isMouseVisible(page)) {
        setMouseVisible(page, false)
      }
      const hideMs = Date.now()
      events.push({
        type: 'mouseHide',
        startMs: hideMs,
        endMs: hideMs,
      })
    }

    await options.doClick({
      ...options.clickOptions,
      noWaitAfter: options.clickOptions?.noWaitAfter ?? true,
    })
  } else if (mode === 'singleBefore') {
    const startMs = Date.now()
    await sleep(CLICK_DURATION_MS)
    const endMs = Date.now()
    const clickTimeMs = startMs + (endMs - startMs) / 2

    events.push(
      buildMouseDownEvent({
        startMs,
        endMs: clickTimeMs,
        easing,
      }),
      buildMouseUpEvent({
        startMs: clickTimeMs,
        endMs,
        easing,
      })
    )

    if (options.shouldHideMouse) {
      if (isMouseVisible(page)) {
        setMouseVisible(page, false)
      }
      const hideMs = Date.now()
      events.push({
        type: 'mouseHide',
        startMs: hideMs,
        endMs: hideMs,
      })
    }

    await options.doClick({
      ...options.clickOptions,
      noWaitAfter: options.clickOptions?.noWaitAfter ?? true,
    })
  } else {
    const wrapperStartMs = Date.now()
    await sleep(halfClickDuration)

    await options.doClick({
      ...options.clickOptions,
      noWaitAfter: options.clickOptions?.noWaitAfter ?? true,
    })
    await sleep(halfClickDuration)
    const endMs = Date.now()
    const startMs = Math.max(wrapperStartMs, endMs - CLICK_DURATION_MS)
    const clickTimeMs = startMs + (endMs - startMs) / 2

    events.push(
      buildMouseDownEvent({
        startMs,
        endMs: clickTimeMs,
        easing,
      }),
      buildMouseUpEvent({
        startMs: clickTimeMs,
        endMs,
        easing,
      })
    )
  }

  setMousePosition(page, { x: options.targetX, y: options.targetY })

  return {
    ...(elementRect ? { elementRect } : {}),
    events,
  }
}

export async function performMouseDown(options: {
  mouseDownInternal: MouseDownInternal
  downOptions?: MouseDownUpOptions
}): Promise<void> {
  await options.mouseDownInternal(options.downOptions)
}

export async function performMouseUp(options: {
  mouseUpInternal: MouseUpInternal
  upOptions?: MouseDownUpOptions
}): Promise<void> {
  await options.mouseUpInternal(options.upOptions)
}

export function performMouseShow(options: {
  mouseShowInternal: MouseVisibilityInternal
  page: object
}): void {
  options.mouseShowInternal()
  setMouseVisible(options.page, true)
}

export function performMouseHide(options: {
  mouseHideInternal: MouseVisibilityInternal
  page: object
}): void {
  options.mouseHideInternal()
  setMouseVisible(options.page, false)
}
