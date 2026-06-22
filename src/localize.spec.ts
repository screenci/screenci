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

  it('declares studio-managed names via the studio field', () => {
    const n = normalizeLocalizeSpec({
      languages: ['en', 'fi'],
      studio: { narration: ['intro', 'save'], text: ['heading'] },
    })
    expect(n.narration).toMatchObject({
      cueNames: ['intro', 'save'],
      studioNames: ['intro', 'save'],
      seededNames: [],
    })
    expect(n.text).toMatchObject({
      fieldNames: ['heading'],
      studioNames: ['heading'],
      seededNames: [],
    })
    expect(n.languages).toEqual(['en', 'fi'])
  })

  it('supports the partial form: studio names alongside seeded maps', () => {
    const n = normalizeLocalizeSpec({
      studio: { narration: ['alert'] },
      narration: { en: { intro: 'Hi' }, fi: { intro: 'Moi' } },
      text: { en: { heading: 'H' }, fi: { heading: 'O' } },
    })
    expect(n.narration?.cueNames).toEqual(['intro', 'alert'])
    expect(n.narration?.seededNames).toEqual(['intro'])
    expect(n.narration?.studioNames).toEqual(['alert'])
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

  it('throws when a name is both seeded and studio-managed', () => {
    expect(() =>
      normalizeLocalizeSpec({
        studio: { narration: ['intro'] },
        narration: { en: { intro: 'Hi' }, fi: { intro: 'Moi' } },
      })
    ).toThrow(
      /narration name\(s\) intro are both seeded and declared in studio/
    )
  })

  it('throws when there are no languages to infer', () => {
    expect(() =>
      normalizeLocalizeSpec({ studio: { narration: ['intro'] } })
    ).toThrow(/no languages/)
  })

  it('throws on an unsupported language code', () => {
    expect(() =>
      normalizeLocalizeSpec({ narration: { en: { intro: 'Hi' }, zz: {} } })
    ).toThrow(/unsupported language "zz"/)
  })

  it('rejects duplicate studio names', () => {
    expect(() =>
      normalizeLocalizeSpec({ languages: ['en'], studio: { text: ['a', 'a'] } })
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
    it('expands a single voice config to every language', () => {
      const n = normalizeLocalizeSpec({
        voice: { name: voices.Ava },
        narration: { en: { intro: 'Hi' }, fi: { intro: 'Moi' } },
      })
      expect(n.voiceByLang).toEqual({
        en: { name: voices.Ava },
        fi: { name: voices.Ava },
      })
    })

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

    it('throws when a voice map does not cover every language', () => {
      expect(() =>
        normalizeLocalizeSpec({
          voice: { en: { name: voices.Ava } },
          narration: { en: { intro: 'Hi' }, fi: { intro: 'Moi' } },
        })
      ).toThrow(/voice map must cover every language.*missing fi/)
    })

    it('defaults to an empty voice map when no voice is set', () => {
      const n = normalizeLocalizeSpec({
        narration: { en: { intro: 'Hi' } },
      })
      expect(n.voiceByLang).toEqual({})
    })
  })
})
