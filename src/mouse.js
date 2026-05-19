import { evaluateEasingAtT } from './easing.js'
import { logger } from './logger.js'
const mousePositions = new WeakMap()
const mouseVisibilities = new WeakMap()
const originalMouseMoves = new WeakMap()
const originalMouseClicks = new WeakMap()
const originalMouseDowns = new WeakMap()
const originalMouseUps = new WeakMap()
const originalMouseShows = new WeakMap()
const originalMouseHides = new WeakMap()
const originalLocatorClicks = new WeakMap()
const originalLocatorTaps = new WeakMap()
const originalLocatorChecks = new WeakMap()
const originalLocatorUnchecks = new WeakMap()
const originalLocatorSelects = new WeakMap()
export const CLICK_DURATION_MS = 200
export const CURSOR_FRAME_INTERVAL_MS = 1000 / 60
export function getMousePosition(page) {
  return mousePositions.get(page)
}
export function setMousePosition(page, pos) {
  mousePositions.set(page, pos)
}
export function isMouseVisible(page) {
  return mouseVisibilities.get(page) ?? true
}
export function setMouseVisible(page, visible) {
  mouseVisibilities.set(page, visible)
}
export function getOriginalMouseMove(page, fallback) {
  return originalMouseMoves.get(page) ?? fallback
}
export function setOriginalMouseMove(page, move) {
  originalMouseMoves.set(page, move)
}
export function getOriginalMouseClick(page, fallback) {
  return originalMouseClicks.get(page) ?? fallback
}
export function setOriginalMouseClick(page, click) {
  originalMouseClicks.set(page, click)
}
export function getOriginalMouseDown(page, fallback) {
  return originalMouseDowns.get(page) ?? fallback
}
export function setOriginalMouseDown(page, down) {
  originalMouseDowns.set(page, down)
}
export function getOriginalMouseUp(page, fallback) {
  return originalMouseUps.get(page) ?? fallback
}
export function setOriginalMouseUp(page, up) {
  originalMouseUps.set(page, up)
}
export function getOriginalMouseShow(page, fallback) {
  return originalMouseShows.get(page) ?? fallback
}
export function setOriginalMouseShow(page, show) {
  originalMouseShows.set(page, show)
}
export function getOriginalMouseHide(page, fallback) {
  return originalMouseHides.get(page) ?? fallback
}
export function setOriginalMouseHide(page, hide) {
  originalMouseHides.set(page, hide)
}
export function setOriginalLocatorClick(locator, action) {
  originalLocatorClicks.set(locator, action)
}
export function getOriginalLocatorClick(locator) {
  return originalLocatorClicks.get(locator)
}
export function setOriginalLocatorTap(locator, action) {
  originalLocatorTaps.set(locator, action)
}
export function getOriginalLocatorTap(locator) {
  return originalLocatorTaps.get(locator)
}
export function setOriginalLocatorCheck(locator, action) {
  originalLocatorChecks.set(locator, action)
}
export function getOriginalLocatorCheck(locator) {
  return originalLocatorChecks.get(locator)
}
export function setOriginalLocatorUncheck(locator, action) {
  originalLocatorUnchecks.set(locator, action)
}
export function getOriginalLocatorUncheck(locator) {
  return originalLocatorUnchecks.get(locator)
}
export function setOriginalLocatorSelect(locator, action) {
  originalLocatorSelects.set(locator, action)
}
export function getOriginalLocatorSelect(locator) {
  return originalLocatorSelects.get(locator)
}
export function assertDurationOrSpeed(duration, speed, context) {
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
export function resolveMouseMoveDuration(page, targetX, targetY, options) {
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
export async function performMouseMove(options) {
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
        await new Promise((resolve) => setTimeout(resolve, stepMs))
      }
    }
  } else {
    await mouseMoveInternal(targetX, targetY)
  }
  setMousePosition(page, { x: targetX, y: targetY })
  return { startMs, endMs: Date.now() }
}
export function buildMouseDownEvent(options) {
  return {
    type: 'mouseDown',
    startMs: options.startMs,
    endMs: options.endMs,
    ...(options.easing !== undefined ? { easing: options.easing } : {}),
  }
}
export function buildMouseUpEvent(options) {
  return {
    type: 'mouseUp',
    startMs: options.startMs,
    endMs: options.endMs,
    ...(options.easing !== undefined ? { easing: options.easing } : {}),
  }
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
export async function performMouseClickAction(options) {
  const page = options.locator.page()
  const halfClickDuration = CLICK_DURATION_MS / 2
  const easing = options.easing ?? 'ease-in-out'
  const events = []
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
export async function performMouseDown(options) {
  await options.mouseDownInternal(options.downOptions)
}
export async function performMouseUp(options) {
  await options.mouseUpInternal(options.upOptions)
}
export function performMouseShow(options) {
  options.mouseShowInternal()
  setMouseVisible(options.page, true)
}
export function performMouseHide(options) {
  options.mouseHideInternal()
  setMouseVisible(options.page, false)
}
