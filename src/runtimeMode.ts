export const SCREENCI_RECORDING_ENV = 'SCREENCI_RECORDING'
export const SCREENCI_MOCK_RECORD_ENV = 'SCREENCI_MOCK_RECORD'
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
