/**
 * Action-parameter provenance. Every instrumented Playwright action (click,
 * fill, hover, ...) reports which option values it used and whether each value
 * was explicit at the call site or a default. The records are serialized into
 * `data.json` (so the backend learns the used values and their provenance) and
 * snapshotted under `.screenci` so the next `record` run can warn when a web
 * editor override shadows an explicitly code-set value.
 *
 * Editor overrides arrive keyed by
 * `"<selector>|<method>|<occurrence>|<optionPath>"` and are applied to the
 * action before it runs; every application is logged.
 */
import { logger } from './logger.js'

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

/** One recorded parameter: the code value used and where it came from. */
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

/** Editor overrides for one video: `paramKey -> value`. */
export type ActionOverrides = Record<string, unknown>

/** Editor overrides keyed by video name. */
export type ActionOverridesByVideo = Record<string, ActionOverrides>

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

/**
 * Whether an override value is acceptable for a parameter: primitives always,
 * plain objects/arrays for structured options (e.g. `position`). Functions and
 * symbols never (they cannot come from JSON anyway).
 */
function isApplicableOverride(value: unknown): boolean {
  const t = typeof value
  return (
    t === 'number' ||
    t === 'string' ||
    t === 'boolean' ||
    (t === 'object' && value !== null)
  )
}

/**
 * Collects the {@link ActionParamRecord}s of one recording and applies editor
 * overrides. One instance per `EventRecorder`; constructor-injected so tests
 * build it directly with fake overrides and a spy logger.
 */
export class ActionParamCollector {
  private readonly records: ActionParamRecord[] = []
  private readonly occurrences = new Map<string, number>()
  private readonly overrides: ActionOverrides
  private readonly log: (message: string) => void

  constructor(
    overrides: ActionOverrides = {},
    log: (message: string) => void = (message) => logger.info(message)
  ) {
    this.overrides = overrides
    this.log = log
  }

  /**
   * Record one action call and return the effective option values: the editor
   * override when present (logged per application), else the explicit call-site
   * value, else the default. The stored record always carries the code value
   * and its provenance, never the override.
   */
  apply(
    selector: string,
    method: ActionMethod,
    spec: ActionParamSpec
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

      const overrideKey = actionParamKey(
        selector,
        method,
        occurrence,
        optionPath
      )
      const override = this.overrides[overrideKey]
      if (override !== undefined && isApplicableOverride(override)) {
        effective[optionPath] = override
        this.log(
          `[screenci] editor override: ${selector} ${method} ${optionPath}: ` +
            `${JSON.stringify(override)} (code: ${JSON.stringify(
              toRecordedValue(codeValue)
            )}, ${source})`
        )
      } else {
        effective[optionPath] = codeValue
      }
    }

    this.records.push({ selector, method, occurrence, params })
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
