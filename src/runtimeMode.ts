export const SCREENCI_RECORDING_ENV = 'SCREENCI_RECORDING'
export const SCREENCI_MOCK_RECORD_ENV = 'SCREENCI_MOCK_RECORD'
export const SCREENCI_LANGUAGES_ENV = 'SCREENCI_LANGUAGES'
export const SCREENCI_TEXT_OVERRIDES_ENV = 'SCREENCI_TEXT_OVERRIDES'
export const SCREENCI_DISABLE_RECORDING_TIMINGS_ENV =
  'SCREENCI_DISABLE_RECORDING_TIMINGS'
export const SCREENCI_DEBUG_TIMING_ENV = 'SCREENCI_DEBUG_TIMING'

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

/** Per-language text field overrides: `{ [language]: { [field]: value } }`. */
export type TextOverrides = Record<string, Record<string, string>>

/**
 * Parse Studio text-field overrides injected for a re-record. Because the
 * recording process never reaches the backend, Studio edits are passed in via
 * `SCREENCI_TEXT_OVERRIDES` (a JSON map of language -> field -> value), set by
 * the CLI from the backend before the recording runs. Returns `null` when unset
 * or malformed, so the `text` fixture falls back to the code-declared seed.
 */
export function parseTextOverrides(
  env: NodeJS.ProcessEnv = process.env
): TextOverrides | null {
  const raw = env[SCREENCI_TEXT_OVERRIDES_ENV]
  if (raw === undefined || raw.trim().length === 0) return null

  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null

    const result: TextOverrides = {}
    for (const [language, fields] of Object.entries(parsed)) {
      if (typeof fields !== 'object' || fields === null) continue
      const perLanguage: Record<string, string> = {}
      for (const [field, value] of Object.entries(fields)) {
        if (typeof value === 'string') perLanguage[field] = value
      }
      result[language] = perLanguage
    }
    return result
  } catch {
    return null
  }
}
