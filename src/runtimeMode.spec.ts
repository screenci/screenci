import { describe, expect, it } from 'vitest'
import {
  resolveRecordingTimingDuration,
  shouldSimulateRecordingTimings,
} from './runtimeMode.js'

describe('runtimeMode', () => {
  it('disables recording timings when the fast-test env is set', () => {
    const env = {
      SCREENCI_DISABLE_RECORDING_TIMINGS: 'true',
    } as NodeJS.ProcessEnv

    expect(shouldSimulateRecordingTimings(env)).toBe(false)
    expect(resolveRecordingTimingDuration(500, env)).toBe(0)
  })

  it('keeps recording timings enabled for mock-record tests', () => {
    const env = {
      SCREENCI_DISABLE_RECORDING_TIMINGS: 'true',
      SCREENCI_MOCK_RECORD: 'true',
    } as NodeJS.ProcessEnv

    expect(shouldSimulateRecordingTimings(env)).toBe(true)
    expect(resolveRecordingTimingDuration(500, env)).toBe(500)
  })

  it('keeps recording timings enabled for real recording', () => {
    const env = {
      SCREENCI_DISABLE_RECORDING_TIMINGS: 'true',
      SCREENCI_RECORDING: 'true',
    } as NodeJS.ProcessEnv

    expect(shouldSimulateRecordingTimings(env)).toBe(true)
    expect(resolveRecordingTimingDuration(500, env)).toBe(500)
  })
})
