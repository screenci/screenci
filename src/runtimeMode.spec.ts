import { describe, expect, it } from 'vitest'
import {
  isTimingDebugEnabled,
  parseRequestedLanguages,
  parseTextOverrides,
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

describe('parseTextOverrides', () => {
  it('returns null when unset or empty', () => {
    expect(parseTextOverrides({} as NodeJS.ProcessEnv)).toBeNull()
    expect(
      parseTextOverrides({ SCREENCI_TEXT_OVERRIDES: '  ' } as NodeJS.ProcessEnv)
    ).toBeNull()
  })

  it('parses a language -> field -> value JSON map', () => {
    expect(
      parseTextOverrides({
        SCREENCI_TEXT_OVERRIDES: JSON.stringify({
          en: { heading: 'Hi' },
          fi: { heading: 'Moi' },
        }),
      } as NodeJS.ProcessEnv)
    ).toEqual({ en: { heading: 'Hi' }, fi: { heading: 'Moi' } })
  })

  it('drops non-string values and keeps valid ones', () => {
    expect(
      parseTextOverrides({
        SCREENCI_TEXT_OVERRIDES: JSON.stringify({
          en: { heading: 'Hi', count: 3 },
        }),
      } as NodeJS.ProcessEnv)
    ).toEqual({ en: { heading: 'Hi' } })
  })

  it('returns null on malformed JSON', () => {
    expect(
      parseTextOverrides({
        SCREENCI_TEXT_OVERRIDES: 'not json',
      } as NodeJS.ProcessEnv)
    ).toBeNull()
  })
})
