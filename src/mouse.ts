import type { Locator } from '@playwright/test'
import type {
  ElementRect,
  MouseDownEvent,
  MouseHideEvent,
  MouseUpEvent,
} from './events.js'
import type { Easing } from './types.js'
import { evaluateEasingAtT } from './easing.js'
import { logger } from './logger.js'

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

const mousePositions = new WeakMap<object, ViewportMousePosition>()
const mouseVisibilities = new WeakMap<object, boolean>()
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

  if (duration > 0) {
    const steps = Math.max(1, Math.floor(duration / CURSOR_FRAME_INTERVAL_MS))
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

  setMousePosition(page, { x: targetX, y: targetY })

  return { startMs, endMs: Date.now() }
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
  return new Promise((resolve) => setTimeout(resolve, ms))
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
    await options.doClick({
      ...options.clickOptions,
      trial: true,
    })
  }

  const elementRect = await options.locator.boundingBox()
  if (!elementRect) {
    logger.warn('[screenci] Unable to resolve locator bounds before action.')
  }

  if (mode === 'tripleBefore') {
    for (let i = 0; i < 3; i++) {
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
    }

    if (options.shouldHideMouse && isMouseVisible(page)) {
      setMouseVisible(page, false)
      const hideMs = Date.now()
      events.push({
        type: 'mouseHide',
        startMs: hideMs,
        endMs: hideMs,
      })
    }

    await options.doClick(options.clickOptions)
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

    if (options.shouldHideMouse && isMouseVisible(page)) {
      setMouseVisible(page, false)
      const hideMs = Date.now()
      events.push({
        type: 'mouseHide',
        startMs: hideMs,
        endMs: hideMs,
      })
    }

    await options.doClick(options.clickOptions)
  } else {
    const startMs = Date.now()
    await sleep(halfClickDuration)

    await options.doClick(options.clickOptions)
    await sleep(halfClickDuration)
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
