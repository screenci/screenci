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
import { NOOP_EVENT_RECORDER } from './events.js'
import type { AutoZoomOptions, Easing, ScreenCIPage } from './types.js'
import { isInsideHide } from './hide.js'
import { changeFocus, type MouseMoveRequest } from './changeFocus.js'
import { DEFAULT_CLICK_MOUSE_MOVE_DURATION } from './defaults.js'
import {
  CLICK_DURATION_MS,
  assertDurationOrSpeed,
  buildMouseDownEvent,
  buildMouseUpEvent,
  getOriginalLocatorCheck,
  getOriginalLocatorClick,
  getOriginalLocatorSelect,
  getOriginalLocatorTap,
  getOriginalLocatorUncheck,
  getOriginalMouseDown,
  getOriginalMouseHide,
  getOriginalMouseShow,
  getOriginalMouseUp,
  isMouseVisible,
  type MouseClickInteractionType,
  performMouseClickAction,
  performMouseDown,
  performMouseHide,
  performMouseMove,
  performMouseShow,
  performMouseUp,
  resolveMouseMoveDuration,
  setPerformanceIntervals,
  setOriginalLocatorCheck,
  setOriginalLocatorClick,
  setOriginalLocatorSelect,
  setOriginalLocatorTap,
  setOriginalLocatorUncheck,
  setMouseVisible,
  setOriginalMouseClick,
  setOriginalMouseDown,
  setOriginalMouseHide,
  setOriginalMouseMove,
  setOriginalMouseShow,
  setOriginalMouseUp,
} from './mouse.js'
import {
  resolveRecordingTimingDuration,
  shouldSimulateRecordingTimings,
} from './runtimeMode.js'
import {
  getRuntimeClickRecorder,
  setRuntimeClickRecorder,
} from './runtimeContext.js'

const pageClickRecorders = new WeakMap<object, IEventRecorder>()

const DEFAULT_PRE_CLICK_PAUSE_MS = 50
const DEFAULT_POST_CLICK_PAUSE_MS = 300
const DEFAULT_POST_TYPING_SETTLE_PAUSE_MS = CLICK_DURATION_MS / 2

export function setActiveClickRecorder(recorder: IEventRecorder | null): void {
  setRuntimeClickRecorder(recorder)
}

export function bindClickRecorderToPage(
  page: object,
  recorder: IEventRecorder | null
): void {
  const resolved = recorder ?? NOOP_EVENT_RECORDER
  pageClickRecorders.set(page, resolved)
  setPerformanceIntervals(page, resolved.getPerformanceIntervals())
}

function getActiveClickRecorder(page?: object): IEventRecorder {
  if (page !== undefined && pageClickRecorders.has(page)) {
    return pageClickRecorders.get(page)!
  }

  return getRuntimeClickRecorder()
}

const instrumented = new WeakSet<object>()

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) =>
    setTimeout(resolve, resolveRecordingTimingDuration(ms))
  )
}

function withDefaultNoWaitAfter<T extends object>(
  options?: T
): T & { noWaitAfter: boolean } {
  const optionsWithNoWaitAfter = options as
    | (T & { noWaitAfter?: boolean })
    | undefined

  if (
    optionsWithNoWaitAfter &&
    typeof optionsWithNoWaitAfter.noWaitAfter === 'boolean'
  ) {
    return optionsWithNoWaitAfter as T & { noWaitAfter: boolean }
  }

  return {
    ...options,
    noWaitAfter: true,
  } as T & { noWaitAfter: boolean }
}

function buildDefaultClickMouseMoveRequest(options?: {
  targetPosInElement?: { x: number; y: number } | undefined
  moveDuration?: number | undefined
  moveSpeed?: number | undefined
  moveEasing?: Easing | undefined
}): MouseMoveRequest {
  return {
    ...(options?.targetPosInElement !== undefined
      ? { targetPosInElement: options.targetPosInElement }
      : {}),
    ...(options?.moveDuration !== undefined
      ? { duration: options.moveDuration }
      : options?.moveSpeed === undefined
        ? { duration: DEFAULT_CLICK_MOUSE_MOVE_DURATION }
        : {}),
    ...(options?.moveSpeed !== undefined ? { speed: options.moveSpeed } : {}),
    easing: options?.moveEasing ?? 'ease-in-out',
  }
}

async function appendMouseWait(
  innerEvents: ClickActionResult['innerEvents'],
  durationMs: number
): Promise<void> {
  if (durationMs <= 0) return
  const startMs = Date.now()
  await sleep(durationMs)
  innerEvents.push({
    type: 'mouseWait',
    startMs,
    endMs: Date.now(),
  })
}

async function appendPostTypingSettleWait(
  innerEvents: ClickActionResult['innerEvents']
): Promise<void> {
  if (!shouldSimulateRecordingTimings()) return
  await appendMouseWait(innerEvents, DEFAULT_POST_TYPING_SETTLE_PAUSE_MS)
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

type ClickActionResult = {
  elementRect: ElementRect
  innerEvents: Array<
    | FocusChangeEvent
    | MouseMoveEvent
    | MouseDownEvent
    | MouseUpEvent
    | MouseWaitEvent
    | MouseHideEvent
  >
}

type ResolvedLocatorMouseAction = {
  doClick: Parameters<typeof performMouseClickAction>[0]['doClick']
  supportsTrial: boolean
}

function resolveLocatorMouseAction(
  locator: Locator,
  interactionType: MouseClickInteractionType
): ResolvedLocatorMouseAction {
  switch (interactionType) {
    case 'click': {
      const action = getOriginalLocatorClick(locator)
      if (action) return { doClick: action, supportsTrial: true }
      break
    }
    case 'tap': {
      const action = getOriginalLocatorTap(locator)
      if (action) return { doClick: action, supportsTrial: true }
      break
    }
    case 'check': {
      const action = getOriginalLocatorCheck(locator)
      if (action) return { doClick: action, supportsTrial: true }
      break
    }
    case 'uncheck': {
      const action = getOriginalLocatorUncheck(locator)
      if (action) return { doClick: action, supportsTrial: true }
      break
    }
    case 'select': {
      const action = getOriginalLocatorSelect(locator)
      if (action) {
        return {
          doClick: (options) =>
            action(
              null,
              options as Parameters<Locator['selectOption']>[1]
            ).then(() => {}),
          supportsTrial: false,
        }
      }
      break
    }
    default: {
      const _: never = interactionType
      throw new Error(`Unknown mouse click interaction type: ${_}`)
    }
  }

  throw new Error(
    `[screenci] Missing original locator action for '${interactionType}'.`
  )
}

async function performAction(
  mouseMoveRequest: MouseMoveRequest | undefined,
  locator: Locator,
  doClick: Parameters<typeof performMouseClickAction>[0]['doClick'],
  supportsTrial: boolean,
  mode: 'singleBefore' | 'tripleBefore' | 'singleDuring',
  autoZoomOptions?: AutoZoomOptions,
  position?: { x: number; y: number },
  noWaitAfter?: boolean,
  beforeClickPause = 0,
  postClickPause = 0,
  shouldHideMouse = false,
  selectDuration?: number
): Promise<ClickActionResult | null> {
  const focusChange = await changeFocus(
    locator,
    autoZoomOptions,
    mouseMoveRequest
  )
  const elementRect = focusChange.elementRect
  const innerEvents: ClickActionResult['innerEvents'] = [focusChange]
  const targetPosition =
    position ??
    (elementRect
      ? {
          x: elementRect.width / 2,
          y: elementRect.height / 2,
        }
      : undefined)

  if (!elementRect || !targetPosition) {
    throw new Error(
      '[screenci] performAction requires an element rect and target position.'
    )
  }

  await sleep(beforeClickPause)

  if (!mouseMoveRequest) {
    await doClick(
      withDefaultNoWaitAfter({
        ...(noWaitAfter !== undefined ? { noWaitAfter } : {}),
        ...(supportsTrial ? { trial: true } : {}),
        ...(mode === 'singleDuring' ? { position: targetPosition } : {}),
      })
    )
    await appendMouseWait(innerEvents, postClickPause)
    return {
      elementRect,
      innerEvents,
    }
  }

  const clickActionBase = {
    locator,
    doClick,
    supportsTrial,
    targetX: elementRect.x + targetPosition.x,
    targetY: elementRect.y + targetPosition.y,
    clickOptions: {
      position: targetPosition,
      ...(noWaitAfter !== undefined ? { noWaitAfter } : {}),
    },
  }

  const clickActionOptions =
    mode === 'singleDuring'
      ? ({
          ...clickActionBase,
          mode,
        } satisfies Parameters<typeof performMouseClickAction>[0])
      : ({
          ...clickActionBase,
          mode,
          shouldHideMouse,
          ...(selectDuration !== undefined ? { selectDuration } : {}),
        } satisfies Parameters<typeof performMouseClickAction>[0])

  const { events, elementRect: actionElementRect } =
    await performMouseClickAction(clickActionOptions)

  innerEvents.push(...events)

  await appendMouseWait(innerEvents, postClickPause)

  return {
    elementRect: actionElementRect ?? elementRect,
    innerEvents,
  }
}

async function isLocatorAlreadyFocusedForTyping(
  locator: Locator
): Promise<boolean> {
  return locator.evaluate((element) => {
    const doc = element.ownerDocument
    if (!doc || doc.activeElement !== element) return false

    if ('isContentEditable' in element && element.isContentEditable)
      return false

    const tagName = element.tagName.toLowerCase()
    return tagName === 'input' || tagName === 'textarea'
  })
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
  setOriginalLocatorClick(locator, originalClick)
  locator.click = async (
    options?: Parameters<Locator['click']>[0] & {
      moveDuration?: number
      moveSpeed?: number
      beforeClickPause?: number
      moveEasing?: Easing
      postClickPause?: number
      autoZoomOptions?: AutoZoomOptions
    }
  ) => {
    const {
      moveDuration,
      moveSpeed,
      beforeClickPause,
      moveEasing,
      postClickPause,
      autoZoomOptions,
      position,
      steps: _steps,
      ...clickOptions
    } = options ?? {}

    if (isInsideHide()) {
      return originalClick({
        ...clickOptions,
        ...(position !== undefined && { position }),
        noWaitAfter: clickOptions.noWaitAfter ?? true,
      })
    }

    assertDurationOrSpeed(moveDuration, moveSpeed, 'click move')

    const { doClick, supportsTrial } = resolveLocatorMouseAction(
      locator,
      'click'
    )

    const result = await performAction(
      buildDefaultClickMouseMoveRequest({
        targetPosInElement: position,
        moveDuration,
        moveSpeed,
        moveEasing,
      }),
      locator,
      doClick,
      supportsTrial,
      'singleDuring',
      autoZoomOptions,
      position,
      clickOptions.noWaitAfter,
      beforeClickPause,
      postClickPause ?? DEFAULT_POST_CLICK_PAUSE_MS,
      false
    )

    const activeClickRecorder = getActiveClickRecorder(locator.page())
    if (activeClickRecorder && result) {
      activeClickRecorder.addInput('click', undefined, result.innerEvents)
    }
  }

  type PressSequentiallyOptions = Parameters<
    Locator['pressSequentially']
  >[1] & {
    moveDuration?: number
    moveSpeed?: number
    moveEasing?: Easing
    beforeClickPause?: number
    postClickPause?: number
    noWaitAfter?: boolean
    forceClick?: boolean
    autoZoomOptions?: AutoZoomOptions
    hideMouse?: boolean
    position?: { x: number; y: number }
  }

  const originalPressSequentially = locator.pressSequentially.bind(locator)
  locator.pressSequentially = async (
    text: string,
    options?: PressSequentiallyOptions
  ): Promise<void> => {
    const shouldSkipDefaultClickAnimation =
      !options?.forceClick && (await isLocatorAlreadyFocusedForTyping(locator))
    const {
      moveDuration,
      moveSpeed,
      moveEasing = 'ease-in-out',
      beforeClickPause,
      postClickPause,
      noWaitAfter,
      forceClick: _forceClick,
      autoZoomOptions,
      hideMouse: _hideMouse,
      position,
      ...pressOptions
    } = options ?? {}

    if (isInsideHide()) {
      return originalPressSequentially(
        text,
        pressOptions as Parameters<Locator['pressSequentially']>[1]
      )
    }

    const innerEvents: ClickActionResult['innerEvents'] = []
    let elementRect: ElementRect | undefined = undefined

    if (shouldSkipDefaultClickAnimation) {
      const focusChange = await changeFocus(locator, autoZoomOptions)
      innerEvents.push(focusChange)
      elementRect = focusChange.elementRect
      await originalPressSequentially(
        text,
        pressOptions as Parameters<Locator['pressSequentially']>[1]
      )
    } else {
      const clickActionResult = await performAction(
        buildDefaultClickMouseMoveRequest({
          targetPosInElement: position,
          moveDuration,
          moveSpeed,
          moveEasing,
        }),
        locator,
        async () =>
          originalPressSequentially(
            text,
            pressOptions as Parameters<Locator['pressSequentially']>[1]
          ),
        false,
        'singleBefore',
        autoZoomOptions,
        position,
        noWaitAfter,
        beforeClickPause ?? DEFAULT_PRE_CLICK_PAUSE_MS,
        postClickPause ?? DEFAULT_POST_CLICK_PAUSE_MS,
        _hideMouse ?? false
      )
      innerEvents.push(...(clickActionResult?.innerEvents ?? []))
      elementRect = clickActionResult?.elementRect
    }

    await appendPostTypingSettleWait(innerEvents)

    const activeClickRecorder = getActiveClickRecorder(locator.page())
    if (activeClickRecorder) {
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
      moveDuration?: number
      moveSpeed?: number
      moveEasing?: Easing
      beforeClickPause?: number
      postClickPause?: number
      noWaitAfter?: boolean
      forceClick?: boolean
      duration?: number
      timeout?: number
      position?: { x: number; y: number }
      hideMouse?: boolean
      autoZoomOptions?: AutoZoomOptions
    }
  ) => {
    if (isInsideHide()) {
      const {
        moveDuration: _moveDuration,
        moveSpeed: _moveSpeed,
        moveEasing: _moveEasing,
        beforeClickPause: _beforeClickPause,
        postClickPause: _postClickPause,
        noWaitAfter: _noWaitAfter,
        forceClick: _forceClick,
        duration: _duration,
        position: _position,
        hideMouse: _hideMouse,
        autoZoomOptions: _autoZoomOptions,
        ...fillOptions
      } = options ?? {}

      return originalFill(value, fillOptions as Parameters<Locator['fill']>[1])
    }

    const shouldSkipDefaultClickAnimation =
      !options?.forceClick && (await isLocatorAlreadyFocusedForTyping(locator))

    const {
      moveDuration,
      moveSpeed,
      moveEasing = 'ease-in-out',
      beforeClickPause,
      postClickPause,
      noWaitAfter,
      hideMouse: _hideMouse,
      autoZoomOptions,
      position,
    } = options ?? {}

    const innerEvents: ClickActionResult['innerEvents'] = []
    let elementRect: ElementRect | undefined = undefined

    const typeFilledValue = async (): Promise<void> => {
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

      const duration = options?.duration ?? 1000
      const delay = value.length > 0 ? duration / value.length : 0
      await locator.page().keyboard.type(value, { delay })
    }

    if (shouldSkipDefaultClickAnimation) {
      const focusChange = await changeFocus(locator, autoZoomOptions)
      innerEvents.push(focusChange)
      elementRect = focusChange.elementRect
      await typeFilledValue()
    } else {
      const clickActionResult = await performAction(
        buildDefaultClickMouseMoveRequest({
          targetPosInElement: position,
          moveDuration,
          moveSpeed,
          moveEasing,
        }),
        locator,
        typeFilledValue,
        false,
        'singleBefore',
        autoZoomOptions,
        position,
        noWaitAfter,
        beforeClickPause ?? DEFAULT_PRE_CLICK_PAUSE_MS,
        postClickPause ?? CLICK_DURATION_MS / 2,
        _hideMouse ?? false
      )
      innerEvents.push(...(clickActionResult?.innerEvents ?? []))
      elementRect = clickActionResult?.elementRect
    }

    await appendPostTypingSettleWait(innerEvents)

    const activeClickRecorder = getActiveClickRecorder(locator.page())
    if (activeClickRecorder) {
      activeClickRecorder.addInput(
        'pressSequentially',
        elementRect,
        innerEvents
      )
    }
  }

  const originalTap = locator.tap.bind(locator)
  setOriginalLocatorTap(
    locator,
    originalTap as unknown as (options?: {
      position?: { x: number; y: number }
      trial?: boolean
    }) => Promise<void>
  )
  locator.tap = async (
    options?: Parameters<Locator['tap']>[0] & {
      moveDuration?: number
      moveSpeed?: number
      moveEasing?: Easing
      beforeClickPause?: number
      postClickPause?: number
      noWaitAfter?: boolean
      autoZoomOptions?: AutoZoomOptions
    }
  ): Promise<void> => {
    const {
      moveDuration,
      moveSpeed,
      moveEasing,
      beforeClickPause,
      postClickPause,
      noWaitAfter,
      position,
      autoZoomOptions,
      ...tapOpts
    } = options ?? {}

    if (isInsideHide()) {
      return originalTap({
        ...(tapOpts as Parameters<Locator['tap']>[0]),
        noWaitAfter: noWaitAfter ?? true,
      })
    }

    const { doClick, supportsTrial } = resolveLocatorMouseAction(locator, 'tap')

    const result = await performAction(
      buildDefaultClickMouseMoveRequest({
        targetPosInElement: position,
        moveDuration,
        moveSpeed,
        moveEasing,
      }),
      locator,
      doClick,
      supportsTrial,
      'singleDuring',
      autoZoomOptions,
      position,
      noWaitAfter,
      beforeClickPause,
      postClickPause ?? DEFAULT_POST_CLICK_PAUSE_MS,
      false
    )

    const activeClickRecorder = getActiveClickRecorder(locator.page())
    if (activeClickRecorder && result) {
      activeClickRecorder.addInput(
        'tap',
        result.elementRect,
        result.innerEvents
      )
    }
  }

  const originalCheck = locator.check.bind(locator)
  setOriginalLocatorCheck(
    locator,
    originalCheck as unknown as (options?: {
      position?: { x: number; y: number }
      trial?: boolean
    }) => Promise<void>
  )
  locator.check = async (
    options?: Parameters<Locator['check']>[0] & {
      moveDuration?: number
      moveSpeed?: number
      moveEasing?: Easing
      beforeClickPause?: number
      postClickPause?: number
      noWaitAfter?: boolean
      autoZoomOptions?: AutoZoomOptions
    }
  ): Promise<void> => {
    const {
      moveDuration,
      moveSpeed,
      moveEasing,
      beforeClickPause,
      postClickPause,
      noWaitAfter,
      position,
      autoZoomOptions,
      ...checkOpts
    } = options ?? {}

    if (isInsideHide()) {
      return originalCheck({
        ...(checkOpts as Parameters<Locator['check']>[0]),
        noWaitAfter: noWaitAfter ?? true,
      })
    }

    const { doClick, supportsTrial } = resolveLocatorMouseAction(
      locator,
      'check'
    )

    const result = await performAction(
      buildDefaultClickMouseMoveRequest({
        targetPosInElement: position,
        moveDuration,
        moveSpeed,
        moveEasing,
      }),
      locator,
      doClick,
      supportsTrial,
      'singleDuring',
      autoZoomOptions,
      position,
      noWaitAfter,
      beforeClickPause,
      postClickPause ?? DEFAULT_POST_CLICK_PAUSE_MS,
      false
    )

    const activeClickRecorder = getActiveClickRecorder(locator.page())
    if (activeClickRecorder && result) {
      activeClickRecorder.addInput(
        'check',
        result.elementRect,
        result.innerEvents
      )
    }
  }

  const originalUncheck = locator.uncheck.bind(locator)
  setOriginalLocatorUncheck(
    locator,
    originalUncheck as unknown as (options?: {
      position?: { x: number; y: number }
      trial?: boolean
    }) => Promise<void>
  )
  locator.uncheck = async (
    options?: Parameters<Locator['uncheck']>[0] & {
      moveDuration?: number
      moveSpeed?: number
      moveEasing?: Easing
      beforeClickPause?: number
      postClickPause?: number
      noWaitAfter?: boolean
      autoZoomOptions?: AutoZoomOptions
    }
  ): Promise<void> => {
    const {
      moveDuration,
      moveSpeed,
      moveEasing,
      beforeClickPause,
      postClickPause,
      noWaitAfter,
      position,
      autoZoomOptions,
      ...uncheckOpts
    } = options ?? {}

    if (isInsideHide()) {
      return originalUncheck({
        ...(uncheckOpts as Parameters<Locator['uncheck']>[0]),
        noWaitAfter: noWaitAfter ?? true,
      })
    }

    const { doClick, supportsTrial } = resolveLocatorMouseAction(
      locator,
      'uncheck'
    )

    const result = await performAction(
      buildDefaultClickMouseMoveRequest({
        targetPosInElement: position,
        moveDuration,
        moveSpeed,
        moveEasing,
      }),
      locator,
      doClick,
      supportsTrial,
      'singleDuring',
      autoZoomOptions,
      position,
      noWaitAfter,
      beforeClickPause,
      postClickPause ?? DEFAULT_POST_CLICK_PAUSE_MS,
      false
    )

    const activeClickRecorder = getActiveClickRecorder(locator.page())
    if (activeClickRecorder && result) {
      activeClickRecorder.addInput(
        'uncheck',
        result.elementRect,
        result.innerEvents
      )
    }
  }

  locator.setChecked = async (
    checked: boolean,
    options?: Parameters<Locator['check']>[0] & {
      moveDuration?: number
      moveSpeed?: number
      moveEasing?: Easing
      beforeClickPause?: number
      postClickPause?: number
      noWaitAfter?: boolean
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
  let currentSelectValues: Parameters<Locator['selectOption']>[0] = null
  let currentSelectOptions: Parameters<Locator['selectOption']>[1] | undefined
  let currentSelectResult: string[] = []
  setOriginalLocatorSelect(locator, (_values, actionOptions) =>
    originalSelectOption(currentSelectValues, {
      ...currentSelectOptions,
      ...actionOptions,
    }).then((res) => {
      currentSelectResult = res
      return res
    })
  )
  locator.selectOption = async (
    values: Parameters<Locator['selectOption']>[0],
    options?: Parameters<Locator['selectOption']>[1] & {
      moveDuration?: number
      moveSpeed?: number
      moveEasing?: Easing
      beforeClickPause?: number
      postClickPause?: number
      noWaitAfter?: boolean
      position?: { x: number; y: number }
      autoZoomOptions?: AutoZoomOptions
    }
  ): Promise<string[]> => {
    const {
      moveDuration,
      moveSpeed,
      moveEasing,
      beforeClickPause,
      postClickPause,
      noWaitAfter,
      position,
      autoZoomOptions,
      ...selectOpts
    } = options ?? {}

    if (isInsideHide()) {
      return originalSelectOption(values, {
        ...(selectOpts as Parameters<Locator['selectOption']>[1]),
        noWaitAfter: noWaitAfter ?? true,
      })
    }

    currentSelectValues = values
    currentSelectOptions = selectOpts as Parameters<Locator['selectOption']>[1]
    currentSelectResult = []
    const { doClick, supportsTrial } = resolveLocatorMouseAction(
      locator,
      'select'
    )
    const actionResult = await performAction(
      buildDefaultClickMouseMoveRequest({
        targetPosInElement: position,
        moveDuration,
        moveSpeed,
        moveEasing,
      }),
      locator,
      doClick,
      supportsTrial,
      'singleDuring',
      autoZoomOptions,
      position,
      noWaitAfter,
      beforeClickPause,
      postClickPause ?? DEFAULT_POST_CLICK_PAUSE_MS
    )

    const activeClickRecorder = getActiveClickRecorder(locator.page())
    if (activeClickRecorder && actionResult) {
      activeClickRecorder.addInput(
        'select',
        actionResult.elementRect,
        actionResult.innerEvents
      )
    }

    return currentSelectResult
  }

  const originalHover = locator.hover.bind(locator)
  locator.hover = async (
    options?: Parameters<Locator['hover']>[0] & {
      moveDuration?: number
      moveSpeed?: number
      moveEasing?: Easing
      hoverDuration?: number
      autoZoomOptions?: AutoZoomOptions
    }
  ): Promise<void> => {
    const {
      moveDuration,
      moveSpeed,
      moveEasing = 'ease-in-out',
      hoverDuration = 1000,
      position,
      ...hoverOptions
    } = options ?? {}

    assertDurationOrSpeed(moveDuration, moveSpeed, 'hover move')

    const innerEvents: Array<
      FocusChangeEvent | MouseMoveEvent | MouseWaitEvent
    > = []

    const mouseMovePlan = {
      targetPosInElement: position,
      ...(moveDuration !== undefined ? { duration: moveDuration } : {}),
      ...(moveSpeed !== undefined ? { speed: moveSpeed } : {}),
      easing: moveEasing,
    }

    const hoverFocusChange = await changeFocus(
      locator,
      options?.autoZoomOptions,
      mouseMovePlan
    )
    const locatorRect = hoverFocusChange.elementRect

    innerEvents.push(hoverFocusChange)

    const waitStartMs = Date.now()
    await originalHover({
      ...hoverOptions,
      ...(position ? { position } : {}),
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

    const activeClickRecorder = getActiveClickRecorder(locator.page())
    if (activeClickRecorder && innerEvents.length > 0) {
      activeClickRecorder.addInput('hover', locatorRect, innerEvents)
    }
  }

  const originalScrollIntoViewIfNeeded =
    locator.scrollIntoViewIfNeeded.bind(locator)
  locator.scrollIntoViewIfNeeded = async (
    options?: Parameters<Locator['scrollIntoViewIfNeeded']>[0] & {
      easing?: Easing
      duration?: number
      /** 0–1: fraction of output dimensions visible in the zoomed viewport (default 0.72) */
      amount?: number
      /** 0–1: visibility bias inside the zoomed viewport; 0 = barely fit, 1 = centered. */
      centering?: number
    }
  ): Promise<void> => {
    if (isInsideHide()) {
      return originalScrollIntoViewIfNeeded(options)
    }

    const {
      easing = 'ease-in-out',
      duration,
      amount,
      centering,
    } = options ?? {}
    const result = await changeFocus(locator, {
      easing,
      ...(duration !== undefined ? { duration } : {}),
      ...(amount !== undefined ? { amount } : {}),
      ...(centering !== undefined ? { centering } : {}),
    })

    const activeClickRecorder = getActiveClickRecorder(locator.page())
    if (activeClickRecorder) {
      activeClickRecorder.addInput('focusChange', result.elementRect, [result])
    }
  }

  const originalSelectText = locator.selectText.bind(locator)
  locator.selectText = async (
    options?: Parameters<Locator['selectText']>[0] & {
      moveDuration?: number
      moveSpeed?: number
      moveEasing?: Easing
      beforeClickPause?: number
      selectDuration?: number
    }
  ): Promise<void> => {
    const {
      moveDuration,
      moveSpeed,
      moveEasing = 'ease-in-out',
      beforeClickPause = DEFAULT_PRE_CLICK_PAUSE_MS,
      selectDuration,
      ...selectOpts
    } = options ?? {}

    assertDurationOrSpeed(moveDuration, moveSpeed, 'selectText move')

    const innerEvents: Array<
      | FocusChangeEvent
      | MouseMoveEvent
      | MouseDownEvent
      | MouseUpEvent
      | MouseWaitEvent
      | MouseHideEvent
    > = []

    const selectActionResult = await performAction(
      buildDefaultClickMouseMoveRequest({
        targetPosInElement: { x: 0, y: 0 },
        moveDuration,
        moveSpeed,
        moveEasing,
      }),
      locator,
      async () => {
        await originalSelectText(selectOpts)
      },
      false,
      'tripleBefore',
      undefined,
      undefined,
      undefined,
      beforeClickPause,
      undefined,
      false,
      selectDuration
    )

    const locatorRect = selectActionResult?.elementRect
    innerEvents.push(...(selectActionResult?.innerEvents ?? []))

    const activeClickRecorder = getActiveClickRecorder(locator.page())
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

    const targetBbPreview = await target.boundingBox()
    const targetRectPreview: ElementRect | undefined = targetBbPreview
      ? {
          x: targetBbPreview.x,
          y: targetBbPreview.y,
          width: targetBbPreview.width,
          height: targetBbPreview.height,
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
      (targetRectPreview
        ? { x: targetRectPreview.width / 2, y: targetRectPreview.height / 2 }
        : undefined)

    const sourceFocusChange = await changeFocus(locator, undefined, {
      targetPosInElement: sourcePosition,
      ...(moveDuration !== undefined ? { duration: moveDuration } : {}),
      ...(moveSpeed !== undefined ? { speed: moveSpeed } : {}),
      easing: moveEasing,
    })

    if (sourceFocusChange.elementRect) {
      innerEvents.push(sourceFocusChange)
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
    if (targetPos) {
      const targetBb = await target.boundingBox()
      const targetRect: ElementRect | undefined = targetBb
        ? {
            x: targetBb.x,
            y: targetBb.y,
            width: targetBb.width,
            height: targetBb.height,
          }
        : targetRectPreview
      if (!targetRect) {
        throw new Error('[screenci] dragTo target must have a bounding box.')
      }
      const toX = targetRect.x + targetPos.x
      const toY = targetRect.y + targetPos.y
      const resolvedDuration = resolveMouseMoveDuration(page, toX, toY, {
        duration: dragDuration,
        speed: dragSpeed,
        defaultDuration: DEFAULT_CLICK_MOUSE_MOVE_DURATION,
        context: 'dragTo drag',
      })
      await performMouseMove({
        page,
        targetX: toX,
        targetY: toY,
        duration: resolvedDuration,
        easing: dragEasing,
      })
      innerEvents.push({
        type: 'mouseMove',
        startMs: dragStartTime,
        endMs: Date.now(),
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

    const activeClickRecorder = getActiveClickRecorder(locator.page())
    if (activeClickRecorder && innerEvents.length > 0) {
      activeClickRecorder.addInput(
        'dragTo',
        sourceFocusChange.elementRect,
        innerEvents
      )
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
      postClickPause?: number
      autoZoomOptions?: AutoZoomOptions
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
  const originalDblclickMethod = (
    originalMouse as unknown as {
      dblclick?: (
        x: number,
        y: number,
        options?: {
          button?: 'left' | 'right' | 'middle'
          delay?: number
        }
      ) => Promise<void>
    }
  ).dblclick
  const originalDblclick =
    typeof originalDblclickMethod === 'function'
      ? originalDblclickMethod.bind(originalMouse)
      : async (
          x: number,
          y: number,
          options?: {
            button?: 'left' | 'right' | 'middle'
            delay?: number
          }
        ) => {
          await originalClick(x, y, options)
          await originalClick(x, y, options)
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
      _move: typeof originalMove
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
  )._move = originalMove
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
      // A bare `page.mouse.move` animates by default (matching click-move
      // timing) so the cursor glides instead of teleporting. Pass an explicit
      // `duration`/`speed` to retime, or `duration: 0` for an instant jump.
      defaultDuration: DEFAULT_CLICK_MOUSE_MOVE_DURATION,
      context: 'page.mouse.move',
    })
    const easing = options?.easing ?? 'ease-in-out'
    const moveResult = await performMouseMove({
      page,
      targetX: x,
      targetY: y,
      duration,
      easing,
    })
    const moveEvent: FocusChangeEvent = {
      type: 'focusChange',
      startMs: moveResult.startMs,
      endMs: moveResult.endMs,
      x,
      y,
      mouse: {
        startMs: moveResult.startMs,
        endMs: moveResult.endMs,
        ...(duration > 0 ? { easing } : {}),
      },
    }

    const activeClickRecorder = getActiveClickRecorder(page)
    if (activeClickRecorder) {
      // Auto-show cursor when moving after a typing auto-hide
      if (!isMouseVisible(page)) {
        setMouseVisible(page, true)
        const showMs = moveResult.startMs
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

  // Cosmetic press primitives. Calling these records the cursor press for the
  // video (the same events a real click produces). With `fake: true` the press
  // is recorded but the real browser event is suppressed, so the recorded
  // data.json is identical whether or not the page was actually clicked.
  const doReal = (
    fake: boolean | undefined,
    real: () => Promise<void>
  ): Promise<void> => (fake ? Promise.resolve() : real())

  // Auto-show a hidden cursor before a press so it is never invisible. Mirrors
  // the auto-show in `page.mouse.move`.
  const autoShowCursorIfHidden = (): void => {
    if (isMouseVisible(page)) return
    setMouseVisible(page, true)
    const showMs = Date.now()
    const showEvent: MouseShowEvent = {
      type: 'mouseShow',
      startMs: showMs,
      endMs: showMs,
    }
    getActiveClickRecorder(page).addInput('mouseShow', undefined, [showEvent])
  }

  // Records a full press (down + up) over `pressMs`, optionally dispatching the
  // real action `during` the press window (matching the locator 'singleDuring'
  // timing). Pushes the mouseDown/mouseUp events onto `events`.
  const recordVisualPress = async (
    events: Array<MouseDownEvent | MouseUpEvent>,
    pressMs: number,
    easing: Easing,
    during?: () => Promise<void>
  ): Promise<void> => {
    const wrapperStartMs = Date.now()
    await sleep(pressMs / 2)
    if (during) await during()
    await sleep(pressMs / 2)
    const endMs = Date.now()
    const startMs = Math.max(wrapperStartMs, endMs - pressMs)
    const midMs = startMs + (endMs - startMs) / 2
    events.push(
      buildMouseDownEvent({ startMs, endMs: midMs, easing }),
      buildMouseUpEvent({ startMs: midMs, endMs, easing })
    )
  }

  // Animates the cursor to (x, y) and returns the focusChange event for it,
  // mirroring how `page.mouse.move` records a move.
  const animateCursorToForPress = async (
    x: number,
    y: number,
    moveDuration: number | undefined,
    moveSpeed: number | undefined,
    moveEasing: Easing
  ): Promise<FocusChangeEvent> => {
    const duration = resolveMouseMoveDuration(page, x, y, {
      duration: moveDuration,
      speed: moveSpeed,
      defaultDuration: DEFAULT_CLICK_MOUSE_MOVE_DURATION,
      context: 'page.mouse.click move',
    })
    const moveResult = await performMouseMove({
      page,
      targetX: x,
      targetY: y,
      duration,
      easing: moveEasing,
    })
    return {
      type: 'focusChange',
      startMs: moveResult.startMs,
      endMs: moveResult.endMs,
      x,
      y,
      mouse: {
        startMs: moveResult.startMs,
        endMs: moveResult.endMs,
        ...(duration > 0 ? { easing: moveEasing } : {}),
      },
    }
  }

  ;(
    originalMouse as unknown as {
      down: (options?: {
        button?: 'left' | 'right' | 'middle'
        clickCount?: number
        duration?: number
        easing?: Easing
        fake?: boolean
      }) => Promise<void>
    }
  ).down = async (options) => {
    const { duration, easing, fake, ...native } = options ?? {}

    if (isInsideHide()) {
      await doReal(fake, () => originalDown(native))
      return
    }

    autoShowCursorIfHidden()
    const startMs = Date.now()
    await doReal(fake, () => originalDown(native))
    await sleep(duration ?? CLICK_DURATION_MS / 2)
    const event: MouseDownEvent = buildMouseDownEvent({
      startMs,
      endMs: Date.now(),
      ...(easing !== undefined ? { easing } : {}),
    })
    getActiveClickRecorder(page).addInput('mouseDown', undefined, [event])
  }
  ;(
    originalMouse as unknown as {
      up: (options?: {
        button?: 'left' | 'right' | 'middle'
        clickCount?: number
        duration?: number
        easing?: Easing
        fake?: boolean
      }) => Promise<void>
    }
  ).up = async (options) => {
    const { duration, easing, fake, ...native } = options ?? {}

    if (isInsideHide()) {
      await doReal(fake, () => originalUp(native))
      return
    }

    const startMs = Date.now()
    await doReal(fake, () => originalUp(native))
    await sleep(duration ?? CLICK_DURATION_MS / 2)
    const event: MouseUpEvent = buildMouseUpEvent({
      startMs,
      endMs: Date.now(),
      ...(easing !== undefined ? { easing } : {}),
    })
    getActiveClickRecorder(page).addInput('mouseUp', undefined, [event])
  }

  type MouseCoordinateClickOptions = {
    button?: 'left' | 'right' | 'middle'
    clickCount?: number
    delay?: number
    moveDuration?: number
    moveSpeed?: number
    moveEasing?: Easing
    duration?: number
    easing?: Easing
    fake?: boolean
  }
  ;(
    originalMouse as unknown as {
      click: (
        x: number,
        y: number,
        options?: MouseCoordinateClickOptions
      ) => Promise<void>
    }
  ).click = async (x, y, options) => {
    const {
      moveDuration,
      moveSpeed,
      moveEasing = 'ease-in-out',
      duration,
      easing = 'ease-in-out',
      fake,
      ...native
    } = options ?? {}

    if (isInsideHide()) {
      await doReal(fake, () => originalClick(x, y, native))
      return
    }

    autoShowCursorIfHidden()
    const focusChange = await animateCursorToForPress(
      x,
      y,
      moveDuration,
      moveSpeed,
      moveEasing
    )
    const pressEvents: Array<MouseDownEvent | MouseUpEvent> = []
    await recordVisualPress(
      pressEvents,
      duration ?? CLICK_DURATION_MS,
      easing,
      () => doReal(fake, () => originalClick(x, y, native))
    )
    getActiveClickRecorder(page).addInput('click', undefined, [
      focusChange,
      ...pressEvents,
    ])
  }
  ;(
    originalMouse as unknown as {
      dblclick: (
        x: number,
        y: number,
        options?: MouseCoordinateClickOptions
      ) => Promise<void>
    }
  ).dblclick = async (x, y, options) => {
    const {
      moveDuration,
      moveSpeed,
      moveEasing = 'ease-in-out',
      duration,
      easing = 'ease-in-out',
      fake,
      ...native
    } = options ?? {}

    if (isInsideHide()) {
      await doReal(fake, () => originalDblclick(x, y, native))
      return
    }

    autoShowCursorIfHidden()
    const focusChange = await animateCursorToForPress(
      x,
      y,
      moveDuration,
      moveSpeed,
      moveEasing
    )
    const pressEvents: Array<MouseDownEvent | MouseUpEvent> = []
    // The real double click fires once, during the first visual press. The
    // second press is visual only.
    await recordVisualPress(
      pressEvents,
      duration ?? CLICK_DURATION_MS,
      easing,
      () => doReal(fake, () => originalDblclick(x, y, native))
    )
    await recordVisualPress(pressEvents, duration ?? CLICK_DURATION_MS, easing)
    getActiveClickRecorder(page).addInput('click', undefined, [
      focusChange,
      ...pressEvents,
    ])
  }

  setMouseVisible(page, true)
  ;(originalMouse as unknown as { show: () => void }).show = () => {
    if (!isMouseVisible(page)) {
      performMouseShow({
        mouseShowInternal: getOriginalMouseShow(page, originalShow),
        page,
      })
      const activeClickRecorder = getActiveClickRecorder(page)
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
      const activeClickRecorder = getActiveClickRecorder(page)
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
