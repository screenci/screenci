import type {
  Page,
  BrowserContext,
  Browser,
  Locator,
  FrameLocator,
} from '@playwright/test'
import type {
  IEventRecorder,
  ElementRect,
  MouseMoveEvent,
  MouseDownEvent,
  MouseUpEvent,
  MouseShowEvent,
  MouseHideEvent,
  MouseWaitEvent,
} from './events.js'
import type {
  ClickBeforeFillOption,
  Easing,
  PostClickMove,
  ScreenCIPage,
} from './types.js'
import { logger } from './logger.js'
import {
  isInsideAutoZoom,
  getZoomDuration,
  getZoomEasing,
  getPostZoomInOutDelay,
  getLastZoomLocation,
  setLastZoomLocation,
} from './autoZoom.js'
import { isInsideHide } from './hide.js'
import { scrollTo } from './scroll.js'

let activeClickRecorder: IEventRecorder | null = null

function resolveScrollAnimationOptions(): {
  easing: Easing
  duration: number | undefined
} {
  if (!isInsideAutoZoom()) {
    return { easing: 'ease-in-out', duration: undefined }
  }

  return {
    easing: getZoomEasing() ?? 'ease-in-out',
    duration: getZoomDuration() ?? undefined,
  }
}

export function setActiveClickRecorder(recorder: IEventRecorder | null): void {
  activeClickRecorder = recorder
}

/**
 * Evaluate a polynomial easing function at normalized time t ∈ [0, 1].
 * Returns the eased progress value (0–1).
 */
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

/** Tracked cursor position per page, updated after each animated move. */
const mousePositions = new WeakMap<object, { x: number; y: number }>()

/** Tracks cursor visibility per page (true = visible). Defaults to true. */
const mouseVisibilities = new WeakMap<object, boolean>()

/** Stores the original (un-instrumented) mouse.move per page so internal
 *  cursor animations don't emit addInput recorder events. */
const originalMouseMoves = new WeakMap<
  object,
  (x: number, y: number, options?: { steps?: number }) => Promise<void>
>()

const instrumented = new WeakSet<object>()

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const CLICK_DURATION_MS = 200
const PRE_ACTION_SLEEP = 50
const POST_ACTION_SLEEP = 250

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
    const startPos = mousePositions.get(page) ?? { x: 0, y: 0 }
    const distancePx = Math.hypot(targetX - startPos.x, targetY - startPos.y)
    return (distancePx / speed) * 1000
  }
  return duration ?? defaultDuration ?? 0
}

const LOCATOR_RETURN_METHODS = [
  'locator',
  'getByAltText',
  'getByLabel',
  'getByPlaceholder',
  'getByRole',
  'getByTestId',
  'getByText',
  'getByTitle',
] as const satisfies ReadonlyArray<keyof Locator & keyof Page>

type LocatorReturnMethod = (typeof LOCATOR_RETURN_METHODS)[number]

const LOCATOR_ONLY_SYNC_RETURN_METHODS = [
  'and',
  'describe',
  'filter',
  'first',
  'last',
  'nth',
  'or',
] as const satisfies ReadonlyArray<keyof Locator>

type LocatorOnlySyncReturnMethod =
  (typeof LOCATOR_ONLY_SYNC_RETURN_METHODS)[number]

type LocatorOnlySyncReturnMethodsRecord = Record<
  LocatorOnlySyncReturnMethod,
  (...args: unknown[]) => Locator
>

const FRAME_LOCATOR_LOCATOR_RETURN_METHODS = [
  'locator',
  'getByAltText',
  'getByLabel',
  'getByPlaceholder',
  'getByRole',
  'getByTestId',
  'getByText',
  'getByTitle',
  'owner',
] as const satisfies ReadonlyArray<keyof FrameLocator>

type FrameLocatorLocatorReturnMethod =
  (typeof FRAME_LOCATOR_LOCATOR_RETURN_METHODS)[number]

type FrameLocatorLocatorReturnMethodsRecord = Record<
  FrameLocatorLocatorReturnMethod,
  (...args: unknown[]) => Locator
>

const FRAME_LOCATOR_SELF_RETURN_METHODS = [
  'frameLocator',
  'first',
  'last',
  'nth',
] as const satisfies ReadonlyArray<keyof FrameLocator>

type FrameLocatorSelfReturnMethod =
  (typeof FRAME_LOCATOR_SELF_RETURN_METHODS)[number]

type FrameLocatorSelfReturnMethodsRecord = Record<
  FrameLocatorSelfReturnMethod,
  (...args: unknown[]) => FrameLocator
>

type DOMClickData = {
  x: number
  y: number
  targetRect: ElementRect
}

function canUseDirectMouseClickAfterScroll(
  options: Parameters<Locator['click']>[0] | undefined
): boolean {
  if (!options) return true
  const unsupported = [
    'force',
    'modifiers',
    'noWaitAfter',
    'timeout',
    'trial',
  ] as const

  return unsupported.every((key) => options[key] === undefined)
}

// Per-page storage for the most recently captured DOM click event data.
// Reset to null before each instrumented click; set by the exposeFunction callback.
const pendingClickData = new WeakMap<object, DOMClickData | null>()

export function scrollIntoViewAsync(
  locator: Locator,
  options: {
    behavior?: ScrollBehavior
    block?: ScrollLogicalPosition
    timeout?: number
    postScrollTimeout?: number
  } = {}
): Promise<void> {
  const {
    behavior = 'smooth',
    block = 'center',
    timeout = 5000,
    postScrollTimeout = 500,
  } = options
  return locator.evaluate(
    (element, opts) =>
      new Promise<void>((resolve) => {
        let settled = false
        const finish = () => {
          if (settled) return
          settled = true
          clearTimeout(fallback)
          setTimeout(resolve, opts.postScrollTimeout)
        }

        const fallback = setTimeout(finish, opts.timeout)

        // scrollend fires once the smooth-scroll animation completes (Chrome 114+).
        // It captures scroll on any ancestor element via the capture phase.
        window.addEventListener('scrollend', finish, {
          capture: true,
          once: true,
        })

        element.scrollIntoView({ behavior: opts.behavior, block: opts.block })

        // If the element is already in the target position no scroll occurs and
        // scrollend never fires. Detect this: if no scroll event appears within
        // two animation frames the element was already in place.
        let didScroll = false
        window.addEventListener(
          'scroll',
          () => {
            didScroll = true
          },
          {
            capture: true,
            passive: true,
            once: true,
          }
        )
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            if (!didScroll) finish()
          })
        )
      }),
    { behavior, block, timeout, postScrollTimeout }
  )
}

const CURSOR_STEP_MS = 1000 / 60

/**
 * Physically moves the mouse from its current tracked position to (targetX,
 * targetY) over `duration` ms using `easing`, then returns a MouseMoveEvent
 * whose startMs is `eventStartMs` (which may predate this call, e.g. when a
 * scroll consumed part of moveDuration).  When duration ≤ 0 the cursor is
 * snapped directly to the target with a single move call.
 * Always updates the internal mousePositions tracker.
 */
async function animateMouseMove(
  page: object,
  mouseMoveInternal: (x: number, y: number) => Promise<void>,
  targetX: number,
  targetY: number,
  duration: number,
  easing: Easing,
  eventStartMs: number,
  elementRect?: ElementRect
): Promise<MouseMoveEvent> {
  if (duration > 0) {
    const startPos = mousePositions.get(page) ?? { x: 0, y: 0 }
    const steps = Math.max(1, Math.floor(duration / CURSOR_STEP_MS))
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

  mousePositions.set(page, { x: targetX, y: targetY })

  const endMs = Date.now()

  return {
    type: 'mouseMove',
    startMs: eventStartMs,
    endMs,
    duration: Math.max(0, endMs - eventStartMs),
    x: targetX,
    y: targetY,
    easing,
    ...(elementRect !== undefined ? { elementRect } : {}),
  }
}

type ClickActionResult = {
  elementRect: ElementRect
  innerEvents: Array<
    MouseMoveEvent | MouseDownEvent | MouseUpEvent | MouseWaitEvent
  >
}

/**
 * Performs all click mechanics (scroll-check, zoom handling, cursor animation,
 * click, post-click move) and returns the collected timing/position data.
 * Returns null if coordinates could not be determined (no DOM event and no
 * locator bounding box).
 */
async function performClickActions(
  locator: Locator,
  doClick: (options: Parameters<Locator['click']>[0]) => Promise<void>,
  clickOptions: Parameters<Locator['click']>[0],
  position?: { x: number; y: number },
  moveDuration?: number,
  moveSpeed?: number,
  beforeClickPause = CLICK_DURATION_MS / 2,
  moveEasing: Easing = 'ease-in-out',
  postClickPause = CLICK_DURATION_MS / 2,
  postClickMove?: PostClickMove
): Promise<ClickActionResult | null> {
  const page = locator.page()
  pendingClickData.set(page, null)
  const halfClickDuration = CLICK_DURATION_MS / 2
  const mouseMoveInternal =
    originalMouseMoves.get(page) ?? page.mouse.move.bind(page.mouse)

  // Capture before any setLastZoomLocation call changes the state.
  const isFirstAutoZoomEvent =
    isInsideAutoZoom() && getLastZoomLocation() === null

  const moveStartTime = Date.now()
  const scrollAnimation = resolveScrollAnimationOptions()
  const locatorRect = await scrollTo(
    locator,
    Math.floor((locator.page().viewportSize()?.height ?? 0) / 2),
    scrollAnimation.easing,
    scrollAnimation.duration
  )
  const scrollElapsedMs = Date.now() - moveStartTime
  if (!locatorRect) {
    logger.warn(
      '[screenci] Unable to get locator bounding box; skipping auto-scroll check.'
    )
  }

  const innerEvents: Array<MouseMoveEvent | MouseDownEvent | MouseUpEvent> = []

  // If inside autoZoom: optionally await zoom duration for camera pan then
  // update the zoom location tracker.
  if (isInsideAutoZoom() && locatorRect) {
    const targetX = position
      ? locatorRect.x + position.x
      : locatorRect.x + locatorRect.width / 2
    const targetY = position
      ? locatorRect.y + position.y
      : locatorRect.y + locatorRect.height / 2
    const lastLoc = getLastZoomLocation()
    if (lastLoc !== null) {
      const zoomDur = getZoomDuration() ?? 0
      if (zoomDur > 0) {
        await sleep(zoomDur)
      }
    }
    setLastZoomLocation({
      x: targetX,
      y: targetY,
      elementRect: locatorRect,
      eventType: 'click',
    })
  }

  const targetPos = position
    ? position
    : locatorRect
      ? {
          x: locatorRect.width / 2,
          y: locatorRect.height / 2,
        }
      : undefined

  if (targetPos && locatorRect) {
    const targetX = locatorRect.x + targetPos.x
    const targetY = locatorRect.y + targetPos.y
    const resolvedDuration = resolveMouseMoveDuration(page, targetX, targetY, {
      duration: moveDuration,
      speed: moveSpeed,
      defaultDuration: 1000,
      context: 'click move',
    })
    if (scrollElapsedMs > 0) {
      await mouseMoveInternal(targetX, targetY)
      mousePositions.set(page, { x: targetX, y: targetY })

      const remainingDuration = Math.max(0, resolvedDuration - scrollElapsedMs)
      if (remainingDuration > 0) {
        await new Promise<void>((resolve) =>
          setTimeout(resolve, remainingDuration)
        )
      }

      const moveEndTime = Date.now()
      innerEvents.push({
        type: 'mouseMove',
        startMs: moveStartTime,
        endMs: moveEndTime,
        duration: Math.max(0, moveEndTime - moveStartTime),
        x: targetX,
        y: targetY,
        easing: moveEasing,
        elementRect: locatorRect,
      })
    } else {
      innerEvents.push(
        await animateMouseMove(
          page,
          mouseMoveInternal,
          targetX,
          targetY,
          resolvedDuration,
          moveEasing,
          moveStartTime,
          locatorRect
        )
      )
    }
  } else {
    assertDurationOrSpeed(moveDuration, moveSpeed, 'click move')
    const remainingMs = Math.max(
      0,
      moveSpeed === undefined ? (moveDuration ?? 1000) : 0
    )
    if (remainingMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, remainingMs))
    }
  }

  const effectiveBeforeClickPause = isFirstAutoZoomEvent
    ? Math.max(beforeClickPause, getPostZoomInOutDelay() ?? 0)
    : beforeClickPause
  await new Promise<void>((resolve) =>
    setTimeout(resolve, effectiveBeforeClickPause)
  )

  await new Promise<void>((resolve) => setTimeout(resolve, halfClickDuration))
  // Note click can take some time, but better to show it before than after
  const clickTime = Date.now()
  const mouseDownStart = clickTime - halfClickDuration
  innerEvents.push({
    type: 'mouseDown',
    startMs: mouseDownStart,
    endMs: clickTime,
    easing: 'ease-in-out',
  })

  if (
    scrollElapsedMs > 0 &&
    targetPos &&
    locatorRect &&
    canUseDirectMouseClickAfterScroll(clickOptions)
  ) {
    const mouseClickOptions = {
      ...(clickOptions?.button !== undefined
        ? { button: clickOptions.button }
        : {}),
      ...(clickOptions?.clickCount !== undefined
        ? { clickCount: clickOptions.clickCount }
        : {}),
    }
    await page.mouse.down(mouseClickOptions)
    if (clickOptions?.delay) {
      await new Promise<void>((resolve) =>
        setTimeout(resolve, clickOptions.delay)
      )
    }
    await page.mouse.up(mouseClickOptions)
  } else {
    await doClick({
      ...clickOptions,
      ...(targetPos ? { position: targetPos } : {}),
    })
  }
  const domClickData = pendingClickData.get(page)

  if (domClickData) {
    const lastMouseMoveIndex = innerEvents.findIndex(
      (e) => e.type === 'mouseMove'
    )
    if (lastMouseMoveIndex !== -1) {
      const existingMove = innerEvents[lastMouseMoveIndex]
      if (existingMove?.type === 'mouseMove') {
        innerEvents[lastMouseMoveIndex] = {
          ...existingMove,
          x: domClickData.x,
          y: domClickData.y,
          elementRect: domClickData.targetRect,
        }
      }
    }

    mousePositions.set(page, { x: domClickData.x, y: domClickData.y })
  }

  const mouseUpEnd = Date.now() + halfClickDuration
  innerEvents.push({
    type: 'mouseUp',
    startMs: clickTime,
    endMs: mouseUpEnd,
    easing: 'ease-in-out',
  })

  await new Promise<void>((resolve) => setTimeout(resolve, halfClickDuration))

  await new Promise<void>((resolve) => setTimeout(resolve, postClickPause))

  // Animate mouse cursor in the specified direction after the click completes,
  // capturing start/end times and final position for the recorded event.
  if (postClickMove !== undefined) {
    const currentPos = mousePositions.get(page) ?? { x: 0, y: 0 }
    let targetX: number | undefined
    let targetY: number | undefined

    if ('direction' in postClickMove) {
      if (locatorRect === undefined) {
        logger.warn(
          '[screenci] postClickMove with direction requires a locator rect; skipping mouse move.'
        )
      } else {
        const padding = postClickMove.padding ?? 0
        switch (postClickMove.direction) {
          case 'up':
            targetX = currentPos.x
            targetY = locatorRect.y - padding
            break
          case 'down':
            targetX = currentPos.x
            targetY = locatorRect.y + locatorRect.height + padding
            break
          case 'left':
            targetX = locatorRect.x - padding
            targetY = currentPos.y
            break
          case 'right':
            targetX = locatorRect.x + locatorRect.width + padding
            targetY = currentPos.y
            break
          default: {
            const _: never = postClickMove.direction
            throw new Error(`Unknown postClickMove direction: ${_}`)
          }
        }
      }
    } else {
      targetX = currentPos.x + postClickMove.x
      targetY = currentPos.y + postClickMove.y
    }

    if (targetX !== undefined && targetY !== undefined) {
      const easing = postClickMove.easing ?? 'ease-in-out'
      const duration = resolveMouseMoveDuration(page, targetX, targetY, {
        duration: postClickMove.duration,
        speed: postClickMove.speed,
        defaultDuration: undefined,
        context: 'postClickMove',
      })
      const steps = Math.max(1, Math.floor(duration / CURSOR_STEP_MS))
      const stepMs = duration / steps

      const postClickMoveStartMs = Date.now()

      const startPos = { ...currentPos }

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

      const postClickMoveEndMs = Date.now()
      innerEvents.push({
        type: 'mouseMove',
        startMs: postClickMoveStartMs,
        endMs: postClickMoveEndMs,
        duration: Math.max(0, postClickMoveEndMs - postClickMoveStartMs),
        x: targetX,
        y: targetY,
        easing,
        zoomFollow: false,
      })
      mousePositions.set(page, { x: targetX, y: targetY })
    }
  }

  let elementRect: ElementRect | undefined
  if (domClickData) {
    elementRect = domClickData.targetRect
  } else if (locatorRect) {
    elementRect = locatorRect
  }

  if (elementRect) {
    return {
      elementRect,
      innerEvents,
    }
  } else {
    logger.warn(
      '[screenci] Failed to capture click coordinates from both DOM event and locator bounding box.'
    )
    return null
  }
}

/**
 * Shared implementation for tap, check, uncheck, and select instrumentation.
 */
type SimpleActionOptions =
  | Parameters<Locator['tap']>[0]
  | Parameters<Locator['check']>[0]
  | Parameters<Locator['uncheck']>[0]
  | Parameters<Locator['selectOption']>[1]

async function prepareAutoZoomForLocator(
  locator: Locator,
  eventType: 'click' | 'fill'
): Promise<ElementRect | undefined> {
  const hadPreviousZoomLocation = getLastZoomLocation() !== null
  const zoomDur = isInsideAutoZoom() ? (getZoomDuration() ?? 0) : 0
  if (isInsideAutoZoom() && hadPreviousZoomLocation && zoomDur > 0) {
    await sleep(zoomDur)
  }

  const scrollAnimation = resolveScrollAnimationOptions()
  const locatorRect = await scrollTo(
    locator,
    Math.floor((locator.page().viewportSize()?.height ?? 0) / 2),
    scrollAnimation.easing,
    scrollAnimation.duration
  )

  if (isInsideAutoZoom() && locatorRect) {
    if (!hadPreviousZoomLocation && zoomDur > 0) {
      await sleep(zoomDur)
    }

    setLastZoomLocation({
      x: locatorRect.x + locatorRect.width / 2,
      y: locatorRect.y + locatorRect.height / 2,
      elementRect: locatorRect,
      eventType,
    })
  }

  return locatorRect
}

async function performSimpleAction(
  locator: Locator,
  doAction: (options: SimpleActionOptions) => Promise<void>,
  options: SimpleActionOptions,
  subType: 'tap' | 'check' | 'uncheck' | 'select',
  clickOpt?: ClickBeforeFillOption,
  position?: { x: number; y: number },
  recordMousePress = subType === 'tap'
): Promise<void> {
  await sleep(PRE_ACTION_SLEEP)
  let innerEvents: Array<
    MouseMoveEvent | MouseDownEvent | MouseUpEvent | MouseWaitEvent
  > = []
  let elementRect: ElementRect | undefined

  if (clickOpt !== undefined) {
    const {
      moveDuration,
      moveSpeed,
      beforeClickPause,
      moveEasing,
      postClickPause,
      postClickMove,
    } = clickOpt

    const clickActionResult = await performClickActions(
      locator,
      doAction,
      {},
      position,
      moveDuration,
      moveSpeed,
      beforeClickPause,
      moveEasing,
      postClickPause,
      postClickMove
    )
    innerEvents = clickActionResult?.innerEvents ?? []
    elementRect = clickActionResult?.elementRect
  } else {
    const isFirstAutoZoomEvent =
      isInsideAutoZoom() && getLastZoomLocation() === null

    const locatorRect = await prepareAutoZoomForLocator(locator, 'fill')

    if (isFirstAutoZoomEvent) {
      const postDelay = getPostZoomInOutDelay() ?? 0
      if (postDelay > 0) await sleep(postDelay)
    }

    const targetPosition = locatorRect
      ? {
          x: locatorRect.width / 2,
          y: locatorRect.height / 2,
        }
      : undefined

    const startTime = Date.now()
    await doAction({
      ...options,
      ...(targetPosition ? { position: targetPosition } : {}),
    })
    const endTime = Date.now()
    elementRect = locatorRect

    if (recordMousePress) {
      const midTime = (startTime + endTime) / 2
      innerEvents.push({
        type: 'mouseDown',
        startMs: startTime,
        endMs: midTime,
      })
      innerEvents.push({
        type: 'mouseUp',
        startMs: midTime,
        endMs: endTime,
      })
    }
  }

  const simpleWaitStart = Date.now()
  await sleep(POST_ACTION_SLEEP)
  const simpleWaitEnd = Date.now()
  innerEvents.push({
    type: 'mouseWait',
    startMs: simpleWaitStart,
    endMs: simpleWaitEnd,
  })

  if (activeClickRecorder && innerEvents.length > 0) {
    activeClickRecorder.addInput(subType, elementRect, innerEvents)
  }
}

async function recordedClick(
  locator: Locator,
  doClick: (options: Parameters<Locator['click']>[0]) => Promise<void>,
  clickOptions: Parameters<Locator['click']>[0],
  position?: { x: number; y: number },
  moveDuration?: number,
  moveSpeed?: number,
  beforeClickPause = CLICK_DURATION_MS / 2,
  moveEasing: Easing = 'ease-in-out',
  postClickPause = CLICK_DURATION_MS / 2,
  postClickMove?: PostClickMove
): Promise<void> {
  await sleep(PRE_ACTION_SLEEP)
  const result = await performClickActions(
    locator,
    doClick,
    clickOptions,
    position,
    moveDuration,
    moveSpeed,
    beforeClickPause,
    moveEasing,
    postClickPause,
    postClickMove
  )
  const clickWaitStart = Date.now()
  await sleep(POST_ACTION_SLEEP)
  const clickWaitEnd = Date.now()
  if (activeClickRecorder && result) {
    result.innerEvents.push({
      type: 'mouseWait',
      startMs: clickWaitStart,
      endMs: clickWaitEnd,
    })
    activeClickRecorder.addInput(
      'click',
      result.elementRect,
      result.innerEvents
    )
  }
}

type LocatorReturnMethodsRecord = Record<
  LocatorReturnMethod,
  (...args: unknown[]) => Locator
>

function instrumentLocatorMethods(obj: Locator | Page): void {
  for (const method of LOCATOR_RETURN_METHODS) {
    const original = (obj as unknown as LocatorReturnMethodsRecord)[
      method
    ].bind(obj)
    ;(obj as unknown as LocatorReturnMethodsRecord)[method] = (
      ...args: unknown[]
    ): Locator => instrumentLocator(original(...args))
  }
}

export function instrumentFrameLocator(
  frameLocator: FrameLocator
): FrameLocator {
  if (instrumented.has(frameLocator)) return frameLocator
  instrumented.add(frameLocator)

  for (const method of FRAME_LOCATOR_LOCATOR_RETURN_METHODS) {
    const original = (
      frameLocator as unknown as FrameLocatorLocatorReturnMethodsRecord
    )[method].bind(frameLocator)
    ;(frameLocator as unknown as FrameLocatorLocatorReturnMethodsRecord)[
      method
    ] = (...args: unknown[]): Locator => instrumentLocator(original(...args))
  }

  for (const method of FRAME_LOCATOR_SELF_RETURN_METHODS) {
    const original = (
      frameLocator as unknown as FrameLocatorSelfReturnMethodsRecord
    )[method].bind(frameLocator)
    ;(frameLocator as unknown as FrameLocatorSelfReturnMethodsRecord)[method] =
      (...args: unknown[]): FrameLocator =>
        instrumentFrameLocator(original(...args))
  }

  return frameLocator
}

export function instrumentLocator(locator: Locator): Locator {
  if (instrumented.has(locator)) return locator
  instrumented.add(locator)

  const originalClick = locator.click.bind(locator)
  locator.click = async (
    options?: Parameters<Locator['click']>[0] & {
      moveDuration?: number
      moveSpeed?: number
      beforeClickPause?: number
      moveEasing?: Easing
      postClickPause?: number
      postClickMove?: PostClickMove
    }
  ) => {
    const {
      moveDuration,
      moveSpeed,
      beforeClickPause,
      moveEasing,
      postClickPause,
      postClickMove,
      position,
      steps: _steps,
      ...clickOptions
    } = options ?? {}

    if (isInsideHide()) {
      return originalClick({
        ...clickOptions,
        ...(position !== undefined && { position }),
      })
    }

    assertDurationOrSpeed(moveDuration, moveSpeed, 'click move')

    return recordedClick(
      locator,
      (options: Parameters<Locator['click']>[0]) => originalClick(options),
      clickOptions,
      position,
      moveDuration,
      moveSpeed,
      beforeClickPause,
      moveEasing,
      postClickPause,
      postClickMove
    )
  }

  type PressSequentiallyOptions = Parameters<
    Locator['pressSequentially']
  >[1] & {
    click?: ClickBeforeFillOption
    hideMouse?: boolean
    position?: { x: number; y: number }
  }

  const originalPressSequentially = locator.pressSequentially.bind(locator)
  locator.pressSequentially = async (
    text: string,
    options?: PressSequentiallyOptions
  ): Promise<void> => {
    const {
      click: _click,
      hideMouse: _hideMouse,
      position: _position,
      ...pressOptions
    } = options ?? {}

    if (isInsideHide()) {
      return originalPressSequentially(
        text,
        pressOptions as Parameters<Locator['pressSequentially']>[1]
      )
    }

    await sleep(PRE_ACTION_SLEEP)
    const innerEvents: Array<
      | MouseMoveEvent
      | MouseDownEvent
      | MouseUpEvent
      | MouseHideEvent
      | MouseWaitEvent
    > = []
    let elementRect: ElementRect | undefined

    if (options?.click !== undefined) {
      // Click before fill: performClickActions handles scrolling and bounding box.
      const clickOpt = options.click
      const position = options.position
      const {
        moveDuration,
        moveSpeed,
        beforeClickPause,
        moveEasing,
        postClickPause,
        postClickMove,
        ...clickOptions
      } = clickOpt

      const clickActionResult = await performClickActions(
        locator,
        (options) => originalClick(options),
        clickOptions,
        position,
        moveDuration,
        moveSpeed,
        beforeClickPause,
        moveEasing,
        postClickPause,
        postClickMove
      )
      innerEvents.push(...(clickActionResult?.innerEvents ?? []))
      elementRect = clickActionResult?.elementRect
    } else {
      const isFirstAutoZoomEvent =
        isInsideAutoZoom() && getLastZoomLocation() === null

      const locatorRect = await prepareAutoZoomForLocator(locator, 'fill')

      if (isFirstAutoZoomEvent) {
        const postDelay = getPostZoomInOutDelay() ?? 0
        if (postDelay > 0) await sleep(postDelay)
      }

      elementRect = locatorRect
    }

    // Hide cursor while typing (will be shown again on next mouse move)
    const page = locator.page()
    const shouldHideMouse = options?.hideMouse === true
    if (shouldHideMouse) {
      const cursorVisible = mouseVisibilities.get(page) ?? true
      if (cursorVisible) {
        mouseVisibilities.set(page, false)
        const hideMs = Date.now()
        innerEvents.push({
          type: 'mouseHide',
          startMs: hideMs,
          endMs: hideMs,
        })
      }
    }

    await originalPressSequentially(
      text,
      pressOptions as Parameters<Locator['pressSequentially']>[1]
    )

    const pressWaitStart = Date.now()
    await sleep(POST_ACTION_SLEEP)
    const pressWaitEnd = Date.now()

    if (activeClickRecorder) {
      innerEvents.push({
        type: 'mouseWait',
        startMs: pressWaitStart,
        endMs: pressWaitEnd,
      })
      activeClickRecorder.addInput(
        'pressSequentially',
        elementRect,
        innerEvents
      )
    }
  }

  const originalFill = locator.fill.bind(locator)
  locator.fill = async (
    value: string,
    options?: {
      duration?: number
      timeout?: number
      click?: ClickBeforeFillOption
      position?: { x: number; y: number }
      hideMouse?: boolean
    }
  ) => {
    if (isInsideHide()) {
      const {
        duration: _duration,
        click: _click,
        position: _position,
        hideMouse: _hideMouse,
        ...fillOptions
      } = options ?? {}

      return originalFill(value, fillOptions as Parameters<Locator['fill']>[1])
    }

    if (options?.click !== undefined) {
      await sleep(PRE_ACTION_SLEEP)

      const clickActionResult = await performClickActions(
        locator,
        (clickOptions) => originalClick(clickOptions),
        {},
        options.position,
        options.click.moveDuration,
        options.click.moveSpeed,
        options.click.beforeClickPause,
        options.click.moveEasing,
        options.click.postClickPause,
        options.click.postClickMove
      )

      const innerEvents: Array<
        | MouseMoveEvent
        | MouseDownEvent
        | MouseUpEvent
        | MouseHideEvent
        | MouseWaitEvent
      > = [...(clickActionResult?.innerEvents ?? [])]
      const elementRect = clickActionResult?.elementRect
      const page = locator.page()

      if (options.hideMouse === true) {
        const cursorVisible = mouseVisibilities.get(page) ?? true
        if (cursorVisible) {
          mouseVisibilities.set(page, false)
          const hideMs = Date.now()
          innerEvents.push({
            type: 'mouseHide',
            startMs: hideMs,
            endMs: hideMs,
          })
        }
      }

      await locator.evaluate((element) => {
        if (
          element instanceof HTMLInputElement ||
          element instanceof HTMLTextAreaElement
        ) {
          element.focus()
          element.select()
          return
        }

        if (element instanceof HTMLElement && element.isContentEditable) {
          element.focus()
          const selection = element.ownerDocument.getSelection()
          if (!selection) return
          const range = element.ownerDocument.createRange()
          range.selectNodeContents(element)
          selection.removeAllRanges()
          selection.addRange(range)
        }
      })

      const duration = options.duration ?? 1000
      const delay = value.length > 0 ? duration / value.length : 0
      await page.keyboard.type(value, { delay })

      const fillWaitStart = Date.now()
      await sleep(POST_ACTION_SLEEP)
      const fillWaitEnd = Date.now()
      innerEvents.push({
        type: 'mouseWait',
        startMs: fillWaitStart,
        endMs: fillWaitEnd,
      })

      if (activeClickRecorder) {
        activeClickRecorder.addInput(
          'pressSequentially',
          elementRect,
          innerEvents
        )
      }
      return
    }

    const duration = options?.duration ?? 1000
    const delay = value.length > 0 ? duration / value.length : 0
    const pressOptions: PressSequentiallyOptions = { delay }
    if (options?.timeout !== undefined) pressOptions.timeout = options.timeout
    if (options?.click !== undefined) pressOptions.click = options.click
    if (options?.position !== undefined)
      pressOptions.position = options.position
    if (options?.hideMouse !== undefined)
      pressOptions.hideMouse = options.hideMouse
    return locator.pressSequentially(value, pressOptions)
  }

  const originalTap = locator.tap.bind(locator)
  locator.tap = async (
    options?: Parameters<Locator['tap']>[0] & { click?: ClickBeforeFillOption }
  ): Promise<void> => {
    const clickOpt = options?.click
    const { click: _click, position, ...tapOpts } = options ?? {}
    return performSimpleAction(
      locator,
      (options: Parameters<Locator['tap']>[0]) => originalTap(options),
      tapOpts as Parameters<Locator['tap']>[0],
      'tap',
      clickOpt,
      position
    )
  }

  const originalCheck = locator.check.bind(locator)
  locator.check = async (
    options?: Parameters<Locator['check']>[0] & {
      click?: ClickBeforeFillOption
    }
  ): Promise<void> => {
    const clickOpt = options?.click
    const position = options?.position
    const { click: _click, ...checkOpts } = options ?? {}

    if (isInsideHide()) {
      return originalCheck(checkOpts as Parameters<Locator['check']>[0])
    }

    return performSimpleAction(
      locator,
      (options: Parameters<Locator['check']>[0]) => originalCheck(options),
      checkOpts as Parameters<Locator['check']>[0],
      'check',
      clickOpt,
      position,
      false
    )
  }

  const originalUncheck = locator.uncheck.bind(locator)
  locator.uncheck = async (
    options?: Parameters<Locator['uncheck']>[0] & {
      click?: ClickBeforeFillOption
    }
  ): Promise<void> => {
    const clickOpt = options?.click
    const position = options?.position
    const { click: _click, ...uncheckOpts } = options ?? {}

    if (isInsideHide()) {
      return originalUncheck(uncheckOpts as Parameters<Locator['uncheck']>[0])
    }

    return performSimpleAction(
      locator,
      (options: Parameters<Locator['uncheck']>[0]) => originalUncheck(options),
      uncheckOpts as Parameters<Locator['uncheck']>[0],
      'uncheck',
      clickOpt,
      position,
      false
    )
  }

  locator.setChecked = async (
    checked: boolean,
    options?: Parameters<Locator['check']>[0] & {
      click?: ClickBeforeFillOption
    }
  ): Promise<void> => {
    if (checked) {
      return locator.check(options)
    } else {
      return locator.uncheck(options)
    }
  }

  const originalSelectOption = locator.selectOption.bind(locator)
  locator.selectOption = async (
    values: Parameters<Locator['selectOption']>[0],
    options?: Parameters<Locator['selectOption']>[1] & {
      click?: ClickBeforeFillOption
      position?: { x: number; y: number }
    }
  ): Promise<string[]> => {
    const clickOpt = options?.click
    const { click: _click, position, ...selectOpts } = options ?? {}

    if (isInsideHide()) {
      return originalSelectOption(
        values,
        selectOpts as Parameters<Locator['selectOption']>[1]
      )
    }

    let result: string[] = []
    await performSimpleAction(
      locator,
      (options: Parameters<Locator['selectOption']>[1]) =>
        originalSelectOption(values, options).then((res) => {
          result = res
        }),
      selectOpts as Parameters<Locator['selectOption']>[1],
      'select',
      clickOpt,
      position,
      false
    )
    return result
  }

  const originalHover = locator.hover.bind(locator)
  locator.hover = async (
    options?: Parameters<Locator['hover']>[0] & {
      moveDuration?: number
      moveSpeed?: number
      easing?: Easing
      hoverDuration?: number
    }
  ): Promise<void> => {
    const {
      moveDuration,
      moveSpeed,
      easing: moveEasing = 'ease-in-out',
      hoverDuration = 1000,
      position,
      ...hoverOptions
    } = options ?? {}

    assertDurationOrSpeed(moveDuration, moveSpeed, 'hover move')

    const page = locator.page()
    const mouseMoveInternal =
      originalMouseMoves.get(page) ?? page.mouse.move.bind(page.mouse)

    const moveStartTime = Date.now()
    const scrollAnimation = resolveScrollAnimationOptions()
    const locatorRect = await scrollTo(
      locator,
      Math.floor((locator.page().viewportSize()?.height ?? 0) / 2),
      scrollAnimation.easing,
      scrollAnimation.duration
    )
    const scrollElapsedMs = Date.now() - moveStartTime

    const innerEvents: Array<MouseMoveEvent | MouseWaitEvent> = []

    const targetPos =
      position ??
      (locatorRect
        ? { x: locatorRect.width / 2, y: locatorRect.height / 2 }
        : undefined)

    if (targetPos && locatorRect) {
      const targetX = locatorRect.x + targetPos.x
      const targetY = locatorRect.y + targetPos.y
      const resolvedDuration = resolveMouseMoveDuration(
        page,
        targetX,
        targetY,
        {
          duration: moveDuration,
          speed: moveSpeed,
          defaultDuration: 1000,
          context: 'hover move',
        }
      )
      const effectiveDuration = Math.max(0, resolvedDuration - scrollElapsedMs)
      innerEvents.push(
        await animateMouseMove(
          page,
          mouseMoveInternal,
          targetX,
          targetY,
          effectiveDuration,
          moveEasing,
          moveStartTime,
          locatorRect
        )
      )
    }

    const waitStartMs = Date.now()
    await originalHover({
      ...hoverOptions,
      ...(targetPos ? { position: targetPos } : {}),
    })
    if (hoverDuration > 0) {
      await sleep(hoverDuration)
    }
    const waitFinishMs = Date.now()

    innerEvents.push({
      type: 'mouseWait',
      startMs: waitStartMs,
      endMs: waitFinishMs,
    })

    if (activeClickRecorder && innerEvents.length > 0) {
      activeClickRecorder.addInput('hover', locatorRect, innerEvents)
    }
  }

  const originalSelectText = locator.selectText.bind(locator)
  locator.selectText = async (
    options?: Parameters<Locator['selectText']>[0] & {
      moveDuration?: number
      moveSpeed?: number
      easing?: Easing
      beforeClickPause?: number
      selectDuration?: number
    }
  ): Promise<void> => {
    const {
      moveDuration,
      moveSpeed,
      easing: moveEasing = 'ease-in-out',
      beforeClickPause = CLICK_DURATION_MS / 2,
      selectDuration = 600,
      ...selectOpts
    } = options ?? {}

    assertDurationOrSpeed(moveDuration, moveSpeed, 'selectText move')

    const page = locator.page()
    const mouseMoveInternal =
      originalMouseMoves.get(page) ?? page.mouse.move.bind(page.mouse)

    const moveStartTime = Date.now()
    const scrollAnimation = resolveScrollAnimationOptions()
    const locatorRect = await scrollTo(
      locator,
      Math.floor((locator.page().viewportSize()?.height ?? 0) / 2),
      scrollAnimation.easing,
      scrollAnimation.duration
    )
    const scrollElapsedMs = Date.now() - moveStartTime

    const innerEvents: Array<MouseMoveEvent | MouseDownEvent | MouseUpEvent> =
      []

    const targetPos = locatorRect
      ? { x: locatorRect.width / 2, y: locatorRect.height / 2 }
      : undefined

    if (targetPos && locatorRect) {
      const targetX = locatorRect.x + targetPos.x
      const targetY = locatorRect.y + targetPos.y
      const resolvedDuration = resolveMouseMoveDuration(
        page,
        targetX,
        targetY,
        {
          duration: moveDuration,
          speed: moveSpeed,
          defaultDuration: 1000,
          context: 'selectText move',
        }
      )
      const effectiveDuration = Math.max(0, resolvedDuration - scrollElapsedMs)
      innerEvents.push(
        await animateMouseMove(
          page,
          mouseMoveInternal,
          targetX,
          targetY,
          effectiveDuration,
          moveEasing,
          moveStartTime,
          locatorRect
        )
      )
    }

    await sleep(beforeClickPause)

    await originalSelectText(selectOpts)

    // Backtrack triple-click events from the moment originalSelectText resolves.
    // Clamp start so events don't precede the prior animation (produces a visible
    // pre-click pause in the recording, which is acceptable).
    // All timestamps use a single base + integer * segmentMs to avoid FP drift.
    const selectEndMs = Date.now()
    const lastEventEndMs = innerEvents.at(-1)?.endMs ?? 0
    const tripleClickStartMs = Math.max(
      lastEventEndMs,
      selectEndMs - selectDuration
    )
    const segmentMs = selectDuration / 6
    for (let i = 0; i < 3; i++) {
      const seg = i * 2
      innerEvents.push({
        type: 'mouseDown',
        startMs: tripleClickStartMs + seg * segmentMs,
        endMs: tripleClickStartMs + (seg + 1) * segmentMs,
        easing: 'ease-in-out',
      })
      innerEvents.push({
        type: 'mouseUp',
        startMs: tripleClickStartMs + (seg + 1) * segmentMs,
        endMs: tripleClickStartMs + (seg + 2) * segmentMs,
        easing: 'ease-in-out',
      })
    }

    if (activeClickRecorder && innerEvents.length > 0) {
      activeClickRecorder.addInput('selectText', locatorRect, innerEvents)
    }
  }

  locator.dragTo = async (
    target: Locator,
    options?: Omit<NonNullable<Parameters<Locator['dragTo']>[1]>, 'steps'> & {
      moveDuration?: number
      moveSpeed?: number
      moveEasing?: Easing
      preDragPause?: number
      dragDuration?: number
      dragSpeed?: number
      dragEasing?: Easing
    }
  ): Promise<void> => {
    const {
      moveDuration,
      moveSpeed,
      moveEasing = 'ease-in-out',
      preDragPause = CLICK_DURATION_MS / 2,
      dragDuration,
      dragSpeed,
      dragEasing = 'ease-in-out',
      sourcePosition,
      targetPosition,
    } = options ?? {}

    assertDurationOrSpeed(moveDuration, moveSpeed, 'dragTo move')
    assertDurationOrSpeed(dragDuration, dragSpeed, 'dragTo drag')

    await sleep(PRE_ACTION_SLEEP)

    const page = locator.page()
    const mouseMoveInternal =
      originalMouseMoves.get(page) ?? page.mouse.move.bind(page.mouse)

    const moveStartTime = Date.now()
    const scrollAnimation = resolveScrollAnimationOptions()
    const sourceRect = await scrollTo(
      locator,
      Math.floor((locator.page().viewportSize()?.height ?? 0) / 2),
      scrollAnimation.easing,
      scrollAnimation.duration
    )
    const scrollElapsedMs = Date.now() - moveStartTime
    const targetBb = await target.boundingBox()
    const targetRect: ElementRect | undefined = targetBb
      ? {
          x: targetBb.x,
          y: targetBb.y,
          width: targetBb.width,
          height: targetBb.height,
        }
      : undefined

    const innerEvents: Array<
      MouseMoveEvent | MouseDownEvent | MouseUpEvent | MouseWaitEvent
    > = []

    const sourcePos =
      sourcePosition ??
      (sourceRect
        ? { x: sourceRect.width / 2, y: sourceRect.height / 2 }
        : undefined)

    const targetPos =
      targetPosition ??
      (targetRect
        ? { x: targetRect.width / 2, y: targetRect.height / 2 }
        : undefined)

    // 1. Animate cursor to source
    if (sourcePos && sourceRect) {
      const toX = sourceRect.x + sourcePos.x
      const toY = sourceRect.y + sourcePos.y
      const resolvedDuration = resolveMouseMoveDuration(page, toX, toY, {
        duration: moveDuration,
        speed: moveSpeed,
        defaultDuration: 1000,
        context: 'dragTo move',
      })
      const effectiveDuration = Math.max(0, resolvedDuration - scrollElapsedMs)
      innerEvents.push(
        await animateMouseMove(
          page,
          mouseMoveInternal,
          toX,
          toY,
          effectiveDuration,
          moveEasing,
          moveStartTime,
          sourceRect
        )
      )
    }

    // 2. preDragPause + mouseDown
    await sleep(preDragPause)
    const mouseDownStart = Date.now()
    await page.mouse.down()
    await sleep(CLICK_DURATION_MS / 2)
    innerEvents.push({
      type: 'mouseDown',
      startMs: mouseDownStart,
      endMs: Date.now(),
      easing: 'ease-in-out',
    })

    // 3. Drag: animate cursor from source to target
    const dragStartTime = Date.now()
    if (targetPos && targetRect) {
      const toX = targetRect.x + targetPos.x
      const toY = targetRect.y + targetPos.y
      const resolvedDuration = resolveMouseMoveDuration(page, toX, toY, {
        duration: dragDuration,
        speed: dragSpeed,
        defaultDuration: 1000,
        context: 'dragTo drag',
      })
      innerEvents.push(
        await animateMouseMove(
          page,
          mouseMoveInternal,
          toX,
          toY,
          resolvedDuration,
          dragEasing,
          dragStartTime,
          targetRect
        )
      )
    }

    // 4. mouseUp at target
    const mouseUpStart = Date.now()
    await page.mouse.up()
    await sleep(CLICK_DURATION_MS / 2)
    innerEvents.push({
      type: 'mouseUp',
      startMs: mouseUpStart,
      endMs: Date.now(),
      easing: 'ease-in-out',
    })

    const dragWaitStart = Date.now()
    await sleep(POST_ACTION_SLEEP)
    const dragWaitEnd = Date.now()
    innerEvents.push({
      type: 'mouseWait',
      startMs: dragWaitStart,
      endMs: dragWaitEnd,
    })

    if (activeClickRecorder && innerEvents.length > 0) {
      activeClickRecorder.addInput('dragTo', sourceRect, innerEvents)
    }
  }

  const originalPage = locator.page.bind(locator)
  ;(locator as unknown as { page(): ScreenCIPage }).page = (): ScreenCIPage =>
    originalPage() as unknown as ScreenCIPage

  instrumentLocatorMethods(locator)

  for (const method of LOCATOR_ONLY_SYNC_RETURN_METHODS) {
    const original = (locator as unknown as LocatorOnlySyncReturnMethodsRecord)[
      method
    ].bind(locator)
    ;(locator as unknown as LocatorOnlySyncReturnMethodsRecord)[method] = (
      ...args: unknown[]
    ): Locator => instrumentLocator(original(...args))
  }

  const originalAll = locator.all.bind(locator)
  locator.all = async (): Promise<Array<Locator>> => {
    const locators = await originalAll()
    return locators.map(instrumentLocator)
  }

  const originalContentFrame = (
    locator as unknown as { contentFrame: () => FrameLocator }
  ).contentFrame.bind(locator)
  ;(locator as unknown as { contentFrame: () => FrameLocator }).contentFrame =
    (): FrameLocator => instrumentFrameLocator(originalContentFrame())

  const originalLocatorFrameLocator = (
    locator as unknown as { frameLocator: (...args: unknown[]) => FrameLocator }
  ).frameLocator.bind(locator)
  ;(
    locator as unknown as { frameLocator: (...args: unknown[]) => FrameLocator }
  ).frameLocator = (...args: unknown[]): FrameLocator =>
    instrumentFrameLocator(originalLocatorFrameLocator(...args))

  return locator
}

export async function instrumentPage(page: Page): Promise<Page> {
  if (instrumented.has(page)) return page
  instrumented.add(page)

  // Expose a Node.js function to the browser that captures DOM click event data.
  // Called synchronously from the click handler before any navigation can occur.
  await page.exposeFunction('__screenciOnClick', (data: DOMClickData): void => {
    pendingClickData.set(page, data)
  })

  // Inject a capture listener on every page load (including after navigation).
  await page.addInitScript(() => {
    document.addEventListener(
      'click',
      (e: MouseEvent) => {
        const target = e.target as Element
        const r = target.getBoundingClientRect()
        ;(
          window as unknown as {
            __screenciOnClick: (data: unknown) => void
          }
        ).__screenciOnClick({
          x: e.clientX,
          y: e.clientY,
          targetRect: { x: r.x, y: r.y, width: r.width, height: r.height },
        })
      },
      { capture: true }
    )
  })

  instrumentLocatorMethods(page)

  const originalPageFrameLocator = (
    page as unknown as { frameLocator: (...args: unknown[]) => FrameLocator }
  ).frameLocator.bind(page)
  ;(
    page as unknown as { frameLocator: (...args: unknown[]) => FrameLocator }
  ).frameLocator = (...args: unknown[]): FrameLocator =>
    instrumentFrameLocator(originalPageFrameLocator(...args))

  // Delegate page.click to the instrumented locator so all click recording
  // flows through the same path.
  page.click = async (
    selector: string,
    options?: Parameters<Page['click']>[1] & {
      moveDuration?: number
      moveSpeed?: number
      beforeClickPause?: number
      moveEasing?: Easing
      postClickMove?: PostClickMove
    }
  ) => {
    return page.locator(selector).click(options)
  }

  // Instrument page.mouse to record mouse moves and visibility toggles.
  const originalMouse = page.mouse
  const originalMove = originalMouse.move.bind(originalMouse)
  originalMouseMoves.set(page, originalMove)
  ;(
    originalMouse as unknown as {
      move: (
        x: number,
        y: number,
        options?: {
          steps?: number
          duration?: number
          speed?: number
          easing?: Easing
        }
      ) => Promise<void>
    }
  ).move = async (
    x: number,
    y: number,
    options?: {
      steps?: number
      duration?: number
      speed?: number
      easing?: Easing
    }
  ) => {
    const duration = resolveMouseMoveDuration(page, x, y, {
      duration: options?.duration,
      speed: options?.speed,
      defaultDuration: 0,
      context: 'page.mouse.move',
    })
    const easing = options?.easing ?? 'ease-in-out'
    const startMs = Date.now()

    if (duration > 0) {
      const startPos = mousePositions.get(page) ?? { x: 0, y: 0 }
      const steps = Math.max(1, Math.floor(duration / CURSOR_STEP_MS))
      const stepMs = duration / steps

      for (let i = 0; i <= steps; i++) {
        const t = i / steps
        const easedT = evaluateEasingAtT(t, easing)
        const cx = startPos.x + easedT * (x - startPos.x)
        const cy = startPos.y + easedT * (y - startPos.y)
        await originalMove(cx, cy)
        if (i < steps) {
          await new Promise<void>((resolve) => setTimeout(resolve, stepMs))
        }
      }
    } else {
      await originalMove(x, y)
    }

    mousePositions.set(page, { x, y })
    const endMs = Date.now()

    if (activeClickRecorder) {
      // Auto-show cursor when moving after a typing auto-hide
      if (!(mouseVisibilities.get(page) ?? true)) {
        mouseVisibilities.set(page, true)
        const showMs = startMs
        const showEvent: MouseShowEvent = {
          type: 'mouseShow',
          startMs: showMs,
          endMs: showMs,
        }
        activeClickRecorder.addInput('mouseShow', undefined, [showEvent])
      }
      const moveEvent: MouseMoveEvent = {
        type: 'mouseMove',
        startMs,
        endMs,
        duration,
        x,
        y,
        ...(duration > 0 ? { easing } : {}),
      }
      activeClickRecorder.addInput('mouseMove', undefined, [moveEvent])
    }
  }

  mouseVisibilities.set(page, true)
  ;(originalMouse as unknown as { show: () => void }).show = () => {
    if (!(mouseVisibilities.get(page) ?? true)) {
      mouseVisibilities.set(page, true)
      if (activeClickRecorder) {
        const timeMs = Date.now()
        const showEvent: MouseShowEvent = {
          type: 'mouseShow',
          startMs: timeMs,
          endMs: timeMs,
        }
        activeClickRecorder.addInput('mouseShow', undefined, [showEvent])
      }
    }
  }
  ;(originalMouse as unknown as { hide: () => void }).hide = () => {
    if (mouseVisibilities.get(page) ?? true) {
      mouseVisibilities.set(page, false)
      if (activeClickRecorder) {
        const timeMs = Date.now()
        const hideEvent: MouseHideEvent = {
          type: 'mouseHide',
          startMs: timeMs,
          endMs: timeMs,
        }
        activeClickRecorder.addInput('mouseHide', undefined, [hideEvent])
      }
    }
  }

  page.on('popup', (popup) => {
    void instrumentPage(popup)
  })

  return page
}

export function instrumentContext(context: BrowserContext): BrowserContext {
  if (instrumented.has(context)) return context
  instrumented.add(context)

  const originalNewPage = context.newPage.bind(context)
  context.newPage = async (...args: Parameters<BrowserContext['newPage']>) => {
    return instrumentPage(await originalNewPage(...args))
  }

  return context
}

export function instrumentBrowser(browser: Browser): Browser {
  if (instrumented.has(browser)) return browser
  instrumented.add(browser)

  const originalNewContext = browser.newContext.bind(browser)
  browser.newContext = async (...args: Parameters<Browser['newContext']>) => {
    return instrumentContext(await originalNewContext(...args))
  }

  const originalNewPage = browser.newPage.bind(browser)
  browser.newPage = async (...args: Parameters<Browser['newPage']>) => {
    return instrumentPage(await originalNewPage(...args))
  }

  return browser
}
