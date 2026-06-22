import { describe, it, expect } from 'vitest'
import { normalizeLocalizeSpec } from './localize.js'

describe('normalizeLocalizeSpec', () => {
  it('infers languages from the union of seeded narration and text keys', () => {
    const n = normalizeLocalizeSpec({
      narration: { en: { intro: 'Hi' }, fi: { intro: 'Moi' } },
      text: { en: { heading: 'H' }, fi: { heading: 'O' } },
    })
    expect(n.languages).toEqual(['en', 'fi'])
    expect(n.mode).toBe('per-language')
    expect(n.browserLocale).toBe(true)
    expect(n.narration).toMatchObject({ kind: 'seeded', cueNames: ['intro'] })
    expect(n.text).toMatchObject({ kind: 'seeded', fieldNames: ['heading'] })
  })

  it('treats a string list as the studio-managed (name-only) form', () => {
    const n = normalizeLocalizeSpec({
      languages: ['en', 'fi'],
      narration: ['intro', 'save'],
      text: ['heading'],
    })
    expect(n.narration).toEqual({ kind: 'studio', cueNames: ['intro', 'save'] })
    expect(n.text).toEqual({ kind: 'studio', fieldNames: ['heading'] })
    expect(n.languages).toEqual(['en', 'fi'])
  })

  it('allows mixing seeded and name-only across fields', () => {
    const n = normalizeLocalizeSpec({
      narration: { en: { intro: 'Hi' }, fi: { intro: 'Moi' } },
      text: ['heading'],
    })
    expect(n.narration?.kind).toBe('seeded')
    expect(n.text?.kind).toBe('studio')
    expect(n.languages).toEqual(['en', 'fi'])
  })

  it('honors explicit languages, mode, browserLocale, and locales', () => {
    const n = normalizeLocalizeSpec({
      languages: ['en'],
      narration: { en: { intro: 'Hi' } },
      mode: 'shared',
      browserLocale: false,
      locales: { en: 'en-GB' },
    })
    expect(n.mode).toBe('shared')
    expect(n.browserLocale).toBe(false)
    expect(n.locales).toEqual({ en: 'en-GB' })
  })

  it('throws when a seeded map is missing a declared language', () => {
    expect(() =>
      normalizeLocalizeSpec({
        narration: { en: { intro: 'Hi' }, fi: { intro: 'Moi' } },
        text: { en: { heading: 'H' } },
      })
    ).toThrow(/text languages must match.*missing fi/)
  })

  it('throws when there are no languages to infer', () => {
    expect(() => normalizeLocalizeSpec({ narration: ['intro'] })).toThrow(
      /no languages/
    )
  })

  it('throws on an unsupported language code', () => {
    expect(() =>
      normalizeLocalizeSpec({ narration: { en: { intro: 'Hi' }, zz: {} } })
    ).toThrow(/unsupported language "zz"/)
  })

  it('rejects duplicate name-only entries', () => {
    expect(() =>
      normalizeLocalizeSpec({ languages: ['en'], text: ['a', 'a'] })
    ).toThrow(/duplicate text name "a"/)
  })

  it('collects cue and field names as the union across languages', () => {
    const n = normalizeLocalizeSpec({
      narration: {
        en: { intro: 'Hi', outro: 'Bye' },
        fi: { intro: 'Moi', outro: 'Hei' },
      },
    })
    expect(n.narration).toMatchObject({ cueNames: ['intro', 'outro'] })
  })
})
