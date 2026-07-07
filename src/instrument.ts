import type {
  Page,
  BrowserContext,
  Browser,
  Locator,
  FrameLocator,
  Route,
  Request,
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
  InputEvent,
} from './events.js'
import { NOOP_EVENT_RECORDER } from './events.js'
import {
  buildEditableMeta,
  chainLocatorDescription,
  describeLocatorCall,
  editableIdentityKey,
  getLocatorDescription,
  setLocatorDescription,
  type EditableMeta,
  type EditableSchemaKind,
} from './editableDescriptor.js'
import { applyEditableOverride } from './editableRuntime.js'
import type {
  AutoZoomOptions,
  Easing,
  RedactOptions,
  ScreenCIPage,
} from './types.js'
import { isInsideHide } from './hide.js'
import { redact } from './redact.js'
import {
  changeFocus,
  resolvePointFocusZoom,
  type MouseMoveRequest,
} from './changeFocus.js'
import { getAutoZoomState, setCurrentZoomViewport } from './autoZoom.js'
import { buildZoomEvent, resolveAutoZoomOptions } from './zoom.js'
import {
  DEFAULT_AUTO_ZOOM_CENTERING,
  DEFAULT_CLICK_MOUSE_MOVE_DURATION,
  DEFAULT_DRAG_PRESS_DELAY_MS,
  DEFAULT_DRAG_STEPS,
  DEFAULT_FILL_TYPING_DURATION_MS,
  DEFAULT_HOVER_DURATION_MS,
  DEFAULT_PRE_CLICK_PAUSE_MS,
} from './defaults.js'
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
  nextEditablePosition,
  setRuntimeClickRecorder,
  isScreenshotCapture,
} from './runtimeContext.js'
import {
  normalizeSelector,
  type ActionMethod,
  type ActionParamSpec,
} from './actionParams.js'

const pageClickRecorders = new WeakMap<object, IEventRecorder>()

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

/**
 * Record one instrumented action's option parameters (explicit vs default) on
 * the active recorder and return the effective values, with any web-editor
 * overrides applied (each application is logged by the recorder's collector).
 * Outside a recording the no-op recorder resolves the spec without tracking.
 */
function applyActionParams(
  locator: Locator,
  method: ActionMethod,
  spec: ActionParamSpec
): Record<string, unknown> {
  return getActiveClickRecorder(locator.page()).applyActionParams(
    normalizeSelector(locator),
    method,
    spec
  )
}

/** The shared cursor-move spec entries every mouse-driven action records. */
function cursorMoveSpec(
  move: CursorMoveOption['move'],
  moveDelayAfterFallback: number
): ActionParamSpec {
  return {
    'move.duration': {
      explicit: move?.duration,
      // The default duration only applies when no speed is given; with a speed
      // the duration is derived from the distance instead.
      fallback:
        move?.speed === undefined ? DEFAULT_CLICK_MOUSE_MOVE_DURATION : null,
    },
    'move.speed': { explicit: move?.speed, fallback: null },
    'move.easing': { explicit: move?.easing, fallback: 'ease-in-out' },
    'move.delayAfter': {
      explicit: move?.delayAfter,
      fallback: moveDelayAfterFallback,
    },
  }
}

/** Effective cursor-move values back out of an {@link applyActionParams} result. */
function effectiveCursorMove(effective: Record<string, unknown>): {
  moveDuration: number | undefined
  moveSpeed: number | undefined
  moveEasing: Easing
  moveDelayAfter: number
} {
  const moveSpeed = asOptionalNumber(effective['move.speed'])
  return {
    // With an (overridden or explicit) speed the duration must stay unset so
    // the move derives its duration from the distance.
    moveDuration:
      moveSpeed !== undefined
        ? undefined
        : asOptionalNumber(effective['move.duration']),
    moveSpeed,
    moveEasing: (effective['move.easing'] as Easing) ?? 'ease-in-out',
    moveDelayAfter: asOptionalNumber(effective['move.delayAfter']) ?? 0,
  }
}

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

function asOptionalPoint(value: unknown): { x: number; y: number } | undefined {
  if (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { x?: unknown }).x === 'number' &&
    typeof (value as { y?: unknown }).y === 'number'
  ) {
    return value as { x: number; y: number }
  }
  return undefined
}

const instrumented = new WeakSet<object>()
type RouteHandler = (
  route: Route,
  request: Request
) => Promise<unknown> | unknown
type RouteFulfillOptions = Parameters<Route['fulfill']>[0]

const routeHandlerWrappers = new WeakMap<
  object,
  WeakMap<RouteHandler, RouteHandler>
>()

const JAVASCRIPT_CONTENT_TYPES = new Set([
  'application/ecmascript',
  'application/javascript',
  'application/x-javascript',
  'text/ecmascript',
  'text/javascript',
])

function getHeaderValue(
  headers: Record<string, string> | undefined,
  name: string
): string | undefined {
  if (!headers) return undefined
  const lowerName = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerName) return value
  }
  return undefined
}

function normalizeContentType(contentType: string): string {
  return contentType.split(';', 1)[0]!.trim().toLowerCase()
}

function inferContentTypeFromPath(path: string): string | undefined {
  const normalizedPath = path.split(/[?#]/, 1)[0] ?? path
  const ext = normalizedPath.match(/\.([^.\\/]+)$/)?.[1]?.toLowerCase()
  switch (ext) {
    case 'cjs':
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'ts':
    case 'tsx':
      return 'text/javascript'
    case 'css':
      return 'text/css'
    case 'html':
    case 'htm':
      return 'text/html'
    case 'json':
      return 'application/json'
    default:
      return undefined
  }
}

function resolveFulfillContentType(
  options: RouteFulfillOptions
): string | undefined {
  if (!options) return undefined
  const explicit =
    options.contentType ?? getHeaderValue(options.headers, 'content-type')
  if (explicit) return explicit
  if ('json' in options && options.json !== undefined) return 'application/json'
  if (options.path) return inferContentTypeFromPath(options.path)
  return getHeaderValue(options.response?.headers(), 'content-type')
}

function expectedContentTypeForRequest(
  request: Request
): { label: string; accepts: (contentType: string) => boolean } | null {
  switch (request.resourceType()) {
    case 'script':
      return {
        label: 'a JavaScript MIME type',
        accepts: (contentType) =>
          JAVASCRIPT_CONTENT_TYPES.has(normalizeContentType(contentType)),
      }
    case 'stylesheet':
      return {
        label: 'text/css',
        accepts: (contentType) =>
          normalizeContentType(contentType) === 'text/css',
      }
    case 'document':
      return {
        label: 'text/html',
        accepts: (contentType) => {
          const normalized = normalizeContentType(contentType)
          return (
            normalized === 'text/html' || normalized === 'application/xhtml+xml'
          )
        },
      }
    default:
      return null
  }
}

function assertRouteFulfillMatchesBrowserResource(
  request: Request,
  options: RouteFulfillOptions,
  source: 'page.route' | 'browserContext.route'
): void {
  const status = options?.status ?? 200
  if (status === 204 || status === 304 || status >= 300) return

  const expected = expectedContentTypeForRequest(request)
  if (expected === null) return

  const contentType = resolveFulfillContentType(options)
  if (contentType !== undefined && expected.accepts(contentType)) return

  const resourceType = request.resourceType()
  const renderedContentType =
    contentType === undefined ? 'no content type' : contentType

  throw new Error(
    `[screenci] ${source} fulfilled a ${resourceType} request for ${request.url()} ` +
      `with ${renderedContentType}. Browser ${resourceType} loads are not API requests ` +
      `and must be fulfilled with ${expected.label}. This usually means a broad route ` +
      `glob intercepted an app asset, for example a Vite module. Narrow API mocks to ` +
      `an absolute URL such as http://localhost:5173/api/... or call route.fallback() ` +
      `when request.resourceType() is not 'fetch' or 'xhr'.`
  )
}

function guardRouteFulfill(
  route: Route,
  request: Request,
  source: 'page.route' | 'browserContext.route'
): Route {
  const originalFulfill = route.fulfill.bind(route)
  ;(route as Route).fulfill = async (
    options?: RouteFulfillOptions
  ): Promise<void> => {
    assertRouteFulfillMatchesBrowserResource(request, options, source)
    await originalFulfill(options)
  }
  return route
}

function wrapRouteHandler(
  target: object,
  handler: RouteHandler,
  source: 'page.route' | 'browserContext.route'
): RouteHandler {
  let targetWrappers = routeHandlerWrappers.get(target)
  if (!targetWrappers) {
    targetWrappers = new WeakMap()
    routeHandlerWrappers.set(target, targetWrappers)
  }

  let wrapped = targetWrappers.get(handler)
  if (!wrapped) {
    wrapped = (route, request) =>
      handler(guardRouteFulfill(route, request, source), request)
    targetWrappers.set(handler, wrapped)
  }
  return wrapped
}

function unwrapRouteHandler(
  target: object,
  handler: RouteHandler
): RouteHandler {
  return routeHandlerWrappers.get(target)?.get(handler) ?? handler
}

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

/**
 * While an `autoZoom()` block is active, a raw cursor move (`page.mouse.move`, or
 * the cursor-move portion of `page.mouse.click`/`dblclick`) drives the camera as
 * well: the zoom viewport pans, and on the first move zooms in, to follow the
 * cursor to `point`. Without this the camera stays parked on the last element a
 * locator action framed, so gestures composed by hand from `page.mouse.*` (e.g. a
 * manual drag) leave the cursor to wander out of frame.
 *
 * Returns the `zoom` field to attach to the move's `focusChange` event (or
 * `undefined` when not inside autoZoom, when the viewport is unknown, or when the
 * framing does not change), and updates the current zoom viewport as a side
 * effect so the block's later zoom-out starts from the followed point.
 */
function resolveAutoZoomCursorFollow(
  page: Page,
  point: { x: number; y: number },
  timing: { startMs: number; endMs: number; duration: number; easing: Easing }
): FocusChangeEvent['zoom'] | undefined {
  const state = getAutoZoomState()
  if (!state.insideAutoZoom) return undefined

  const viewportSize =
    state.currentZoomViewport?.viewportSize ?? page.viewportSize()
  if (viewportSize === null) return undefined

  const resolvedOptions = resolveAutoZoomOptions(state, {})
  // Mirror element framing inside autoZoom: honor an explicit centering, else use
  // the tight auto-zoom comfort inset. For a zero-size point this places the
  // cursor near center so it stays framed as it moves.
  const centering =
    state.options.centering !== undefined
      ? resolvedOptions.centering
      : DEFAULT_AUTO_ZOOM_CENTERING
  const currentZoomEnd = state.currentZoomViewport?.end ?? {
    pointPx: { x: 0, y: 0 },
    size: { widthPx: viewportSize.width, heightPx: viewportSize.height },
  }

  const pointZoom = resolvePointFocusZoom({
    point,
    viewportSize,
    amount: resolvedOptions.amount,
    centering,
    currentZoomEnd,
  })

  const zoomEvent = buildZoomEvent({
    target: pointZoom.zoomTarget,
    currentZoomEnd,
    zoomTiming: {
      startMs: timing.startMs,
      endMs: timing.endMs,
      ...(timing.duration > 0 ? { easing: timing.easing } : {}),
    },
  })

  setCurrentZoomViewport({
    focusPoint: { x: point.x, y: point.y },
    end: pointZoom.end,
    viewportSize,
    optimalOffset: pointZoom.optimalOffset,
  })

  return zoomEvent
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

type CursorMoveOption = {
  move?: (
    | { duration?: number; speed?: never }
    | { duration?: never; speed?: number }
  ) & {
    easing?: Easing
    delayAfter?: number
  }
}

function resolveCursorMoveOption(move: CursorMoveOption['move']): {
  moveDuration: number | undefined
  moveSpeed: number | undefined
  moveEasing: Easing
  moveDelayAfter: number | undefined
} {
  return {
    moveDuration: move?.duration,
    moveSpeed: move?.speed,
    moveEasing: move?.easing ?? 'ease-in-out',
    moveDelayAfter: move?.delayAfter,
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

/**
 * Apply a per-action redact mask to a typing target before the value is typed,
 * so a secret entered via `fill`/`pressSequentially` is never captured in the
 * clear. The mask is persistent: the value stays masked for the rest of the
 * video (a transient unmask would leak it). Skipped inside `hide()`, where the
 * whole section is cut from the recording anyway.
 */
async function applyActionRedact(
  locator: Locator,
  redactOption: boolean | RedactOptions | undefined
): Promise<void> {
  if (!redactOption || isInsideHide()) return
  const options = redactOption === true ? undefined : redactOption
  await redact(locator, options)
}

/** True when any of the given code-supplied option values is set. */
function hasExplicitOption(...values: unknown[]): boolean {
  return values.some((value) => value !== undefined)
}

/**
 * Marks action-specific fields as explicitly code-set on an already-built
 * editable meta (for fields stamped after {@link buildPointerEditableMeta},
 * like typing/hover/drag durations).
 */
function addLockedFields(
  editable: EditableMeta | undefined,
  fields: Record<string, unknown>
): void {
  if (editable === undefined) return
  const extra = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([field]) => field)
  if (extra.length === 0) return
  editable.lockedFields = [...(editable.lockedFields ?? []), ...extra]
}

/**
 * Builds the editable metadata for an instrumented input action: identity
 * from the locator's captured description, position from the runtime
 * counters, and the effective option values this run used. Returns undefined
 * when implicit editability is disabled and no explicit name was given for
 * the action. `locked` is true when code passed any explicit ScreenCI
 * option, which locks the whole action against web edits.
 */
function buildInputEditableMeta(
  locator: Locator,
  subKind: InputEvent['subType'],
  options: {
    locked: boolean
    lockedFields?: string[]
    defaults: Record<string, unknown>
    schemaKind?: EditableSchemaKind
    name?: string | undefined
  }
): EditableMeta | undefined {
  const matcher = getLocatorDescription(locator)
  const identity = {
    kind: 'input' as const,
    subKind,
    ...(options.name !== undefined && { name: options.name }),
    ...(matcher !== undefined && { matcher }),
  }
  return buildEditableMeta({
    ...identity,
    schemaKind: options.schemaKind ?? 'cursorMove',
    locked: options.locked,
    ...(options.lockedFields !== undefined && {
      lockedFields: options.lockedFields,
    }),
    defaults: options.defaults,
    position: nextEditablePosition(editableIdentityKey(identity)),
  })
}

/**
 * Editable metadata for the pointer-driven wrappers, which share the cursor
 * move option set (`move.duration/speed/easing/delayAfter`).
 */
function buildPointerEditableMeta(
  locator: Locator,
  subKind: InputEvent['subType'],
  values: {
    moveDuration?: number | undefined
    moveSpeed?: number | undefined
    moveEasing?: Easing | undefined
    moveDelayAfter?: number | undefined
    autoZoomOptions?: AutoZoomOptions | undefined
    hasExplicitMove: boolean
    /** The code-supplied move option, used to mark per-field provenance. */
    explicitMove?: CursorMoveOption['move']
  }
): EditableMeta | undefined {
  const lockedFields = [
    ...(values.explicitMove?.duration !== undefined ? ['moveDuration'] : []),
    ...(values.explicitMove?.speed !== undefined ? ['moveSpeed'] : []),
    ...(values.explicitMove?.easing !== undefined ? ['moveEasing'] : []),
    ...(values.explicitMove?.delayAfter !== undefined
      ? ['moveDelayAfter']
      : []),
  ]
  return buildInputEditableMeta(locator, subKind, {
    // Explicit code options mark provenance: web edits still apply, but the
    // editor and the record run warn that they shadow code values.
    locked: values.hasExplicitMove || values.autoZoomOptions !== undefined,
    lockedFields,
    defaults: {
      // moveDuration and moveSpeed are mutually exclusive; only default the
      // duration when no speed is in play so a merge never carries both.
      ...(values.moveSpeed === undefined && {
        moveDuration: values.moveDuration ?? DEFAULT_CLICK_MOUSE_MOVE_DURATION,
      }),
      ...(values.moveSpeed !== undefined && { moveSpeed: values.moveSpeed }),
      moveEasing: values.moveEasing ?? 'ease-in-out',
      moveDelayAfter: values.moveDelayAfter ?? DEFAULT_PRE_CLICK_PAUSE_MS,
    },
  })
}

/**
 * Cursor timing values shared by the pointer-driven wrappers. When the action
 * is editable, the web override (merged over the effective defaults by
 * {@link applyEditableOverride}) replaces the code-side values, warning when
 * it shadows an explicit one; a non-editable action keeps them untouched.
 */
type CursorTimingValues = {
  moveDuration?: number | undefined
  moveSpeed?: number | undefined
  moveEasing?: Easing | undefined
  moveDelayAfter?: number | undefined
}

function resolveCursorTimingOverrides(
  editable: EditableMeta | undefined,
  original: CursorTimingValues
): CursorTimingValues {
  if (editable === undefined) return original
  const eff = applyEditableOverride(editable)
  return {
    ...(typeof eff.moveDuration === 'number' && {
      moveDuration: eff.moveDuration,
    }),
    ...(typeof eff.moveSpeed === 'number' && { moveSpeed: eff.moveSpeed }),
    ...(typeof eff.moveEasing === 'string' && {
      moveEasing: eff.moveEasing as Easing,
    }),
    ...(typeof eff.moveDelayAfter === 'number' && {
      moveDelayAfter: eff.moveDelayAfter,
    }),
  }
}

/**
 * A single numeric override value for an editable action, for
 * action-specific fields outside {@link CursorTimingValues} (typing duration,
 * hover duration, drag duration). Undefined when not editable or no
 * numeric override is stored for the key.
 */
function editableOverrideNumber(
  editable: EditableMeta | undefined,
  key: string
): number | undefined {
  if (editable === undefined) return undefined
  const value = applyEditableOverride(editable)[key]
  return typeof value === 'number' ? value : undefined
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

  await appendMouseWait(innerEvents, beforeClickPause)

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
    ): Locator => {
      const child = original(...args)
      setLocatorDescription(
        child,
        chainLocatorDescription(
          getLocatorDescription(obj),
          describeLocatorCall(method, args)
        )
      )
      return instrumentLocator(child)
    }
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
    ] = (...args: unknown[]): Locator => {
      const child = original(...args)
      setLocatorDescription(
        child,
        chainLocatorDescription(
          getLocatorDescription(frameLocator),
          describeLocatorCall(method, args)
        )
      )
      return instrumentLocator(child)
    }
  }

  for (const method of FRAME_LOCATOR_SELF_RETURN_METHODS) {
    const original = (
      frameLocator as unknown as FrameLocatorSelfReturnMethodsRecord
    )[method].bind(frameLocator)
    ;(frameLocator as unknown as FrameLocatorSelfReturnMethodsRecord)[method] =
      (...args: unknown[]): FrameLocator => {
        const child = original(...args)
        setLocatorDescription(
          child,
          chainLocatorDescription(
            getLocatorDescription(frameLocator),
            describeLocatorCall(method, args)
          )
        )
        return instrumentFrameLocator(child)
      }
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
      move?: CursorMoveOption['move']
      autoZoomOptions?: AutoZoomOptions
    }
  ) => {
    const {
      move,
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

    assertDurationOrSpeed(move?.duration, move?.speed, 'click move')

    const effective = applyActionParams(locator, 'click', {
      ...cursorMoveSpec(move, DEFAULT_PRE_CLICK_PAUSE_MS),
      position: { explicit: position, fallback: null },
      noWaitAfter: { explicit: clickOptions.noWaitAfter, fallback: true },
    })
    const { moveDuration, moveSpeed, moveEasing, moveDelayAfter } =
      effectiveCursorMove(effective)
    const effectivePosition = asOptionalPoint(effective.position)

    const editable = buildPointerEditableMeta(locator, 'click', {
      moveDuration,
      moveSpeed,
      moveEasing,
      moveDelayAfter,
      autoZoomOptions,
      hasExplicitMove: move !== undefined,
      explicitMove: move,
    })
    const timing = resolveCursorTimingOverrides(editable, {
      moveDuration,
      moveSpeed,
      moveEasing,
      moveDelayAfter,
    })

    const { doClick, supportsTrial } = resolveLocatorMouseAction(
      locator,
      'click'
    )

    const result = await performAction(
      buildDefaultClickMouseMoveRequest({
        targetPosInElement: effectivePosition,
        moveDuration: timing.moveDuration,
        moveSpeed: timing.moveSpeed,
        moveEasing: timing.moveEasing,
      }),
      locator,
      doClick,
      supportsTrial,
      'singleDuring',
      autoZoomOptions,
      effectivePosition,
      effective.noWaitAfter as boolean,
      timing.moveDelayAfter ?? moveDelayAfter,
      0,
      false
    )

    const activeClickRecorder = getActiveClickRecorder(locator.page())
    if (activeClickRecorder && result) {
      activeClickRecorder.addInput(
        'click',
        undefined,
        result.innerEvents,
        editable
      )
    }
  }

  type PressSequentiallyOptions = Parameters<
    Locator['pressSequentially']
  >[1] & {
    move?: CursorMoveOption['move']
    noWaitAfter?: boolean
    forceClick?: boolean
    autoZoomOptions?: AutoZoomOptions
    hideMouse?: boolean
    position?: { x: number; y: number }
    redact?: boolean | RedactOptions
  }

  const originalPressSequentially = locator.pressSequentially.bind(locator)
  locator.pressSequentially = async (
    text: string,
    options?: PressSequentiallyOptions
  ): Promise<void> => {
    const shouldSkipDefaultClickAnimation =
      !options?.forceClick && (await isLocatorAlreadyFocusedForTyping(locator))
    const {
      move,
      noWaitAfter,
      forceClick: _forceClick,
      autoZoomOptions,
      hideMouse: _hideMouse,
      position,
      redact: redactOption,
      ...pressOptions
    } = options ?? {}

    if (isInsideHide()) {
      return originalPressSequentially(
        text,
        pressOptions as Parameters<Locator['pressSequentially']>[1]
      )
    }

    const effective = applyActionParams(locator, 'pressSequentially', {
      ...cursorMoveSpec(move, DEFAULT_PRE_CLICK_PAUSE_MS),
      position: { explicit: position, fallback: null },
      noWaitAfter: { explicit: noWaitAfter, fallback: true },
    })
    const { moveDuration, moveSpeed, moveEasing, moveDelayAfter } =
      effectiveCursorMove(effective)
    const effectivePosition = asOptionalPoint(effective.position)

    await applyActionRedact(locator, redactOption)

    const editable = buildPointerEditableMeta(locator, 'pressSequentially', {
      moveDuration,
      moveSpeed,
      moveEasing,
      moveDelayAfter,
      autoZoomOptions,
      hasExplicitMove: move !== undefined,
      explicitMove: move,
    })
    const timing = resolveCursorTimingOverrides(editable, {
      moveDuration,
      moveSpeed,
      moveEasing,
      moveDelayAfter,
    })

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
          targetPosInElement: effectivePosition,
          moveDuration: timing.moveDuration,
          moveSpeed: timing.moveSpeed,
          moveEasing: timing.moveEasing,
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
        effectivePosition,
        effective.noWaitAfter as boolean,
        timing.moveDelayAfter ?? moveDelayAfter,
        0,
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
        innerEvents,
        editable
      )
    }
  }

  const originalFill = locator.fill.bind(locator)
  locator.fill = async (
    value: string,
    options?: {
      move?: CursorMoveOption['move']
      noWaitAfter?: boolean
      forceClick?: boolean
      duration?: number
      timeout?: number
      position?: { x: number; y: number }
      hideMouse?: boolean
      redact?: boolean | RedactOptions
      autoZoomOptions?: AutoZoomOptions
    }
  ) => {
    if (isInsideHide()) {
      const {
        move: _move,
        noWaitAfter: _noWaitAfter,
        forceClick: _forceClick,
        duration: _duration,
        position: _position,
        hideMouse: _hideMouse,
        redact: _redact,
        autoZoomOptions: _autoZoomOptions,
        ...fillOptions
      } = options ?? {}

      return originalFill(value, fillOptions as Parameters<Locator['fill']>[1])
    }

    const shouldSkipDefaultClickAnimation =
      !options?.forceClick && (await isLocatorAlreadyFocusedForTyping(locator))

    const {
      move,
      noWaitAfter,
      hideMouse: _hideMouse,
      autoZoomOptions,
      position,
      redact: redactOption,
    } = options ?? {}

    const effective = applyActionParams(locator, 'fill', {
      ...cursorMoveSpec(move, DEFAULT_PRE_CLICK_PAUSE_MS),
      position: { explicit: position, fallback: null },
      noWaitAfter: { explicit: noWaitAfter, fallback: true },
      duration: {
        explicit: options?.duration,
        fallback: DEFAULT_FILL_TYPING_DURATION_MS,
      },
    })
    const { moveDuration, moveSpeed, moveEasing, moveDelayAfter } =
      effectiveCursorMove(effective)
    const effectivePosition = asOptionalPoint(effective.position)
    const typingDuration = asOptionalNumber(effective.duration) ?? 1000

    // Mask the field before any character is typed so the secret is never
    // captured in the clear.
    await applyActionRedact(locator, redactOption)

    const editable = buildPointerEditableMeta(locator, 'pressSequentially', {
      moveDuration,
      moveSpeed,
      moveEasing,
      moveDelayAfter,
      autoZoomOptions,
      hasExplicitMove: move !== undefined || options?.duration !== undefined,
      explicitMove: move,
    })
    if (editable !== undefined) {
      // Typing spread duration is fill-specific; expose it as an editable
      // field alongside the shared cursor timings.
      editable.defaults.duration = typingDuration
      addLockedFields(editable, { duration: options?.duration })
    }
    const timing = resolveCursorTimingOverrides(editable, {
      moveDuration,
      moveSpeed,
      moveEasing,
      moveDelayAfter,
    })
    const effTypingDuration =
      editableOverrideNumber(editable, 'duration') ?? typingDuration

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

      // A still keeps only the final frame, so spreading the keystrokes over a
      // typing animation is wasted time. Type instantly for screenshots (the
      // field still ends up filled), matching the instant cursor move.
      const duration = isScreenshotCapture() ? 0 : effTypingDuration
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
          targetPosInElement: effectivePosition,
          moveDuration: timing.moveDuration,
          moveSpeed: timing.moveSpeed,
          moveEasing: timing.moveEasing,
        }),
        locator,
        typeFilledValue,
        false,
        'singleBefore',
        autoZoomOptions,
        effectivePosition,
        effective.noWaitAfter as boolean,
        timing.moveDelayAfter ?? moveDelayAfter,
        0,
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
        innerEvents,
        editable
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
      move?: CursorMoveOption['move']
      noWaitAfter?: boolean
      autoZoomOptions?: AutoZoomOptions
    }
  ): Promise<void> => {
    const { move, noWaitAfter, position, autoZoomOptions, ...tapOpts } =
      options ?? {}

    if (isInsideHide()) {
      return originalTap({
        ...(tapOpts as Parameters<Locator['tap']>[0]),
        noWaitAfter: noWaitAfter ?? true,
      })
    }

    const effective = applyActionParams(locator, 'tap', {
      ...cursorMoveSpec(move, DEFAULT_PRE_CLICK_PAUSE_MS),
      position: { explicit: position, fallback: null },
      noWaitAfter: { explicit: noWaitAfter, fallback: true },
    })
    const { moveDuration, moveSpeed, moveEasing, moveDelayAfter } =
      effectiveCursorMove(effective)
    const effectivePosition = asOptionalPoint(effective.position)

    const editable = buildPointerEditableMeta(locator, 'tap', {
      moveDuration,
      moveSpeed,
      moveEasing,
      moveDelayAfter,
      autoZoomOptions,
      hasExplicitMove: move !== undefined,
      explicitMove: move,
    })
    const timing = resolveCursorTimingOverrides(editable, {
      moveDuration,
      moveSpeed,
      moveEasing,
      moveDelayAfter,
    })

    const { doClick, supportsTrial } = resolveLocatorMouseAction(locator, 'tap')

    const result = await performAction(
      buildDefaultClickMouseMoveRequest({
        targetPosInElement: effectivePosition,
        moveDuration: timing.moveDuration,
        moveSpeed: timing.moveSpeed,
        moveEasing: timing.moveEasing,
      }),
      locator,
      doClick,
      supportsTrial,
      'singleDuring',
      autoZoomOptions,
      effectivePosition,
      effective.noWaitAfter as boolean,
      timing.moveDelayAfter ?? moveDelayAfter,
      0,
      false
    )

    const activeClickRecorder = getActiveClickRecorder(locator.page())
    if (activeClickRecorder && result) {
      activeClickRecorder.addInput(
        'tap',
        result.elementRect,
        result.innerEvents,
        editable
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
      move?: CursorMoveOption['move']
      noWaitAfter?: boolean
      autoZoomOptions?: AutoZoomOptions
    }
  ): Promise<void> => {
    const { move, noWaitAfter, position, autoZoomOptions, ...checkOpts } =
      options ?? {}

    if (isInsideHide()) {
      return originalCheck({
        ...(checkOpts as Parameters<Locator['check']>[0]),
        noWaitAfter: noWaitAfter ?? true,
      })
    }

    const effective = applyActionParams(locator, 'check', {
      ...cursorMoveSpec(move, DEFAULT_PRE_CLICK_PAUSE_MS),
      position: { explicit: position, fallback: null },
      noWaitAfter: { explicit: noWaitAfter, fallback: true },
    })
    const { moveDuration, moveSpeed, moveEasing, moveDelayAfter } =
      effectiveCursorMove(effective)
    const effectivePosition = asOptionalPoint(effective.position)

    const editable = buildPointerEditableMeta(locator, 'check', {
      moveDuration,
      moveSpeed,
      moveEasing,
      moveDelayAfter,
      autoZoomOptions,
      hasExplicitMove: move !== undefined,
      explicitMove: move,
    })
    const timing = resolveCursorTimingOverrides(editable, {
      moveDuration,
      moveSpeed,
      moveEasing,
      moveDelayAfter,
    })

    const { doClick, supportsTrial } = resolveLocatorMouseAction(
      locator,
      'check'
    )

    const result = await performAction(
      buildDefaultClickMouseMoveRequest({
        targetPosInElement: effectivePosition,
        moveDuration: timing.moveDuration,
        moveSpeed: timing.moveSpeed,
        moveEasing: timing.moveEasing,
      }),
      locator,
      doClick,
      supportsTrial,
      'singleDuring',
      autoZoomOptions,
      effectivePosition,
      effective.noWaitAfter as boolean,
      timing.moveDelayAfter ?? moveDelayAfter,
      0,
      false
    )

    const activeClickRecorder = getActiveClickRecorder(locator.page())
    if (activeClickRecorder && result) {
      activeClickRecorder.addInput(
        'check',
        result.elementRect,
        result.innerEvents,
        editable
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
      move?: CursorMoveOption['move']
      noWaitAfter?: boolean
      autoZoomOptions?: AutoZoomOptions
    }
  ): Promise<void> => {
    const { move, noWaitAfter, position, autoZoomOptions, ...uncheckOpts } =
      options ?? {}

    if (isInsideHide()) {
      return originalUncheck({
        ...(uncheckOpts as Parameters<Locator['uncheck']>[0]),
        noWaitAfter: noWaitAfter ?? true,
      })
    }

    const effective = applyActionParams(locator, 'uncheck', {
      ...cursorMoveSpec(move, DEFAULT_PRE_CLICK_PAUSE_MS),
      position: { explicit: position, fallback: null },
      noWaitAfter: { explicit: noWaitAfter, fallback: true },
    })
    const { moveDuration, moveSpeed, moveEasing, moveDelayAfter } =
      effectiveCursorMove(effective)
    const effectivePosition = asOptionalPoint(effective.position)

    const editable = buildPointerEditableMeta(locator, 'uncheck', {
      moveDuration,
      moveSpeed,
      moveEasing,
      moveDelayAfter,
      autoZoomOptions,
      hasExplicitMove: move !== undefined,
      explicitMove: move,
    })
    const timing = resolveCursorTimingOverrides(editable, {
      moveDuration,
      moveSpeed,
      moveEasing,
      moveDelayAfter,
    })

    const { doClick, supportsTrial } = resolveLocatorMouseAction(
      locator,
      'uncheck'
    )

    const result = await performAction(
      buildDefaultClickMouseMoveRequest({
        targetPosInElement: effectivePosition,
        moveDuration: timing.moveDuration,
        moveSpeed: timing.moveSpeed,
        moveEasing: timing.moveEasing,
      }),
      locator,
      doClick,
      supportsTrial,
      'singleDuring',
      autoZoomOptions,
      effectivePosition,
      effective.noWaitAfter as boolean,
      timing.moveDelayAfter ?? moveDelayAfter,
      0,
      false
    )

    const activeClickRecorder = getActiveClickRecorder(locator.page())
    if (activeClickRecorder && result) {
      activeClickRecorder.addInput(
        'uncheck',
        result.elementRect,
        result.innerEvents,
        editable
      )
    }
  }

  locator.setChecked = async (
    checked: boolean,
    options?: Parameters<Locator['check']>[0] & {
      move?: CursorMoveOption['move']
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
      move?: CursorMoveOption['move']
      noWaitAfter?: boolean
      position?: { x: number; y: number }
      autoZoomOptions?: AutoZoomOptions
    }
  ): Promise<string[]> => {
    const { move, noWaitAfter, position, autoZoomOptions, ...selectOpts } =
      options ?? {}

    if (isInsideHide()) {
      return originalSelectOption(values, {
        ...(selectOpts as Parameters<Locator['selectOption']>[1]),
        noWaitAfter: noWaitAfter ?? true,
      })
    }

    const effective = applyActionParams(locator, 'selectOption', {
      ...cursorMoveSpec(move, DEFAULT_PRE_CLICK_PAUSE_MS),
      position: { explicit: position, fallback: null },
      noWaitAfter: { explicit: noWaitAfter, fallback: true },
    })
    const { moveDuration, moveSpeed, moveEasing, moveDelayAfter } =
      effectiveCursorMove(effective)
    const effectivePosition = asOptionalPoint(effective.position)

    currentSelectValues = values
    currentSelectOptions = selectOpts as Parameters<Locator['selectOption']>[1]
    currentSelectResult = []
    const editable = buildPointerEditableMeta(locator, 'select', {
      moveDuration,
      moveSpeed,
      moveEasing,
      moveDelayAfter,
      autoZoomOptions,
      hasExplicitMove: move !== undefined,
      explicitMove: move,
    })
    const timing = resolveCursorTimingOverrides(editable, {
      moveDuration,
      moveSpeed,
      moveEasing,
      moveDelayAfter,
    })

    const { doClick, supportsTrial } = resolveLocatorMouseAction(
      locator,
      'select'
    )
    const actionResult = await performAction(
      buildDefaultClickMouseMoveRequest({
        targetPosInElement: effectivePosition,
        moveDuration: timing.moveDuration,
        moveSpeed: timing.moveSpeed,
        moveEasing: timing.moveEasing,
      }),
      locator,
      doClick,
      supportsTrial,
      'singleDuring',
      autoZoomOptions,
      effectivePosition,
      effective.noWaitAfter as boolean,
      timing.moveDelayAfter ?? moveDelayAfter,
      0
    )

    const activeClickRecorder = getActiveClickRecorder(locator.page())
    if (activeClickRecorder && actionResult) {
      activeClickRecorder.addInput(
        'select',
        actionResult.elementRect,
        actionResult.innerEvents,
        editable
      )
    }

    return currentSelectResult
  }

  const originalHover = locator.hover.bind(locator)
  locator.hover = async (
    options?: Parameters<Locator['hover']>[0] & {
      move?: CursorMoveOption['move']
      duration?: number
      autoZoomOptions?: AutoZoomOptions
    }
  ): Promise<void> => {
    const { move, duration, position, ...hoverOptions } = options ?? {}

    assertDurationOrSpeed(move?.duration, move?.speed, 'hover move')

    const effective = applyActionParams(locator, 'hover', {
      'move.duration': { explicit: move?.duration, fallback: null },
      'move.speed': { explicit: move?.speed, fallback: null },
      'move.easing': { explicit: move?.easing, fallback: 'ease-in-out' },
      position: { explicit: position, fallback: null },
      duration: { explicit: duration, fallback: DEFAULT_HOVER_DURATION_MS },
    })
    const moveDuration = asOptionalNumber(effective['move.duration'])
    const moveSpeed = asOptionalNumber(effective['move.speed'])
    const moveEasing = (effective['move.easing'] as Easing) ?? 'ease-in-out'
    const effectivePosition = asOptionalPoint(effective.position)
    const hoverDuration = asOptionalNumber(effective.duration) ?? 1000

    const editable = buildPointerEditableMeta(locator, 'hover', {
      moveDuration,
      moveSpeed,
      moveEasing,
      autoZoomOptions: options?.autoZoomOptions,
      hasExplicitMove: move !== undefined || options?.duration !== undefined,
      explicitMove: move,
    })
    if (editable !== undefined) {
      // Hover hold duration is hover-specific; expose it as an editable field
      // alongside the shared cursor timings.
      editable.defaults.duration = hoverDuration
      delete editable.defaults.moveDelayAfter
      addLockedFields(editable, { duration: options?.duration })
    }
    const timing = resolveCursorTimingOverrides(editable, {
      moveDuration,
      moveSpeed,
      moveEasing,
    })
    const effHoverDuration =
      editableOverrideNumber(editable, 'duration') ?? hoverDuration

    const innerEvents: Array<
      FocusChangeEvent | MouseMoveEvent | MouseWaitEvent
    > = []

    const mouseMovePlan = {
      targetPosInElement: effectivePosition,
      ...(timing.moveDuration !== undefined
        ? { duration: timing.moveDuration }
        : {}),
      ...(timing.moveSpeed !== undefined ? { speed: timing.moveSpeed } : {}),
      easing: timing.moveEasing ?? moveEasing,
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
      ...(effectivePosition ? { position: effectivePosition } : {}),
    })
    if (effHoverDuration > 0) {
      await sleep(effHoverDuration)
    }
    const waitFinishMs = Date.now()

    innerEvents.push({
      type: 'mouseWait',
      startMs: waitStartMs,
      endMs: waitFinishMs,
    })

    const activeClickRecorder = getActiveClickRecorder(locator.page())
    if (activeClickRecorder && innerEvents.length > 0) {
      activeClickRecorder.addInput('hover', locatorRect, innerEvents, editable)
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

    const effective = applyActionParams(locator, 'scrollIntoViewIfNeeded', {
      easing: { explicit: options?.easing, fallback: 'ease-in-out' },
      duration: { explicit: options?.duration, fallback: null },
      amount: { explicit: options?.amount, fallback: null },
      centering: { explicit: options?.centering, fallback: null },
    })
    const easing = (effective.easing as Easing) ?? 'ease-in-out'
    const duration = asOptionalNumber(effective.duration)
    const amount = asOptionalNumber(effective.amount)
    const centering = asOptionalNumber(effective.centering)

    const editable = buildInputEditableMeta(locator, 'focusChange', {
      locked: hasExplicitOption(
        options?.easing,
        options?.duration,
        options?.amount,
        options?.centering
      ),
      lockedFields: [
        ...(options?.easing !== undefined ? ['easing'] : []),
        ...(options?.duration !== undefined ? ['duration'] : []),
        ...(options?.amount !== undefined ? ['amount'] : []),
        ...(options?.centering !== undefined ? ['centering'] : []),
      ],
      schemaKind: 'autoZoom',
      // Unset optional fields are recorded as null so the web editor knows the
      // field exists and may set it (an override key must exist in defaults).
      defaults: {
        easing,
        duration: duration ?? null,
        amount: amount ?? null,
        centering: centering ?? null,
      },
    })
    const eff =
      editable !== undefined ? applyEditableOverride(editable) : undefined
    const effEasing =
      typeof eff?.easing === 'string' ? (eff.easing as Easing) : easing
    const effDuration =
      typeof eff?.duration === 'number' ? eff.duration : duration
    const effAmount = typeof eff?.amount === 'number' ? eff.amount : amount
    const effCentering =
      typeof eff?.centering === 'number' ? eff.centering : centering

    const result = await changeFocus(locator, {
      easing: effEasing,
      ...(effDuration !== undefined ? { duration: effDuration } : {}),
      ...(effAmount !== undefined ? { amount: effAmount } : {}),
      ...(effCentering !== undefined ? { centering: effCentering } : {}),
    })

    const activeClickRecorder = getActiveClickRecorder(locator.page())
    if (activeClickRecorder) {
      activeClickRecorder.addInput(
        'focusChange',
        result.elementRect,
        [result],
        editable
      )
    }
  }

  const originalSelectText = locator.selectText.bind(locator)
  locator.selectText = async (
    options?: Parameters<Locator['selectText']>[0] & {
      move?: CursorMoveOption['move']
      duration?: number
      autoZoomOptions?: AutoZoomOptions
    }
  ): Promise<void> => {
    const { move, duration, autoZoomOptions, ...selectOpts } = options ?? {}

    assertDurationOrSpeed(move?.duration, move?.speed, 'selectText move')

    const effective = applyActionParams(locator, 'selectText', {
      ...cursorMoveSpec(move, DEFAULT_PRE_CLICK_PAUSE_MS),
      duration: { explicit: duration, fallback: null },
    })
    const { moveDuration, moveSpeed, moveEasing, moveDelayAfter } =
      effectiveCursorMove(effective)
    const selectDuration = asOptionalNumber(effective.duration)

    const editable = buildPointerEditableMeta(locator, 'selectText', {
      moveDuration,
      moveSpeed,
      moveEasing,
      moveDelayAfter,
      autoZoomOptions,
      hasExplicitMove: move !== undefined || duration !== undefined,
      explicitMove: move,
    })
    if (editable !== undefined) {
      // Selection sweep duration is selectText-specific.
      editable.defaults.duration = selectDuration ?? null
      addLockedFields(editable, { duration })
    }
    const timing = resolveCursorTimingOverrides(editable, {
      moveDuration,
      moveSpeed,
      moveEasing,
      moveDelayAfter,
    })
    const effSelectDuration =
      editableOverrideNumber(editable, 'duration') ?? selectDuration

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
        moveDuration: timing.moveDuration,
        moveSpeed: timing.moveSpeed,
        moveEasing: timing.moveEasing,
      }),
      locator,
      async () => {
        await originalSelectText(selectOpts)
      },
      false,
      'tripleBefore',
      autoZoomOptions,
      undefined,
      undefined,
      timing.moveDelayAfter ?? moveDelayAfter,
      undefined,
      false,
      effSelectDuration
    )

    const locatorRect = selectActionResult?.elementRect
    innerEvents.push(...(selectActionResult?.innerEvents ?? []))

    const activeClickRecorder = getActiveClickRecorder(locator.page())
    if (activeClickRecorder && innerEvents.length > 0) {
      activeClickRecorder.addInput(
        'selectText',
        locatorRect,
        innerEvents,
        editable
      )
    }
  }

  locator.dragTo = async (
    target: Locator,
    options?: Omit<NonNullable<Parameters<Locator['dragTo']>[1]>, 'steps'> & {
      move?: CursorMoveOption['move']
      duration?: number
      speed?: number
      easing?: Easing
      dragSteps?: number
      autoZoomOptions?: AutoZoomOptions
    }
  ): Promise<void> => {
    const { move, sourcePosition, targetPosition, autoZoomOptions } =
      options ?? {}

    assertDurationOrSpeed(move?.duration, move?.speed, 'dragTo move')
    assertDurationOrSpeed(options?.duration, options?.speed, 'dragTo drag')

    const effective = applyActionParams(locator, 'dragTo', {
      ...cursorMoveSpec(move, DEFAULT_DRAG_PRESS_DELAY_MS),
      duration: { explicit: options?.duration, fallback: null },
      speed: { explicit: options?.speed, fallback: null },
      easing: { explicit: options?.easing, fallback: 'ease-in-out' },
      dragSteps: { explicit: options?.dragSteps, fallback: DEFAULT_DRAG_STEPS },
      sourcePosition: { explicit: sourcePosition, fallback: null },
      targetPosition: { explicit: targetPosition, fallback: null },
    })
    const { moveDuration, moveSpeed, moveEasing, moveDelayAfter } =
      effectiveCursorMove(effective)
    const dragSpeed = asOptionalNumber(effective.speed)
    const duration =
      dragSpeed !== undefined ? undefined : asOptionalNumber(effective.duration)
    const speed = dragSpeed
    const easing = (effective.easing as Easing) ?? 'ease-in-out'
    const dragSteps =
      asOptionalNumber(effective.dragSteps) ?? DEFAULT_DRAG_STEPS
    const effectiveSourcePosition = asOptionalPoint(effective.sourcePosition)
    const effectiveTargetPosition = asOptionalPoint(effective.targetPosition)

    const editable = buildPointerEditableMeta(locator, 'dragTo', {
      moveDuration,
      moveSpeed,
      moveEasing,
      moveDelayAfter,
      autoZoomOptions,
      hasExplicitMove:
        move !== undefined ||
        hasExplicitOption(duration, speed, options?.easing, options?.dragSteps),
      explicitMove: move,
    })
    if (editable !== undefined) {
      // Drag-phase fields are dragTo-specific.
      editable.defaults.duration = duration ?? DEFAULT_CLICK_MOUSE_MOVE_DURATION
      editable.defaults.easing = easing
      editable.defaults.dragSteps = dragSteps
      addLockedFields(editable, {
        duration,
        easing: options?.easing,
        dragSteps: options?.dragSteps,
      })
    }
    const timing = resolveCursorTimingOverrides(editable, {
      moveDuration,
      moveSpeed,
      moveEasing,
      moveDelayAfter,
    })
    const effDragDuration =
      editableOverrideNumber(editable, 'duration') ?? duration
    const effDragSteps =
      editableOverrideNumber(editable, 'dragSteps') ?? dragSteps

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
      effectiveTargetPosition ??
      (targetRectPreview
        ? { x: targetRectPreview.width / 2, y: targetRectPreview.height / 2 }
        : undefined)

    const sourceFocusChange = await changeFocus(locator, autoZoomOptions, {
      targetPosInElement: effectiveSourcePosition,
      ...(timing.moveDuration !== undefined
        ? { duration: timing.moveDuration }
        : {}),
      ...(timing.moveSpeed !== undefined ? { speed: timing.moveSpeed } : {}),
      easing: timing.moveEasing ?? moveEasing,
    })

    if (sourceFocusChange.elementRect) {
      innerEvents.push(sourceFocusChange)
    }

    // 2. move.delayAfter + mouseDown
    await sleep(timing.moveDelayAfter ?? moveDelayAfter)
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
        duration: effDragDuration,
        speed,
        defaultDuration: DEFAULT_CLICK_MOUSE_MOVE_DURATION,
        context: 'dragTo drag',
      })
      await performMouseMove({
        page,
        targetX: toX,
        targetY: toY,
        duration: resolvedDuration,
        easing,
        steps: effDragSteps,
      })
      innerEvents.push({
        type: 'mouseMove',
        startMs: dragStartTime,
        endMs: Date.now(),
        x: toX,
        y: toY,
        ...(resolvedDuration > 0 ? { easing } : {}),
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
        innerEvents,
        editable
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
    ): Locator => {
      const child = original(...args)
      setLocatorDescription(
        child,
        chainLocatorDescription(
          getLocatorDescription(locator),
          describeLocatorCall(method, args)
        )
      )
      return instrumentLocator(child)
    }
  }

  const originalAll = locator.all.bind(locator)
  locator.all = async (): Promise<Array<Locator>> => {
    const locators = await originalAll()
    return locators.map((item, index) => {
      setLocatorDescription(
        item,
        chainLocatorDescription(
          getLocatorDescription(locator),
          describeLocatorCall('nth', [index])
        )
      )
      return instrumentLocator(item)
    })
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
      move?: CursorMoveOption['move']
      autoZoomOptions?: AutoZoomOptions
    }
  ) => {
    return (
      page.locator(selector) as unknown as {
        click: (options?: unknown) => Promise<void>
      }
    ).click(options)
  }

  const originalWaitForTimeout = page.waitForTimeout.bind(page)
  page.waitForTimeout = (async (timeout?: number): Promise<void> => {
    // Two forms: a number from code (explicit, overriding it warns) and no
    // argument (a web-editable pause defaulting to 0).
    const requested = typeof timeout === 'number' ? timeout : 0
    const locked = typeof timeout === 'number'
    const editable = buildEditableMeta({
      kind: 'delay',
      schemaKind: 'delay',
      locked,
      ...(locked && { lockedFields: ['durationMs'] }),
      defaults: { durationMs: requested },
      position: nextEditablePosition(editableIdentityKey({ kind: 'delay' })),
    })
    const effDuration =
      editableOverrideNumber(editable, 'durationMs') ?? requested
    // Recorded before the wait so timeMs marks the start of the pause
    // (timeMs + durationMs is its end on the editor timeline).
    if (!isInsideHide()) {
      getActiveClickRecorder(page).addDelay(effDuration, editable)
    }
    await originalWaitForTimeout(resolveRecordingTimingDuration(effDuration))
  }) as Page['waitForTimeout']

  const originalRoute = page.route.bind(page)
  page.route = (async (
    url: Parameters<Page['route']>[0],
    handler: Parameters<Page['route']>[1],
    options?: Parameters<Page['route']>[2]
  ) => {
    return originalRoute(
      url,
      wrapRouteHandler(
        page,
        handler as RouteHandler,
        'page.route'
      ) as typeof handler,
      options
    )
  }) as Page['route']

  const originalUnroute = page.unroute.bind(page)
  page.unroute = (async (
    url: Parameters<Page['unroute']>[0],
    handler?: Parameters<Page['unroute']>[1]
  ) => {
    return originalUnroute(
      url,
      handler
        ? (unwrapRouteHandler(page, handler as RouteHandler) as typeof handler)
        : undefined
    )
  }) as Page['unroute']

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
    const zoomEvent = resolveAutoZoomCursorFollow(
      page,
      { x, y },
      { startMs: moveResult.startMs, endMs: moveResult.endMs, duration, easing }
    )
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
      ...(zoomEvent !== undefined ? { zoom: zoomEvent } : {}),
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
    const zoomEvent = resolveAutoZoomCursorFollow(
      page,
      { x, y },
      {
        startMs: moveResult.startMs,
        endMs: moveResult.endMs,
        duration,
        easing: moveEasing,
      }
    )
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
      ...(zoomEvent !== undefined ? { zoom: zoomEvent } : {}),
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
    move?: CursorMoveOption['move']
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
      move,
      duration,
      easing = 'ease-in-out',
      fake,
      ...native
    } = options ?? {}
    const { moveDuration, moveSpeed, moveEasing } =
      resolveCursorMoveOption(move)

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
      move,
      duration,
      easing = 'ease-in-out',
      fake,
      ...native
    } = options ?? {}
    const { moveDuration, moveSpeed, moveEasing } =
      resolveCursorMoveOption(move)

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

  const originalRoute = context.route.bind(context)
  context.route = (async (
    url: Parameters<BrowserContext['route']>[0],
    handler: Parameters<BrowserContext['route']>[1],
    options?: Parameters<BrowserContext['route']>[2]
  ) => {
    return originalRoute(
      url,
      wrapRouteHandler(
        context,
        handler as RouteHandler,
        'browserContext.route'
      ) as typeof handler,
      options
    )
  }) as BrowserContext['route']

  const originalUnroute = context.unroute.bind(context)
  context.unroute = (async (
    url: Parameters<BrowserContext['unroute']>[0],
    handler?: Parameters<BrowserContext['unroute']>[1]
  ) => {
    return originalUnroute(
      url,
      handler
        ? (unwrapRouteHandler(
            context,
            handler as RouteHandler
          ) as typeof handler)
        : undefined
    )
  }) as BrowserContext['unroute']

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
