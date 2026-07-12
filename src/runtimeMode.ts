import { isScreenshotCapture } from './runtimeContext.js'

export const SCREENCI_RECORDING_ENV = 'SCREENCI_RECORDING'
export const SCREENCI_MOCK_RECORD_ENV = 'SCREENCI_MOCK_RECORD'
export const SCREENCI_LANGUAGES_ENV = 'SCREENCI_LANGUAGES'
export const SCREENCI_DISABLE_RECORDING_TIMINGS_ENV =
  'SCREENCI_DISABLE_RECORDING_TIMINGS'
export const SCREENCI_DEBUG_TIMING_ENV = 'SCREENCI_DEBUG_TIMING'
export const SCREENCI_UPLOAD_EXISTING_ENV = 'UPLOAD_EXISTING'

/**
 * When set, `screenci record` skips the Playwright recording run entirely and
 * re-uploads whatever is already on disk under `.screenci`. Useful for resending
 * the most recent local recordings when only the upload failed, without paying
 * to re-record. Internal/debug-only: not surfaced as a documented flag.
 */
export function isUploadExistingEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return (
    env[SCREENCI_UPLOAD_EXISTING_ENV] === 'true' ||
    env[SCREENCI_UPLOAD_EXISTING_ENV] === '1'
  )
}

/**
 * When set, screenci logs a per-phase timing breakdown for each interaction so
 * a slow recording can be traced to the phase responsible (snapshot, cursor
 * move, scroll, actionability, click).
 */
export function isTimingDebugEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return (
    env[SCREENCI_DEBUG_TIMING_ENV] === 'true' ||
    env[SCREENCI_DEBUG_TIMING_ENV] === '1'
  )
}

export function isScreenciRecordingEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env[SCREENCI_RECORDING_ENV] === 'true'
}

export function isScreenciMockRecordEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env[SCREENCI_MOCK_RECORD_ENV] === 'true'
}

export function shouldSimulateRecordingTimings(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (isScreenciRecordingEnabled(env) || isScreenciMockRecordEnabled(env)) {
    return true
  }

  if (env[SCREENCI_DISABLE_RECORDING_TIMINGS_ENV] === 'true') {
    return false
  }

  return true
}

export function resolveRecordingTimingDuration(
  durationMs: number,
  env: NodeJS.ProcessEnv = process.env
): number {
  // A screenshot keeps only the final frame, so every simulated recording-timing
  // pause (cursor beats, click holds, post-zoom settle, overlay frame gaps) is
  // wasted wall-clock. Collapse them all to zero for stills, matching the instant
  // cursor move; videos keep their pacing. This is the single choke point every
  // recording-timing wait flows through.
  if (isScreenshotCapture()) return 0
  return shouldSimulateRecordingTimings(env) ? durationMs : 0
}

/**
 * Parse the comma-separated language filter set by `screenci record
 * --languages fi,en`. Returns `null` when unset or empty (meaning "record every
 * declared language"); otherwise the trimmed, de-duplicated list in the order
 * given. The per-language builder intersects this with each video's declared
 * languages so a run never records or renders more than was asked for.
 */
export function parseRequestedLanguages(
  env: NodeJS.ProcessEnv = process.env
): string[] | null {
  const raw = env[SCREENCI_LANGUAGES_ENV]
  if (raw === undefined) return null

  const seen = new Set<string>()
  const languages: string[] = []
  for (const part of raw.split(',')) {
    const trimmed = part.trim()
    if (trimmed.length === 0 || seen.has(trimmed)) continue
    seen.add(trimmed)
    languages.push(trimmed)
  }

  return languages.length > 0 ? languages : null
}
