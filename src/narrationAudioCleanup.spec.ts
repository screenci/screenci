import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  resolveNarrationAudioCleanup,
  DEFAULT_DENOISE_STRENGTH,
  DEFAULT_NORMALIZE_LEVEL,
  MIN_NORMALIZE_LEVEL,
  MAX_NORMALIZE_LEVEL,
} from './narrationAudioCleanup.js'

describe('resolveNarrationAudioCleanup', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns undefined for undefined and false (off by default)', () => {
    expect(resolveNarrationAudioCleanup(undefined)).toBeUndefined()
    expect(resolveNarrationAudioCleanup(false)).toBeUndefined()
  })

  it('enables the full chain with defaults for true', () => {
    expect(resolveNarrationAudioCleanup(true)).toEqual({
      denoise: { strength: DEFAULT_DENOISE_STRENGTH },
      normalize: { level: DEFAULT_NORMALIZE_LEVEL },
    })
  })

  it('object form enables only the listed sub-features', () => {
    expect(resolveNarrationAudioCleanup({ denoise: true })).toEqual({
      denoise: { strength: DEFAULT_DENOISE_STRENGTH },
      normalize: false,
    })
    expect(resolveNarrationAudioCleanup({ normalize: true })).toEqual({
      denoise: false,
      normalize: { level: DEFAULT_NORMALIZE_LEVEL },
    })
  })

  it('accepts tuning values in the nested object form', () => {
    expect(
      resolveNarrationAudioCleanup({
        denoise: { strength: 0.5 },
        normalize: { level: -14 },
      })
    ).toEqual({
      denoise: { strength: 0.5 },
      normalize: { level: -14 },
    })
  })

  it('fills defaults for empty nested objects', () => {
    expect(
      resolveNarrationAudioCleanup({ denoise: {}, normalize: {} })
    ).toEqual({
      denoise: { strength: DEFAULT_DENOISE_STRENGTH },
      normalize: { level: DEFAULT_NORMALIZE_LEVEL },
    })
  })

  it('clamps out-of-range values and warns', () => {
    expect(
      resolveNarrationAudioCleanup({
        denoise: { strength: 1.5 },
        normalize: { level: -50 },
      })
    ).toEqual({
      denoise: { strength: 1 },
      normalize: { level: MIN_NORMALIZE_LEVEL },
    })
    expect(
      resolveNarrationAudioCleanup({
        denoise: { strength: -1 },
        normalize: { level: 0 },
      })
    ).toEqual({
      denoise: { strength: 0 },
      normalize: { level: MAX_NORMALIZE_LEVEL },
    })
    expect(console.warn).toHaveBeenCalled()
  })

  it('collapses to undefined when both sub-features are disabled', () => {
    expect(
      resolveNarrationAudioCleanup({ denoise: false, normalize: false })
    ).toBeUndefined()
    expect(resolveNarrationAudioCleanup({})).toBeUndefined()
  })

  it('keeps one sub-feature enabled when the other is explicitly false', () => {
    expect(
      resolveNarrationAudioCleanup({ denoise: false, normalize: true })
    ).toEqual({
      denoise: false,
      normalize: { level: DEFAULT_NORMALIZE_LEVEL },
    })
  })
})
