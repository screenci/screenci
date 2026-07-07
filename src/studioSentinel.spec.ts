import { describe, it, expect } from 'vitest'
import {
  resolveStudioRecordOptions,
  resolveStudioRenderOptions,
} from './video.js'
import { DEFAULT_VIDEO_OPTIONS } from './defaults.js'

describe('record/render option resolution', () => {
  it('resolves omitted recordOptions to the defaults', () => {
    const { base } = resolveStudioRecordOptions(undefined)
    expect(base).toEqual(DEFAULT_VIDEO_OPTIONS)
  })

  it('merges partial recordOptions over the defaults', () => {
    const { base } = resolveStudioRecordOptions({ aspectRatio: '9:16' })
    expect(base).toEqual({ ...DEFAULT_VIDEO_OPTIONS, aspectRatio: '9:16' })
  })

  it('keeps full code recordOptions values, merged over the defaults', () => {
    const code = { aspectRatio: '9:16' as const, quality: '1080p' as const }
    const { base } = resolveStudioRecordOptions(code)
    expect(base).toEqual({ ...DEFAULT_VIDEO_OPTIONS, ...code })
  })

  it('resolves omitted renderOptions to undefined (defaults applied at write time)', () => {
    const { obj } = resolveStudioRenderOptions(undefined)
    expect(obj).toBeUndefined()
  })

  it('passes code renderOptions through untouched', () => {
    const code = { narration: { voice: { name: 'x' } } } as never
    expect(resolveStudioRenderOptions(code)).toEqual({ obj: code })
    const seed = { output: { aspectRatio: '9:16' as const } }
    expect(resolveStudioRenderOptions(seed)).toEqual({ obj: seed })
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
