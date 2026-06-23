import { describe, expect, it } from 'vitest'
import { studioOptionFlags, validateStudioDeclaration } from './studio.js'

describe('studioOptionFlags', () => {
  it('defaults both flags to false for an absent declaration', () => {
    expect(studioOptionFlags(undefined)).toEqual({
      renderOptions: false,
      recordOptions: false,
    })
  })

  it('defaults both flags to false when neither option is deferred', () => {
    expect(studioOptionFlags({ narration: ['intro'] })).toEqual({
      renderOptions: false,
      recordOptions: false,
    })
  })

  it('reflects the renderOptions/recordOptions deferral flags', () => {
    expect(
      studioOptionFlags({ renderOptions: true, recordOptions: true })
    ).toEqual({ renderOptions: true, recordOptions: true })
    expect(studioOptionFlags({ recordOptions: true })).toEqual({
      renderOptions: false,
      recordOptions: true,
    })
  })
})

describe('validateStudioDeclaration', () => {
  it('is a no-op for a null declaration', () => {
    expect(() => validateStudioDeclaration(null, [], [])).not.toThrow()
  })

  it('accepts unique, non-empty name lists disjoint from the seeded names', () => {
    expect(() =>
      validateStudioDeclaration(
        {
          narration: ['alert'],
          text: ['cta'],
          overlays: ['logo'],
          audio: ['theme'],
        },
        ['intro'],
        ['heading']
      )
    ).not.toThrow()
  })

  it('rejects a duplicate name within a single list', () => {
    expect(() =>
      validateStudioDeclaration({ overlays: ['logo', 'logo'] }, [], [])
    ).toThrow('video.studio(): duplicate overlays name "logo".')
  })

  it('rejects an empty name', () => {
    expect(() => validateStudioDeclaration({ audio: [''] }, [], [])).toThrow(
      'video.studio(): audio names must be non-empty strings.'
    )
  })

  it('rejects a narration name that is also seeded in localize()', () => {
    expect(() =>
      validateStudioDeclaration({ narration: ['intro'] }, ['intro'], [])
    ).toThrow(
      /narration name\(s\) intro are both seeded in localize\(\) and declared as Studio-managed/
    )
  })

  it('rejects a text name that is also seeded in localize()', () => {
    expect(() =>
      validateStudioDeclaration({ text: ['heading'] }, [], ['heading'])
    ).toThrow(
      /text name\(s\) heading are both seeded in localize\(\) and declared as Studio-managed/
    )
  })

  it('allows overlays/audio names to coincide with seeded narration/text names', () => {
    // Only narration and text share a namespace with the localize seeds.
    expect(() =>
      validateStudioDeclaration(
        { overlays: ['intro'], audio: ['heading'] },
        ['intro'],
        ['heading']
      )
    ).not.toThrow()
  })
})
