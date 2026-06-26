import { describe, it, expect } from 'vitest'
import { normalizeLocalizeSpec } from './localize.js'
import { voices } from './voices.js'

describe('normalizeLocalizeSpec', () => {
  it('infers languages from the union of seeded narration and text keys', () => {
    const n = normalizeLocalizeSpec({
      narration: { en: { intro: 'Hi' }, fi: { intro: 'Moi' } },
      text: { en: { heading: 'H' }, fi: { heading: 'O' } },
    })
    expect(n.languages).toEqual(['en', 'fi'])
    expect(n.mode).toBe('per-language')
    expect(n.browserLocale).toBe(true)
    expect(n.narration).toMatchObject({
      cueNames: ['intro'],
      seededNames: ['intro'],
      studioNames: [],
    })
    expect(n.narration?.seedByLang).toEqual({
      en: { intro: { kind: 'text', text: 'Hi' } },
      fi: { intro: { kind: 'text', text: 'Moi' } },
    })
    expect(n.text).toMatchObject({
      fieldNames: ['heading'],
      seededNames: ['heading'],
      studioNames: [],
    })
  })

  it('accepts a spec with only languages (every cue/field is Studio-managed)', () => {
    // Studio-managed names are now declared via video.studio({...}), not on the
    // localize spec. A spec carrying just `languages` is valid: it sets the
    // language set and leaves narration/text null (the fixtures merge the
    // Studio-managed cues/fields in from the studio declaration).
    const n = normalizeLocalizeSpec({ languages: ['en', 'fi'] })
    expect(n.narration).toBeNull()
    expect(n.text).toBeNull()
    expect(n.languages).toEqual(['en', 'fi'])
  })

  it('keeps seeded maps independent of Studio-managed names', () => {
    const n = normalizeLocalizeSpec({
      narration: { en: { intro: 'Hi' }, fi: { intro: 'Moi' } },
      text: { en: { heading: 'H' }, fi: { heading: 'O' } },
    })
    expect(n.narration?.cueNames).toEqual(['intro'])
    expect(n.narration?.seededNames).toEqual(['intro'])
    expect(n.narration?.studioNames).toEqual([])
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
    ).toThrow(/text for "fi" must declare the same keys.*missing heading/)
  })

  it('throws when seeded languages have different keys', () => {
    expect(() =>
      normalizeLocalizeSpec({
        narration: { en: { intro: 'Hi', outro: 'Bye' }, fi: { intro: 'Moi' } },
      })
    ).toThrow(/narration for "fi" must declare the same keys.*missing outro/)
  })

  it('throws when a spec has nothing to localize', () => {
    expect(() => normalizeLocalizeSpec({})).toThrow(/nothing to localize/)
  })

  it('throws on an unsupported language code', () => {
    expect(() =>
      normalizeLocalizeSpec({ narration: { en: { intro: 'Hi' }, zz: {} } })
    ).toThrow(/unsupported language "zz"/)
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

  it('captures a per-cue voice from the { cue, voice } object form', () => {
    const n = normalizeLocalizeSpec({
      narration: {
        en: { save: 'Save.' },
        fi: { save: { cue: 'Tallenna.', voice: { name: voices.Nora } } },
      },
    })
    expect(n.narration?.seedByLang.en?.save).toEqual({
      kind: 'text',
      text: 'Save.',
    })
    expect(n.narration?.seedByLang.fi?.save).toEqual({
      kind: 'text',
      text: 'Tallenna.',
      voice: { name: voices.Nora },
    })
  })

  it('captures a per-cue synthesis language from the { cue, language } form', () => {
    const n = normalizeLocalizeSpec({
      narration: {
        en: { tagline: 'Just do it' },
        fi: { tagline: { cue: 'Just do it', language: 'en' } },
      },
    })
    expect(n.narration?.seedByLang.en?.tagline).toEqual({
      kind: 'text',
      text: 'Just do it',
    })
    expect(n.narration?.seedByLang.fi?.tagline).toEqual({
      kind: 'text',
      text: 'Just do it',
      language: 'en',
    })
  })

  it('normalizes a media cue value', () => {
    const n = normalizeLocalizeSpec({
      languages: ['en'],
      narration: { en: { jingle: { media: 'jingle.mp3', subtitle: 'la la' } } },
    })
    expect(n.narration?.seedByLang.en?.jingle).toEqual({
      kind: 'media',
      path: 'jingle.mp3',
      subtitle: 'la la',
    })
  })

  describe('voice', () => {
    it('keeps a per-language voice map', () => {
      const n = normalizeLocalizeSpec({
        voice: { en: { name: voices.Ava }, fi: { name: voices.Nora } },
        narration: { en: { intro: 'Hi' }, fi: { intro: 'Moi' } },
      })
      expect(n.voiceByLang).toEqual({
        en: { name: voices.Ava },
        fi: { name: voices.Nora },
      })
    })

    it('allows a partial voice map (omitted languages use the use default)', () => {
      const n = normalizeLocalizeSpec({
        voice: { fi: { name: voices.Nora } },
        narration: { en: { intro: 'Hi' }, fi: { intro: 'Moi' } },
      })
      expect(n.voiceByLang).toEqual({ fi: { name: voices.Nora } })
    })

    it('throws when a voice map names a language outside the localization', () => {
      expect(() =>
        normalizeLocalizeSpec({
          voice: { en: { name: voices.Ava }, sv: { name: voices.Nora } },
          narration: { en: { intro: 'Hi' }, fi: { intro: 'Moi' } },
        })
      ).toThrow(/voice map names language\(s\) sv that are not part/)
    })

    it('defaults to an empty voice map when no voice is set', () => {
      const n = normalizeLocalizeSpec({
        narration: { en: { intro: 'Hi' } },
      })
      expect(n.voiceByLang).toEqual({})
    })
  })
})
