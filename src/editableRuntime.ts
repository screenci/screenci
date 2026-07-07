/**
 * Runtime application of web-editor overrides for editable actions.
 *
 * Before a recording, the CLI fetches the video's stored overrides from the
 * backend and injects them via `SCREENCI_EDITABLE_OVERRIDES` (a JSON map of
 * video name to entries in stable-key form). At runtime each editable action
 * resolves its override by stable key and merges it over the effective
 * defaults, so a web edit changes the very next record without a code change.
 */
import type { EditableMeta } from './editableDescriptor.js'
import { stableEditableKey } from './editableDescriptor.js'
import { getEditableRunOverrides } from './runtimeContext.js'

export const SCREENCI_EDITABLE_OVERRIDES_ENV = 'SCREENCI_EDITABLE_OVERRIDES'

/** One stored override: the action's stable key and its edited values. */
export type EditableOverrideEntry = {
  key: string
  values: Record<string, unknown>
}

/** Overrides per video name, as injected by the CLI. */
export type EditableOverridesByVideo = Record<string, EditableOverrideEntry[]>

/**
 * Parse the injected override map. Returns `null` when unset or malformed so
 * the run falls back to code/default values; entries with a non-string key or
 * non-object values are dropped.
 */
export function parseEditableOverrides(
  env: NodeJS.ProcessEnv = process.env
): EditableOverridesByVideo | null {
  const raw = env[SCREENCI_EDITABLE_OVERRIDES_ENV]
  if (raw === undefined || raw.trim().length === 0) return null

  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null

    const result: EditableOverridesByVideo = {}
    for (const [videoName, entries] of Object.entries(parsed)) {
      if (!Array.isArray(entries)) continue
      const valid: EditableOverrideEntry[] = []
      for (const entry of entries) {
        if (typeof entry !== 'object' || entry === null) continue
        const { key, values } = entry as Record<string, unknown>
        if (typeof key !== 'string') continue
        if (typeof values !== 'object' || values === null) continue
        valid.push({ key, values: values as Record<string, unknown> })
      }
      result[videoName] = valid
    }
    return result
  } catch {
    return null
  }
}

/**
 * Overrides for one video, keyed by stable key for O(1) runtime resolution.
 */
export function indexEditableOverrides(
  entries: readonly EditableOverrideEntry[]
): Map<string, Record<string, unknown>> {
  const byKey = new Map<string, Record<string, unknown>>()
  for (const entry of entries) {
    byKey.set(entry.key, entry.values)
  }
  return byKey
}

/**
 * Merges the web override for the given editable action over its effective
 * defaults and returns the values the action should run with. Also stamps
 * `meta.applied` with the override so the recording documents what was used.
 *
 * Overrides apply to explicit code values too: when an overridden field is in
 * `meta.lockedFields` (or the action is marked `locked`), the override still
 * wins but a warning explains that it shadows a value set in code. Only keys
 * already present in `defaults` are applied: a stale override field from an
 * older schema can never inject an unknown option.
 */
export function applyEditableOverride(
  meta: EditableMeta | undefined,
  overridesByKey: Map<
    string,
    Record<string, unknown>
  > | null = getEditableRunOverrides(),
  warn: (message: string) => void = (message) => console.warn(message)
): Record<string, unknown> {
  if (meta === undefined) return {}
  if (overridesByKey === null) return { ...meta.defaults }

  const key = stableEditableKey(meta.descriptor)
  const override = overridesByKey.get(key)
  if (override === undefined) return { ...meta.defaults }

  const lockedFields = new Set(
    meta.lockedFields ?? (meta.locked ? Object.keys(meta.defaults) : [])
  )
  const applied: Record<string, unknown> = {}
  const merged: Record<string, unknown> = { ...meta.defaults }
  for (const [field, value] of Object.entries(override)) {
    if (value === undefined) continue
    if (!(field in meta.defaults)) continue
    if (lockedFields.has(field) && meta.defaults[field] !== value) {
      warn(
        `[screenci] editor override shadows code value: ${key} ${field}: ` +
          `code ${JSON.stringify(meta.defaults[field])} -> editor ` +
          `${JSON.stringify(value)}. Run \`screenci status\` to reconcile.`
      )
    }
    merged[field] = value
    applied[field] = value
  }
  if (Object.keys(applied).length > 0) {
    meta.applied = applied
  }
  return merged
}

/**
 * The indexed overrides for one video, ready to bind into the runtime
 * context at recording start. Null when none were injected for it.
 */
export function resolveEditableOverridesForVideo(
  videoName: string,
  env: NodeJS.ProcessEnv = process.env
): Map<string, Record<string, unknown>> | null {
  const entries = parseEditableOverrides(env)?.[videoName]
  if (entries === undefined || entries.length === 0) return null
  return indexEditableOverrides(entries)
}
