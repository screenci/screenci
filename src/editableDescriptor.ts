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
export type EditableActionKind = 'input' | 'autoZoom' | 'speed' | 'delay'

/**
 * Which option form the web editor renders for the action. The `defaults`
 * map's keys define the concrete fields; this picks the panel layout.
 */
export type EditableSchemaKind = 'cursorMove' | 'autoZoom' | 'speed' | 'delay'

export type EditableActionDescriptor = {
  kind: EditableActionKind
  /** Input action sub-kind: 'click', 'pressSequentially', 'dragTo', ... */
  subKind?: string
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
    'kind' | 'subKind' | 'name' | 'matcher'
  >
): string {
  return [
    descriptor.kind,
    descriptor.subKind ?? '',
    descriptor.name ?? descriptor.matcher ?? '',
  ].join('|')
}

/**
 * The stable key overrides are matched by across re-records: identity plus
 * ordinal. `seq` stays out (it shifts whenever any action is added anywhere).
 */
export function stableEditableKey(
  descriptor: Pick<
    EditableActionDescriptor,
    'kind' | 'subKind' | 'name' | 'matcher' | 'ordinal'
  >
): string {
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
  return {
    descriptor: {
      kind: input.kind,
      ...(input.subKind !== undefined && { subKind: input.subKind }),
      ...(input.name !== undefined && { name: input.name }),
      ...(input.matcher !== undefined && { matcher: input.matcher }),
      ordinal: input.position.ordinal,
      seq: input.position.seq,
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
