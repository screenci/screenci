/**
 * The `.screenci/editable-actions.json` snapshot: the latest known editable
 * actions per video (stable key, per-field explicit provenance and effective
 * defaults), aggregated by the CLI from the per-recording `data.json` files
 * after every record run. It is never wiped (the record command's directory
 * clear preserves it) so the next run and `screenci status` can compare the
 * web editor's timing overrides against the previous run's explicit code
 * values and warn when an override shadows one.
 */
import {
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'fs'
import { join } from 'path'
import type { EditableOverridesByVideo } from './editableRuntime.js'
import { stableEditableKey } from './editableDescriptor.js'

/** File name of the snapshot inside `.screenci`. Preserved across runs. */
export const EDITABLE_SNAPSHOT_FILE = 'editable-actions.json'

/** One editable action as recorded by the previous run. */
export type EditableSnapshotEntry = {
  key: string
  locked: boolean
  lockedFields?: string[]
  defaults: Record<string, unknown>
}

export type EditableSnapshot = {
  version: 1
  videos: Record<string, EditableSnapshotEntry[]>
}

/** A web override that shadows an explicitly code-set editable field. */
export type EditableOverrideCollision = {
  videoName: string
  key: string
  field: string
  codeValue: unknown
  editorValue: unknown
}

const EMPTY_SNAPSHOT: EditableSnapshot = { version: 1, videos: {} }

/** Read the snapshot; tolerant of a missing or corrupt file (empty snapshot). */
export function readEditableSnapshot(screenciDir: string): EditableSnapshot {
  const filePath = join(screenciDir, EDITABLE_SNAPSHOT_FILE)
  if (!existsSync(filePath)) return { ...EMPTY_SNAPSHOT, videos: {} }
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'))
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as { videos?: unknown }).videos !== 'object' ||
      (parsed as { videos?: unknown }).videos === null
    ) {
      return { ...EMPTY_SNAPSHOT, videos: {} }
    }
    return { version: 1, videos: (parsed as EditableSnapshot).videos }
  } catch {
    return { ...EMPTY_SNAPSHOT, videos: {} }
  }
}

type RecordedEditableMeta = {
  descriptor?: {
    kind?: unknown
    subKind?: unknown
    name?: unknown
    matcher?: unknown
    ordinal?: unknown
  }
  locked?: unknown
  lockedFields?: unknown
  defaults?: unknown
}

function toSnapshotEntry(
  editable: RecordedEditableMeta
): EditableSnapshotEntry | null {
  const descriptor = editable.descriptor
  if (
    typeof descriptor !== 'object' ||
    descriptor === null ||
    typeof descriptor.kind !== 'string' ||
    typeof descriptor.ordinal !== 'number'
  ) {
    return null
  }
  const lockedFields = Array.isArray(editable.lockedFields)
    ? editable.lockedFields.filter(
        (field): field is string => typeof field === 'string'
      )
    : []
  return {
    key: stableEditableKey({
      kind: descriptor.kind as never,
      ...(typeof descriptor.subKind === 'string' && {
        subKind: descriptor.subKind,
      }),
      ...(typeof descriptor.name === 'string' && { name: descriptor.name }),
      ...(typeof descriptor.matcher === 'string' && {
        matcher: descriptor.matcher,
      }),
      ordinal: descriptor.ordinal,
    }),
    locked: editable.locked === true,
    ...(lockedFields.length > 0 && { lockedFields }),
    defaults:
      typeof editable.defaults === 'object' && editable.defaults !== null
        ? (editable.defaults as Record<string, unknown>)
        : {},
  }
}

/**
 * Collect editable actions (keyed by `metadata.videoName`) from every
 * `.screenci/<recording>/data.json` written by the run that just finished.
 */
export function collectEditableFromRecordings(
  screenciDir: string
): Record<string, EditableSnapshotEntry[]> {
  const collected: Record<string, EditableSnapshotEntry[]> = {}
  if (!existsSync(screenciDir)) return collected
  for (const entry of readdirSync(screenciDir)) {
    const dataPath = join(screenciDir, entry, 'data.json')
    try {
      if (!statSync(join(screenciDir, entry)).isDirectory()) continue
      if (!existsSync(dataPath)) continue
      const parsed: unknown = JSON.parse(readFileSync(dataPath, 'utf8'))
      if (typeof parsed !== 'object' || parsed === null) continue
      const data = parsed as {
        metadata?: { videoName?: unknown }
        events?: unknown
      }
      const videoName = data.metadata?.videoName
      if (typeof videoName !== 'string') continue
      const events = Array.isArray(data.events) ? data.events : []
      const entries: EditableSnapshotEntry[] = []
      for (const event of events) {
        if (typeof event !== 'object' || event === null) continue
        const editable = (event as { editable?: unknown }).editable
        if (typeof editable !== 'object' || editable === null) continue
        const snapshotEntry = toSnapshotEntry(editable as RecordedEditableMeta)
        if (snapshotEntry !== null) entries.push(snapshotEntry)
      }
      // Per-language passes share one videoName; keep the first pass's
      // entries (each language performs the same actions).
      if (!(videoName in collected) || entries.length > 0) {
        collected[videoName] = entries
      }
    } catch {
      continue
    }
  }
  return collected
}

/**
 * Merge freshly recorded entries over the existing snapshot. Videos not
 * recorded this run keep their previous entries (a filtered run must not
 * lose them).
 */
export function mergeEditableSnapshot(
  existing: EditableSnapshot,
  recorded: Record<string, EditableSnapshotEntry[]>
): EditableSnapshot {
  return { version: 1, videos: { ...existing.videos, ...recorded } }
}

/** Write the snapshot (write-then-rename so a crash never corrupts it). */
export function writeEditableSnapshot(
  screenciDir: string,
  snapshot: EditableSnapshot
): void {
  const filePath = join(screenciDir, EDITABLE_SNAPSHOT_FILE)
  const tmpPath = `${filePath}.tmp`
  writeFileSync(tmpPath, JSON.stringify(snapshot, null, 2))
  renameSync(tmpPath, filePath)
}

/**
 * Update the snapshot from the recordings a run just produced: read, merge,
 * write. Called by the CLI after Playwright exits; best-effort by design (the
 * caller catches errors).
 */
export function updateEditableSnapshot(screenciDir: string): void {
  const recorded = collectEditableFromRecordings(screenciDir)
  if (Object.keys(recorded).length === 0) return
  writeEditableSnapshot(
    screenciDir,
    mergeEditableSnapshot(readEditableSnapshot(screenciDir), recorded)
  )
}

/**
 * Find web timing overrides that shadow explicitly code-set values: an
 * override field listed in the snapshot entry's `lockedFields` (or any field
 * of a fully `locked` entry) whose value differs from the recorded one. Pure;
 * a missing snapshot (first run) or unknown keys produce no collisions.
 */
/**
 * Human-readable status lines for the web timing overrides, for
 * `screenci status`. Classifies every stored override field:
 *
 * - `shadows code value`: the field is explicit in code and differs
 * - `changes default`: applies cleanly over a package default
 * - `stale`: the action (or video) no longer exists in the latest snapshot
 *
 * Returns an empty list when there are no overrides at all.
 */
export function formatEditableStatusReport(
  snapshot: EditableSnapshot,
  overridesByVideo: EditableOverridesByVideo
): string[] {
  const lines: string[] = []
  for (const [videoName, entries] of Object.entries(overridesByVideo)) {
    if (entries.length === 0) continue
    lines.push(`Video: ${videoName}`)
    const snapshotEntries = snapshot.videos[videoName]
    const byKey = new Map(
      (snapshotEntries ?? []).map((entry) => [entry.key, entry])
    )
    for (const override of entries) {
      const snapshotEntry = byKey.get(override.key)
      if (snapshotEntry === undefined) {
        lines.push(
          `  ${override.key}: stale (not in the latest recording; remove it ` +
            `in the web editor or re-record)`
        )
        continue
      }
      const lockedFields = new Set(
        snapshotEntry.lockedFields ??
          (snapshotEntry.locked ? Object.keys(snapshotEntry.defaults) : [])
      )
      for (const [field, editorValue] of Object.entries(override.values)) {
        if (editorValue === undefined) continue
        const codeValue = snapshotEntry.defaults[field]
        if (codeValue === editorValue) {
          lines.push(
            `  ${override.key} ${field}: in sync (${JSON.stringify(editorValue)})`
          )
        } else if (lockedFields.has(field)) {
          lines.push(
            `  ${override.key} ${field}: override shadows explicit code ` +
              `value (code ${JSON.stringify(codeValue)} -> editor ` +
              `${JSON.stringify(editorValue)}); move it into code or clear ` +
              `the edit`
          )
        } else {
          lines.push(
            `  ${override.key} ${field}: changes default ` +
              `(${JSON.stringify(codeValue)} -> ${JSON.stringify(editorValue)})`
          )
        }
      }
    }
  }
  return lines
}

/** Minimal authored-event shape the status report needs. */
export type AuthoredEventStatusInput = {
  id: string
  kind: string
  from: { ref: string; offsetMs: number }
  to?: { anchor?: { ref: string } } | { durationMs?: number }
}

/**
 * Status lines for web-authored events (hides/speed blocks): whether each
 * anchor still resolves against the latest recorded snapshot. Timestamp
 * anchors (`timestamp||name|ordinal` keys or bare names) cannot be verified
 * against the editable snapshot, so they report as unverified rather than
 * missing.
 */
export function formatAuthoredStatusReport(
  snapshot: EditableSnapshot,
  authoredByVideo: Record<string, AuthoredEventStatusInput[]>
): string[] {
  const lines: string[] = []
  for (const [videoName, events] of Object.entries(authoredByVideo)) {
    if (events.length === 0) continue
    lines.push(`Video: ${videoName}`)
    const keys = new Set(
      (snapshot.videos[videoName] ?? []).map((entry) => entry.key)
    )
    const checkRef = (ref: string): string => {
      if (keys.has(ref)) return 'ok'
      if (ref.startsWith('timestamp||') || !ref.includes('|')) {
        return 'unverified (timestamp anchors are checked at record time)'
      }
      return 'MISSING (fix the anchor in the web editor or re-record)'
    }
    for (const event of events) {
      const fromStatus = checkRef(event.from.ref)
      const toRef =
        event.to !== undefined && 'anchor' in event.to
          ? event.to.anchor?.ref
          : undefined
      lines.push(
        `  ${event.kind} '${event.id}': from ${event.from.ref} ` +
          `${event.from.offsetMs >= 0 ? '+' : ''}${event.from.offsetMs}ms ` +
          `-> anchor ${fromStatus}` +
          (toRef !== undefined
            ? `; to ${toRef} -> anchor ${checkRef(toRef)}`
            : '')
      )
    }
  }
  return lines
}

export function diffEditableOverridesAgainstSnapshot(
  snapshot: EditableSnapshot,
  overridesByVideo: EditableOverridesByVideo
): EditableOverrideCollision[] {
  const collisions: EditableOverrideCollision[] = []
  for (const [videoName, entries] of Object.entries(overridesByVideo)) {
    const snapshotEntries = snapshot.videos[videoName]
    if (snapshotEntries === undefined) continue
    const byKey = new Map(snapshotEntries.map((entry) => [entry.key, entry]))
    for (const override of entries) {
      const snapshotEntry = byKey.get(override.key)
      if (snapshotEntry === undefined) continue
      const lockedFields = new Set(
        snapshotEntry.lockedFields ??
          (snapshotEntry.locked ? Object.keys(snapshotEntry.defaults) : [])
      )
      for (const [field, editorValue] of Object.entries(override.values)) {
        if (editorValue === undefined) continue
        if (!lockedFields.has(field)) continue
        const codeValue = snapshotEntry.defaults[field]
        if (codeValue === editorValue) continue
        collisions.push({
          videoName,
          key: override.key,
          field,
          codeValue,
          editorValue,
        })
      }
    }
  }
  return collisions
}
