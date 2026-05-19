import { isInsideHide } from './hide.js'
import { changeFocus } from './changeFocus.js'
import { DEFAULT_MOUSE_MOVE_SPEED } from './defaults.js'
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
  setMouseVisible,
  setOriginalMouseClick,
  setOriginalMouseDown,
  setOriginalMouseHide,
  setOriginalMouseMove,
  setOriginalMouseShow,
  setOriginalMouseUp,
} from './mouse.js'
let activeClickRecorder = null
const DEFAULT_POST_CLICK_PAUSE_MS = 500
export function setActiveClickRecorder(recorder) {
  activeClickRecorder = recorder
}
const instrumented = new WeakSet()
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
async function appendMouseWait(innerEvents, durationMs) {
  if (durationMs <= 0) return
  const startMs = Date.now()
  await sleep(durationMs)
  innerEvents.push({
    type: 'mouseWait',
    startMs,
    endMs: Date.now(),
  })
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
]
const LOCATOR_ONLY_SYNC_RETURN_METHODS = [
  'and',
  'describe',
  'filter',
  'first',
  'last',
  'nth',
  'or',
]
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
]
const FRAME_LOCATOR_SELF_RETURN_METHODS = [
  'frameLocator',
  'first',
  'last',
  'nth',
]
function resolveLocatorMouseAction(locator, interactionType) {
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
          doClick: (options) => action(null, options).then(() => {}),
          supportsTrial: false,
        }
      }
      break
    }
    default: {
      const _ = interactionType
      throw new Error(`Unknown mouse click interaction type: ${_}`)
    }
  }
  throw new Error(
    `[screenci] Missing original locator action for '${interactionType}'.`
  )
}
async function performAction(
  mouseMoveRequest,
  locator,
  doClick,
  supportsTrial,
  mode,
  autoZoomOptions,
  position,
  beforeClickPause = 0,
  postClickPause = 0,
  postClickMove,
  shouldHideMouse = false
) {
  const page = locator.page()
  const focusChange = await changeFocus(
    locator,
    autoZoomOptions,
    mouseMoveRequest
  )
  const elementRect = focusChange.elementRect
  const innerEvents = [focusChange]
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
    await doClick({
      ...(supportsTrial ? { trial: true } : {}),
      ...(mode === 'singleDuring' ? { position: targetPosition } : {}),
    })
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
    clickOptions: { position: targetPosition },
  }
  const clickActionOptions =
    mode === 'singleDuring'
      ? {
          ...clickActionBase,
          mode,
        }
      : {
          ...clickActionBase,
          mode,
          shouldHideMouse,
        }
  const { events, elementRect: actionElementRect } =
    await performMouseClickAction(clickActionOptions)
  innerEvents.push(...events)
  await appendMouseWait(innerEvents, postClickPause)
  if (postClickMove !== undefined) {
    const currentPos = getMousePosition(page) ?? { x: 0, y: 0 }
    let targetX
    let targetY
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
          const _ = postClickMove.direction
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
        defaultSpeed: DEFAULT_MOUSE_MOVE_SPEED,
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
function instrumentLocatorMethods(obj) {
  for (const method of LOCATOR_RETURN_METHODS) {
    const original = obj[method].bind(obj)
    obj[method] = (...args) => instrumentLocator(original(...args))
  }
}
export function instrumentFrameLocator(frameLocator) {
  if (instrumented.has(frameLocator)) return frameLocator
  instrumented.add(frameLocator)
  for (const method of FRAME_LOCATOR_LOCATOR_RETURN_METHODS) {
    const original = frameLocator[method].bind(frameLocator)
    frameLocator[method] = (...args) => instrumentLocator(original(...args))
  }
  for (const method of FRAME_LOCATOR_SELF_RETURN_METHODS) {
    const original = frameLocator[method].bind(frameLocator)
    frameLocator[method] = (...args) =>
      instrumentFrameLocator(original(...args))
  }
  return frameLocator
}
export function instrumentLocator(locator) {
  if (instrumented.has(locator)) return locator
  instrumented.add(locator)
  const originalClick = locator.click.bind(locator)
  setOriginalLocatorClick(locator, originalClick)
  locator.click = async (options) => {
    const {
      moveDuration,
      moveSpeed,
      beforeClickPause,
      moveEasing,
      postClickPause,
      postClickMove,
      autoZoomOptions,
      position,
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
        ...(position !== undefined ? { targetPosInElement: position } : {}),
        ...(moveDuration !== undefined ? { duration: moveDuration } : {}),
        ...(moveSpeed !== undefined ? { speed: moveSpeed } : {}),
        easing: moveEasing ?? 'ease-in-out',
      },
      locator,
      doClick,
      supportsTrial,
      'singleDuring',
      autoZoomOptions,
      position,
      beforeClickPause,
      postClickPause ?? DEFAULT_POST_CLICK_PAUSE_MS,
      postClickMove,
      false
    )
    if (activeClickRecorder && result) {
      activeClickRecorder.addInput('click', undefined, result.innerEvents)
    }
  }
  const originalPressSequentially = locator.pressSequentially.bind(locator)
  locator.pressSequentially = async (text, options) => {
    const clickOpt = options?.click ?? {}
    const { autoZoomOptions, ...pressOptions } = options ?? {}
    if (isInsideHide()) {
      return originalPressSequentially(text, pressOptions)
    }
    const innerEvents = []
    let elementRect = undefined
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
      async () => originalPressSequentially(text, pressOptions),
      false,
      'singleBefore',
      autoZoomOptions,
      options?.position,
      beforeClickPause ?? CLICK_DURATION_MS / 2,
      postClickPause ?? CLICK_DURATION_MS / 2,
      postClickMove,
      true
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
  locator.fill = async (value, options) => {
    if (isInsideHide()) {
      const { ...fillOptions } = options ?? {}
      return originalFill(value, fillOptions)
    }
    const clickOpt = options?.click ?? {}
    const innerEvents = []
    let elementRect = undefined
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
      async () => {
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
      'singleBefore',
      options?.autoZoomOptions,
      options?.position,
      beforeClickPause ?? CLICK_DURATION_MS / 2,
      postClickPause ?? CLICK_DURATION_MS / 2,
      postClickMove,
      true
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
  setOriginalLocatorTap(locator, originalTap)
  locator.tap = async (options) => {
    const clickOpt = options?.click
    const { position, autoZoomOptions, ...tapOpts } = options ?? {}
    if (isInsideHide()) {
      return originalTap(tapOpts)
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
      'singleDuring',
      autoZoomOptions,
      position,
      clickOpt?.beforeClickPause,
      clickOpt?.postClickPause ?? DEFAULT_POST_CLICK_PAUSE_MS,
      clickOpt?.postClickMove,
      false
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
  setOriginalLocatorCheck(locator, originalCheck)
  locator.check = async (options) => {
    const clickOpt = options?.click
    const position = options?.position
    const { autoZoomOptions, ...checkOpts } = options ?? {}
    if (isInsideHide()) {
      return originalCheck(checkOpts)
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
      'singleDuring',
      autoZoomOptions,
      position,
      clickOpt?.beforeClickPause,
      clickOpt?.postClickPause ?? DEFAULT_POST_CLICK_PAUSE_MS,
      clickOpt?.postClickMove,
      false
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
  setOriginalLocatorUncheck(locator, originalUncheck)
  locator.uncheck = async (options) => {
    const clickOpt = options?.click
    const position = options?.position
    const { autoZoomOptions, ...uncheckOpts } = options ?? {}
    if (isInsideHide()) {
      return originalUncheck(uncheckOpts)
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
      'singleDuring',
      autoZoomOptions,
      position,
      clickOpt?.beforeClickPause,
      clickOpt?.postClickPause ?? DEFAULT_POST_CLICK_PAUSE_MS,
      clickOpt?.postClickMove,
      false
    )
    if (activeClickRecorder && result) {
      activeClickRecorder.addInput(
        'uncheck',
        result.elementRect,
        result.innerEvents
      )
    }
  }
  locator.setChecked = async (checked, options) => {
    if (checked) {
      return locator.check(options)
    } else {
      return locator.uncheck(options)
    }
  }
  const originalSelectOption = locator.selectOption.bind(locator)
  let currentSelectValues = null
  let currentSelectOptions
  let currentSelectResult = []
  setOriginalLocatorSelect(locator, (_values, actionOptions) =>
    originalSelectOption(currentSelectValues, {
      ...currentSelectOptions,
      ...actionOptions,
    }).then((res) => {
      currentSelectResult = res
      return res
    })
  )
  locator.selectOption = async (values, options) => {
    const clickOpt = options?.click
    const { position, autoZoomOptions, ...selectOpts } = options ?? {}
    if (isInsideHide()) {
      return originalSelectOption(values, selectOpts)
    }
    currentSelectValues = values
    currentSelectOptions = selectOpts
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
      'singleDuring',
      autoZoomOptions,
      position,
      clickOpt?.beforeClickPause,
      clickOpt?.postClickPause ?? DEFAULT_POST_CLICK_PAUSE_MS,
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
  locator.hover = async (options) => {
    const {
      moveDuration,
      moveSpeed,
      easing: moveEasing = 'ease-in-out',
      hoverDuration = 1000,
      position,
      ...hoverOptions
    } = options ?? {}
    assertDurationOrSpeed(moveDuration, moveSpeed, 'hover move')
    const innerEvents = []
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
    if (activeClickRecorder && innerEvents.length > 0) {
      activeClickRecorder.addInput('hover', locatorRect, innerEvents)
    }
  }
  const originalScrollIntoViewIfNeeded =
    locator.scrollIntoViewIfNeeded.bind(locator)
  locator.scrollIntoViewIfNeeded = async (options) => {
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
    if (activeClickRecorder) {
      activeClickRecorder.addInput('focusChange', result.elementRect, [result])
    }
  }
  const originalSelectText = locator.selectText.bind(locator)
  locator.selectText = async (options) => {
    const {
      moveDuration,
      moveSpeed,
      easing: moveEasing = 'ease-in-out',
      beforeClickPause = CLICK_DURATION_MS / 2,
      ...selectOpts
    } = options ?? {}
    assertDurationOrSpeed(moveDuration, moveSpeed, 'selectText move')
    const innerEvents = []
    const selectActionResult = await performAction(
      {
        targetPosInElement: { x: 0, y: 0 },
        ...(moveDuration !== undefined ? { duration: moveDuration } : {}),
        ...(moveSpeed !== undefined ? { speed: moveSpeed } : {}),
        easing: moveEasing,
      },
      locator,
      async () => {
        await originalSelectText(selectOpts)
      },
      false,
      'tripleBefore',
      undefined,
      undefined,
      beforeClickPause,
      undefined,
      undefined,
      false
    )
    const locatorRect = selectActionResult?.elementRect
    innerEvents.push(...(selectActionResult?.innerEvents ?? []))
    if (activeClickRecorder && innerEvents.length > 0) {
      activeClickRecorder.addInput('selectText', locatorRect, innerEvents)
    }
  }
  locator.dragTo = async (target, options) => {
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
    const targetBb = await target.boundingBox()
    const targetRect = targetBb
      ? {
          x: targetBb.x,
          y: targetBb.y,
          width: targetBb.width,
          height: targetBb.height,
        }
      : undefined
    const innerEvents = []
    const targetPos =
      targetPosition ??
      (targetRect
        ? { x: targetRect.width / 2, y: targetRect.height / 2 }
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
    if (targetPos && targetRect) {
      const toX = targetRect.x + targetPos.x
      const toY = targetRect.y + targetPos.y
      const resolvedDuration = resolveMouseMoveDuration(page, toX, toY, {
        duration: dragDuration,
        speed: dragSpeed,
        defaultDuration: undefined,
        defaultSpeed: DEFAULT_MOUSE_MOVE_SPEED,
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
    if (activeClickRecorder && innerEvents.length > 0) {
      activeClickRecorder.addInput(
        'dragTo',
        sourceFocusChange.elementRect,
        innerEvents
      )
    }
  }
  const originalPage = locator.page.bind(locator)
  locator.page = () => originalPage()
  instrumentLocatorMethods(locator)
  for (const method of LOCATOR_ONLY_SYNC_RETURN_METHODS) {
    const original = locator[method].bind(locator)
    locator[method] = (...args) => instrumentLocator(original(...args))
  }
  const originalAll = locator.all.bind(locator)
  locator.all = async () => {
    const locators = await originalAll()
    return locators.map(instrumentLocator)
  }
  const originalContentFrame = locator.contentFrame.bind(locator)
  locator.contentFrame = () => instrumentFrameLocator(originalContentFrame())
  const originalLocatorFrameLocator = locator.frameLocator.bind(locator)
  locator.frameLocator = (...args) =>
    instrumentFrameLocator(originalLocatorFrameLocator(...args))
  return locator
}
export async function instrumentPage(page) {
  if (instrumented.has(page)) return page
  instrumented.add(page)
  instrumentLocatorMethods(page)
  const originalPageFrameLocator = page.frameLocator.bind(page)
  page.frameLocator = (...args) =>
    instrumentFrameLocator(originalPageFrameLocator(...args))
  // Delegate page.click to the instrumented locator so all click recording
  // flows through the same path.
  page.click = async (selector, options) => {
    return page.locator(selector).click(options)
  }
  // Instrument page.mouse to record mouse moves and visibility toggles.
  const originalMouse = page.mouse
  const originalMove = originalMouse.move.bind(originalMouse)
  const originalDown = originalMouse.down.bind(originalMouse)
  const originalUp = originalMouse.up.bind(originalMouse)
  const originalClickMethod = originalMouse.click
  const originalClick =
    typeof originalClickMethod === 'function'
      ? originalClickMethod.bind(originalMouse)
      : async (x, y, options) => {
          await originalMove(x, y)
          await originalDown(options)
          if (options?.delay) {
            await sleep(options.delay)
          }
          await originalUp(options)
        }
  const originalShowMethod = originalMouse.show
  const originalHideMethod = originalMouse.hide
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
  originalMouse._move = originalMove
  originalMouse.move = async (x, y, options) => {
    const duration = resolveMouseMoveDuration(page, x, y, {
      duration: options?.duration,
      speed: options?.speed,
      defaultDuration: undefined,
      defaultSpeed: DEFAULT_MOUSE_MOVE_SPEED,
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
    const moveEvent = {
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
        const showEvent = {
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
  originalMouse.show = () => {
    if (!isMouseVisible(page)) {
      performMouseShow({
        mouseShowInternal: getOriginalMouseShow(page, originalShow),
        page,
      })
      if (activeClickRecorder) {
        const timeMs = Date.now()
        const showEvent = {
          type: 'mouseShow',
          startMs: timeMs,
          endMs: timeMs,
        }
        activeClickRecorder.addInput('mouseShow', undefined, [showEvent])
      }
    }
  }
  originalMouse.hide = () => {
    if (isMouseVisible(page)) {
      performMouseHide({
        mouseHideInternal: getOriginalMouseHide(page, originalHide),
        page,
      })
      if (activeClickRecorder) {
        const timeMs = Date.now()
        const hideEvent = {
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
export function instrumentContext(context) {
  if (instrumented.has(context)) return context
  instrumented.add(context)
  const originalNewPage = context.newPage.bind(context)
  context.newPage = async (...args) => {
    return instrumentPage(await originalNewPage(...args))
  }
  return context
}
export function instrumentBrowser(browser) {
  if (instrumented.has(browser)) return browser
  instrumented.add(browser)
  const originalNewContext = browser.newContext.bind(browser)
  browser.newContext = async (...args) => {
    return instrumentContext(await originalNewContext(...args))
  }
  const originalNewPage = browser.newPage.bind(browser)
  browser.newPage = async (...args) => {
    return instrumentPage(await originalNewPage(...args))
  }
  return browser
}
