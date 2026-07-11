/**
 * Unified timeline edits: the single wire format for web-editor overrides.
 *
 * A `TimelineEditsDoc` carries every edit the web editor stored for a video as
 * typed records keyed by the stable code identity of an action (its `editId`
 * slug). There are no anchors and no offsets: position is "where the call sits
 * in code call-order," and timing gaps are plain `waitForTimeout` sleeps.
 *
 * Two record shapes apply at record time:
 * - `paramEdit`: changes parameter fields of a recorded action (durations,
 *   sleeps, typing delay). It targets an action by its stable editable key.
 * - `renameEdit`: renames an action's `editId` slug (codified by `screenci
 *   sync`; nothing to apply at record time).
 *
 * The remaining records are codify-only: they are never materialized into the
 * recorded event list. `screenci sync` writes them into the .screenci.ts
 * sources as real calls (a narration cue, an `autoZoom(...)` bracket, a
 * `hide(...)` span, a `moveNarration(...)` point, etc.), and normal recording
 * then emits the corresponding events. Each codify record locates its call
 * site by an `editId`:
 * - `mediaEdit`: a narration cue / overlay / audio start placed in the gap
 *   after an action. `blocking:true` awaits it (backbone, advances the
 *   timeline); `blocking:false` fires and forgets (background). End is never
 *   stored.
 * - `zoomEdit`: an `autoZoom` bracket over the interaction run
 *   `fromEditId..untilEditId`; lead-in/hold are sleeps inside the block.
 * - `gapSpanEdit`: a `hide`/`speed`/`time` span whose start and end both land
 *   in gaps (after `fromEditId` and after `untilEditId`).
 * - `gapPointEdit`: an instant `moveNarration`/`resizeRecording`/`setBackground`
 *   point in the gap after an action.
 *
 * Before a record run the CLI fetches the doc and injects it via
 * `SCREENCI_TIMELINE_EDITS` (a JSON map of video name to doc). Only param edits
 * apply at runtime (they change real waits). Every param edit produces an
 * `OverrideReportItem` so nothing is ever silently skipped.
 */
import { isOverrideDebugEnabled } from './debugFlags.js'

export const SCREENCI_TIMELINE_EDITS_ENV = 'SCREENCI_TIMELINE_EDITS'

export const TIMELINE_EDITS_VERSION = 3

// ─── Edit records ────────────────────────────────────────────────────────────

export const MEDIA_EDIT_KINDS = ['narrationCue', 'overlay', 'audio'] as const
export const GAP_SPAN_KINDS = ['hide', 'speed', 'time'] as const
export const GAP_POINT_KINDS = [
  'narrationBox',
  'recording',
  'background',
] as const

export type MediaEditKind = (typeof MEDIA_EDIT_KINDS)[number]
export type GapSpanKind = (typeof GAP_SPAN_KINDS)[number]
export type GapPointKind = (typeof GAP_POINT_KINDS)[number]

/**
 * Parameter edit for a recorded action. Targets a stable editable key and
 * carries only field values: the record shape cannot express repositioning.
 */
export type ParamEdit = {
  type: 'paramEdit'
  id: string
  target: { key: string }
  fields: Record<string, unknown>
}

/**
 * Rename of an action's stable `editId` slug, made in the web editor. Applied
 * to code by `screenci sync` (the slug's string literal is replaced); until
 * then the recorded slug keeps matching, so nothing goes stale in between.
 */
export type RenameEdit = {
  type: 'renameEdit'
  id: string
  target: { editId: string }
  newEditId: string
}

/**
 * A narration cue / overlay / audio start, placed in the gap after the action
 * identified by `afterEditId`. `blocking:true` is awaited (backbone); a
 * `sleepBeforeMs` gap precedes it. `props.name` names the media.
 */
export type MediaEdit = {
  type: 'mediaEdit'
  id: string
  kind: MediaEditKind
  afterEditId: string
  sleepBeforeMs?: number
  /**
   * Places the call BEFORE the anchor instead of in the gap after it, with a
   * `{ delay: delayMs }` option: the recorded start lands `delayMs` after the
   * anchor's start, so the media can begin during the anchor interaction.
   * Mutually exclusive with a positive `sleepBeforeMs`.
   */
  delayMs?: number
  blocking: boolean
  props?: Record<string, unknown>
  disabled?: boolean
}

/**
 * An `autoZoom` bracket over the interaction run `fromEditId..untilEditId`.
 * `leadInMs`/`holdMs` become `waitForTimeout` sleeps at the start/end inside
 * the block; `props` carry the zoom options (amount/duration/easing/...).
 */
export type ZoomEdit = {
  type: 'zoomEdit'
  id: string
  fromEditId: string
  untilEditId: string
  leadInMs?: number
  holdMs?: number
  props?: Record<string, unknown>
  disabled?: boolean
}

/**
 * A zero-record-time span (`hide`/`speed`/`time`). Start lands in the gap
 * after `fromEditId`, end in the gap after `untilEditId`; the backbone in
 * between is blanked/retimed. `fromSleepMs`/`untilSleepMs` pace the gap edges.
 */
export type GapSpanEdit = {
  type: 'gapSpanEdit'
  id: string
  kind: GapSpanKind
  fromEditId: string
  fromSleepMs?: number
  /**
   * Delays the span's recorded START into the `fromEditId` interaction: the
   * wrap opens with `{ delay: delayMs }` so the effect begins `delayMs` after
   * the interaction's start. Mutually exclusive with a positive `fromSleepMs`.
   */
  delayMs?: number
  untilEditId: string
  untilSleepMs?: number
  props?: Record<string, unknown>
  disabled?: boolean
}

/**
 * An instant zero-duration point (`narrationBox`/`recording`/`background`) in
 * the gap after `afterEditId`. `props` carry the change (corner/size/css/...).
 */
export type GapPointEdit = {
  type: 'gapPointEdit'
  id: string
  kind: GapPointKind
  afterEditId: string
  sleepBeforeMs?: number
  /**
   * Places the call BEFORE the anchor with a `{ delay: delayMs }` option so
   * the instant change lands `delayMs` after the anchor interaction's start
   * (i.e. during it). Mutually exclusive with a positive `sleepBeforeMs`.
   */
  delayMs?: number
  props?: Record<string, unknown>
  disabled?: boolean
}

/**
 * A placement change to an overlay DECLARATION in `video.overlays({...})`,
 * made graphically in the web editor. `props` carries exactly one placement
 * variant to merge into the named overlay's config object:
 * - `{ margin }` for a locator-locked overlay (declared with `over`),
 * - `{ x?, y?, width | height }` or `{ fill }` for a freely placed one.
 * Applied by `screenci sync` only (nothing to do at record time); stale
 * variant keys (e.g. `fill` when switching to a box) are removed by the
 * codemod. The id is `overlaydecl-<overlayName>` so upserts are
 * last-write-wins per overlay.
 */
export type OverlayDeclEdit = {
  type: 'overlayDeclEdit'
  id: string
  overlayName: string
  props: Record<string, unknown>
  disabled?: boolean
}

/** Codify-only records: placed into code by `screenci sync`, never at runtime. */
export type CodifyEdit = MediaEdit | ZoomEdit | GapSpanEdit | GapPointEdit

export type EditRecord = ParamEdit | RenameEdit | CodifyEdit | OverlayDeclEdit

export type TimelineEditsDoc = {
  version: number
  edits: EditRecord[]
}

// ─── Override report ─────────────────────────────────────────────────────────

export type OverrideReportStatus =
  | 'applied'
  | 'fallback'
  | 'shadowed-code'
  | 'skipped'

export type OverrideReportChannel =
  | 'paramEdit'
  | 'codifyEdit'
  | 'legacyEditable'
  | 'legacyAuthored'
  | 'fetch'

export type OverrideReportItem = {
  editId: string
  channel: OverrideReportChannel
  status: OverrideReportStatus
  /** Codify-edit kind or paramEdit target key, for readable logs. */
  subject?: string
  reason?: string
  resolvedStartMs?: number
  resolvedEndMs?: number
  appliedValues?: Record<string, unknown>
  codeValues?: Record<string, unknown>
}

/**
 * Collects one item per edit application attempt and turns them into
 * readable log lines. Injected wherever overrides are applied so the whole
 * run produces a single report, embedded in data.json and uploaded.
 */
export class OverrideReportBuilder {
  private readonly reportItems: OverrideReportItem[] = []

  constructor(
    private readonly log: (message: string) => void = (message) =>
      console.warn(message)
  ) {}

  add(item: OverrideReportItem): void {
    this.reportItems.push(item)
    // Skips, fallbacks and shadowed code values always log; applied detail
    // only with override debugging enabled.
    if (item.status === 'applied' && !isOverrideDebugEnabled()) return
    this.log(formatReportItem(item))
  }

  items(): OverrideReportItem[] {
    return [...this.reportItems]
  }

  /** Logs the end-of-video summary block (counts per status). */
  logSummary(videoName: string): void {
    if (this.reportItems.length === 0) return
    const counts = new Map<OverrideReportStatus, number>()
    for (const item of this.reportItems) {
      counts.set(item.status, (counts.get(item.status) ?? 0) + 1)
    }
    const parts = [...counts.entries()].map(
      ([status, count]) => `${count} ${status}`
    )
    this.log(`[screenci overrides] ${videoName}: ${parts.join(', ')}`)
  }
}

export function formatReportItem(item: OverrideReportItem): string {
  const status =
    item.status === 'applied' ? 'applied' : item.status.toUpperCase()
  const subject = item.subject !== undefined ? ` ${item.subject}` : ''
  const range =
    item.resolvedStartMs !== undefined
      ? item.resolvedEndMs !== undefined &&
        item.resolvedEndMs !== item.resolvedStartMs
        ? ` -> ${Math.round(item.resolvedStartMs)}..${Math.round(item.resolvedEndMs)}ms`
        : ` -> ${Math.round(item.resolvedStartMs)}ms`
      : ''
  const reason = item.reason !== undefined ? ` reason=${item.reason}` : ''
  return `[screenci overrides] ${status} ${item.channel}${subject} ${item.editId}${range}${reason}`
}

// ─── Parsing ─────────────────────────────────────────────────────────────────

export type InvalidEdit = { id: string; reason: string }

export type ParsedVideoEdits = {
  edits: EditRecord[]
  /** Records that failed validation: reported, never silently dropped. */
  invalid: InvalidEdit[]
}

export type TimelineEditsByVideo = Record<string, ParsedVideoEdits>

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function optionalNonNegativeMs(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === 'number' && Number.isFinite(value) && value >= 0)
  )
}

/**
 * Validates an optional `delayMs` against its sibling sleep field: a delay
 * must be a positive integer and cannot combine with a positive sleep (the
 * two encode contradictory placements: before vs after the anchor).
 */
function delayMsProblem(
  delayMs: unknown,
  sleepMs: unknown,
  sleepField: string
): string | null {
  if (delayMs === undefined) return null
  if (
    typeof delayMs !== 'number' ||
    !Number.isInteger(delayMs) ||
    delayMs <= 0
  ) {
    return 'invalid delayMs'
  }
  if (typeof sleepMs === 'number' && sleepMs > 0) {
    return `delayMs cannot combine with a positive ${sleepField}`
  }
  return null
}

function optionalProps(value: unknown): boolean {
  return value === undefined || (typeof value === 'object' && value !== null)
}

/** Why a record is invalid, or null when it is a valid {@link EditRecord}. */
function editRecordProblem(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return 'not an object'
  const record = value as Record<string, unknown>
  if (!isNonEmptyString(record.id)) return 'missing id'
  switch (record.type) {
    case 'paramEdit': {
      const target = record.target as Record<string, unknown> | null
      if (
        typeof target !== 'object' ||
        target === null ||
        !isNonEmptyString(target.key)
      ) {
        return 'paramEdit missing target.key'
      }
      if (typeof record.fields !== 'object' || record.fields === null) {
        return 'paramEdit missing fields'
      }
      return null
    }
    case 'renameEdit': {
      const target = record.target as Record<string, unknown> | null
      if (
        typeof target !== 'object' ||
        target === null ||
        !isNonEmptyString(target.editId)
      ) {
        return 'renameEdit missing target.editId'
      }
      if (!isNonEmptyString(record.newEditId)) {
        return 'renameEdit missing newEditId'
      }
      return null
    }
    case 'mediaEdit': {
      if (
        !(MEDIA_EDIT_KINDS as readonly string[]).includes(record.kind as string)
      ) {
        return `unknown mediaEdit kind '${String(record.kind)}'`
      }
      if (!isNonEmptyString(record.afterEditId))
        return 'mediaEdit missing afterEditId'
      if (typeof record.blocking !== 'boolean')
        return 'mediaEdit missing blocking'
      if (!optionalNonNegativeMs(record.sleepBeforeMs))
        return 'invalid sleepBeforeMs'
      {
        const problem = delayMsProblem(
          record.delayMs,
          record.sleepBeforeMs,
          'sleepBeforeMs'
        )
        if (problem !== null) return problem
      }
      if (record.delayMs !== undefined && record.blocking === true) {
        return 'delayMs requires blocking: false'
      }
      if (!optionalProps(record.props)) return 'invalid props'
      return null
    }
    case 'zoomEdit': {
      if (!isNonEmptyString(record.fromEditId))
        return 'zoomEdit missing fromEditId'
      if (!isNonEmptyString(record.untilEditId))
        return 'zoomEdit missing untilEditId'
      if (!optionalNonNegativeMs(record.leadInMs)) return 'invalid leadInMs'
      if (!optionalNonNegativeMs(record.holdMs)) return 'invalid holdMs'
      if (!optionalProps(record.props)) return 'invalid props'
      return null
    }
    case 'gapSpanEdit': {
      if (
        !(GAP_SPAN_KINDS as readonly string[]).includes(record.kind as string)
      ) {
        return `unknown gapSpanEdit kind '${String(record.kind)}'`
      }
      if (!isNonEmptyString(record.fromEditId))
        return 'gapSpanEdit missing fromEditId'
      if (!isNonEmptyString(record.untilEditId))
        return 'gapSpanEdit missing untilEditId'
      if (!optionalNonNegativeMs(record.fromSleepMs))
        return 'invalid fromSleepMs'
      if (!optionalNonNegativeMs(record.untilSleepMs))
        return 'invalid untilSleepMs'
      {
        const problem = delayMsProblem(
          record.delayMs,
          record.fromSleepMs,
          'fromSleepMs'
        )
        if (problem !== null) return problem
      }
      if (!optionalProps(record.props)) return 'invalid props'
      return null
    }
    case 'gapPointEdit': {
      if (
        !(GAP_POINT_KINDS as readonly string[]).includes(record.kind as string)
      ) {
        return `unknown gapPointEdit kind '${String(record.kind)}'`
      }
      if (!isNonEmptyString(record.afterEditId))
        return 'gapPointEdit missing afterEditId'
      if (!optionalNonNegativeMs(record.sleepBeforeMs))
        return 'invalid sleepBeforeMs'
      {
        const problem = delayMsProblem(
          record.delayMs,
          record.sleepBeforeMs,
          'sleepBeforeMs'
        )
        if (problem !== null) return problem
      }
      if (!optionalProps(record.props)) return 'invalid props'
      return null
    }
    case 'overlayDeclEdit': {
      if (!isNonEmptyString(record.overlayName)) {
        return 'overlayDeclEdit missing overlayName'
      }
      if (typeof record.props !== 'object' || record.props === null) {
        return 'overlayDeclEdit missing props'
      }
      return null
    }
    default:
      return `unknown record type '${String(record.type)}'`
  }
}

/**
 * Parse the injected timeline-edits map. Returns `null` when the env var is
 * unset or unreadable; per-video invalid records are kept in `invalid` so the
 * caller can report them instead of losing them silently.
 */
export function parseTimelineEdits(
  env: NodeJS.ProcessEnv = process.env
): TimelineEditsByVideo | null {
  const raw = env[SCREENCI_TIMELINE_EDITS_ENV]
  if (raw === undefined || raw.trim().length === 0) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null

  const result: TimelineEditsByVideo = {}
  for (const [videoName, doc] of Object.entries(parsed)) {
    if (typeof doc !== 'object' || doc === null) continue
    const { edits } = doc as Record<string, unknown>
    if (!Array.isArray(edits)) continue
    const valid: EditRecord[] = []
    const invalid: InvalidEdit[] = []
    for (const [index, record] of edits.entries()) {
      const problem = editRecordProblem(record)
      if (problem === null) {
        valid.push(record as EditRecord)
      } else {
        const id =
          typeof (record as Record<string, unknown>)?.id === 'string'
            ? ((record as Record<string, unknown>).id as string)
            : `#${index}`
        invalid.push({ id, reason: problem })
      }
    }
    if (valid.length > 0 || invalid.length > 0) {
      result[videoName] = { edits: valid, invalid }
    }
  }
  return Object.keys(result).length > 0 ? result : null
}

/** The parsed edits for one video from the injected env, or null. */
export function resolveTimelineEditsForVideo(
  videoName: string,
  env: NodeJS.ProcessEnv = process.env
): ParsedVideoEdits | null {
  return parseTimelineEdits(env)?.[videoName] ?? null
}

export type SplitEdits = {
  /** Param edits: applied at record time (they change real waits). */
  paramEdits: ParamEdit[]
  /** Codify-only records: never materialized at record time. */
  codifyEdits: CodifyEdit[]
}

export function splitEdits(edits: readonly EditRecord[]): SplitEdits {
  const paramEdits: ParamEdit[] = []
  const codifyEdits: CodifyEdit[] = []
  for (const edit of edits) {
    switch (edit.type) {
      case 'paramEdit':
        paramEdits.push(edit)
        break
      case 'renameEdit':
        // Renames affect code identity only; nothing to apply at record time
        // (the recorded slug keeps matching until the rename is codified).
        break
      case 'overlayDeclEdit':
        // Declaration placement edits are codified by `screenci sync`; at
        // record time the studio draft already carries the placement override.
        break
      case 'mediaEdit':
      case 'zoomEdit':
      case 'gapSpanEdit':
      case 'gapPointEdit':
        if (edit.disabled !== true) codifyEdits.push(edit)
        break
      default: {
        const exhaustive: never = edit
        void exhaustive
      }
    }
  }
  return { paramEdits, codifyEdits }
}

// ─── Stable ids for cues and overlays ────────────────────────────────────────

/** Stable id of the nth (0-based) narration cue with this name. */
export function cueIdFor(name: string, ordinal: number): string {
  return `cue||${name}|${ordinal}`
}

/** Stable id of the nth (0-based) overlay/asset with this name. */
export function overlayIdFor(name: string, ordinal: number): string {
  return `overlay||${name}|${ordinal}`
}

/** Stable id of the declaration-placement edit for an overlay name. */
export function overlayDeclIdFor(name: string): string {
  return `overlaydecl-${name}`
}
