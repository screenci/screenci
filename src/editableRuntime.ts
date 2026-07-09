/**
 * Runtime application of web-editor overrides for editable actions.
 *
 * Before a recording, the CLI fetches the video's stored timeline edits from
 * the backend and injects them via `SCREENCI_TIMELINE_EDITS`. At runtime each
 * editable action resolves its param edit by stable key and merges it over
 * the effective defaults, so a web edit changes the very next record without
 * a code change. Placed events from the same doc apply at data.json write
 * time (see timelineEdits.ts).
 */
import type { EditableMeta } from './editableDescriptor.js'
import { stableEditableKey } from './editableDescriptor.js'
import { jsonEqual } from './actionParams.js'
import {
  getEditableRunOverrides,
  getEditableRunReport,
} from './runtimeContext.js'
import { isOverrideDebugEnabled } from './debugFlags.js'
import type { OverrideReportBuilder } from './timelineEdits.js'
import { resolveTimelineEditsForVideo, splitEdits } from './timelineEdits.js'

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
  warn: (message: string) => void = (message) => console.warn(message),
  report: OverrideReportBuilder | null = getEditableRunReport()
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
  const shadowed: Record<string, unknown> = {}
  const merged: Record<string, unknown> = { ...meta.defaults }
  for (const [field, value] of Object.entries(override)) {
    if (value === undefined) continue
    // Unknown fields never inject options, with one exception: `sleepBefore`
    // applies to recordings made before the field existed in defaults, so a
    // web start-time edit works without an intermediate re-record.
    if (!(field in meta.defaults) && field !== 'sleepBefore') continue
    // A field equal to the recorded default changes nothing: skip it so it is
    // never merged, logged, or reported as a no-op `x -> x` override. (The
    // editor prunes these on save; this also covers docs stored before that.)
    if (jsonEqual(meta.defaults[field], value)) continue
    if (lockedFields.has(field) && meta.defaults[field] !== value) {
      shadowed[field] = meta.defaults[field]
      warn(
        `[screenci] editor override shadows code value: ${key} ${field}: ` +
          `code ${JSON.stringify(meta.defaults[field])} -> editor ` +
          `${JSON.stringify(value)}. Run \`screenci status\` to reconcile.`
      )
    }
    merged[field] = value
    applied[field] = value
    if (isOverrideDebugEnabled()) {
      warn(
        `[screenci debug] editor override applied: ${key} ${field}: ` +
          `${JSON.stringify(meta.defaults[field])} -> ${JSON.stringify(value)}`
      )
    }
  }
  if (Object.keys(applied).length > 0) {
    meta.applied = applied
    report?.add({
      editId: key,
      channel: 'paramEdit',
      status: Object.keys(shadowed).length > 0 ? 'shadowed-code' : 'applied',
      subject: key,
      appliedValues: applied,
      ...(Object.keys(shadowed).length > 0 && { codeValues: shadowed }),
    })
  }
  return merged
}

/**
 * Runtime overrides for one video: the unified timeline-edits doc's param
 * edits (`SCREENCI_TIMELINE_EDITS`), indexed by stable key. Only param edits
 * apply at runtime; placed events apply at data.json write time. Null when
 * nothing was injected for the video.
 */
export function resolveRuntimeOverridesForVideo(
  videoName: string,
  env: NodeJS.ProcessEnv = process.env
): Map<string, Record<string, unknown>> | null {
  const unified = resolveTimelineEditsForVideo(videoName, env)
  if (unified === null) return null
  const { paramEdits } = splitEdits(unified.edits)
  if (paramEdits.length === 0) return null
  const byKey = new Map<string, Record<string, unknown>>()
  for (const edit of paramEdits) {
    byKey.set(edit.target.key, edit.fields)
  }
  return byKey
}
