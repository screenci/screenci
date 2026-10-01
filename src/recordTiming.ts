/** A run longer than a day is a clock jump, not a recording. */
const MAX_RECORD_WALL_CLOCK_MS = 86_400_000

/**
 * How long a recording run took, as whole wall-clock ms, for the upload
 * metadata (the web app estimates the next run's progress bar from it).
 * Undefined when the clock gives nothing usable (no time passed, it went
 * backward, or an absurd span), so the field is left out instead of lying.
 */
export function recordWallClockMs(
  startedAtMs: number,
  finishedAtMs: number
): number | undefined {
  const elapsed = Math.round(finishedAtMs - startedAtMs)
  if (!Number.isFinite(elapsed)) return undefined
  if (elapsed <= 0 || elapsed > MAX_RECORD_WALL_CLOCK_MS) return undefined
  return elapsed
}
