import { describe, it, expectTypeOf } from 'vitest'
import { video } from './video.js'
import { voices } from './voices.js'
import type { NarrationCue } from './cue.js'
import type { LocalizeSpec, NarrationByLang } from './localize.js'

describe('localized typed fixtures', () => {
  it('types narration and values to seeded names', () => {
    video
      .narration({ en: { intro: 'Hi' }, fi: { intro: 'Moi' } })
      .values({ en: { heading: 'H' }, fi: { heading: 'O' } })(
      'T',
      async ({ narration, values }) => {
        expectTypeOf(narration.intro).toEqualTypeOf<NarrationCue>()
        // Seeded fields are always populated in per-language mode (the default).
        expectTypeOf(values.heading).toEqualTypeOf<string>()
        // @ts-expect-error 'nope' is not a declared cue
        void narration.nope
        // @ts-expect-error 'nope' is not a declared values field
        void values.nope
      }
    )
  })

  it('types values fields as string in shared mode', () => {
    video
      .languages({ mode: 'shared' })
      .values({ en: { heading: 'H' }, fi: { heading: 'O' } })(
      'T',
      async ({ values }) => {
        // A shared capture does no per-language injection, so a seeded field is
        // the empty string at runtime rather than undefined.
        expectTypeOf(values.heading).toEqualTypeOf<string>()
      }
    )
  })

  it('unions seeded names with editor-owned names across features', () => {
    video
      .narration(['alert'])
      .values({ en: { heading: 'H' }, fi: { heading: 'O' } })(
      'T',
      async ({ narration, values }) => {
        // Editor-owned cue names are typed like seeded ones.
        expectTypeOf(narration.alert).toEqualTypeOf<NarrationCue>()
        // Seeded field: always populated per-language.
        expectTypeOf(values.heading).toEqualTypeOf<string>()
      }
    )
  })

  it('unions narration names when languages declare different keys', () => {
    video.narration({
      en: { intro: 'Hi', save: 'Save' },
      // fi omits `save`: it falls back to the shared/default value at runtime.
      fi: { intro: 'Moi' },
    })('T', async ({ narration }) => {
      expectTypeOf(narration.intro).toEqualTypeOf<NarrationCue>()
      expectTypeOf(narration.save).toEqualTypeOf<NarrationCue>()
    })
  })

  it('unions values names when languages declare different keys', () => {
    video.values({
      en: { heading: 'H', tagline: 'T' },
      fi: { heading: 'O' },
    })('T', async ({ values }) => {
      expectTypeOf(values.heading).toEqualTypeOf<string>()
      expectTypeOf(values.tagline).toEqualTypeOf<string>()
    })
  })

  it('accepts a per-language voice map', () => {
    const spec: LocalizeSpec = {
      voice: { en: { name: voices.Ava }, fi: { name: voices.Nora } },
      narration: { en: { intro: 'Hi' }, fi: { intro: 'Moi' } },
    }
    void spec
  })

  it('accepts a partial per-language voice map', () => {
    const spec: LocalizeSpec = {
      voice: { fi: { name: voices.Nora } },
      narration: { en: { intro: 'Hi' }, fi: { intro: 'Moi' } },
    }
    void spec
  })

  it('rejects a single voice config for all languages (use `use` instead)', () => {
    const spec: LocalizeSpec = {
      // @ts-expect-error voice must be a per-language map; the all-languages
      // default belongs in `use` (renderOptions.narration.voice).
      voice: { name: voices.Ava },
      narration: { en: { intro: 'Hi' }, fi: { intro: 'Moi' } },
    }
    void spec
  })

  it('accepts a global renderOptions narration voice outside the Russian subset', () => {
    video.use({
      renderOptions: {
        narration: {
          voice: { name: voices.Sophie },
        },
      },
    })
  })

  it('accepts a per-cue voice override in the { cue, voice } form', () => {
    video.narration({
      en: { save: 'Save.' },
      fi: { save: { cue: 'Tallenna.', voice: { name: voices.Nora } } },
    })('T', async () => {})
  })

  it('rejects an unavailable Russian per-language built-in voice', () => {
    const spec: LocalizeSpec = {
      voice: {
        // @ts-expect-error this built-in voice is not available for Russian
        ru: { name: voices.Sophie },
      },
      narration: { en: { intro: 'Hi' }, ru: { intro: 'Privet' } },
    }
    void spec
  })

  it('rejects an unavailable Russian per-cue built-in voice', () => {
    const narration: NarrationByLang = {
      en: { intro: 'Hi' },
      ru: {
        intro: {
          cue: 'Privet',
          // @ts-expect-error this built-in voice is not available for Russian
          voice: { name: voices.Sophie },
        },
      },
    }
    void narration
  })

  it('accepts a per-cue synthesis language on a { cue } value', () => {
    video.narration({
      en: { tagline: 'Just do it' },
      fi: { tagline: { cue: 'Just do it', language: 'en' } },
    })('T', async () => {})
  })

  it('rejects language on a media cue value', () => {
    video.narration({
      en: {
        // @ts-expect-error language is not valid on the { media } form
        jingle: { media: 'jingle.mp3', language: 'en' },
      },
    })('T', async () => {})
  })
})
