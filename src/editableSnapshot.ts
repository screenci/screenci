/**
 * Editable-action entries collected from the per-recording `data.json` files
 * (stable key, editId, effective defaults, call-site source). Editor codegen
 * (`screenci dev`) uses them to locate call sites by editId when writing an
 * edit into the .screenci.ts sources; code is the single source of truth.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { stableEditableKey } from './editableDescriptor.js'
import type {
  CodifyEdit,
  NarrationEdit,
  OptionsEdit,
  OverlayDeclEdit,
  ParamEdit,
  RenameEdit,
} from './timelineEdits.js'
import { OPTIONS_EDIT_METHODS } from './timelineEdits.js'

/** Param-edit values per video, in the stable-key entry shape the snapshot
 *  comparisons work with. */
export type EditableOverrideEntry = {
  key: string
  values: Record<string, unknown>
}
export type EditableOverridesByVideo = Record<string, EditableOverrideEntry[]>

/** Codify-only edits per video, straight from the unified timeline-edits docs
 *  (media/zoom/gap records the codemod places into code). */
export type CodifyEditsByVideo = Record<string, CodifyEdit[]>

/** editId renames per video, from the unified timeline-edits docs. */
export type RenamesByVideo = Record<
  string,
  Array<{ editId: string; newEditId: string }>
>

/** Overlay declaration placement edits per video (codified by sync). */
export type OverlayDeclEditsByVideo = Record<string, OverlayDeclEdit[]>

/** Render/record option snapshots per video (codified into builder calls). */
export type StudioOptionsByVideo = Record<
  string,
  {
    renderOptions?: Record<string, unknown>
    recordOptions?: Record<string, unknown>
  }
>

/** Narration cue value edits per video (codified into the declaration). */
export type NarrationEditsByVideo = Record<string, NarrationEdit[]>

/**
 * Splits fetched unified timeline-edits docs (keyed by video name) into the
 * shapes the status report and sync prompt consume. Records that do not look
 * like edit records are ignored (the server produced them, so this is only a
 * guard against version skew).
 */
export function splitTimelineEditsByVideo(
  docsByVideo: Record<string, unknown>
): {
  overrides: EditableOverridesByVideo
  codify: CodifyEditsByVideo
  /** Disabled codify records: the editor placed then removed these. `screenci
   *  sync` deletes their codemod-authored calls (ghost cleanup). */
  removedCodify: CodifyEditsByVideo
  renames: RenamesByVideo
  overlayDecls: OverlayDeclEditsByVideo
  studioOptions: StudioOptionsByVideo
  narrationEdits: NarrationEditsByVideo
} {
  const overrides: EditableOverridesByVideo = {}
  const codify: CodifyEditsByVideo = {}
  const removedCodify: CodifyEditsByVideo = {}
  const renames: RenamesByVideo = {}
  const overlayDecls: OverlayDeclEditsByVideo = {}
  const studioOptions: StudioOptionsByVideo = {}
  const narrationEdits: NarrationEditsByVideo = {}
  const CODIFY_TYPES = new Set([
    'mediaEdit',
    'zoomEdit',
    'gapSpanEdit',
    'gapPointEdit',
  ])
  for (const [videoName, doc] of Object.entries(docsByVideo)) {
    const edits = (doc as { edits?: unknown[] } | null)?.edits
    if (!Array.isArray(edits)) continue
    for (const edit of edits) {
      if (typeof edit !== 'object' || edit === null) continue
      const record = edit as { type?: unknown; disabled?: unknown }
      if (record.type === 'paramEdit') {
        const param = edit as ParamEdit
        if (typeof param.target?.key !== 'string') continue
        ;(overrides[videoName] ??= []).push({
          key: param.target.key,
          values: param.fields ?? {},
        })
      } else if (
        typeof record.type === 'string' &&
        CODIFY_TYPES.has(record.type)
      ) {
        if (record.disabled === true) {
          ;(removedCodify[videoName] ??= []).push(edit as CodifyEdit)
          continue
        }
        ;(codify[videoName] ??= []).push(edit as CodifyEdit)
      } else if (record.type === 'renameEdit') {
        const rename = edit as RenameEdit
        if (
          typeof rename.target?.editId !== 'string' ||
          typeof rename.newEditId !== 'string'
        ) {
          continue
        }
        ;(renames[videoName] ??= []).push({
          editId: rename.target.editId,
          newEditId: rename.newEditId,
        })
      } else if (record.type === 'overlayDeclEdit') {
        const decl = edit as OverlayDeclEdit
        if (
          typeof decl.overlayName !== 'string' ||
          typeof decl.props !== 'object' ||
          decl.props === null ||
          record.disabled === true
        ) {
          continue
        }
        ;(overlayDecls[videoName] ??= []).push(decl)
      } else if (record.type === 'optionsEdit') {
        const options = edit as OptionsEdit
        if (
          !OPTIONS_EDIT_METHODS.includes(options.method) ||
          typeof options.values !== 'object' ||
          options.values === null
        ) {
          continue
        }
        ;(studioOptions[videoName] ??= {})[options.method] = options.values
      } else if (record.type === 'narrationEdit') {
        const narration = edit as NarrationEdit
        const value = narration.value as unknown
        const validValue =
          typeof value === 'string' ||
          (typeof value === 'object' &&
            value !== null &&
            typeof (value as { cue?: unknown }).cue === 'string')
        if (
          typeof narration.cueName !== 'string' ||
          typeof narration.lang !== 'string' ||
          !validValue
        ) {
          continue
        }
        ;(narrationEdits[videoName] ??= []).push(narration)
      }
    }
  }
  return {
    overrides,
    codify,
    removedCodify,
    renames,
    overlayDecls,
    studioOptions,
    narrationEdits,
  }
}

/** One editable action as recorded by the previous run. */
export type EditableSnapshotEntry = {
  key: string
  /** Stable code identity slug (e.g. `fill1`) when the action is stamped. */
  editId?: string
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

type RecordedEditableMeta = {
  descriptor?: {
    kind?: unknown
    subKind?: unknown
    editId?: unknown
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
      ...(typeof descriptor.editId === 'string' && {
        editId: descriptor.editId,
      }),
      ...(typeof descriptor.name === 'string' && { name: descriptor.name }),
      ...(typeof descriptor.matcher === 'string' && {
        matcher: descriptor.matcher,
      }),
      ordinal: descriptor.ordinal,
    }),
    ...(typeof descriptor.editId === 'string' && {
      editId: descriptor.editId,
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
 * Editable entries of a single recording's parsed data.json. Shared by the
 * snapshot collector below and the dev startup handshake (which reads kept
 * recording data itself).
 */
export function entriesFromRecordingData(data: {
  events?: unknown
}): EditableSnapshotEntry[] {
  const events = Array.isArray(data.events) ? data.events : []
  const entries: EditableSnapshotEntry[] = []
  for (const event of events) {
    if (typeof event !== 'object' || event === null) continue
    const editable = (event as { editable?: unknown }).editable
    if (typeof editable !== 'object' || editable === null) continue
    const snapshotEntry = toSnapshotEntry(editable as RecordedEditableMeta)
    if (snapshotEntry !== null) entries.push(snapshotEntry)
  }
  return entries
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
    // Prefer this run's data.json; fall back to the kept last-data.json (a
    // previous run's event data preserved for the dev freshness check).
    const candidates = [
      join(screenciDir, entry, 'data.json'),
      join(screenciDir, entry, 'last-data.json'),
    ]
    try {
      if (!statSync(join(screenciDir, entry)).isDirectory()) continue
      const dataPath = candidates.find((path) => existsSync(path))
      if (dataPath === undefined) continue
      const parsed: unknown = JSON.parse(readFileSync(dataPath, 'utf8'))
      if (typeof parsed !== 'object' || parsed === null) continue
      const data = parsed as {
        metadata?: { videoName?: unknown }
        events?: unknown
      }
      const videoName = data.metadata?.videoName
      if (typeof videoName !== 'string') continue
      const entries = entriesFromRecordingData(data)
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
