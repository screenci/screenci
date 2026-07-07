/**
 * Web-authored timeline events (hides and speed blocks added from the web
 * editor, without code changes).
 *
 * Each authored event is anchored to a recorded event: `from.ref` names a
 * previous known event (an editable action's stable key, or a `timestamp()`
 * marker) and `offsetMs` shifts from it. The end is either another anchor
 * (with its own offset) or a plain duration. Before a record run the CLI
 * fetches the stored events and injects them via `SCREENCI_AUTHORED_EVENTS`
 * (a JSON map of video name to events); at data.json write time the recorded
 * event list is post-processed: anchors resolve to recording-time positions
 * and matching hideStart/hideEnd or speedStart/speedEnd pairs are inserted.
 * Unresolvable anchors never fail the recording: the event is skipped with a
 * warning, and `screenci status` reports it.
 */
import { stableEditableKey } from './editableDescriptor.js'
import type { EditableMeta } from './editableDescriptor.js'
import { isOverrideDebugEnabled } from './debugFlags.js'

export const SCREENCI_AUTHORED_EVENTS_ENV = 'SCREENCI_AUTHORED_EVENTS'

export type EventAnchor = {
  /** Stable key of an editable action, `timestamp||name|ordinal`, or a bare
   *  timestamp name (first occurrence). */
  ref: string
  /** Offset in recording ms from the anchored edge (may be negative). */
  offsetMs: number
  /** Which edge of the anchored event to measure from (default 'start'). */
  edge?: 'start' | 'end'
}

export type AuthoredEventEnd = { anchor: EventAnchor } | { durationMs: number }

/** Span kinds need a `to`; point kinds fire once at `from`. */
export const AUTHORED_SPAN_KINDS = ['hide', 'speed', 'time'] as const
export const AUTHORED_POINT_KINDS = [
  'narrationUpdate',
  'recordingUpdate',
  'backgroundUpdate',
] as const

export type AuthoredEventKind =
  | (typeof AUTHORED_SPAN_KINDS)[number]
  | (typeof AUTHORED_POINT_KINDS)[number]

export type AuthoredEvent = {
  id: string
  kind: AuthoredEventKind
  from: EventAnchor
  /** Required for span kinds (hide/speed/time); ignored for point kinds. */
  to?: AuthoredEventEnd
  /**
   * Kind-specific options: speed reads `multiplier` (default 2), time reads
   * `durationMs` (the render-time target), narrationUpdate reads
   * `corner`/`size`/`visible`/`duration`, recordingUpdate reads
   * `size`/`visible`/`duration`, backgroundUpdate reads
   * `backgroundCss`/`duration`.
   */
  props?: Record<string, unknown>
}

export type AuthoredEventsByVideo = Record<string, AuthoredEvent[]>

function isAnchor(value: unknown): value is EventAnchor {
  if (typeof value !== 'object' || value === null) return false
  const anchor = value as Record<string, unknown>
  return (
    typeof anchor.ref === 'string' &&
    anchor.ref.length > 0 &&
    typeof anchor.offsetMs === 'number' &&
    Number.isFinite(anchor.offsetMs) &&
    (anchor.edge === undefined ||
      anchor.edge === 'start' ||
      anchor.edge === 'end')
  )
}

function isEnd(value: unknown): value is AuthoredEventEnd {
  if (typeof value !== 'object' || value === null) return false
  const end = value as Record<string, unknown>
  if (isAnchor(end.anchor)) return true
  return (
    typeof end.durationMs === 'number' &&
    Number.isFinite(end.durationMs) &&
    end.durationMs > 0
  )
}

function isAuthoredEvent(value: unknown): value is AuthoredEvent {
  if (typeof value !== 'object' || value === null) return false
  const event = value as Record<string, unknown>
  if (typeof event.id !== 'string' || !isAnchor(event.from)) return false
  if (
    (AUTHORED_SPAN_KINDS as readonly string[]).includes(event.kind as string)
  ) {
    return isEnd(event.to)
  }
  return (AUTHORED_POINT_KINDS as readonly string[]).includes(
    event.kind as string
  )
}

/**
 * Parse the injected authored-events map. Returns `null` when unset or
 * malformed; invalid events are dropped.
 */
export function parseAuthoredEvents(
  env: NodeJS.ProcessEnv = process.env
): AuthoredEventsByVideo | null {
  const raw = env[SCREENCI_AUTHORED_EVENTS_ENV]
  if (raw === undefined || raw.trim().length === 0) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const result: AuthoredEventsByVideo = {}
    for (const [videoName, events] of Object.entries(parsed)) {
      if (!Array.isArray(events)) continue
      const valid = events.filter(isAuthoredEvent)
      if (valid.length > 0) result[videoName] = valid
    }
    return Object.keys(result).length > 0 ? result : null
  } catch {
    return null
  }
}

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

/**
 * Resolve an anchor to a recording-time position. `ref` matches, in order:
 * an editable action's stable key, a timestamp marker's stable key
 * (`timestamp||name|ordinal`), or a bare timestamp name (first occurrence).
 * Returns `null` when nothing matches.
 */
export function resolveAnchorMs(
  events: readonly EventLike[],
  anchor: EventAnchor
): number | null {
  const timestampOrdinals = new Map<string, number>()
  for (const [index, event] of events.entries()) {
    if (typeof event !== 'object' || event === null) continue

    if (event.editable?.descriptor !== undefined) {
      if (stableEditableKey(event.editable.descriptor) === anchor.ref) {
        const span = eventSpan(event, index, events)
        if (span === null) return null
        return (
          (anchor.edge === 'end' ? span.endMs : span.startMs) + anchor.offsetMs
        )
      }
    }

    if (event.type === 'timestamp' && typeof event.name === 'string') {
      const ordinal = timestampOrdinals.get(event.name) ?? 0
      timestampOrdinals.set(event.name, ordinal + 1)
      const stampKey = `timestamp||${event.name}|${ordinal}`
      if (anchor.ref === stampKey || anchor.ref === event.name) {
        return typeof event.timeMs === 'number'
          ? event.timeMs + anchor.offsetMs
          : null
      }
    }
  }
  return null
}

/** Insert `event` into `events` before the first event that starts later. */
function insertSorted<T extends { timeMs: number }>(
  events: EventLike[],
  event: T
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
  events.splice(index, 0, event as unknown as EventLike)
}

/**
 * Apply authored events to a recorded event list: resolve both anchors and
 * insert the matching start/end event pair, keeping the list time-ordered.
 * Never throws: an event whose anchors do not resolve, whose range is empty
 * or inverted, or whose props are invalid is skipped with a warning.
 */
export function applyAuthoredEvents<T>(
  recordedEvents: readonly T[],
  authored: readonly AuthoredEvent[],
  warn: (message: string) => void = (message) => console.warn(message)
): T[] {
  const events = [...(recordedEvents as unknown as EventLike[])]
  const recordingEndMs = events.reduce((max, event, index) => {
    const span = eventSpan(event, index, events)
    return span !== null ? Math.max(max, span.endMs) : max
  }, 0)

  for (const event of authored) {
    const fromRaw = resolveAnchorMs(events, event.from)
    if (fromRaw === null) {
      warn(
        `[screenci] authored ${event.kind} skipped: anchor '${event.from.ref}' not found`
      )
      continue
    }
    const props = event.props ?? {}
    const propNumber = (field: string): number | undefined => {
      const value = props[field]
      return typeof value === 'number' && Number.isFinite(value)
        ? value
        : undefined
    }

    // Point kinds fire once at the resolved position.
    if ((AUTHORED_POINT_KINDS as readonly string[]).includes(event.kind)) {
      const timeMs = Math.max(0, Math.min(fromRaw, recordingEndMs))
      const duration = propNumber('duration')
      const transition =
        duration !== undefined && duration > 0
          ? { transition: { duration } }
          : {}
      if (isOverrideDebugEnabled()) {
        warn(
          `[screenci debug] authored ${event.kind} applied at ` +
            `${Math.round(timeMs)}ms (anchor '${event.from.ref}' ` +
            `${event.from.offsetMs >= 0 ? '+' : ''}${event.from.offsetMs}ms)`
        )
      }
      if (event.kind === 'backgroundUpdate') {
        if (typeof props.backgroundCss !== 'string' || !props.backgroundCss) {
          warn(
            `[screenci] authored backgroundUpdate skipped: missing backgroundCss`
          )
          continue
        }
        insertSorted(events, {
          type: 'backgroundUpdate',
          timeMs,
          background: { backgroundCss: props.backgroundCss },
          ...transition,
        })
      } else if (event.kind === 'narrationUpdate') {
        insertSorted(events, {
          type: 'narrationUpdate',
          timeMs,
          ...(typeof props.corner === 'string' && { corner: props.corner }),
          ...(propNumber('size') !== undefined && {
            size: propNumber('size'),
          }),
          ...(typeof props.visible === 'boolean' && {
            visible: props.visible,
          }),
          ...transition,
        })
      } else {
        insertSorted(events, {
          type: 'recordingUpdate',
          timeMs,
          ...(propNumber('size') !== undefined && {
            size: propNumber('size'),
          }),
          ...(typeof props.visible === 'boolean' && {
            visible: props.visible,
          }),
          ...transition,
        })
      }
      continue
    }

    // Span kinds need a resolvable end.
    if (event.to === undefined) {
      warn(`[screenci] authored ${event.kind} skipped: missing end`)
      continue
    }
    const toRaw =
      'durationMs' in event.to
        ? fromRaw + event.to.durationMs
        : resolveAnchorMs(events, event.to.anchor)
    if (toRaw === null) {
      warn(
        `[screenci] authored ${event.kind} skipped: end anchor '${
          ('anchor' in event.to && event.to.anchor.ref) || ''
        }' not found`
      )
      continue
    }
    const fromMs = Math.max(0, Math.min(fromRaw, recordingEndMs))
    const toMs = Math.max(0, Math.min(toRaw, recordingEndMs))
    if (toMs <= fromMs) {
      warn(
        `[screenci] authored ${event.kind} skipped: range is empty or ` +
          `inverted (${Math.round(fromRaw)}ms -> ${Math.round(toRaw)}ms)`
      )
      continue
    }
    if ((fromRaw !== fromMs || toRaw !== toMs) && recordingEndMs > 0) {
      warn(
        `[screenci] authored ${event.kind} clamped to the recording ` +
          `(0-${Math.round(recordingEndMs)}ms)`
      )
    }

    if (isOverrideDebugEnabled()) {
      warn(
        `[screenci debug] authored ${event.kind} applied: ` +
          `${Math.round(fromMs)}-${Math.round(toMs)}ms ` +
          `(anchor '${event.from.ref}' ` +
          `${event.from.offsetMs >= 0 ? '+' : ''}${event.from.offsetMs}ms)`
      )
    }
    if (event.kind === 'hide') {
      insertSorted(events, { type: 'hideStart', timeMs: fromMs })
      insertSorted(events, { type: 'hideEnd', timeMs: toMs })
    } else if (event.kind === 'time') {
      // Render-time remap of the span to the target duration.
      const durationMs = propNumber('durationMs')
      if (durationMs === undefined || durationMs < 0) {
        warn(
          `[screenci] authored time skipped: props.durationMs must be a ` +
            `non-negative number`
        )
        continue
      }
      insertSorted(events, { type: 'timeStart', timeMs: fromMs, durationMs })
      insertSorted(events, { type: 'timeEnd', timeMs: toMs })
    } else {
      const multiplier = propNumber('multiplier')
      const resolvedMultiplier =
        multiplier !== undefined && multiplier > 0 ? multiplier : 2
      insertSorted(events, {
        type: 'speedStart',
        timeMs: fromMs,
        multiplier: resolvedMultiplier,
      })
      insertSorted(events, { type: 'speedEnd', timeMs: toMs })
    }
  }
  return events as unknown as T[]
}

/** The authored events for one video, from the injected env. */
export function resolveAuthoredEventsForVideo(
  videoName: string,
  env: NodeJS.ProcessEnv = process.env
): AuthoredEvent[] | null {
  const events = parseAuthoredEvents(env)?.[videoName]
  return events !== undefined && events.length > 0 ? events : null
}
