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
import { isInsideHide } from './hide.js'
import { changeFocus, type MouseMoveRequest } from './changeFocus.js'
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
  getMousePosition,
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
  setOriginalLocatorCheck,
  setOriginalLocatorClick,
  setOriginalLocatorSelect,
  setOriginalLocatorTap,
  setOriginalLocatorUncheck,
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
  autoZoomOptions?: AutoZoomOptions,
  position?: { x: number; y: number },
  beforeClickPause = 0,
  postClickPause = 0,
  postClickMove?: PostClickMove,
  shouldHideMouse = false
): Promise<ClickActionResult | null> {
  const page = locator.page()
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

  const { events, elementRect: actionElementRect } =
    await performMouseClickAction({
      locator,
      doClick,
      supportsTrial,
      targetX: elementRect.x + targetPosition.x,
      targetY: elementRect.y + targetPosition.y,
      shouldHideMouse,
      clickOptions: { position: targetPosition },
    })

  innerEvents.push(...events)

  await sleep(postClickPause)

  if (postClickMove !== undefined) {
    const currentPos = getMousePosition(page) ?? { x: 0, y: 0 }
    let targetX: number | undefined
    let targetY: number | undefined

    if ('direction' in postClickMove) {
      const padding = postClickMove.padding ?? 0
      switch (postClickMove.direction) {
        case 'up':
          targetX = currentPos.x
          targetY = elementRect.y - padding
          break
        case 'down':
          targetX = currentPos.x
          targetY = elementRect.y + elementRect.height + padding
          break
        case 'left':
          targetX = elementRect.x - padding
          targetY = currentPos.y
          break
        case 'right':
          targetX = elementRect.x + elementRect.width + padding
          targetY = currentPos.y
          break
        default: {
          const _: never = postClickMove.direction
          throw new Error(`Unknown postClickMove direction: ${_}`)
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
        targetX,
        targetY,
        duration,
        easing,
      })
      const endMs = Date.now()
      innerEvents.push({
        type: 'focusChange',
        x: targetX,
        y: targetY,
        startMs,
        endMs,
        mouse: {
          startMs,
          endMs,
          ...(duration > 0 ? { easing } : {}),
        },
      })
    }
  }

  return {
    elementRect: actionElementRect ?? elementRect,
    innerEvents,
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
  setOriginalLocatorClick(locator, originalClick)
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

    const { doClick, supportsTrial } = resolveLocatorMouseAction(
      locator,
      'click'
    )

    const result = await performAction(
      {
        targetPosInElement: position ?? { x: 0, y: 0 },
        ...(moveDuration !== undefined ? { duration: moveDuration } : {}),
        ...(moveSpeed !== undefined ? { speed: moveSpeed } : {}),
        easing: moveEasing ?? 'ease-in-out',
      },
      locator,
      doClick,
      supportsTrial,
      autoZoomOptions,
      position,
      beforeClickPause,
      postClickPause,
      postClickMove
    )

    if (activeClickRecorder && result) {
      activeClickRecorder.addInput('click', undefined, result.innerEvents)
    }
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
    const clickOpt: ClickBeforeFillOption = options?.click ?? {}
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

    const {
      moveDuration,
      moveSpeed,
      beforeClickPause,
      moveEasing = 'ease-in-out',
      postClickPause,
      postClickMove,
    } = clickOpt

    const clickActionResult = await performAction(
      {
        targetPosInElement: options?.position ?? { x: 0, y: 0 },
        ...(moveDuration !== undefined ? { duration: moveDuration } : {}),
        ...(moveSpeed !== undefined ? { speed: moveSpeed } : {}),
        easing: moveEasing,
      },
      locator,
      async () =>
        originalPressSequentially(
          text,
          pressOptions as Parameters<Locator['pressSequentially']>[1]
        ),
      false,
      autoZoomOptions,
      options?.position,
      beforeClickPause ?? CLICK_DURATION_MS / 2,
      postClickPause ?? CLICK_DURATION_MS / 2,
      postClickMove,
      options?.hideMouse === true
    )
    innerEvents.push(...(clickActionResult?.innerEvents ?? []))
    elementRect = clickActionResult?.elementRect

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

    const clickOpt: ClickBeforeFillOption = options?.click ?? {}
    const innerEvents: Array<
      | FocusChangeEvent
      | MouseMoveEvent
      | MouseDownEvent
      | MouseUpEvent
      | MouseHideEvent
      | MouseWaitEvent
    > = []
    let elementRect: ElementRect | undefined = undefined

    const {
      moveDuration,
      moveSpeed,
      beforeClickPause,
      moveEasing = 'ease-in-out',
      postClickPause,
      postClickMove,
    } = clickOpt

    const clickActionResult = await performAction(
      {
        targetPosInElement: options?.position ?? { x: 0, y: 0 },
        ...(moveDuration !== undefined ? { duration: moveDuration } : {}),
        ...(moveSpeed !== undefined ? { speed: moveSpeed } : {}),
        easing: moveEasing,
      },
      locator,
      async (clickOptions) => {
        if (options?.click !== undefined) {
          await originalClick(clickOptions)
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

        const duration = options?.duration ?? 1000
        const delay = value.length > 0 ? duration / value.length : 0
        await locator.page().keyboard.type(value, { delay })
      },
      false,
      options?.autoZoomOptions,
      options?.position,
      beforeClickPause ?? CLICK_DURATION_MS / 2,
      postClickPause ?? CLICK_DURATION_MS / 2,
      postClickMove,
      options?.hideMouse === true
    )
    innerEvents.push(...(clickActionResult?.innerEvents ?? []))
    elementRect = clickActionResult?.elementRect

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

    if (isInsideHide()) {
      return originalTap(tapOpts as Parameters<Locator['tap']>[0])
    }

    const { doClick, supportsTrial } = resolveLocatorMouseAction(locator, 'tap')

    const result = await performAction(
      clickOpt
        ? {
            targetPosInElement: position ?? { x: 0, y: 0 },
            ...(clickOpt.moveDuration !== undefined
              ? { duration: clickOpt.moveDuration }
              : {}),
            ...(clickOpt.moveSpeed !== undefined
              ? { speed: clickOpt.moveSpeed }
              : {}),
            easing: clickOpt.moveEasing ?? 'ease-in-out',
          }
        : undefined,
      locator,
      doClick,
      supportsTrial,
      autoZoomOptions,
      position,
      clickOpt?.beforeClickPause,
      clickOpt?.postClickPause,
      clickOpt?.postClickMove
    )

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

    const { doClick, supportsTrial } = resolveLocatorMouseAction(
      locator,
      'check'
    )

    const result = await performAction(
      clickOpt
        ? {
            targetPosInElement: position ?? { x: 0, y: 0 },
            ...(clickOpt.moveDuration !== undefined
              ? { duration: clickOpt.moveDuration }
              : {}),
            ...(clickOpt.moveSpeed !== undefined
              ? { speed: clickOpt.moveSpeed }
              : {}),
            easing: clickOpt.moveEasing ?? 'ease-in-out',
          }
        : undefined,
      locator,
      doClick,
      supportsTrial,
      autoZoomOptions,
      position,
      clickOpt?.beforeClickPause,
      clickOpt?.postClickPause,
      clickOpt?.postClickMove
    )

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

    const { doClick, supportsTrial } = resolveLocatorMouseAction(
      locator,
      'uncheck'
    )

    const result = await performAction(
      clickOpt
        ? {
            targetPosInElement: position ?? { x: 0, y: 0 },
            ...(clickOpt.moveDuration !== undefined
              ? { duration: clickOpt.moveDuration }
              : {}),
            ...(clickOpt.moveSpeed !== undefined
              ? { speed: clickOpt.moveSpeed }
              : {}),
            easing: clickOpt.moveEasing ?? 'ease-in-out',
          }
        : undefined,
      locator,
      doClick,
      supportsTrial,
      autoZoomOptions,
      position,
      clickOpt?.beforeClickPause,
      clickOpt?.postClickPause,
      clickOpt?.postClickMove
    )

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

    currentSelectValues = values
    currentSelectOptions = selectOpts as Parameters<Locator['selectOption']>[1]
    currentSelectResult = []
    const { doClick, supportsTrial } = resolveLocatorMouseAction(
      locator,
      'select'
    )
    const actionResult = await performAction(
      clickOpt
        ? {
            targetPosInElement: position ?? { x: 0, y: 0 },
            ...(clickOpt.moveDuration !== undefined
              ? { duration: clickOpt.moveDuration }
              : {}),
            ...(clickOpt.moveSpeed !== undefined
              ? { speed: clickOpt.moveSpeed }
              : {}),
            easing: clickOpt.moveEasing ?? 'ease-in-out',
          }
        : undefined,
      locator,
      doClick,
      supportsTrial,
      autoZoomOptions,
      position,
      clickOpt?.beforeClickPause,
      clickOpt?.postClickPause,
      clickOpt?.postClickMove
    )

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
            targetPosInElement: targetPos,
            ...(moveDuration !== undefined ? { duration: moveDuration } : {}),
            ...(moveSpeed !== undefined ? { speed: moveSpeed } : {}),
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
            targetPosInElement: targetPos,
            ...(moveDuration !== undefined ? { duration: moveDuration } : {}),
            ...(moveSpeed !== undefined ? { speed: moveSpeed } : {}),
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
      targetX: x,
      targetY: y,
      duration,
      easing,
    })
    const moveEvent: FocusChangeEvent = {
      type: 'focusChange',
      startMs,
      endMs: Date.now(),
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
