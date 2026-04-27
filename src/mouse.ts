import type { MouseDownEvent, MouseUpEvent } from './events.js'
import type { Easing } from './types.js'
import { evaluateEasingAtT } from './easing.js'

type MousePosition = { x: number; y: number }

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

type MouseDownUpOptions = {
  button?: 'left' | 'right' | 'middle'
  clickCount?: number
}

type MouseDownInternal = (options?: MouseDownUpOptions) => Promise<void>
type MouseUpInternal = (options?: MouseDownUpOptions) => Promise<void>
type MouseVisibilityInternal = () => void

const mousePositions = new WeakMap<object, MousePosition>()
const mouseVisibilities = new WeakMap<object, boolean>()
const originalMouseMoves = new WeakMap<object, MouseMoveInternal>()
const originalMouseClicks = new WeakMap<object, MouseClickInternal>()
const originalMouseDowns = new WeakMap<object, MouseDownInternal>()
const originalMouseUps = new WeakMap<object, MouseUpInternal>()
const originalMouseShows = new WeakMap<object, MouseVisibilityInternal>()
const originalMouseHides = new WeakMap<object, MouseVisibilityInternal>()

export const CLICK_DURATION_MS = 200
export const CURSOR_FRAME_INTERVAL_MS = 1000 / 60

export function getMousePosition(page: object): MousePosition | undefined {
  return mousePositions.get(page)
}

export function setMousePosition(page: object, pos: MousePosition): void {
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
    context: string
  }
): number {
  const { duration, speed, defaultDuration, context } = options
  assertDurationOrSpeed(duration, speed, context)
  if (speed !== undefined) {
    const startPos = getMousePosition(page) ?? { x: 0, y: 0 }
    const distancePx = Math.hypot(targetX - startPos.x, targetY - startPos.y)
    return (distancePx / speed) * 1000
  }
  return duration ?? defaultDuration ?? 0
}

export async function performMouseMove(options: {
  page: object
  mouseMoveInternal: (x: number, y: number) => Promise<void>
  targetX: number
  targetY: number
  duration: number
  easing: Easing
}): Promise<{ startMs: number; endMs: number }> {
  const { page, mouseMoveInternal, targetX, targetY, duration, easing } =
    options
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

export async function performMouseClick(options: {
  page: object
  mouseClickInternal: MouseClickInternal
  x: number
  y: number
  clickOptions?: MouseClickOptions
  easing?: Easing
}): Promise<[MouseDownEvent, MouseUpEvent]> {
  const startMs = Date.now()
  await options.mouseClickInternal(options.x, options.y, options.clickOptions)
  const endMs = Date.now()
  const easing = options.easing ?? 'ease-in-out'
  const clickTimeMs = (startMs + endMs) / 2

  setMousePosition(options.page, { x: options.x, y: options.y })

  return [
    buildMouseDownEvent({
      startMs,
      endMs: clickTimeMs,
      easing,
    }),
    buildMouseUpEvent({
      startMs: clickTimeMs,
      endMs,
      easing,
    }),
  ]
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
