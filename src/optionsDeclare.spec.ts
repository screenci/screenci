import { describe, it, expect } from 'vitest'
import {
  normalizeOptionsArg,
  mergeRecordOptions,
  mergeRenderOptions,
  combineRecordOptionsLayers,
  combineRenderOptionsLayers,
} from './optionsDeclare.js'
import type { RecordOptions, RenderOptions } from './types.js'

describe('normalizeOptionsArg', () => {
  it('treats a flat object as the shared bag (no languages)', () => {
    const n = normalizeOptionsArg<RecordOptions>('recordOptions', {
      aspectRatio: '9:16',
      quality: '720p',
    })
    expect(n).toEqual({
      shared: { aspectRatio: '9:16', quality: '720p' },
      byLang: {},
      languages: [],
    })
  })

  it('splits a language-major object into default + per-language overrides', () => {
    const n = normalizeOptionsArg<RecordOptions>('recordOptions', {
      default: { aspectRatio: '16:9' },
      fi: { aspectRatio: '4:3' },
      de: { quality: '1440p' },
    })
    expect(n.shared).toEqual({ aspectRatio: '16:9' })
    expect(n.byLang).toEqual({
      fi: { aspectRatio: '4:3' },
      de: { quality: '1440p' },
    })
    expect(n.languages.sort()).toEqual(['de', 'fi'])
  })

  it('splits a seeded language-major object into shared base and overrides', () => {
    const n = normalizeOptionsArg<RecordOptions>('recordOptions', {
      default: { quality: '1080p' },
      fi: { aspectRatio: '4:3' },
    })
    expect(n.shared).toEqual({ quality: '1080p' })
    expect(n.byLang).toEqual({ fi: { aspectRatio: '4:3' } })
  })

  it('rejects an object mixing language keys with option keys', () => {
    expect(() =>
      normalizeOptionsArg<RecordOptions>('recordOptions', {
        aspectRatio: '16:9',
        fi: { aspectRatio: '4:3' },
      } as never)
    ).toThrow(/mixes language keys/)
  })
})

describe('mergeRecordOptions', () => {
  it('overlays patch fields over the base, ignoring undefined', () => {
    expect(
      mergeRecordOptions(
        { aspectRatio: '16:9', quality: '1080p', fps: 60 },
        { aspectRatio: '9:16', quality: undefined }
      )
    ).toEqual({ aspectRatio: '9:16', quality: '1080p', fps: 60 })
  })

  it('returns the base untouched when the patch is undefined', () => {
    const base = { aspectRatio: '16:9' as const }
    expect(mergeRecordOptions(base, undefined)).toBe(base)
  })
})

describe('mergeRenderOptions', () => {
  it('deep-merges one level per group so a group patch keeps sibling fields', () => {
    const base: Partial<RenderOptions> = {
      narration: { size: 0.3, corner: 'bottom-right' },
      output: { aspectRatio: '16:9' },
    }
    const merged = mergeRenderOptions(base, { narration: { size: 0.5 } })
    expect(merged).toEqual({
      narration: { size: 0.5, corner: 'bottom-right' },
      output: { aspectRatio: '16:9' },
    })
  })

  it('returns the other side when one is undefined', () => {
    const base = { output: { quality: '1080p' as const } }
    expect(mergeRenderOptions(base, undefined)).toBe(base)
    expect(mergeRenderOptions(undefined, base)).toBe(base)
  })
})

describe('combineRecordOptionsLayers', () => {
  it('merges the per-video patch over the config layer', () => {
    const combined = combineRecordOptionsLayers(
      { aspectRatio: '16:9', quality: '1080p', fps: 60 },
      { aspectRatio: '9:16' }
    )
    expect(combined).toEqual({
      aspectRatio: '9:16',
      quality: '1080p',
      fps: 60,
    })
  })

  it('keeps unpatched config fields when the per-video patch is partial', () => {
    const combined = combineRecordOptionsLayers(
      { aspectRatio: '16:9', quality: '1080p' },
      { fps: 30 }
    )
    expect(combined).toEqual({
      aspectRatio: '16:9',
      quality: '1080p',
      fps: 30,
    })
  })

  it('returns the config layer when there is no per-video patch', () => {
    const config = { aspectRatio: '16:9' as const }
    expect(combineRecordOptionsLayers(config, undefined)).toBe(config)
  })
})

describe('combineRenderOptionsLayers', () => {
  it('deep-merges the per-video patch groups over the config layer', () => {
    const combined = combineRenderOptionsLayers(
      { narration: { size: 0.3, corner: 'bottom-left' } },
      { narration: { size: 0.6 } }
    )
    expect(combined).toEqual({
      narration: { size: 0.6, corner: 'bottom-left' },
    })
  })
})
