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
import { stableEditableKey } from './editableDescriptor.js'
import type { Anchor, ParamEdit, PlacedEvent } from './timelineEdits.js'
import { describeAnchor } from './timelineEdits.js'

/** Param-edit values per video, in the stable-key entry shape the snapshot
 *  comparisons work with. */
export type EditableOverrideEntry = {
  key: string
  values: Record<string, unknown>
}
export type EditableOverridesByVideo = Record<string, EditableOverrideEntry[]>

/** Placed events per video, straight from the unified timeline-edits docs. */
export type PlacedEventsByVideo = Record<string, PlacedEvent[]>

/**
 * Splits fetched unified timeline-edits docs (keyed by video name) into the
 * shapes the status report and sync prompt consume. Records that do not look
 * like edit records are ignored (the server produced them, so this is only a
 * guard against version skew).
 */
export function splitTimelineEditsByVideo(
  docsByVideo: Record<string, unknown>
): { overrides: EditableOverridesByVideo; placed: PlacedEventsByVideo } {
  const overrides: EditableOverridesByVideo = {}
  const placed: PlacedEventsByVideo = {}
  for (const [videoName, doc] of Object.entries(docsByVideo)) {
    const edits = (doc as { edits?: unknown[] } | null)?.edits
    if (!Array.isArray(edits)) continue
    for (const edit of edits) {
      if (typeof edit !== 'object' || edit === null) continue
      const record = edit as { type?: unknown }
      if (record.type === 'paramEdit') {
        const param = edit as ParamEdit
        if (typeof param.target?.key !== 'string') continue
        ;(overrides[videoName] ??= []).push({
          key: param.target.key,
          values: param.fields ?? {},
        })
      } else if (record.type === 'placedEvent') {
        const event = edit as PlacedEvent
        if (event.disabled === true) continue
        ;(placed[videoName] ??= []).push(event)
      }
    }
  }
  return { overrides, placed }
}

/** File name of the snapshot inside `.screenci`. Preserved across runs. */
export const EDITABLE_SNAPSHOT_FILE = 'editable-actions.json'

/** One editable action as recorded by the previous run. */
export type EditableSnapshotEntry = {
  key: string
  locked: boolean
  lockedFields?: string[]
  defaults: Record<string, unknown>
  /** User-code call site, for sync-prompt placement instructions. */
  source?: { file: string; line: number }
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
    source?: unknown
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
    ...(() => {
      const source = descriptor.source
      if (
        typeof source === 'object' &&
        source !== null &&
        typeof (source as { file?: unknown }).file === 'string' &&
        typeof (source as { line?: unknown }).line === 'number'
      ) {
        return { source: source as { file: string; line: number } }
      }
      return {}
    })(),
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

/** Whether a placed event's anchor still resolves against the snapshot. */
function anchorStatus(anchor: Anchor, keys: Set<string>): string {
  switch (anchor.ref.type) {
    case 'videoStart':
    case 'videoEnd':
      return 'ok'
    case 'action':
      return keys.has(anchor.ref.key)
        ? 'ok'
        : 'MISSING (fix the anchor in the web editor or re-record)'
    case 'timestamp':
    case 'cue':
      return 'unverified (checked at record time)'
    default: {
      const exhaustive: never = anchor.ref
      void exhaustive
      return 'unverified'
    }
  }
}

/**
 * Status lines for placed events (web-added hides/speedups/time remaps,
 * moved or added narration cues, overlays, timestamp markers): whether each
 * anchor still resolves against the latest recorded snapshot. Timestamp and
 * cue anchors cannot be verified against the editable snapshot, so they
 * report as unverified rather than missing.
 */
export function formatPlacedStatusReport(
  snapshot: EditableSnapshot,
  placedByVideo: PlacedEventsByVideo
): string[] {
  const lines: string[] = []
  for (const [videoName, events] of Object.entries(placedByVideo)) {
    if (events.length === 0) continue
    lines.push(`Video: ${videoName}`)
    const keys = new Set(
      (snapshot.videos[videoName] ?? []).map((entry) => entry.key)
    )
    for (const event of events) {
      const endAnchor =
        event.end !== undefined && 'anchor' in event.end
          ? event.end.anchor
          : undefined
      lines.push(
        `  ${event.kind} '${event.id}': from ${describeAnchor(event.anchor)} ` +
          `-> anchor ${anchorStatus(event.anchor, keys)}` +
          (endAnchor !== undefined
            ? `; to ${describeAnchor(endAnchor)} -> anchor ` +
              anchorStatus(endAnchor, keys)
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

/**
 * Agent-ready placement instructions that move web timeline edits into code.
 * Each line names the exact call site (from the snapshot's captured source),
 * the change to make, and why. Ends with a note on ripple scope so the agent
 * understands which downstream events shift. Returns [] when there is
 * nothing to codify.
 */
/** The code literal for a placed anchor, as accepted by placeHide/... */
export function anchorLiteral(anchor: Anchor): string {
  switch (anchor.ref.type) {
    case 'videoStart':
      return `'video:start'`
    case 'videoEnd':
      return `'video:end'`
    case 'timestamp':
      return anchor.ref.ordinal === 0
        ? `'${anchor.ref.name}'`
        : `{ timestamp: '${anchor.ref.name}', ordinal: ${anchor.ref.ordinal} }`
    case 'action':
      return anchor.edge === 'end'
        ? `{ action: '${anchor.ref.key}' }`
        : `{ action: '${anchor.ref.key}', edge: 'start' }`
    case 'cue':
      // No code literal for cue anchors; the instruction explains instead.
      return `'${anchor.ref.cueId}'`
    default: {
      const exhaustive: never = anchor.ref
      void exhaustive
      return `'video:start'`
    }
  }
}

/** Human position of a placed anchor: file:line for actions, else itself. */
function anchorAt(
  anchor: Anchor,
  byKey: Map<string, EditableSnapshotEntry>
): string {
  if (anchor.ref.type === 'action') {
    const source = byKey.get(anchor.ref.key)?.source
    return source !== undefined
      ? `${source.file}:${source.line}`
      : `(source unknown; action key ${anchor.ref.key})`
  }
  return describeAnchor(anchor)
}

/** The placeX() call that reproduces a placed span event in code. */
export function placeCallFor(event: PlacedEvent): string | null {
  const kind = event.kind
  if (
    kind !== 'hide' &&
    kind !== 'speed' &&
    kind !== 'time' &&
    kind !== 'zoom'
  ) {
    return null
  }
  const parts = [`from: ${anchorLiteral(event.anchor)}`]
  if (event.anchor.offsetMs !== 0) {
    parts.push(`offsetMs: ${Math.round(event.anchor.offsetMs)}`)
  }
  if (event.end !== undefined && 'anchor' in event.end) {
    parts.push(`until: ${anchorLiteral(event.end.anchor)}`)
    if (event.end.anchor.offsetMs !== 0) {
      parts.push(`untilOffsetMs: ${Math.round(event.end.anchor.offsetMs)}`)
    }
  } else if (event.end !== undefined) {
    parts.push(`durationMs: ${Math.round(event.end.durationMs)}`)
  }
  const props = event.props ?? {}
  if (kind === 'speed' && typeof props.multiplier === 'number') {
    parts.push(`multiplier: ${props.multiplier}`)
  }
  if (kind === 'time' && typeof props.durationMs === 'number') {
    parts.push(`playsAsMs: ${Math.round(props.durationMs)}`)
  }
  if (kind === 'zoom') {
    for (const field of ['amount', 'duration', 'centering'] as const) {
      if (typeof props[field] === 'number') {
        parts.push(`${field}: ${props[field]}`)
      }
    }
    if (typeof props.easing === 'string') {
      parts.push(`easing: '${props.easing}'`)
    }
  }
  const fn =
    kind === 'hide'
      ? 'placeHide'
      : kind === 'speed'
        ? 'placeSpeed'
        : kind === 'time'
          ? 'placeTime'
          : 'placeZoom'
  return `${fn}({ ${parts.join(', ')} })`
}

export function buildEditablePlacementPrompt(
  snapshot: EditableSnapshot,
  overridesByVideo: EditableOverridesByVideo,
  placedByVideo: PlacedEventsByVideo = {}
): string[] {
  const lines: string[] = []
  const videoNames = [
    ...new Set([
      ...Object.keys(overridesByVideo),
      ...Object.keys(placedByVideo),
    ]),
  ]
  for (const videoName of videoNames) {
    const entries = snapshot.videos[videoName] ?? []
    const byKey = new Map(entries.map((entry) => [entry.key, entry]))
    const at = (key: string): string => {
      const source = byKey.get(key)?.source
      return source !== undefined
        ? `${source.file}:${source.line}`
        : `(source unknown; action key ${key})`
    }
    const sectionStart = lines.length
    for (const override of overridesByVideo[videoName] ?? []) {
      const entry = byKey.get(override.key)
      for (const [field, value] of Object.entries(override.values)) {
        if (value === undefined) continue
        const codeValue = entry?.defaults[field]
        if (codeValue === value) continue
        if (field === 'sleepBefore' && typeof value === 'number' && value > 0) {
          lines.push(
            `- INSERT \`await page.waitForTimeout(${Math.round(value)})\` ` +
              `immediately BEFORE ${at(override.key)} (web start-time edit ` +
              `on '${override.key}'), then clear the web override.`
          )
          continue
        }
        if (field === 'startOffset' || field === 'endOffset') {
          const boundary = field === 'startOffset' ? 'start' : 'end'
          lines.push(
            `- CHANGE ${at(override.key)}: set \`${field}: ` +
              `${JSON.stringify(value)}\` in the autoZoom options (shifts ` +
              `the zoom window's ${boundary} at write time; editor ` +
              `${JSON.stringify(codeValue)} -> ${JSON.stringify(value)} on ` +
              `'${override.key}'). Large shifts often read better as moving ` +
              `statements into or out of the block instead: the block's ` +
              `first and last actions define its window. Then clear the ` +
              `web override.`
          )
          continue
        }
        lines.push(
          `- CHANGE ${at(override.key)}: set \`${field}\` to ` +
            `${JSON.stringify(value)} (editor override ` +
            `${JSON.stringify(codeValue)} -> ${JSON.stringify(value)} on ` +
            `'${override.key}'), then clear the web override.`
        )
      }
    }
    for (const event of placedByVideo[videoName] ?? []) {
      const name =
        typeof event.props?.name === 'string' ? event.props.name : event.id
      const offset = `${event.anchor.offsetMs >= 0 ? '+' : ''}${Math.round(event.anchor.offsetMs)}ms`
      const call = placeCallFor(event)
      if (call !== null) {
        lines.push(
          `- ADD \`${call}\` anywhere in the test body (anchor is near ` +
            `${anchorAt(event.anchor, byKey)}), matching web event ` +
            `'${event.id}', then remove that event from the web editor.`
        )
        continue
      }
      switch (event.kind) {
        case 'timestamp':
          lines.push(
            `- INSERT \`await timestamp('${name}')\` at the moment ${offset} ` +
              `after ${anchorAt(event.anchor, byKey)} (web-created marker ` +
              `'${event.id}'), then remove it from the web editor.`
          )
          break
        case 'narrationCue':
          lines.push(
            event.targetId !== undefined
              ? `- MOVE the \`await narration.${name}...\` call so the cue ` +
                  `starts ${offset} after ${anchorAt(event.anchor, byKey)}: ` +
                  `add \`await timestamp('<marker>')\` at that anchor and ` +
                  `\`await waitSince('<marker>', ${Math.max(0, Math.round(event.anchor.offsetMs))})\` ` +
                  `right before the cue call (web move '${event.id}'), then ` +
                  `remove the move from the web editor.`
              : `- ADD narration cue '${name}': declare it in ` +
                  `\`video.narration([...])\` and call ` +
                  `\`await narration.${name}()\` at the moment ${offset} ` +
                  `after ${anchorAt(event.anchor, byKey)} (pace it with ` +
                  `\`await waitSince(...)\` when needed; web event ` +
                  `'${event.id}'), then remove it from the web editor.`
          )
          break
        case 'overlay':
          lines.push(
            event.targetId !== undefined
              ? `- MOVE the \`await overlays.${name}...\` call so the ` +
                  `overlay starts ${offset} after ` +
                  `${anchorAt(event.anchor, byKey)} (pace it with ` +
                  `\`await waitSince(...)\`; web move '${event.id}'), then ` +
                  `remove the move from the web editor.`
              : `- ADD overlay '${name}': declare it in ` +
                  `\`video.overlays([...])\` and call ` +
                  `\`await overlays.${name}()\` at the moment ${offset} ` +
                  `after ${anchorAt(event.anchor, byKey)} (web event ` +
                  `'${event.id}'), then remove it from the web editor.`
          )
          break
        default:
          break
      }
    }
    if (lines.length > sectionStart) {
      lines.splice(sectionStart, 0, `## Video: ${videoName}`)
    }
  }
  if (lines.length > 0) {
    lines.push(
      'Note: the recording is a strict sequence. Any timing change ripples: ' +
        'everything after the changed action happens earlier/later by the ' +
        'same amount, up to the next page navigation. Do not reorder ' +
        'actions. placeHide/placeSpeed/placeTime calls are declarative ' +
        '(applied at render time) and may sit anywhere in the test body.'
    )
  }
  return lines
}
