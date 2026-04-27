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
  FocusChangeEvent,
  MouseMoveEvent,
  MouseDownEvent,
  MouseUpEvent,
  MouseShowEvent,
  MouseHideEvent,
  MouseWaitEvent,
} from './events.js'
import type {
  ClickBeforeFillOption,
  AutoZoomOptions,
  Easing,
  PostClickMove,
  ScreenCIPage,
} from './types.js'
import { logger } from './logger.js'
import { isInsideHide } from './hide.js'
import { changeFocus } from './changeFocus.js'
import {
  CLICK_DURATION_MS,
  assertDurationOrSpeed,
  buildMouseDownEvent,
  buildMouseUpEvent,
  getOriginalMouseClick,
  getOriginalMouseDown,
  getOriginalMouseHide,
  getMousePosition,
  getOriginalMouseMove,
  getOriginalMouseShow,
  getOriginalMouseUp,
  isMouseVisible,
  performMouseClick,
  performMouseDown,
  performMouseHide,
  performMouseMove,
  performMouseShow,
  performMouseUp,
  resolveMouseMoveDuration,
  setMousePosition,
  setMouseVisible,
  setOriginalMouseClick,
  setOriginalMouseDown,
  setOriginalMouseHide,
  setOriginalMouseMove,
  setOriginalMouseShow,
  setOriginalMouseUp,
} from './mouse.js'

let activeClickRecorder: IEventRecorder | null = null

export function setActiveClickRecorder(recorder: IEventRecorder | null): void {
  activeClickRecorder = recorder
}

const instrumented = new WeakSet<object>()

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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

function getRecordedInnerEventEndMs(
  event:
    | FocusChangeEvent
    | MouseMoveEvent
    | MouseDownEvent
    | MouseUpEvent
    | MouseHideEvent
    | MouseWaitEvent
): number {
  if (event.type === 'focusChange') {
    return Math.max(
      ...(event.mouse ? [event.mouse.endMs] : []),
      ...(event.scroll ? [event.scroll.endMs] : []),
      ...(event.zoom ? [event.zoom.endMs] : [])
    )
  }
  return event.endMs
}

type ClickActionResult = {
  elementRect: ElementRect
  innerEvents: Array<
    | FocusChangeEvent
    | MouseMoveEvent
    | MouseDownEvent
    | MouseUpEvent
    | MouseWaitEvent
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
  autoZoomOptions?: AutoZoomOptions,
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
  const mouseMoveInternal = getOriginalMouseMove(
    page,
    page.mouse.move.bind(page.mouse)
  )

  const innerEvents: Array<
    FocusChangeEvent | MouseMoveEvent | MouseDownEvent | MouseUpEvent
  > = []

  const locatorRectPreview = await locator.boundingBox()
  const targetPos = position
    ? position
    : locatorRectPreview
      ? {
          x: locatorRectPreview.width / 2,
          y: locatorRectPreview.height / 2,
        }
      : undefined

  const mouseMovePlan =
    targetPos && locatorRectPreview
      ? {
          page,
          mouseMoveInternal,
          startViewportPos: getMousePosition(page) ?? { x: 0, y: 0 },
          targetPosInElement: targetPos,
          ...(moveDuration !== undefined ? { duration: moveDuration } : {}),
          ...(moveSpeed !== undefined ? { speed: moveSpeed } : {}),
          defaultDuration: 1000,
          context: 'click move',
          easing: moveEasing,
        }
      : undefined

  const scrollResult = await changeFocus(
    locator,
    autoZoomOptions,
    mouseMovePlan
  )
  const focusChange = scrollResult
  const locatorRect = focusChange.elementRect
  if (!locatorRect) {
    logger.warn(
      '[screenci] Unable to get locator bounding box; skipping auto-scroll check.'
    )
  }

  innerEvents.push(focusChange)
  setMousePosition(page, {
    x: focusChange.x,
    y: focusChange.y,
  })

  await sleep(beforeClickPause)

  await new Promise<void>((resolve) => setTimeout(resolve, halfClickDuration))
  const clickTime = Date.now()

  const didScroll =
    locatorRectPreview !== null &&
    locatorRect !== undefined &&
    (locatorRectPreview.x !== locatorRect.x ||
      locatorRectPreview.y !== locatorRect.y ||
      locatorRectPreview.width !== locatorRect.width ||
      locatorRectPreview.height !== locatorRect.height)

  if (
    didScroll &&
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
      ...(clickOptions?.delay !== undefined
        ? { delay: clickOptions.delay }
        : {}),
    }
    const [mouseDownEvent, mouseUpEvent] = await performMouseClick({
      page,
      mouseClickInternal: getOriginalMouseClick(
        page,
        page.mouse.click.bind(page.mouse)
      ),
      x: locatorRect.x + targetPos.x,
      y: locatorRect.y + targetPos.y,
      clickOptions: mouseClickOptions,
    })
    innerEvents.push(mouseDownEvent)
    innerEvents.push(mouseUpEvent)
  } else {
    innerEvents.push(
      buildMouseDownEvent({
        startMs: clickTime - halfClickDuration,
        endMs: clickTime,
        easing: 'ease-in-out',
      })
    )
    await doClick({
      ...clickOptions,
      ...(targetPos ? { position: targetPos } : {}),
    })
    innerEvents.push(
      buildMouseUpEvent({
        startMs: clickTime,
        endMs: clickTime + halfClickDuration,
        easing: 'ease-in-out',
      })
    )
  }
  const domClickData = pendingClickData.get(page)

  if (domClickData) {
    const lastMouseMoveIndex = innerEvents.findIndex(
      (e) => e.type === 'focusChange' || e.type === 'mouseMove'
    )
    if (lastMouseMoveIndex !== -1) {
      const existingMove = innerEvents[lastMouseMoveIndex]
      if (
        existingMove?.type === 'focusChange' ||
        existingMove?.type === 'mouseMove'
      ) {
        innerEvents[lastMouseMoveIndex] = {
          ...existingMove,
          x: domClickData.x,
          y: domClickData.y,
          elementRect: domClickData.targetRect,
        }
      }
    }

    setMousePosition(page, { x: domClickData.x, y: domClickData.y })
  }
  await new Promise<void>((resolve) => setTimeout(resolve, halfClickDuration))

  await new Promise<void>((resolve) => setTimeout(resolve, postClickPause))

  // Animate mouse cursor in the specified direction after the click completes,
  // capturing start/end times and final position for the recorded event.
  if (postClickMove !== undefined) {
    const currentPos = getMousePosition(page) ?? { x: 0, y: 0 }
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
      const startMs = Date.now()
      await performMouseMove({
        page,
        mouseMoveInternal,
        targetX,
        targetY,
        duration,
        easing,
      })
      innerEvents.push({
        type: 'focusChange',
        x: targetX,
        y: targetY,
        mouse: {
          startMs,
          endMs: Date.now(),
          ...(duration > 0 ? { easing } : {}),
        },
      })
    }
  }

  let elementRect: ElementRect | undefined
  if (domClickData) {
    elementRect = domClickData.targetRect
  } else if (locatorRect) {
    elementRect = locatorRect ?? undefined
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

async function performSimpleAction(
  locator: Locator,
  doAction: (options: SimpleActionOptions) => Promise<void>,
  options: SimpleActionOptions,
  subType: 'tap' | 'check' | 'uncheck' | 'select',
  clickOpt?: ClickBeforeFillOption,
  autoZoomOptions?: AutoZoomOptions,
  position?: { x: number; y: number },
  recordMousePress = subType === 'tap'
): Promise<void> {
  let innerEvents: Array<
    | FocusChangeEvent
    | MouseMoveEvent
    | MouseDownEvent
    | MouseUpEvent
    | MouseWaitEvent
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
      autoZoomOptions,
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
    if (subType === 'select') {
      await doAction(options)
    }
  } else {
    const focusChange = await changeFocus(locator, autoZoomOptions)
    const locatorRect = focusChange.elementRect
    innerEvents.push(focusChange)

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
    elementRect = locatorRect ?? undefined

    if (recordMousePress) {
      const midTime = (startTime + endTime) / 2
      innerEvents.push(
        buildMouseDownEvent({ startMs: startTime, endMs: midTime })
      )
      innerEvents.push(buildMouseUpEvent({ startMs: midTime, endMs: endTime }))
    }
  }

  if (activeClickRecorder && innerEvents.length > 0) {
    activeClickRecorder.addInput(subType, elementRect, innerEvents)
  }
}

async function recordedClick(
  locator: Locator,
  doClick: (options: Parameters<Locator['click']>[0]) => Promise<void>,
  clickOptions: Parameters<Locator['click']>[0] & {
    autoZoomOptions?: AutoZoomOptions
  },
  autoZoomOptions?: AutoZoomOptions,
  position?: { x: number; y: number },
  moveDuration?: number,
  moveSpeed?: number,
  beforeClickPause = CLICK_DURATION_MS / 2,
  moveEasing: Easing = 'ease-in-out',
  postClickPause = CLICK_DURATION_MS / 2,
  postClickMove?: PostClickMove
): Promise<void> {
  const result = await performClickActions(
    locator,
    doClick,
    clickOptions,
    autoZoomOptions,
    position,
    moveDuration,
    moveSpeed,
    beforeClickPause,
    moveEasing,
    postClickPause,
    postClickMove
  )
  if (activeClickRecorder && result) {
    activeClickRecorder.addInput('click', undefined, result.innerEvents)
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
      autoZoomOptions?: AutoZoomOptions
    }
  ) => {
    const {
      moveDuration,
      moveSpeed,
      beforeClickPause,
      moveEasing,
      postClickPause,
      postClickMove,
      autoZoomOptions,
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
      autoZoomOptions,
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
    autoZoomOptions?: AutoZoomOptions
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
      autoZoomOptions,
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

    const innerEvents: Array<
      | FocusChangeEvent
      | MouseMoveEvent
      | MouseDownEvent
      | MouseUpEvent
      | MouseHideEvent
      | MouseWaitEvent
    > = []
    let elementRect: ElementRect | undefined = undefined

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
        options.autoZoomOptions,
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
      const scrollResult = await changeFocus(locator, options?.autoZoomOptions)
      const locatorRect = scrollResult.elementRect
      const focusChange = scrollResult
      if (focusChange) {
        innerEvents.push(focusChange)
      }

      elementRect = locatorRect ?? undefined
    }

    // Hide cursor while typing (will be shown again on next mouse move)
    const page = locator.page()
    const shouldHideMouse = options?.hideMouse === true
    if (shouldHideMouse) {
      const cursorVisible = isMouseVisible(page)
      if (cursorVisible) {
        setMouseVisible(page, false)
        const hideMs = Date.now()
        innerEvents.push({
          type: 'mouseHide',
          startMs: hideMs,
          endMs: hideMs,
        })
      }
    }

    const typeStartMs = Date.now()
    await originalPressSequentially(
      text,
      pressOptions as Parameters<Locator['pressSequentially']>[1]
    )

    innerEvents.push({
      type: 'mouseWait',
      startMs: typeStartMs,
      endMs: Date.now(),
    })

    if (activeClickRecorder) {
      activeClickRecorder.addInput('pressSequentially', innerEvents)
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
      autoZoomOptions?: AutoZoomOptions
    }
  ) => {
    if (isInsideHide()) {
      const {
        duration: _duration,
        click: _click,
        position: _position,
        hideMouse: _hideMouse,
        autoZoomOptions: _autoZoomOptions,
        ...fillOptions
      } = options ?? {}

      return originalFill(value, fillOptions as Parameters<Locator['fill']>[1])
    }

    if (options?.click !== undefined) {
      const clickActionResult = await performClickActions(
        locator,
        (clickOptions) => originalClick(clickOptions),
        {},
        options.autoZoomOptions,
        options.position,
        options.click.moveDuration,
        options.click.moveSpeed,
        options.click.beforeClickPause,
        options.click.moveEasing,
        options.click.postClickPause,
        options.click.postClickMove
      )

      const innerEvents: Array<
        | FocusChangeEvent
        | MouseMoveEvent
        | MouseDownEvent
        | MouseUpEvent
        | MouseHideEvent
        | MouseWaitEvent
      > = [...(clickActionResult?.innerEvents ?? [])]
      const elementRect = clickActionResult?.elementRect
      const page = locator.page()

      if (options.hideMouse === true) {
        const cursorVisible = isMouseVisible(page)
        if (cursorVisible) {
          setMouseVisible(page, false)
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
      const typeStartMs = Date.now()
      await page.keyboard.type(value, { delay })
      innerEvents.push({
        type: 'mouseWait',
        startMs: typeStartMs,
        endMs: Date.now(),
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

    const page = locator.page()
    const innerEvents: Array<
      FocusChangeEvent | MouseHideEvent | MouseWaitEvent
    > = []
    const fillOptions = options ?? {}

    let elementRect: ElementRect | undefined

    if (fillOptions.hideMouse === true) {
      const cursorVisible = isMouseVisible(page)
      if (cursorVisible) {
        setMouseVisible(page, false)
        const hideMs = Date.now()
        innerEvents.push({
          type: 'mouseHide',
          startMs: hideMs,
          endMs: hideMs,
        })
      }
    }

    const scrollResult = await changeFocus(locator, options?.autoZoomOptions)
    const locatorRect = scrollResult.elementRect
    const focusChange = scrollResult

    if (focusChange) {
      innerEvents.push(focusChange)
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

    const duration = fillOptions.duration ?? 1000
    const delay = value.length > 0 ? duration / value.length : 0
    const typeStartMs = Date.now()
    await page.keyboard.type(value, { delay })
    innerEvents.push({
      type: 'mouseWait',
      startMs: typeStartMs,
      endMs: Date.now(),
    })

    if (activeClickRecorder && innerEvents.length > 0) {
      activeClickRecorder.addInput(
        'pressSequentially',
        elementRect,
        innerEvents
      )
    }

    return
  }

  const originalTap = locator.tap.bind(locator)
  locator.tap = async (
    options?: Parameters<Locator['tap']>[0] & {
      click?: ClickBeforeFillOption
      autoZoomOptions?: AutoZoomOptions
    }
  ): Promise<void> => {
    const clickOpt = options?.click
    const {
      click: _click,
      position,
      autoZoomOptions,
      ...tapOpts
    } = options ?? {}
    return performSimpleAction(
      locator,
      (options: Parameters<Locator['tap']>[0]) => originalTap(options),
      tapOpts as Parameters<Locator['tap']>[0],
      'tap',
      clickOpt,
      autoZoomOptions,
      position
    )
  }

  const originalCheck = locator.check.bind(locator)
  locator.check = async (
    options?: Parameters<Locator['check']>[0] & {
      click?: ClickBeforeFillOption
      autoZoomOptions?: AutoZoomOptions
    }
  ): Promise<void> => {
    const clickOpt = options?.click
    const position = options?.position
    const { click: _click, autoZoomOptions, ...checkOpts } = options ?? {}

    if (isInsideHide()) {
      return originalCheck(checkOpts as Parameters<Locator['check']>[0])
    }

    return performSimpleAction(
      locator,
      (options: Parameters<Locator['check']>[0]) => originalCheck(options),
      checkOpts as Parameters<Locator['check']>[0],
      'check',
      clickOpt,
      autoZoomOptions,
      position,
      false
    )
  }

  const originalUncheck = locator.uncheck.bind(locator)
  locator.uncheck = async (
    options?: Parameters<Locator['uncheck']>[0] & {
      click?: ClickBeforeFillOption
      autoZoomOptions?: AutoZoomOptions
    }
  ): Promise<void> => {
    const clickOpt = options?.click
    const position = options?.position
    const { click: _click, autoZoomOptions, ...uncheckOpts } = options ?? {}

    if (isInsideHide()) {
      return originalUncheck(uncheckOpts as Parameters<Locator['uncheck']>[0])
    }

    return performSimpleAction(
      locator,
      (options: Parameters<Locator['uncheck']>[0]) => originalUncheck(options),
      uncheckOpts as Parameters<Locator['uncheck']>[0],
      'uncheck',
      clickOpt,
      autoZoomOptions,
      position,
      false
    )
  }

  locator.setChecked = async (
    checked: boolean,
    options?: Parameters<Locator['check']>[0] & {
      click?: ClickBeforeFillOption
      autoZoomOptions?: AutoZoomOptions
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
      autoZoomOptions?: AutoZoomOptions
    }
  ): Promise<string[]> => {
    const clickOpt = options?.click
    const {
      click: _click,
      position,
      autoZoomOptions,
      ...selectOpts
    } = options ?? {}

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
      autoZoomOptions,
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
      autoZoomOptions?: AutoZoomOptions
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
    const mouseMoveInternal = getOriginalMouseMove(
      page,
      page.mouse.move.bind(page.mouse)
    )

    const innerEvents: Array<
      FocusChangeEvent | MouseMoveEvent | MouseWaitEvent
    > = []

    const locatorRectPreview = await locator.boundingBox()
    const hasLocatorRectPreview = locatorRectPreview !== null
    const targetPos =
      position ??
      (hasLocatorRectPreview
        ? { x: locatorRectPreview.width / 2, y: locatorRectPreview.height / 2 }
        : undefined)

    const mouseMovePlan =
      targetPos && hasLocatorRectPreview
        ? {
            page,
            mouseMoveInternal,
            startViewportPos: getMousePosition(page) ?? { x: 0, y: 0 },
            targetPosInElement: targetPos,
            ...(moveDuration !== undefined ? { duration: moveDuration } : {}),
            ...(moveSpeed !== undefined ? { speed: moveSpeed } : {}),
            defaultDuration: 1000,
            context: 'hover move',
            easing: moveEasing,
          }
        : undefined

    const hoverFocusChange = await changeFocus(
      locator,
      options?.autoZoomOptions,
      mouseMovePlan
    )
    const locatorRect = hoverFocusChange.elementRect

    innerEvents.push(hoverFocusChange)
    setMousePosition(page, {
      x: hoverFocusChange.x,
      y: hoverFocusChange.y,
    })

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
    const mouseMoveInternal = getOriginalMouseMove(
      page,
      page.mouse.move.bind(page.mouse)
    )

    const innerEvents: Array<
      FocusChangeEvent | MouseMoveEvent | MouseDownEvent | MouseUpEvent
    > = []

    const locatorRectPreview = await locator.boundingBox()
    const targetPos = locatorRectPreview
      ? { x: locatorRectPreview.width / 2, y: locatorRectPreview.height / 2 }
      : undefined

    const mouseMovePlan =
      targetPos && locatorRectPreview
        ? {
            page,
            mouseMoveInternal,
            startViewportPos: getMousePosition(page) ?? { x: 0, y: 0 },
            targetPosInElement: targetPos,
            ...(moveDuration !== undefined ? { duration: moveDuration } : {}),
            ...(moveSpeed !== undefined ? { speed: moveSpeed } : {}),
            defaultDuration: 1000,
            context: 'selectText move',
            easing: moveEasing,
          }
        : undefined

    const selectFocusChange = await changeFocus(
      locator,
      undefined,
      mouseMovePlan
    )
    const locatorRect = selectFocusChange.elementRect

    innerEvents.push(selectFocusChange)
    setMousePosition(page, {
      x: selectFocusChange.x,
      y: selectFocusChange.y,
    })

    await sleep(beforeClickPause)

    await originalSelectText(selectOpts)

    // Backtrack triple-click events from the moment originalSelectText resolves.
    // Clamp start so events don't precede the prior animation (produces a visible
    // pre-click pause in the recording, which is acceptable).
    // All timestamps use a single base + integer * segmentMs to avoid FP drift.
    const selectEndMs = Date.now()
    const lastEventEndMs = innerEvents.at(-1)
      ? getRecordedInnerEventEndMs(innerEvents.at(-1)!)
      : 0
    const tripleClickStartMs = Math.max(
      lastEventEndMs,
      selectEndMs - selectDuration
    )
    const segmentMs = selectDuration / 6
    for (let i = 0; i < 3; i++) {
      const seg = i * 2
      innerEvents.push(
        buildMouseDownEvent({
          startMs: tripleClickStartMs + seg * segmentMs,
          endMs: tripleClickStartMs + (seg + 1) * segmentMs,
          easing: 'ease-in-out',
        })
      )
      innerEvents.push(
        buildMouseUpEvent({
          startMs: tripleClickStartMs + (seg + 1) * segmentMs,
          endMs: tripleClickStartMs + (seg + 2) * segmentMs,
          easing: 'ease-in-out',
        })
      )
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

    const page = locator.page()
    const mouseMoveInternal = getOriginalMouseMove(
      page,
      page.mouse.move.bind(page.mouse)
    )

    const sourceRectPreview = await locator.boundingBox()
    const sourceRect = (await changeFocus(locator)).elementRect
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
      | FocusChangeEvent
      | MouseMoveEvent
      | MouseDownEvent
      | MouseUpEvent
      | MouseWaitEvent
    > = []

    const targetPos =
      targetPosition ??
      (targetRect
        ? { x: targetRect.width / 2, y: targetRect.height / 2 }
        : undefined)

    if (sourceRect) {
      const sourceTargetPos = sourcePosition
        ? sourcePosition
        : { x: sourceRect.width / 2, y: sourceRect.height / 2 }
      const sourceX = sourceRect.x + sourceTargetPos.x
      const sourceY = sourceRect.y + sourceTargetPos.y
      const resolvedDuration = resolveMouseMoveDuration(
        page,
        sourceX,
        sourceY,
        {
          duration: moveDuration,
          speed: moveSpeed,
          defaultDuration: 1000,
          context: 'dragTo move',
        }
      )
      const startMs = Date.now()
      await performMouseMove({
        page,
        mouseMoveInternal,
        targetX: sourceX,
        targetY: sourceY,
        duration: resolvedDuration,
        easing: moveEasing,
      })

      innerEvents.push({
        type: 'mouseMove',
        startMs,
        endMs: Date.now(),
        duration: Date.now() - startMs,
        x: sourceX,
        y: sourceY,
        ...(resolvedDuration > 0 ? { easing: moveEasing } : {}),
      })
    }

    // 2. preDragPause + mouseDown
    await sleep(preDragPause)
    const mouseDownStart = Date.now()
    await performMouseDown({
      mouseDownInternal: getOriginalMouseDown(
        page,
        page.mouse.down.bind(page.mouse)
      ),
    })
    await sleep(CLICK_DURATION_MS / 2)
    innerEvents.push(
      buildMouseDownEvent({
        startMs: mouseDownStart,
        endMs: Date.now(),
        easing: 'ease-in-out',
      })
    )

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
      await performMouseMove({
        page,
        mouseMoveInternal,
        targetX: toX,
        targetY: toY,
        duration: resolvedDuration,
        easing: dragEasing,
      })
      innerEvents.push({
        type: 'mouseMove',
        startMs: dragStartTime,
        endMs: Date.now(),
        duration: Date.now() - dragStartTime,
        x: toX,
        y: toY,
        ...(resolvedDuration > 0 ? { easing: dragEasing } : {}),
        elementRect: targetRect,
      })
    }

    // 4. mouseUp at target
    const mouseUpStart = Date.now()
    await performMouseUp({
      mouseUpInternal: getOriginalMouseUp(page, page.mouse.up.bind(page.mouse)),
    })
    await sleep(CLICK_DURATION_MS / 2)
    innerEvents.push(
      buildMouseUpEvent({
        startMs: mouseUpStart,
        endMs: Date.now(),
        easing: 'ease-in-out',
      })
    )

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
  const originalDown = originalMouse.down.bind(originalMouse)
  const originalUp = originalMouse.up.bind(originalMouse)
  const originalClickMethod = (
    originalMouse as unknown as {
      click?: (
        x: number,
        y: number,
        options?: {
          button?: 'left' | 'right' | 'middle'
          clickCount?: number
          delay?: number
        }
      ) => Promise<void>
    }
  ).click
  const originalClick =
    typeof originalClickMethod === 'function'
      ? originalClickMethod.bind(originalMouse)
      : async (
          x: number,
          y: number,
          options?: {
            button?: 'left' | 'right' | 'middle'
            clickCount?: number
            delay?: number
          }
        ) => {
          await originalMove(x, y)
          await originalDown(options)
          if (options?.delay) {
            await sleep(options.delay)
          }
          await originalUp(options)
        }
  const originalShowMethod = (originalMouse as unknown as { show?: () => void })
    .show
  const originalHideMethod = (originalMouse as unknown as { hide?: () => void })
    .hide
  const originalShow =
    typeof originalShowMethod === 'function'
      ? originalShowMethod.bind(originalMouse)
      : () => {}
  const originalHide =
    typeof originalHideMethod === 'function'
      ? originalHideMethod.bind(originalMouse)
      : () => {}

  setOriginalMouseMove(page, originalMove)
  setOriginalMouseClick(page, originalClick)
  setOriginalMouseDown(page, originalDown)
  setOriginalMouseUp(page, originalUp)
  setOriginalMouseShow(page, originalShow)
  setOriginalMouseHide(page, originalHide)
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
    await performMouseMove({
      page,
      mouseMoveInternal: originalMove,
      targetX: x,
      targetY: y,
      duration,
      easing,
    })
    const moveEvent: FocusChangeEvent = {
      type: 'focusChange',
      x,
      y,
      mouse: {
        startMs,
        endMs: Date.now(),
        ...(duration > 0 ? { easing } : {}),
      },
    }

    if (activeClickRecorder) {
      // Auto-show cursor when moving after a typing auto-hide
      if (!isMouseVisible(page)) {
        setMouseVisible(page, true)
        const showMs = startMs
        const showEvent: MouseShowEvent = {
          type: 'mouseShow',
          startMs: showMs,
          endMs: showMs,
        }
        activeClickRecorder.addInput('mouseShow', undefined, [showEvent])
      }
      activeClickRecorder.addInput('focusChange', undefined, [moveEvent])
    }
  }

  setMouseVisible(page, true)
  ;(originalMouse as unknown as { show: () => void }).show = () => {
    if (!isMouseVisible(page)) {
      performMouseShow({
        mouseShowInternal: getOriginalMouseShow(page, originalShow),
        page,
      })
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
    if (isMouseVisible(page)) {
      performMouseHide({
        mouseHideInternal: getOriginalMouseHide(page, originalHide),
        page,
      })
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
