/**
 * Code-declared placed events and anchored pacing.
 *
 * `placeHide` / `placeSpeed` / `placeTime` declare a render-time event at an
 * anchored position (a known moment plus an offset in milliseconds), exactly
 * like an event placed on the web timeline. They do not run any code and do
 * not wait: the event is resolved and inserted when the recording's data.json
 * is written, so the placement is exact regardless of how long the run took.
 * This is the code form the web editor's edits codify into.
 *
 * `waitSince` is the runtime counterpart for things that DO happen at call
 * time (narration cues, real interactions): it waits until at least the
 * given number of milliseconds have passed since a `timestamp(name)` marker,
 * absorbing execution-speed drift so the call lands at a stable offset.
 */
import { getActiveHideRecorder } from './timelineBlock.js'
import { resolveRecordingTimingDuration } from './runtimeMode.js'
import type { Anchor, AnchorRef, PlacedEvent } from './timelineEdits.js'

/**
 * Where a placed event is measured from:
 * - `'video:start'` / `'video:end'`: the recording bounds
 * - any other string: a `timestamp('name')` marker (first occurrence)
 * - `{ timestamp, ordinal }`: a repeated marker's nth occurrence (0-based)
 * - `{ action, edge }`: an editable action by its stable key (as printed by
 *   `screenci sync-prompt`), from its start or end edge
 */
export type PlaceAnchor =
  | string
  | { timestamp: string; ordinal?: number }
  | { action: string; edge?: 'start' | 'end' }

export type PlaceSpanOptions = {
  /** The known moment the event starts from. */
  from: PlaceAnchor
  /** Offset in ms from the anchor (may be negative). Default 0. */
  offsetMs?: number
  /** Span length in ms. Provide either this or `until`. */
  durationMs?: number
  /** Anchor the span ends at (alternative to `durationMs`). */
  until?: PlaceAnchor
  /** Offset in ms from the `until` anchor. Default 0. */
  untilOffsetMs?: number
}

function toAnchorRef(input: PlaceAnchor): {
  ref: AnchorRef
  edge: 'start' | 'end'
} {
  if (typeof input === 'string') {
    if (input === 'video:start')
      return { ref: { type: 'videoStart' }, edge: 'start' }
    if (input === 'video:end')
      return { ref: { type: 'videoEnd' }, edge: 'start' }
    if (input.trim().length === 0) {
      throw new Error('place anchor must be a non-empty timestamp name')
    }
    return {
      ref: { type: 'timestamp', name: input, ordinal: 0 },
      edge: 'start',
    }
  }
  if ('timestamp' in input) {
    return {
      ref: {
        type: 'timestamp',
        name: input.timestamp,
        ordinal: input.ordinal ?? 0,
      },
      edge: 'start',
    }
  }
  return {
    ref: { type: 'action', key: input.action },
    edge: input.edge ?? 'end',
  }
}

function toAnchor(input: PlaceAnchor, offsetMs: number): Anchor {
  const { ref, edge } = toAnchorRef(input)
  if (!Number.isFinite(offsetMs)) {
    throw new Error('offsetMs must be a finite number')
  }
  return { ref, edge, offsetMs }
}

let codePlacedCounter = 0

function buildSpan(
  kind: 'hide' | 'speed' | 'time' | 'zoom',
  options: PlaceSpanOptions,
  props?: Record<string, unknown>
): PlacedEvent {
  const anchor = toAnchor(options.from, options.offsetMs ?? 0)
  let end: PlacedEvent['end']
  if (options.until !== undefined) {
    end = { anchor: toAnchor(options.until, options.untilOffsetMs ?? 0) }
  } else if (
    typeof options.durationMs === 'number' &&
    Number.isFinite(options.durationMs) &&
    options.durationMs > 0
  ) {
    end = { durationMs: options.durationMs }
  } else {
    throw new Error(
      `place${kind[0]!.toUpperCase()}${kind.slice(1)}() needs a positive durationMs or an until anchor`
    )
  }
  codePlacedCounter += 1
  return {
    type: 'placedEvent',
    id: `code|${kind}|${codePlacedCounter}`,
    kind,
    anchor,
    end,
    ...(props !== undefined && { props }),
  }
}

/**
 * Hides a span of the recording, anchored to a known moment.
 *
 * @example
 * ```ts
 * await timestamp('form-submitted')
 * placeHide({ from: 'form-submitted', offsetMs: 250, durationMs: 500 })
 * ```
 */
export function placeHide(options: PlaceSpanOptions): void {
  getActiveHideRecorder().addPlacedEvent(buildSpan('hide', options))
}

/**
 * Speeds up a span of the recording at render time, anchored to a known
 * moment. `multiplier` defaults to 2.
 */
export function placeSpeed(
  options: PlaceSpanOptions & { multiplier?: number }
): void {
  const { multiplier, ...span } = options
  getActiveHideRecorder().addPlacedEvent(
    buildSpan(
      'speed',
      span,
      multiplier !== undefined ? { multiplier } : undefined
    )
  )
}

/**
 * Remaps a span of the recording to play as exactly `playsAsMs` at render
 * time, anchored to a known moment.
 */
export function placeTime(
  options: PlaceSpanOptions & { playsAsMs: number }
): void {
  const { playsAsMs, ...span } = options
  if (!Number.isFinite(playsAsMs) || playsAsMs < 0) {
    throw new Error('placeTime() playsAsMs must be a non-negative number')
  }
  getActiveHideRecorder().addPlacedEvent(
    buildSpan('time', span, { durationMs: playsAsMs })
  )
}

/**
 * Zooms the render-time camera over a span of the recording, anchored to a
 * known moment. The camera target comes from the mouse positions and element
 * rects recorded inside the window, so zooming into a click means anchoring
 * the window around that click; a negative offset starts the zoom BEFORE the
 * anchor (a lead-in), which works because placement happens after the
 * recording ran.
 *
 * `amount` is the zoom level (default 0.72, smaller is closer), `duration`
 * the zoom-in animation ms, `easing` its curve, `centering` how tightly the
 * camera centers targets (0..1).
 *
 * @example
 * ```ts
 * // Zoom in from 400ms before the Save click until 600ms after it.
 * placeZoom({
 *   from: { action: 'input|click|getByRole(button, name=Save)|0', edge: 'start' },
 *   offsetMs: -400,
 *   until: { action: 'input|click|getByRole(button, name=Save)|0', edge: 'end' },
 *   untilOffsetMs: 600,
 * })
 * ```
 */
export function placeZoom(
  options: PlaceSpanOptions & {
    amount?: number
    duration?: number
    easing?: string
    centering?: number
  }
): void {
  const { amount, duration, easing, centering, ...span } = options
  const props: Record<string, unknown> = {
    ...(amount !== undefined && { amount }),
    ...(duration !== undefined && { duration }),
    ...(easing !== undefined && { easing }),
    ...(centering !== undefined && { centering }),
  }
  getActiveHideRecorder().addPlacedEvent(
    buildSpan('zoom', span, Object.keys(props).length > 0 ? props : undefined)
  )
}

/**
 * Waits until at least `ms` milliseconds have passed since the most recent
 * `timestamp(name)` call, so the NEXT statement runs at a stable offset from
 * that marker regardless of how fast the code in between executed.
 *
 * Use it to pace call-time events (a narration cue, a click) that should
 * land a fixed distance after a known moment. If the marker has not been
 * recorded (or already lies further than `ms` in the past) it returns
 * immediately after any remaining time. Never waits longer than `ms`.
 *
 * @example
 * ```ts
 * await timestamp('dashboard-open')
 * await page.getByRole('button', { name: 'Stats' }).click()
 * await waitSince('dashboard-open', 800)
 * await narration.stats()
 * ```
 */
export async function waitSince(name: string, ms: number): Promise<void> {
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new Error('waitSince() name must be a non-empty string')
  }
  if (!Number.isFinite(ms) || ms < 0) {
    throw new Error('waitSince() ms must be a non-negative number')
  }
  const recorder = getActiveHideRecorder()
  const stampedAt = recorder.getTimestampWallClock(name)
  const targetMs = resolveRecordingTimingDuration(ms)
  const remaining =
    stampedAt === null ? targetMs : targetMs - (Date.now() - stampedAt)
  if (remaining <= 0) return
  await new Promise((resolve) => setTimeout(resolve, remaining))
}
