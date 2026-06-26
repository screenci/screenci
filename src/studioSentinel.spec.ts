import { describe, it, expect } from 'vitest'
import {
  resolveStudioRecordOptions,
  resolveStudioRenderOptions,
} from './video.js'
import { DEFAULT_VIDEO_OPTIONS } from './defaults.js'

describe("'studio' sentinel resolution", () => {
  it('treats recordOptions: studio as deferred, recording with defaults', () => {
    const { base, studio } = resolveStudioRecordOptions('studio')
    expect(studio).toBe(true)
    expect(base).toEqual(DEFAULT_VIDEO_OPTIONS)
  })

  it('passes code recordOptions through untouched', () => {
    const code = { aspectRatio: '9:16' as const, quality: '1080p' as const }
    const { base, studio } = resolveStudioRecordOptions(code)
    expect(studio).toBe(false)
    expect(base).toBe(code)
  })

  it('treats renderOptions: studio as deferred (no code render options)', () => {
    const { obj, studio } = resolveStudioRenderOptions('studio')
    expect(studio).toBe(true)
    expect(obj).toBeUndefined()
  })

  it('passes code/undefined renderOptions through untouched', () => {
    expect(resolveStudioRenderOptions(undefined)).toEqual({
      obj: undefined,
      studio: false,
    })
    const code = { narration: { voice: { name: 'x' } } } as never
    expect(resolveStudioRenderOptions(code)).toEqual({
      obj: code,
      studio: false,
    })
  })
})
