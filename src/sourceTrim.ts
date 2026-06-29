/**
 * Shared validation and parsing for the source `crop` rectangle and the
 * `start`/`end` source-trim positions accepted by file overlays, narration video
 * cues, and `selected()` render dependencies.
 *
 * `crop` is a rectangle in the source file's own pixels. `start`/`end` are time
 * strings (`'2s'`, `'0:02'`, `'50%'`): seconds/timecodes resolve to a concrete ms
 * offset into the source, while a percentage stays symbolic (a fraction of the
 * SOURCE duration) because the source length is not known until render time.
 */
import { parseTimelineOffset, type TimelineOffset } from './timelineOffset.js'
import type { OverlayCrop, SourceTrimPoint } from './events.js'

/**
 * Validates a {@link OverlayCrop}: every field finite, `x`/`y` non-negative, and
 * `width`/`height` strictly positive. Returns the crop unchanged so callers can
 * thread it inline.
 */
export function validateCrop(label: string, crop: OverlayCrop): OverlayCrop {
  const { x, y, width, height } = crop
  const finite = (v: unknown): v is number =>
    typeof v === 'number' && Number.isFinite(v)
  if (!finite(x) || !finite(y) || !finite(width) || !finite(height)) {
    throw new Error(
      `[screenci] ${label} crop must have finite numeric x, y, width, and height (source pixels). Received: ${JSON.stringify(crop)}`
    )
  }
  if (x < 0 || y < 0) {
    throw new Error(`[screenci] ${label} crop x and y must be >= 0.`)
  }
  if (width <= 0 || height <= 0) {
    throw new Error(`[screenci] ${label} crop width and height must be > 0.`)
  }
  return crop
}

/** Parses a single `start`/`end` time string into a {@link SourceTrimPoint}. */
function parseSourceTrimPoint(
  value: TimelineOffset,
  label: string
): SourceTrimPoint {
  if (typeof value !== 'string') {
    throw new Error(
      `[screenci] ${label} must be a time string such as '2s', '0:02', or '50%', got ${typeof value}.`
    )
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
