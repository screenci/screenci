import { describe, it, expectTypeOf } from 'vitest'
import { video } from './video.js'
import { editable } from './studio.js'
import { voices } from './voices.js'
import type { NarrationCue } from './cue.js'

describe('video.localize typed fixtures', () => {
  it('types narration and values to seeded names', () => {
    video.localize({
      narration: { en: { intro: 'Hi' }, fi: { intro: 'Moi' } },
      values: { en: { heading: 'H' }, fi: { heading: 'O' } },
    })('T', async ({ narration, values }) => {
      expectTypeOf(narration.intro).toEqualTypeOf<NarrationCue>()
      // Seeded fields are always populated in per-language mode (the default).
      expectTypeOf(values.heading).toEqualTypeOf<string>()
      // @ts-expect-error 'nope' is not a declared cue
      void narration.nope
      // @ts-expect-error 'nope' is not a declared values field
      void values.nope
    })
  })

  it('types values fields as string in shared mode', () => {
    video.localize({
      mode: 'shared',
      values: { en: { heading: 'H' }, fi: { heading: 'O' } },
    })('T', async ({ values }) => {
      // A shared capture does no per-language injection, so a seeded field is
      // the empty string at runtime rather than undefined.
      expectTypeOf(values.heading).toEqualTypeOf<string>()
    })
  })

  it('unions seeded names with studio-managed names', () => {
    video
      .narration(editable(['alert']))
      .values(editable(['tagline']))
      .localize({
        narration: { en: { intro: 'Hi' }, fi: { intro: 'Moi' } },
        values: { en: { heading: 'H' }, fi: { heading: 'O' } },
      })('T', async ({ narration, values }) => {
      // Seeded and app-editable names are both present.
      expectTypeOf(narration.intro).toEqualTypeOf<NarrationCue>()
      expectTypeOf(narration.alert).toEqualTypeOf<NarrationCue>()
      // Seeded field: always populated per-language.
      expectTypeOf(values.heading).toEqualTypeOf<string>()
      // App-editable field: empty string until set in the web editor.
      expectTypeOf(values.tagline).toEqualTypeOf<string>()
    })
  })

  it('requires every language to declare the same narration keys', () => {
    video.localize({
      narration: {
        en: { intro: 'Hi', save: 'Save' },
        // @ts-expect-error fi is missing the `save` cue key
        fi: { intro: 'Moi' },
      },
    })('T', async () => {})
  })

  it('requires every language to declare the same values keys', () => {
    video.localize({
      values: {
        en: { heading: 'H', tagline: 'T' },
        // @ts-expect-error fi is missing the `tagline` field key
        fi: { heading: 'O' },
      },
    })('T', async () => {})
  })

  it('accepts a per-language voice map', () => {
    video.localize({
      voice: { en: { name: voices.Ava }, fi: { name: voices.Nora } },
      narration: { en: { intro: 'Hi' }, fi: { intro: 'Moi' } },
    })('T', async () => {})
  })

  it('accepts a partial per-language voice map', () => {
    video.localize({
      voice: { fi: { name: voices.Nora } },
      narration: { en: { intro: 'Hi' }, fi: { intro: 'Moi' } },
    })('T', async () => {})
  })

  it('rejects a single voice config for all languages (use `use` instead)', () => {
    video.localize({
      // @ts-expect-error voice must be a per-language map; the all-languages
      // default belongs in `use` (renderOptions.narration.voice).
      voice: { name: voices.Ava },
      narration: { en: { intro: 'Hi' }, fi: { intro: 'Moi' } },
    })('T', async () => {})
  })

  it('accepts a per-cue voice override in the { cue, voice } form', () => {
    video.localize({
      narration: {
        en: { save: 'Save.' },
        fi: { save: { cue: 'Tallenna.', voice: { name: voices.Nora } } },
      },
    })('T', async () => {})
  })

  it('rejects an unavailable Russian per-language built-in voice', () => {
    video.localize({
      voice: {
        // @ts-expect-error this built-in voice is not available for Russian
        ru: { name: voices.Sophie },
      },
      narration: { en: { intro: 'Hi' }, ru: { intro: 'Privet' } },
    })('T', async () => {})
  })

  it('rejects an unavailable Russian per-cue built-in voice', () => {
    video.localize({
      narration: {
        en: { intro: 'Hi' },
        ru: {
          intro: {
            cue: 'Privet',
            // @ts-expect-error this built-in voice is not available for Russian
            voice: { name: voices.Sophie },
          },
        },
      },
    })('T', async () => {})
  })

  it('accepts a per-cue synthesis language on a { cue } value', () => {
    video.localize({
      narration: {
        en: { tagline: 'Just do it' },
        fi: { tagline: { cue: 'Just do it', language: 'en' } },
      },
    })('T', async () => {})
  })

  it('rejects language on a media cue value', () => {
    video.localize({
      narration: {
        en: {
          // @ts-expect-error language is not valid on the { media } form
          jingle: { media: 'jingle.mp3', language: 'en' },
        },
      },
    })('T', async () => {})
  })
})
