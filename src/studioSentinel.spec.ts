import { describe, it, expect } from 'vitest'
import {
  resolveStudioRecordOptions,
  resolveStudioRenderOptions,
} from './video.js'
import { editable } from './studio.js'
import { DEFAULT_VIDEO_OPTIONS } from './defaults.js'

describe('editable() option resolution', () => {
  it('treats recordOptions: editable() as deferred, recording with defaults', () => {
    const { base, studio: isStudio } = resolveStudioRecordOptions(editable())
    expect(isStudio).toBe(true)
    expect(base).toEqual(DEFAULT_VIDEO_OPTIONS)
  })

  it('seeds recordOptions with editable({...}) merged over defaults', () => {
    const { base, studio: isStudio } = resolveStudioRecordOptions(
      editable({ aspectRatio: '9:16' })
    )
    expect(isStudio).toBe(true)
    expect(base).toEqual({ ...DEFAULT_VIDEO_OPTIONS, aspectRatio: '9:16' })
  })

  it('passes code recordOptions through untouched', () => {
    const code = { aspectRatio: '9:16' as const, quality: '1080p' as const }
    const { base, studio: isStudio } = resolveStudioRecordOptions(code)
    expect(isStudio).toBe(false)
    expect(base).toBe(code)
  })

  it('treats renderOptions: editable() as deferred (no seed render options)', () => {
    const { obj, studio: isStudio } = resolveStudioRenderOptions(editable())
    expect(isStudio).toBe(true)
    expect(obj).toBeUndefined()
  })

  it('returns the seed for renderOptions: editable({...}), still Studio-managed', () => {
    const seed = { output: { aspectRatio: '9:16' as const } }
    const { obj, studio: isStudio } = resolveStudioRenderOptions(editable(seed))
    expect(isStudio).toBe(true)
    expect(obj).toEqual(seed)
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

  it('rejects the retired "studio" string with a migration error', () => {
    expect(() => resolveStudioRecordOptions('studio' as never)).toThrow(
      /no longer supported/
    )
    expect(() => resolveStudioRenderOptions('studio' as never)).toThrow(
      /no longer supported/
    )
  })
})
