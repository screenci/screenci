import { describe, expect, it } from 'vitest'
import {
  isTimingDebugEnabled,
  mergeStudioRecordOptions,
  parseRecordOptions,
  parseRequestedLanguages,
  parseValuesOverrides,
  resolveRecordingTimingDuration,
  shouldSimulateRecordingTimings,
} from './runtimeMode.js'

describe('runtimeMode', () => {
  it('enables timing debug only when SCREENCI_DEBUG_TIMING is set', () => {
    expect(isTimingDebugEnabled({} as NodeJS.ProcessEnv)).toBe(false)
    expect(
      isTimingDebugEnabled({ SCREENCI_DEBUG_TIMING: '1' } as NodeJS.ProcessEnv)
    ).toBe(true)
    expect(
      isTimingDebugEnabled({
        SCREENCI_DEBUG_TIMING: 'true',
      } as NodeJS.ProcessEnv)
    ).toBe(true)
    expect(
      isTimingDebugEnabled({ SCREENCI_DEBUG_TIMING: '0' } as NodeJS.ProcessEnv)
    ).toBe(false)
  })

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

describe('parseRequestedLanguages', () => {
  it('returns null when the env var is unset', () => {
    expect(parseRequestedLanguages({} as NodeJS.ProcessEnv)).toBeNull()
  })

  it('parses a comma-separated list, trimming whitespace', () => {
    expect(
      parseRequestedLanguages({
        SCREENCI_LANGUAGES: 'fi, en ,de',
      } as NodeJS.ProcessEnv)
    ).toEqual(['fi', 'en', 'de'])
  })

  it('de-duplicates while preserving first-seen order', () => {
    expect(
      parseRequestedLanguages({
        SCREENCI_LANGUAGES: 'en,fi,en',
      } as NodeJS.ProcessEnv)
    ).toEqual(['en', 'fi'])
  })

  it('returns null when the value is empty or only separators', () => {
    expect(
      parseRequestedLanguages({ SCREENCI_LANGUAGES: '' } as NodeJS.ProcessEnv)
    ).toBeNull()
    expect(
      parseRequestedLanguages({
        SCREENCI_LANGUAGES: ' , ,',
      } as NodeJS.ProcessEnv)
    ).toBeNull()
  })
})

describe('parseValuesOverrides', () => {
  it('returns null when unset or empty', () => {
    expect(parseValuesOverrides({} as NodeJS.ProcessEnv)).toBeNull()
    expect(
      parseValuesOverrides({
        SCREENCI_VALUES_OVERRIDES: '  ',
      } as NodeJS.ProcessEnv)
    ).toBeNull()
  })

  it('parses a language -> field -> value JSON map', () => {
    expect(
      parseValuesOverrides({
        SCREENCI_VALUES_OVERRIDES: JSON.stringify({
          en: { heading: 'Hi' },
          fi: { heading: 'Moi' },
        }),
      } as NodeJS.ProcessEnv)
    ).toEqual({ en: { heading: 'Hi' }, fi: { heading: 'Moi' } })
  })

  it('drops non-string values and keeps valid ones', () => {
    expect(
      parseValuesOverrides({
        SCREENCI_VALUES_OVERRIDES: JSON.stringify({
          en: { heading: 'Hi', count: 3 },
        }),
      } as NodeJS.ProcessEnv)
    ).toEqual({ en: { heading: 'Hi' } })
  })

  it('returns null on malformed JSON', () => {
    expect(
      parseValuesOverrides({
        SCREENCI_VALUES_OVERRIDES: 'not json',
      } as NodeJS.ProcessEnv)
    ).toBeNull()
  })
})

describe('parseRecordOptions', () => {
  it('returns null when unset or empty', () => {
    expect(parseRecordOptions({} as NodeJS.ProcessEnv)).toBeNull()
    expect(
      parseRecordOptions({
        SCREENCI_RECORD_OPTIONS: '   ',
      } as NodeJS.ProcessEnv)
    ).toBeNull()
  })

  it('parses a video name -> options JSON map', () => {
    expect(
      parseRecordOptions({
        SCREENCI_RECORD_OPTIONS: JSON.stringify({
          Demo: { aspectRatio: '9:16', quality: '1080p', fps: 60 },
        }),
      } as NodeJS.ProcessEnv)
    ).toEqual({ Demo: { aspectRatio: '9:16', quality: '1080p', fps: 60 } })
  })

  it('drops unknown fields and invalid values', () => {
    expect(
      parseRecordOptions({
        SCREENCI_RECORD_OPTIONS: JSON.stringify({
          Demo: {
            aspectRatio: '21:9',
            quality: '4320p',
            fps: 12,
            encoder: 'h265',
          },
        }),
      } as NodeJS.ProcessEnv)
    ).toEqual({ Demo: {} })
  })

  it('returns null on malformed JSON', () => {
    expect(
      parseRecordOptions({
        SCREENCI_RECORD_OPTIONS: 'not json',
      } as NodeJS.ProcessEnv)
    ).toBeNull()
  })
})

describe('mergeStudioRecordOptions', () => {
  it('returns the code options unchanged when there is no studio override', () => {
    const code = { aspectRatio: '16:9' as const, encoder: 'h264' }
    expect(mergeStudioRecordOptions(code, undefined)).toBe(code)
  })

  it('overrides only the Studio-owned fields and keeps the rest from code', () => {
    const code = {
      aspectRatio: '16:9' as const,
      quality: '720p' as const,
      encoder: 'h264',
    }
    expect(
      mergeStudioRecordOptions(code, {
        aspectRatio: '9:16',
        fps: 60,
      })
    ).toEqual({
      aspectRatio: '9:16',
      quality: '720p',
      fps: 60,
      encoder: 'h264',
    })
  })
})
