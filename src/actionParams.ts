/**
 * Action-parameter provenance. Every instrumented Playwright action (click,
 * fill, hover, ...) reports which option values it used and whether each value
 * was explicit at the call site or a default. The records are serialized into
 * `data.json` so the backend learns the used values and their provenance; the
 * web editor's edits themselves are codegen'd straight into the sources by
 * `screenci dev`, so the recorded code values are always what a run used.
 */
import {
  DEFAULT_CLICK_MOUSE_MOVE_DURATION,
  DEFAULT_CURSOR_CURVE,
  DEFAULT_DRAG_PRESS_DELAY_MS,
  DEFAULT_DRAG_STEPS,
  DEFAULT_FILL_TYPING_DURATION_MS,
  DEFAULT_HOVER_DURATION_MS,
  DEFAULT_PRE_CLICK_PAUSE_MS,
} from './defaults.js'

/** The instrumented locator methods that report parameter provenance. */
export type ActionMethod =
  | 'click'
  | 'fill'
  | 'pressSequentially'
  | 'tap'
  | 'check'
  | 'uncheck'
  | 'selectOption'
  | 'hover'
  | 'dragTo'
  | 'selectText'
  | 'scrollIntoViewIfNeeded'

/** Whether a parameter value was set at the call site or fell back to a default. */
export type ParamSource = 'explicit' | 'default'

/** One recorded parameter: the code value and its provenance. */
export type ActionParamValue = {
  /** The code value (JSON-safe; `null` when the code value is undefined). */
  value: unknown
  source: ParamSource
}

/**
 * The parameters of one instrumented action call. `occurrence` disambiguates
 * repeated `selector + method` calls within one recording (0-based, in call
 * order). `params` maps an option path (e.g. `move.duration`) to the code
 * value and its provenance; editor overrides never replace `params` (the code
 * value is what the provenance describes).
 */
export type ActionParamRecord = {
  selector: string
  method: ActionMethod
  occurrence: number
  /** The call site's editId slug, when the action was called with one. */
  editId?: string
  params: Record<string, ActionParamValue>
}

/**
 * The declaration an instrumented wrapper makes for each option: the explicit
 * call-site value (undefined when not passed) and the default it falls back to.
 */
export type ActionParamSpec = Record<
  string,
  { explicit: unknown; fallback: unknown }
>

/** The cursor-move option defaults shared by every mouse-driven action. */
function cursorMoveDefaults(delayAfter: number): Record<string, unknown> {
  return {
    // Effective when no `move.speed` is given; with a speed the duration is
    // derived from the travel distance instead.
    'move.duration': DEFAULT_CLICK_MOUSE_MOVE_DURATION,
    'move.speed': null,
    'move.easing': 'ease-in-out',
    'move.curve': DEFAULT_CURSOR_CURVE,
    'move.curviness': null,
    'move.delayAfter': delayAfter,
  }
}

const CLICK_LIKE_DEFAULTS: Record<string, unknown> = {
  ...cursorMoveDefaults(DEFAULT_PRE_CLICK_PAUSE_MS),
  position: null,
  noWaitAfter: true,
}

/**
 * The default value of every tracked action option, per method and option
 * path, exactly as the instrumented actions resolve them (`null` = no default;
 * the option stays unset unless given). Exported from the SDK so the backend
 * and web editor can tell an override that merely restates the default from a
 * real change, and can offer "reset to default".
 */
export const ACTION_PARAM_DEFAULTS: Record<
  ActionMethod,
  Record<string, unknown>
> = {
  click: CLICK_LIKE_DEFAULTS,
  tap: CLICK_LIKE_DEFAULTS,
  check: CLICK_LIKE_DEFAULTS,
  uncheck: CLICK_LIKE_DEFAULTS,
  selectOption: CLICK_LIKE_DEFAULTS,
  pressSequentially: {
    ...CLICK_LIKE_DEFAULTS,
    // Total typing time. Its default is derived per call from the text length
    // (text.length * DEFAULT_PRESS_SEQUENTIALLY_MS_PER_CHAR), so there is no
    // single static default here; the per-call value the recording used is the
    // baseline the editor compares against.
    duration: null,
  },
  fill: {
    ...CLICK_LIKE_DEFAULTS,
    duration: DEFAULT_FILL_TYPING_DURATION_MS,
  },
  hover: {
    'move.duration': null,
    'move.speed': null,
    'move.easing': 'ease-in-out',
    'move.curve': DEFAULT_CURSOR_CURVE,
    'move.curviness': null,
    position: null,
    duration: DEFAULT_HOVER_DURATION_MS,
  },
  selectText: {
    ...cursorMoveDefaults(DEFAULT_PRE_CLICK_PAUSE_MS),
    duration: null,
  },
  dragTo: {
    ...cursorMoveDefaults(DEFAULT_DRAG_PRESS_DELAY_MS),
    duration: null,
    speed: null,
    easing: 'ease-in-out',
    dragSteps: DEFAULT_DRAG_STEPS,
    sourcePosition: null,
    targetPosition: null,
  },
  scrollIntoViewIfNeeded: {
    easing: 'ease-in-out',
    duration: null,
    amount: null,
    centering: null,
  },
}

/** The wire/snapshot key of one parameter of one action call. */
export function actionParamKey(
  selector: string,
  method: ActionMethod,
  occurrence: number,
  optionPath: string
): string {
  return `${selector}|${method}|${occurrence}|${optionPath}`
}

/**
 * Stable selector serialization for keying. Playwright's `String(locator)`
 * yields e.g. `Locator@getByRole('button', { name: 'Save' })` (older versions)
 * or `getByRole('button', { name: 'Save' })`; the engine prefix is noise, so it
 * is stripped.
 */
export function normalizeSelector(locator: unknown): string {
  const raw = String(locator)
  return raw.replace(/^Locator@/, '')
}

/** JSON-safe copy of a code value: undefined collapses to null. */
function toRecordedValue(value: unknown): unknown {
  return value === undefined ? null : value
}

/** JSON-shape equality for override-vs-code comparison (both are JSON-safe). */
export function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Collects the {@link ActionParamRecord}s of one recording. One instance per
 * `EventRecorder`.
 */
export class ActionParamCollector {
  private readonly records: ActionParamRecord[] = []
  private readonly occurrences = new Map<string, number>()

  /**
   * Record one action call and return the effective option values: the
   * explicit call-site value, else the default. The `value`/`source` fields
   * describe the code side.
   */
  apply(
    selector: string,
    method: ActionMethod,
    spec: ActionParamSpec,
    editId?: string
  ): Record<string, unknown> {
    const occurrenceKey = `${selector}|${method}`
    const occurrence = this.occurrences.get(occurrenceKey) ?? 0
    this.occurrences.set(occurrenceKey, occurrence + 1)

    const params: Record<string, ActionParamValue> = {}
    const effective: Record<string, unknown> = {}
    for (const [optionPath, { explicit, fallback }] of Object.entries(spec)) {
      const codeValue = explicit !== undefined ? explicit : fallback
      const source: ParamSource =
        explicit !== undefined ? 'explicit' : 'default'
      params[optionPath] = { value: toRecordedValue(codeValue), source }
      effective[optionPath] = codeValue
    }

    this.records.push({
      selector,
      method,
      occurrence,
      ...(editId !== undefined && { editId }),
      params,
    })
    return effective
  }

  getRecords(): ActionParamRecord[] {
    return [...this.records]
  }
}

/**
 * Effective values without tracking or overrides: what an action resolves to
 * outside a recording (the no-op recorder path). Explicit wins over fallback.
 */
export function resolveSpecWithoutTracking(
  spec: ActionParamSpec
): Record<string, unknown> {
  const effective: Record<string, unknown> = {}
  for (const [optionPath, { explicit, fallback }] of Object.entries(spec)) {
    effective[optionPath] = explicit !== undefined ? explicit : fallback
  }
  return effective
}
