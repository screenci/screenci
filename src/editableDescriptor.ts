/**
 * Identity model for web-editable actions.
 *
 * Every timeline action that the web editor can configure (clicks, zooms,
 * speed blocks, delays) is stamped with an {@link EditableActionDescriptor}
 * describing WHAT the action is (kind, sub-kind, explicit name or locator
 * matcher) and WHERE it sits in the recording (ordinal among identical
 * actions, absolute sequence position). The backend matches stored overrides
 * against these descriptors across re-records, so the identity fields must be
 * derived only from the test code, never from wall-clock timing.
 */

/** Top-level action category. Extend the union when new editables appear. */
export type EditableActionKind =
  | 'input'
  | 'autoZoom'
  | 'speed'
  | 'delay'
  | 'hide'
  | 'time'
  | 'update'

/**
 * Which option form the web editor renders for the action. The `defaults`
 * map's keys define the concrete fields; this picks the panel layout.
 */
export type EditableSchemaKind =
  | 'cursorMove'
  | 'autoZoom'
  | 'speed'
  | 'delay'
  | 'hide'
  | 'time'
  | 'narrationUpdate'
  | 'recordingUpdate'
  | 'backgroundUpdate'
  | 'redact'

export type EditableActionDescriptor = {
  kind: EditableActionKind
  /** Input action sub-kind: 'click', 'pressSequentially', 'dragTo', ... */
  subKind?: string
  /**
   * Stable, human-readable identity slug from code (e.g. `fill1`, `autoZoom2`),
   * set via the `editId` option and stamped automatically by `screenci sync`.
   * When present it IS the action's stable key: matching survives refactors,
   * moved lines, and locator changes. The matcher-based identity below is the
   * bootstrap fallback for not-yet-stamped actions.
   */
  editId?: string
  /** Explicit name, e.g. from `speed('name', fn)`. */
  name?: string
  /**
   * Captured locator description, e.g. `getByRole(button, name=Save)`.
   * Chained locators join with ` > `. Used as the display name and as part of
   * the matching identity when no explicit name is given.
   */
  matcher?: string
  /** Nth occurrence (0-based) of the same identity within the recording. */
  ordinal: number
  /** Absolute position (0-based) among all editable actions in the recording. */
  seq: number
  /**
   * The user-code call site that produced the action, captured from the
   * stack at instrumentation time. Not part of the stable identity; used by
   * `screenci sync-prompt` to tell an agent exactly where to place a change.
   */
  source?: { file: string; line: number }
}

/**
 * The first stack frame outside the screenci package: the user-code call
 * site of the action being instrumented. Best-effort; returns undefined when
 * the stack is unavailable or every frame is internal.
 */
export function captureCallSite(): { file: string; line: number } | undefined {
  const stack = new Error().stack
  if (stack === undefined) return undefined
  for (const frame of stack.split('\n').slice(1)) {
    const match = /\(?(\S+?):(\d+):\d+\)?$/.exec(frame.trim())
    if (match === null) continue
    let file = match[1]!
    if (file.startsWith('node:')) continue
    if (file.includes('node_modules')) continue
    // Frames inside this package (source or built output).
    if (/[\\/]screenci[\\/](src|dist)[\\/]/.test(file)) continue
    file = file.replace(/^file:\/\//, '')
    return { file, line: Number(match[2]) }
  }
  return undefined
}

/**
 * Editable metadata stamped on a recording event. `defaults` holds the
 * effective values this run used for every web-editable field (so the editor
 * shows real values without re-deriving package defaults); `applied` is the
 * web override that was merged in, when one existed.
 */
export type EditableMeta = {
  descriptor: EditableActionDescriptor
  /**
   * True when code set any explicit option on the action. Explicit values no
   * longer block web edits: an override still applies, but the editor and the
   * CLI surface a warning that it shadows a value set in code.
   */
  locked: boolean
  /**
   * The individual fields whose values were set explicitly in code. Used to
   * warn (in the web editor, at record time and in `screenci status`) when an
   * override shadows one of them. Absent when nothing was explicit.
   */
  lockedFields?: string[]
  schemaKind: EditableSchemaKind
  defaults: Record<string, unknown>
  applied?: Record<string, unknown>
}

/** The identity an ordinal counts within: everything except position. */
export function editableIdentityKey(
  descriptor: Pick<
    EditableActionDescriptor,
    'kind' | 'subKind' | 'name' | 'matcher' | 'editId'
  >
): string {
  // An editId IS the identity: ordinals then count executions of that exact
  // call site (ordinal > 0 means it ran in a loop or the id is duplicated).
  if (descriptor.editId !== undefined) return descriptor.editId
  return [
    descriptor.kind,
    descriptor.subKind ?? '',
    descriptor.name ?? descriptor.matcher ?? '',
  ].join('|')
}

/**
 * The stable key overrides are matched by across re-records. With an editId
 * the key is the slug itself (`fill1`), or `fill1#N` for repeat executions of
 * the same call site; without one it is the legacy matcher identity plus
 * ordinal. `seq` stays out (it shifts whenever any action is added anywhere).
 */
export function stableEditableKey(
  descriptor: Pick<
    EditableActionDescriptor,
    'kind' | 'subKind' | 'name' | 'matcher' | 'ordinal' | 'editId'
  >
): string {
  if (descriptor.editId !== undefined) {
    return descriptor.ordinal === 0
      ? descriptor.editId
      : `${descriptor.editId}#${descriptor.ordinal}`
  }
  return `${editableIdentityKey(descriptor)}|${descriptor.ordinal}`
}

/** Position allocated for a descriptor within the current recording. */
export type EditablePosition = {
  seq: number
  ordinal: number
}

export type BuildEditableMetaInput = {
  kind: EditableActionKind
  subKind?: string
  editId?: string
  name?: string
  matcher?: string
  schemaKind: EditableSchemaKind
  locked: boolean
  lockedFields?: string[]
  defaults: Record<string, unknown>
  applied?: Record<string, unknown>
  position: EditablePosition
}

export function buildEditableMeta(input: BuildEditableMetaInput): EditableMeta {
  const source = captureCallSite()
  return {
    descriptor: {
      kind: input.kind,
      ...(input.subKind !== undefined && { subKind: input.subKind }),
      ...(input.editId !== undefined && { editId: input.editId }),
      ...(input.name !== undefined && { name: input.name }),
      ...(input.matcher !== undefined && { matcher: input.matcher }),
      ordinal: input.position.ordinal,
      seq: input.position.seq,
      ...(source !== undefined && { source }),
    },
    locked: input.locked,
    ...(input.lockedFields !== undefined &&
      input.lockedFields.length > 0 && { lockedFields: input.lockedFields }),
    schemaKind: input.schemaKind,
    defaults: input.defaults,
    ...(input.applied !== undefined && { applied: input.applied }),
  }
}

// ─── Locator description capture ───────────────────────────────────────────────

/**
 * Human-readable description of a single locator factory call, e.g.
 * `describeLocatorCall('getByRole', ['button', { name: 'Save' }])` gives
 * `getByRole(button, name=Save)`. Pure so it is unit-testable in isolation.
 */
export function describeLocatorCall(
  method: string,
  args: readonly unknown[]
): string {
  const parts = args
    .map((arg) => serializeLocatorArg(arg))
    .filter((part) => part.length > 0)
  return `${method}(${parts.join(', ')})`
}

function serializeLocatorArg(arg: unknown): string {
  if (typeof arg === 'string') return arg
  if (typeof arg === 'number' || typeof arg === 'boolean') return String(arg)
  if (arg instanceof RegExp) return String(arg)
  if (typeof arg === 'object' && arg !== null) {
    // A nested Locator (filter({ has })) carries its captured description.
    const nested = locatorDescriptions.get(arg)
    if (nested !== undefined) return nested
    const entries = Object.entries(arg)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${serializeLocatorArg(value)}`)
    return entries.join(', ')
  }
  return ''
}

/** Chained locators read source-to-sink: `getByRole(list) > nth(2)`. */
export function chainLocatorDescription(
  parent: string | undefined,
  call: string
): string {
  return parent === undefined ? call : `${parent} > ${call}`
}

const locatorDescriptions = new WeakMap<object, string>()

export function setLocatorDescription(
  locator: object,
  description: string
): void {
  locatorDescriptions.set(locator, description)
}

export function getLocatorDescription(locator: object): string | undefined {
  return locatorDescriptions.get(locator)
}
