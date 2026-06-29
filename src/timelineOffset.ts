/**
 * Parsing for the string position arguments accepted by the narration and
 * overlay controllers, e.g. `narration.intro('0:02')` or `overlays.tip('56%')`.
 *
 * A controller called with a NUMBER keeps its existing meaning (a relative
 * duration in milliseconds). A controller called with a STRING means an absolute
 * position in the final video: "this cue/overlay window should reach this point."
 * Only strings flow through this module; numbers never do.
 *
 * Absolute positions are resolved against the finished render, so a percentage
 * cannot be turned into milliseconds here (the total length is not known until
 * render time). The parser therefore returns a discriminated union: concrete
 * `'<n>s'`/timecode forms resolve to milliseconds, while `'<n>%'` surfaces a
 * fraction the renderer multiplies by the final total.
 */

/**
 * A position within the final video. Strings only (numbers are the existing
 * duration path on each controller). Accepts:
 *  - `'<n>s'`        seconds, e.g. `'2s'` or `'5.51s'`
 *  - `'m:ss(.f)'`    timecode minutes:seconds, e.g. `'0:05.51'` (= 5.51s)
 *  - `'h:mm:ss(.f)'` timecode hours:minutes:seconds, e.g. `'1:02:03.5'`
 *  - `'<n>%'`        percentage of the total video, e.g. `'56.1%'`
 *
 * The template-literal members give editor hints for the common forms; the
 * trailing `string` keeps timecodes (which the type system cannot express)
 * assignable. Validation happens at runtime in {@link parseTimelineOffset}.
 */
export type TimelineOffset = `${number}s` | `${number}%` | string

/** Result of parsing a {@link TimelineOffset} string. */
export type ParsedTimelineOffset =
  /** From `'<n>s'` or a timecode: a concrete absolute position in milliseconds. */
  | { kind: 'absolute'; ms: number }
  /** From `'<n>%'`: a fraction (0.561 for `'56.1%'`), resolved against the total at render. */
  | { kind: 'percent'; fraction: number }

const SECONDS_RE = /^(\d+(?:\.\d+)?)s$/
const PERCENT_RE = /^(\d+(?:\.\d+)?)%$/
const TIMECODE_MIN_RE = /^(\d+):(\d{2}(?:\.\d+)?)$/
const TIMECODE_HOUR_RE = /^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/

function invalidTimecode(value: string): never {
  throw new Error(
    `invalid timecode '${value}'; expected m:ss(.f) or h:mm:ss(.f) with mm/ss < 60`
  )
}

function invalidPosition(value: string): never {
  throw new Error(
    `invalid position '${value}'; expected '<n>s', a timecode 'm:ss(.f)'/'h:mm:ss(.f)', or '<n>%'`
  )
}

/**
 * Parses a string position into a {@link ParsedTimelineOffset}. Throws on any
 * unrecognized or malformed input. Pure: no I/O, no globals.
 */
export function parseTimelineOffset(value: string): ParsedTimelineOffset {
  const trimmed = value.trim()
  if (trimmed.length === 0) invalidPosition(value)

  const percent = PERCENT_RE.exec(trimmed)
  if (percent !== null) {
    return { kind: 'percent', fraction: Number(percent[1]) / 100 }
  }

  const seconds = SECONDS_RE.exec(trimmed)
  if (seconds !== null) {
    return { kind: 'absolute', ms: Number(seconds[1]) * 1000 }
  }

  const hour = TIMECODE_HOUR_RE.exec(trimmed)
  if (hour !== null) {
    const hours = Number(hour[1])
    const minutes = Number(hour[2])
    const secs = Number(hour[3])
    if (minutes >= 60 || secs >= 60) invalidTimecode(value)
    return { kind: 'absolute', ms: (hours * 3600 + minutes * 60 + secs) * 1000 }
  }

  const min = TIMECODE_MIN_RE.exec(trimmed)
  if (min !== null) {
    const minutes = Number(min[1])
    const secs = Number(min[2])
    if (secs >= 60) invalidTimecode(value)
    return { kind: 'absolute', ms: (minutes * 60 + secs) * 1000 }
  }

  // A bare `h:mm:ss`-shaped string that failed the strict patterns above (for
  // example two-digit seconds were not supplied) is reported as a timecode error
  // so the message points at the right fix.
  if (/^\d+:\d/.test(trimmed)) invalidTimecode(value)

  invalidPosition(value)
}
