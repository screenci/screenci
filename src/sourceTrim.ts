/**
 * Shared validation and parsing for the source `clip` rectangle and the
 * `start`/`end` source-trim positions accepted by file overlays, narration video
 * cues, and `selected()` render dependencies.
 *
 * `clip` is a rectangle in the source file's own pixels. `start`/`end` are
 * source positions: numbers are milliseconds, timecodes resolve to a concrete
 * ms offset into the source, and a percentage stays symbolic (a fraction of the
 * SOURCE duration) because the source length is not known until render time.
 */
import { parseTimelineOffset, type TimelineOffset } from './timelineOffset.js'
import type { OverlayClip, SourceTrimPoint } from './events.js'

/**
 * Validates a {@link OverlayClip}: every field finite, `x`/`y` non-negative, and
 * `width`/`height` strictly positive. Returns the clip unchanged so callers can
 * thread it inline.
 */
export function validateClip(label: string, clip: OverlayClip): OverlayClip {
  const { x, y, width, height } = clip
  const finite = (v: unknown): v is number =>
    typeof v === 'number' && Number.isFinite(v)
  if (!finite(x) || !finite(y) || !finite(width) || !finite(height)) {
    throw new Error(
      `[screenci] ${label} clip must have finite numeric x, y, width, and height (source pixels). Received: ${JSON.stringify(clip)}`
    )
  }
  if (x < 0 || y < 0) {
    throw new Error(`[screenci] ${label} clip x and y must be >= 0.`)
  }
  if (width <= 0 || height <= 0) {
    throw new Error(`[screenci] ${label} clip width and height must be > 0.`)
  }
  return clip
}

/** Parses a single `start`/`end` timeline position into a {@link SourceTrimPoint}. */
function parseSourceTrimPoint(
  value: TimelineOffset,
  label: string
): SourceTrimPoint {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`[screenci] ${label} must be >= 0. Received: ${value}.`)
    }
    return { ms: value }
  }
  const parsed = parseTimelineOffset(value)
  if (parsed.kind === 'percent') {
    if (parsed.fraction <= 0 || parsed.fraction > 1) {
      throw new Error(
        `[screenci] ${label} percentage must be greater than 0% and at most 100%. Received: '${value}'.`
      )
    }
    return { percent: parsed.fraction }
  }
  if (parsed.ms < 0) {
    throw new Error(`[screenci] ${label} must be >= 0. Received: '${value}'.`)
  }
  return { ms: parsed.ms }
}

/**
 * Parses and validates the optional `start`/`end` source-trim pair. When both are
 * concrete (ms or percent), `start` must come before `end`; a mixed ms/percent
 * pair cannot be compared here (the source length is unknown) and is deferred to
 * the renderer. Returns the parsed points to thread onto the recorded event.
 */
export function resolveSourceTrim(
  label: string,
  start: TimelineOffset | undefined,
  end: TimelineOffset | undefined
): { sourceStart?: SourceTrimPoint; sourceEnd?: SourceTrimPoint } {
  const sourceStart =
    start !== undefined
      ? parseSourceTrimPoint(start, `${label} start`)
      : undefined
  const sourceEnd =
    end !== undefined ? parseSourceTrimPoint(end, `${label} end`) : undefined

  if (sourceStart !== undefined && sourceEnd !== undefined) {
    if (
      'ms' in sourceStart &&
      'ms' in sourceEnd &&
      sourceStart.ms >= sourceEnd.ms
    ) {
      throw new Error(
        `[screenci] ${label} start must be before end (got start ${start}, end ${end}).`
      )
    }
    if (
      'percent' in sourceStart &&
      'percent' in sourceEnd &&
      sourceStart.percent >= sourceEnd.percent
    ) {
      throw new Error(
        `[screenci] ${label} start must be before end (got start ${start}, end ${end}).`
      )
    }
  }

  return {
    ...(sourceStart !== undefined && { sourceStart }),
    ...(sourceEnd !== undefined && { sourceEnd }),
  }
}
