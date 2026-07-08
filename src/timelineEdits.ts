/**
 * Unified timeline edits: the single wire format for web-editor overrides.
 *
 * A `TimelineEditsDoc` carries every edit the web editor stored for a video,
 * as typed records of exactly two shapes:
 *
 * - `paramEdit`: changes parameter fields of a recorded action (durations,
 *   sleeps, typing delay). It targets an action by its stable editable key and
 *   deliberately has no position or anchor field: real interactions stay where
 *   the test code put them.
 * - `placedEvent`: a render-affecting event (hide, speed, time, narration cue,
 *   overlay, timestamp marker) positioned as anchor + offset from a known
 *   moment: video start/end, an editable action edge, a `timestamp()` marker,
 *   or a narration cue. Placed events move freely and can be created from the
 *   web without code changes.
 *
 * Before a record run the CLI fetches the doc and injects it via
 * `SCREENCI_TIMELINE_EDITS` (a JSON map of video name to doc). Param edits
 * apply at runtime (they change real waits); placed events apply when
 * data.json is written. Every edit produces an `OverrideReportItem` so nothing
 * is ever silently skipped.
 */
import { isOverrideDebugEnabled } from './debugFlags.js'
import { stableEditableKey } from './editableDescriptor.js'
import type { EditableMeta } from './editableDescriptor.js'

export const SCREENCI_TIMELINE_EDITS_ENV = 'SCREENCI_TIMELINE_EDITS'

export const TIMELINE_EDITS_VERSION = 2

// ─── Anchors ─────────────────────────────────────────────────────────────────

/** A known moment in the recording that an edit's position is measured from. */
export type AnchorRef =
  | { type: 'videoStart' }
  | { type: 'videoEnd' }
  /** An editable action, matched by its stable key across re-records. */
  | { type: 'action'; key: string }
  /** A `timestamp('name')` marker; ordinal disambiguates repeated names. */
  | { type: 'timestamp'; name: string; ordinal: number }
  /** A narration cue start, matched by stable cue id (see {@link cueIdFor}). */
  | { type: 'cue'; cueId: string }

export type AnchorEdge = 'start' | 'end'

export type Anchor = {
  ref: AnchorRef
  /** Which edge of the anchored event to measure from. */
  edge: AnchorEdge
  /** Offset in recording ms from the anchored edge (may be negative). */
  offsetMs: number
}

/** Human-readable anchor description for logs and reports. */
export function describeAnchorRef(ref: AnchorRef): string {
  switch (ref.type) {
    case 'videoStart':
      return 'videoStart'
    case 'videoEnd':
      return 'videoEnd'
    case 'action':
      return `action:${ref.key}`
    case 'timestamp':
      return `timestamp:${ref.name}|${ref.ordinal}`
    case 'cue':
      return `cue:${ref.cueId}`
    default: {
      const exhaustive: never = ref
      return String(exhaustive)
    }
  }
}

export function describeAnchor(anchor: Anchor): string {
  const sign = anchor.offsetMs >= 0 ? '+' : ''
  return `${describeAnchorRef(anchor.ref)}.${anchor.edge}${sign}${anchor.offsetMs}ms`
}

// ─── Edit records ────────────────────────────────────────────────────────────

export const PLACED_SPAN_KINDS = ['hide', 'speed', 'time', 'zoom'] as const
export const PLACED_POINT_KINDS = [
  'narrationCue',
  'overlay',
  'timestamp',
  // Presentation updates that fire once at a moment: change the page
  // background, move/resize the narration (PIP) box, or resize/hide/show the
  // screen recording. Each inserts its recorded `*Update` event.
  'background',
  'narrationBox',
  'recording',
] as const

export type PlacedSpanKind = (typeof PLACED_SPAN_KINDS)[number]
export type PlacedPointKind = (typeof PLACED_POINT_KINDS)[number]
export type PlacedEventKind = PlacedSpanKind | PlacedPointKind

export type PlacedEnd = { anchor: Anchor } | { durationMs: number }

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
 * A freely positioned render-affecting event.
 *
 * `targetId` distinguishes moving an existing code-declared cue/overlay
 * (stable id, see {@link cueIdFor}/{@link overlayIdFor}) from creating a new
 * web-authored one (no target; `props.name` names the new studio-managed
 * event).
 */
export type PlacedEvent = {
  type: 'placedEvent'
  id: string
  kind: PlacedEventKind
  anchor: Anchor
  /** Required for span kinds (hide/speed/time); ignored for point kinds
   *  except `overlay`, where a `durationMs` end retimes the overlay's end. */
  end?: PlacedEnd
  /**
   * Recording-time position captured when the edit was made. When the anchor
   * no longer resolves the event falls back to `videoStart + capturedAtMs`
   * (reported as `fallback`) instead of disappearing.
   */
  capturedAtMs?: number
  /** Stable id of the code-declared cue/overlay this event moves, if any. */
  targetId?: string
  /**
   * Kind-specific options: speed reads `multiplier` (default 2), time reads
   * `durationMs`, zoom reads `amount`/`duration`/`easing`/`centering`,
   * timestamp/narrationCue/overlay read `name`, background reads
   * `backgroundCss`, narrationBox reads `corner`/`size`, recording reads
   * `size`/`visible`; the three update kinds also read an optional
   * `durationMs` for an eased transition.
   */
  props?: Record<string, unknown>
  disabled?: boolean
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

export type EditRecord = ParamEdit | PlacedEvent | RenameEdit

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
  | 'placedEvent'
  | 'legacyEditable'
  | 'legacyAuthored'
  | 'fetch'

export type OverrideReportItem = {
  editId: string
  channel: OverrideReportChannel
  status: OverrideReportStatus
  /** Placed-event kind or paramEdit target key, for readable logs. */
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

function isAnchorRef(value: unknown): value is AnchorRef {
  if (typeof value !== 'object' || value === null) return false
  const ref = value as Record<string, unknown>
  switch (ref.type) {
    case 'videoStart':
    case 'videoEnd':
      return true
    case 'action':
      return typeof ref.key === 'string' && ref.key.length > 0
    case 'timestamp':
      return (
        typeof ref.name === 'string' &&
        ref.name.length > 0 &&
        typeof ref.ordinal === 'number' &&
        Number.isInteger(ref.ordinal) &&
        ref.ordinal >= 0
      )
    case 'cue':
      return typeof ref.cueId === 'string' && ref.cueId.length > 0
    default:
      return false
  }
}

function isAnchor(value: unknown): value is Anchor {
  if (typeof value !== 'object' || value === null) return false
  const anchor = value as Record<string, unknown>
  return (
    isAnchorRef(anchor.ref) &&
    (anchor.edge === 'start' || anchor.edge === 'end') &&
    typeof anchor.offsetMs === 'number' &&
    Number.isFinite(anchor.offsetMs)
  )
}

function isPlacedEnd(value: unknown): value is PlacedEnd {
  if (typeof value !== 'object' || value === null) return false
  const end = value as Record<string, unknown>
  if (isAnchor(end.anchor)) return true
  return (
    typeof end.durationMs === 'number' &&
    Number.isFinite(end.durationMs) &&
    end.durationMs > 0
  )
}

/** Why a record is invalid, or null when it is a valid {@link EditRecord}. */
function editRecordProblem(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return 'not an object'
  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string' || record.id.length === 0) {
    return 'missing id'
  }
  if (record.type === 'paramEdit') {
    const target = record.target as Record<string, unknown> | null
    if (
      typeof target !== 'object' ||
      target === null ||
      typeof target.key !== 'string' ||
      target.key.length === 0
    ) {
      return 'paramEdit missing target.key'
    }
    if (typeof record.fields !== 'object' || record.fields === null) {
      return 'paramEdit missing fields'
    }
    return null
  }
  if (record.type === 'placedEvent') {
    const kinds: readonly string[] = [
      ...PLACED_SPAN_KINDS,
      ...PLACED_POINT_KINDS,
    ]
    if (typeof record.kind !== 'string' || !kinds.includes(record.kind)) {
      return `unknown placedEvent kind '${String(record.kind)}'`
    }
    if (!isAnchor(record.anchor)) return 'invalid anchor'
    if (
      (PLACED_SPAN_KINDS as readonly string[]).includes(record.kind) &&
      !isPlacedEnd(record.end)
    ) {
      return `${record.kind} requires an end (anchor or durationMs)`
    }
    if (record.end !== undefined && !isPlacedEnd(record.end)) {
      return 'invalid end'
    }
    if (
      record.capturedAtMs !== undefined &&
      (typeof record.capturedAtMs !== 'number' ||
        !Number.isFinite(record.capturedAtMs) ||
        record.capturedAtMs < 0)
    ) {
      return 'invalid capturedAtMs'
    }
    if (record.targetId !== undefined && typeof record.targetId !== 'string') {
      return 'invalid targetId'
    }
    if (
      record.props !== undefined &&
      (typeof record.props !== 'object' || record.props === null)
    ) {
      return 'invalid props'
    }
    return null
  }
  return `unknown record type '${String(record.type)}'`
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
  paramEdits: ParamEdit[]
  placedEvents: PlacedEvent[]
}

export function splitEdits(edits: readonly EditRecord[]): SplitEdits {
  const paramEdits: ParamEdit[] = []
  const placedEvents: PlacedEvent[] = []
  for (const edit of edits) {
    switch (edit.type) {
      case 'paramEdit':
        paramEdits.push(edit)
        break
      case 'placedEvent':
        if (edit.disabled !== true) placedEvents.push(edit)
        break
      case 'renameEdit':
        // Renames affect code identity only; nothing to apply at record time
        // (the recorded slug keeps matching until the rename is codified).
        break
      default: {
        const exhaustive: never = edit
        void exhaustive
      }
    }
  }
  return { paramEdits, placedEvents }
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

// ─── Anchor resolution against a recorded event list ────────────────────────

type EventLike = {
  type?: unknown
  timeMs?: unknown
  durationMs?: unknown
  name?: unknown
  events?: unknown
  editable?: EditableMeta
}

/** Recording-time span of an event, mirroring the backend's reconciliation. */
function eventSpan(
  event: EventLike,
  index: number,
  events: readonly EventLike[]
): { startMs: number; endMs: number } | null {
  if (event.type === 'input' && Array.isArray(event.events)) {
    let start = Infinity
    let end = -Infinity
    for (const inner of event.events as Array<Record<string, unknown>>) {
      if (typeof inner !== 'object' || inner === null) continue
      if (typeof inner.startMs === 'number') {
        start = Math.min(start, inner.startMs)
      }
      if (typeof inner.endMs === 'number') end = Math.max(end, inner.endMs)
    }
    return Number.isFinite(start) && Number.isFinite(end)
      ? { startMs: start, endMs: end }
      : null
  }
  if (typeof event.timeMs !== 'number') return null
  if (event.type === 'delay') {
    const durationMs =
      typeof event.durationMs === 'number' ? event.durationMs : 0
    return { startMs: event.timeMs, endMs: event.timeMs + durationMs }
  }
  if (event.type === 'speedStart' || event.type === 'autoZoomStart') {
    const endType = event.type === 'speedStart' ? 'speedEnd' : 'autoZoomEnd'
    for (let i = index + 1; i < events.length; i++) {
      const candidate = events[i]
      if (candidate?.type === endType && typeof candidate.timeMs === 'number') {
        return { startMs: event.timeMs, endMs: candidate.timeMs }
      }
    }
  }
  return { startMs: event.timeMs, endMs: event.timeMs }
}

/** Recording end: the latest span end across all events. */
export function recordingEndMsOf(events: readonly unknown[]): number {
  const list = events as readonly EventLike[]
  return list.reduce((max, event, index) => {
    const span = eventSpan(event, index, list)
    return span !== null ? Math.max(max, span.endMs) : max
  }, 0)
}

/**
 * Resolve an anchor to a recording-time position against the recorded event
 * list, deterministically: videoStart/videoEnd always resolve; actions match
 * by stable editable key; timestamps by name + ordinal; cues by stable cue
 * id. Returns `null` when the anchored moment no longer exists.
 */
export function resolveTimelineAnchor(
  events: readonly unknown[],
  anchor: Anchor,
  recordingEndMs: number = recordingEndMsOf(events)
): number | null {
  const ref = anchor.ref
  switch (ref.type) {
    case 'videoStart':
      return anchor.offsetMs
    case 'videoEnd':
      return recordingEndMs + anchor.offsetMs
    case 'action': {
      const list = events as readonly EventLike[]
      for (const [index, event] of list.entries()) {
        if (typeof event !== 'object' || event === null) continue
        if (event.editable?.descriptor === undefined) continue
        if (stableEditableKey(event.editable.descriptor) !== ref.key) continue
        const span = eventSpan(event, index, list)
        if (span === null) return null
        return (
          (anchor.edge === 'end' ? span.endMs : span.startMs) + anchor.offsetMs
        )
      }
      return null
    }
    case 'timestamp': {
      const ordinals = new Map<string, number>()
      for (const event of events as readonly EventLike[]) {
        if (typeof event !== 'object' || event === null) continue
        if (event.type !== 'timestamp' || typeof event.name !== 'string') {
          continue
        }
        const ordinal = ordinals.get(event.name) ?? 0
        ordinals.set(event.name, ordinal + 1)
        if (event.name === ref.name && ordinal === ref.ordinal) {
          return typeof event.timeMs === 'number'
            ? event.timeMs + anchor.offsetMs
            : null
        }
      }
      return null
    }
    case 'cue': {
      const ordinals = new Map<string, number>()
      for (const event of events as readonly EventLike[]) {
        if (typeof event !== 'object' || event === null) continue
        if (
          (event.type !== 'cueStart' && event.type !== 'videoCueStart') ||
          typeof event.name !== 'string'
        ) {
          continue
        }
        const ordinal = ordinals.get(event.name) ?? 0
        ordinals.set(event.name, ordinal + 1)
        if (cueIdFor(event.name, ordinal) === ref.cueId) {
          return typeof event.timeMs === 'number'
            ? event.timeMs + anchor.offsetMs
            : null
        }
      }
      return null
    }
    default: {
      const exhaustive: never = ref
      void exhaustive
      return null
    }
  }
}

// ─── Applying placed events at data.json write time ─────────────────────────

/** Insert `event` into `events` before the first event that starts later. */
function insertSorted(
  events: EventLike[],
  event: { timeMs: number } & Record<string, unknown>
): void {
  const timeOf = (candidate: EventLike): number => {
    if (typeof candidate.timeMs === 'number') return candidate.timeMs
    if (candidate.type === 'input' && Array.isArray(candidate.events)) {
      const first = (candidate.events as Array<Record<string, unknown>>).find(
        (inner) => typeof inner?.startMs === 'number'
      )
      if (first !== undefined) return first.startMs as number
    }
    return 0
  }
  let index = events.findIndex((candidate) => timeOf(candidate) > event.timeMs)
  if (index === -1) index = events.length
  events.splice(index, 0, event)
}

function propNumber(
  props: Record<string, unknown>,
  field: string
): number | undefined {
  const value = props[field]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function propString(
  props: Record<string, unknown>,
  field: string
): string | undefined {
  const value = props[field]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function propBool(
  props: Record<string, unknown>,
  field: string
): boolean | undefined {
  const value = props[field]
  return typeof value === 'boolean' ? value : undefined
}

/**
 * A presentation-update transition from a `durationMs` prop: omitted (an
 * instant cut) when the duration is missing or non-positive, otherwise an
 * eased crossfade. Web-added updates default to `ease-in-out`, matching the
 * SDK's `OverlayTransitionOptions`.
 */
function propTransition(
  props: Record<string, unknown>
): { durationMs: number; easing: string } | undefined {
  const durationMs = propNumber(props, 'durationMs')
  if (durationMs === undefined || durationMs <= 0) return undefined
  const easing = propString(props, 'easing')
  return { durationMs, easing: easing ?? 'ease-in-out' }
}

/**
 * Moves a zoom boundary out of any input event's span: the renderer rejects
 * autoZoom boundaries strictly inside an input, so a start boundary snaps to
 * the containing input's start and an end boundary to its end (the window
 * only ever widens, keeping the anchored action fully inside it).
 */
function clampOutsideInputSpans(
  events: readonly EventLike[],
  boundaryMs: number,
  edge: 'start' | 'end'
): number {
  for (const [index, event] of events.entries()) {
    if (event.type !== 'input') continue
    const span = eventSpan(event, index, events)
    if (span === null) continue
    if (boundaryMs > span.startMs && boundaryMs < span.endMs) {
      return edge === 'start' ? span.startMs : span.endMs
    }
  }
  return boundaryMs
}

/**
 * Applies `autoZoom` write-time boundary shifts: every autoZoomStart carrying
 * `startOffset`/`endOffset` (from the block's options or a web param edit)
 * moves by that many ms, together with its matching autoZoomEnd, then the
 * fields are stripped so downstream consumers never see them. Boundaries are
 * clamped to the recording and widened out of interaction spans (the
 * renderer rejects zoom boundaries inside an input). A negative startOffset
 * legally reaches into the past because placement happens after the
 * recording ran.
 */
export function applyZoomWindowOffsets<T>(recordedEvents: readonly T[]): T[] {
  const events = [...(recordedEvents as unknown as EventLike[])]
  const recordingEndMs = recordingEndMsOf(events)
  for (;;) {
    const startIndex = events.findIndex((event) => {
      if (event.type !== 'autoZoomStart') return false
      const zoom = event as { startOffset?: unknown; endOffset?: unknown }
      return (
        typeof zoom.startOffset === 'number' ||
        typeof zoom.endOffset === 'number'
      )
    })
    if (startIndex === -1) break
    const start = events[startIndex] as EventLike & {
      timeMs: number
      startOffset?: number
      endOffset?: number
    }
    const endIndex = events.findIndex(
      (event, index) => index > startIndex && event.type === 'autoZoomEnd'
    )
    // Keep the end by object identity: splices below may shift its index.
    const endEvent =
      endIndex !== -1
        ? (events[endIndex] as EventLike & { timeMs: number })
        : undefined
    const startOffset = start.startOffset ?? 0
    const endOffset = start.endOffset ?? 0
    const { startOffset: _s, endOffset: _e, ...cleanStart } = start
    if (startOffset !== 0) {
      const shifted = Math.max(0, start.timeMs + startOffset)
      events.splice(startIndex, 1)
      insertSorted(events, {
        ...cleanStart,
        timeMs: clampOutsideInputSpans(events, shifted, 'start'),
      })
    } else {
      events.splice(startIndex, 1, cleanStart as EventLike)
    }
    if (endEvent !== undefined && endOffset !== 0) {
      const currentIndex = events.indexOf(endEvent)
      const shifted = Math.min(recordingEndMs, endEvent.timeMs + endOffset)
      events.splice(currentIndex, 1)
      insertSorted(events, {
        ...(endEvent as Record<string, unknown>),
        timeMs: clampOutsideInputSpans(events, shifted, 'end'),
      } as { timeMs: number } & Record<string, unknown>)
    }
  }
  return events as unknown as T[]
}

/**
 * Resolve a placed event's start: the anchor when it still exists, otherwise
 * the captured recording-time position (`fallback`), otherwise null.
 */
function resolveStart(
  events: readonly EventLike[],
  placed: PlacedEvent,
  recordingEndMs: number
): { ms: number; fallback: boolean } | null {
  const resolved = resolveTimelineAnchor(events, placed.anchor, recordingEndMs)
  if (resolved !== null) return { ms: resolved, fallback: false }
  if (placed.capturedAtMs !== undefined) {
    return { ms: placed.capturedAtMs, fallback: true }
  }
  return null
}

/** Stable cue/overlay id of a recorded event, by name-ordinal counting. */
function findByStableId(
  events: readonly EventLike[],
  types: readonly string[],
  idFor: (name: string, ordinal: number) => string,
  targetId: string
): number {
  const ordinals = new Map<string, number>()
  for (const [index, event] of events.entries()) {
    if (typeof event !== 'object' || event === null) continue
    if (!types.includes(event.type as string)) continue
    if (typeof event.name !== 'string') continue
    const ordinal = ordinals.get(event.name) ?? 0
    ordinals.set(event.name, ordinal + 1)
    if (idFor(event.name, ordinal) === targetId) return index
  }
  return -1
}

/**
 * Apply placed events to a recorded event list: resolve anchors, insert or
 * move the corresponding events, and record one report item per edit. Never
 * throws; every outcome (applied, fallback, skipped + reason) is reported.
 */
export function applyPlacedEvents<T>(
  recordedEvents: readonly T[],
  placedEvents: readonly PlacedEvent[],
  report: OverrideReportBuilder
): T[] {
  const events = [...(recordedEvents as unknown as EventLike[])]
  const recordingEndMs = recordingEndMsOf(events)

  for (const placed of placedEvents) {
    const item = (
      status: OverrideReportStatus,
      extra: Partial<OverrideReportItem> = {}
    ): void => {
      report.add({
        editId: placed.id,
        channel: 'placedEvent',
        status,
        subject: `${placed.kind} anchor=${describeAnchor(placed.anchor)}`,
        ...extra,
      })
    }

    const start = resolveStart(events, placed, recordingEndMs)
    if (start === null) {
      item('skipped', {
        reason: `anchorMissing:${describeAnchorRef(placed.anchor.ref)}`,
      })
      continue
    }
    const props = placed.props ?? {}

    // Point kinds fire once at the resolved position.
    if ((PLACED_POINT_KINDS as readonly string[]).includes(placed.kind)) {
      const timeMs = Math.max(0, Math.min(start.ms, recordingEndMs))
      const status: OverrideReportStatus = start.fallback
        ? 'fallback'
        : 'applied'
      const fallbackReason = start.fallback
        ? {
            reason: `anchorMissing:${describeAnchorRef(placed.anchor.ref)} usedCapturedAtMs`,
          }
        : {}
      switch (placed.kind) {
        case 'timestamp': {
          const name = propString(props, 'name')
          if (name === undefined) {
            item('skipped', { reason: 'timestampMissingName' })
            continue
          }
          insertSorted(events, { type: 'timestamp', timeMs, name })
          item(status, { resolvedStartMs: timeMs, ...fallbackReason })
          continue
        }
        case 'narrationCue': {
          if (placed.targetId !== undefined) {
            const index = findByStableId(
              events,
              ['cueStart', 'videoCueStart'],
              cueIdFor,
              placed.targetId
            )
            if (index === -1) {
              item('skipped', { reason: `targetMissing:${placed.targetId}` })
              continue
            }
            const [cue] = events.splice(index, 1)
            insertSorted(events, {
              ...(cue as Record<string, unknown>),
              timeMs,
            } as EventLike & { timeMs: number })
            item(status, { resolvedStartMs: timeMs, ...fallbackReason })
            continue
          }
          const name = propString(props, 'name')
          if (name === undefined) {
            item('skipped', { reason: 'narrationCueMissingName' })
            continue
          }
          // Web-created cue: studio-managed, text and voice come from Studio.
          insertSorted(events, { type: 'cueStart', timeMs, name, studio: true })
          item(status, { resolvedStartMs: timeMs, ...fallbackReason })
          continue
        }
        case 'overlay': {
          if (placed.targetId !== undefined) {
            const index = findByStableId(
              events,
              ['assetStart'],
              overlayIdFor,
              placed.targetId
            )
            if (index === -1) {
              item('skipped', { reason: `targetMissing:${placed.targetId}` })
              continue
            }
            const overlay = events[index] as EventLike & { timeMs: number }
            const overlayName =
              typeof overlay.name === 'string' ? overlay.name : undefined
            const previousTimeMs = overlay.timeMs
            events.splice(index, 1)
            insertSorted(events, {
              ...(overlay as Record<string, unknown>),
              timeMs,
            } as EventLike & { timeMs: number })
            // Move the matching assetEnd (the first one for this name after
            // the previous start) by the same delta so the span keeps its
            // recorded length, or retime it when the edit carries a duration.
            const durationEnd =
              placed.end !== undefined && 'durationMs' in placed.end
                ? placed.end.durationMs
                : undefined
            const endIndex = events.findIndex(
              (candidate) =>
                candidate.type === 'assetEnd' &&
                (candidate.name === overlayName ||
                  candidate.name === undefined) &&
                typeof candidate.timeMs === 'number' &&
                candidate.timeMs >= previousTimeMs
            )
            if (endIndex !== -1) {
              const end = events[endIndex] as EventLike & { timeMs: number }
              const newEndMs =
                durationEnd !== undefined
                  ? timeMs + durationEnd
                  : end.timeMs + (timeMs - previousTimeMs)
              events.splice(endIndex, 1)
              insertSorted(events, {
                ...(end as Record<string, unknown>),
                timeMs: Math.max(0, Math.min(newEndMs, recordingEndMs)),
              } as EventLike & { timeMs: number })
            }
            item(status, { resolvedStartMs: timeMs, ...fallbackReason })
            continue
          }
          const name = propString(props, 'name')
          if (name === undefined) {
            item('skipped', { reason: 'overlayMissingName' })
            continue
          }
          // Web-created overlay: studio-managed, media comes from Studio.
          insertSorted(events, {
            type: 'assetStart',
            timeMs,
            name,
            studio: true,
          })
          const durationEnd =
            placed.end !== undefined && 'durationMs' in placed.end
              ? placed.end.durationMs
              : undefined
          if (durationEnd !== undefined) {
            insertSorted(events, {
              type: 'assetEnd',
              timeMs: Math.max(
                0,
                Math.min(timeMs + durationEnd, recordingEndMs)
              ),
              name,
            })
          }
          item(status, { resolvedStartMs: timeMs, ...fallbackReason })
          continue
        }
        case 'background': {
          const backgroundCss = propString(props, 'backgroundCss')
          if (backgroundCss === undefined) {
            item('skipped', { reason: 'backgroundMissingCss' })
            continue
          }
          const transition = propTransition(props)
          insertSorted(events, {
            type: 'backgroundUpdate',
            timeMs,
            background: { backgroundCss },
            ...(transition !== undefined && { transition }),
          })
          item(status, { resolvedStartMs: timeMs, ...fallbackReason })
          continue
        }
        case 'narrationBox': {
          // `corner` carries a NarrationPosition (corner / 'center' /
          // 'full-screen'); either it or a new size must be present.
          const position = propString(props, 'corner')
          const size = propNumber(props, 'size')
          if (position === undefined && size === undefined) {
            item('skipped', { reason: 'narrationBoxMissingChange' })
            continue
          }
          const transition = propTransition(props)
          insertSorted(events, {
            type: 'narrationUpdate',
            timeMs,
            ...(position !== undefined && { position }),
            ...(size !== undefined && { size }),
            ...(transition !== undefined && { transition }),
          })
          item(status, { resolvedStartMs: timeMs, ...fallbackReason })
          continue
        }
        case 'recording': {
          const size = propNumber(props, 'size')
          const visible = propBool(props, 'visible')
          if (size === undefined && visible === undefined) {
            item('skipped', { reason: 'recordingMissingChange' })
            continue
          }
          const transition = propTransition(props)
          insertSorted(events, {
            type: 'recordingUpdate',
            timeMs,
            ...(size !== undefined && { size }),
            ...(visible !== undefined && { visible }),
            ...(transition !== undefined && { transition }),
          })
          item(status, { resolvedStartMs: timeMs, ...fallbackReason })
          continue
        }
        default: {
          const exhaustive: never = placed.kind as never
          void exhaustive
          continue
        }
      }
    }

    // Span kinds need a resolvable end.
    if (placed.end === undefined) {
      item('skipped', { reason: 'missingEnd' })
      continue
    }
    const endRaw =
      'durationMs' in placed.end
        ? start.ms + placed.end.durationMs
        : resolveTimelineAnchor(events, placed.end.anchor, recordingEndMs)
    if (endRaw === null) {
      const endRef =
        'anchor' in placed.end
          ? describeAnchorRef(placed.end.anchor.ref)
          : 'durationMs'
      item('skipped', { reason: `endAnchorMissing:${endRef}` })
      continue
    }
    const fromMs = Math.max(0, Math.min(start.ms, recordingEndMs))
    const toMs = Math.max(0, Math.min(endRaw, recordingEndMs))
    if (toMs <= fromMs) {
      item('skipped', {
        reason: `emptyRange:${Math.round(start.ms)}..${Math.round(endRaw)}ms`,
      })
      continue
    }
    const status: OverrideReportStatus = start.fallback ? 'fallback' : 'applied'
    const spanExtra: Partial<OverrideReportItem> = {
      resolvedStartMs: fromMs,
      resolvedEndMs: toMs,
      ...(start.fallback && {
        reason: `anchorMissing:${describeAnchorRef(placed.anchor.ref)} usedCapturedAtMs`,
      }),
    }
    switch (placed.kind as PlacedSpanKind) {
      case 'hide': {
        insertSorted(events, { type: 'hideStart', timeMs: fromMs })
        insertSorted(events, { type: 'hideEnd', timeMs: toMs })
        item(status, spanExtra)
        break
      }
      case 'time': {
        const durationMs = propNumber(props, 'durationMs')
        if (durationMs === undefined || durationMs < 0) {
          item('skipped', { reason: 'timeMissingDurationMs' })
          break
        }
        insertSorted(events, { type: 'timeStart', timeMs: fromMs, durationMs })
        insertSorted(events, { type: 'timeEnd', timeMs: toMs })
        item(status, spanExtra)
        break
      }
      case 'speed': {
        const multiplier = propNumber(props, 'multiplier')
        insertSorted(events, {
          type: 'speedStart',
          timeMs: fromMs,
          multiplier:
            multiplier !== undefined && multiplier > 0 ? multiplier : 2,
        })
        insertSorted(events, { type: 'speedEnd', timeMs: toMs })
        item(status, spanExtra)
        break
      }
      case 'zoom': {
        // The renderer rejects zoom boundaries strictly inside an input
        // event's span, so widen the window outward when a boundary lands
        // in one (a lead-in that starts mid-click starts at the click's
        // start instead). The camera target comes from the recorded mouse
        // positions and element rects inside the window at render time.
        const zoomFromMs = clampOutsideInputSpans(events, fromMs, 'start')
        const zoomToMs = clampOutsideInputSpans(events, toMs, 'end')
        if (zoomToMs <= zoomFromMs) {
          item('skipped', {
            reason: `emptyRange:${Math.round(zoomFromMs)}..${Math.round(zoomToMs)}ms`,
          })
          break
        }
        const amount = propNumber(props, 'amount')
        const duration = propNumber(props, 'duration')
        const easing = propString(props, 'easing')
        const centering = propNumber(props, 'centering')
        insertSorted(events, {
          type: 'autoZoomStart',
          timeMs: zoomFromMs,
          easing: easing ?? 'ease-out',
          duration: duration !== undefined && duration >= 0 ? duration : 750,
          amount: amount !== undefined && amount > 0 ? amount : 0.72,
          ...(centering !== undefined && { centering }),
        })
        insertSorted(events, {
          type: 'autoZoomEnd',
          timeMs: zoomToMs,
          easing: easing ?? 'ease-out',
          duration: duration !== undefined && duration >= 0 ? duration : 750,
        })
        item(status, {
          ...spanExtra,
          resolvedStartMs: zoomFromMs,
          resolvedEndMs: zoomToMs,
        })
        break
      }
      default: {
        const exhaustive: never = placed.kind as never
        void exhaustive
      }
    }
  }
  return events as unknown as T[]
}
