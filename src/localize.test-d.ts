import { describe, it, expectTypeOf } from 'vitest'
import { video } from './video.js'
import { voices } from './voices.js'
import type { NarrationCue } from './cue.js'

describe('video.localize typed fixtures', () => {
  it('types narration and text to seeded names', () => {
    video.localize({
      narration: { en: { intro: 'Hi' }, fi: { intro: 'Moi' } },
      text: { en: { heading: 'H' }, fi: { heading: 'O' } },
    })('T', async ({ narration, text }) => {
      expectTypeOf(narration.intro).toEqualTypeOf<NarrationCue>()
      expectTypeOf(text.heading).toEqualTypeOf<string | undefined>()
      // @ts-expect-error 'nope' is not a declared cue
      void narration.nope
      // @ts-expect-error 'nope' is not a declared text field
      void text.nope
    })
  })

  it('unions seeded names with studio-managed names', () => {
    video.localize({
      studio: { narration: ['alert'], text: ['tagline'] },
      narration: { en: { intro: 'Hi' }, fi: { intro: 'Moi' } },
      text: { en: { heading: 'H' }, fi: { heading: 'O' } },
    })('T', async ({ narration, text }) => {
      // Seeded and Studio-managed names are both present.
      expectTypeOf(narration.intro).toEqualTypeOf<NarrationCue>()
      expectTypeOf(narration.alert).toEqualTypeOf<NarrationCue>()
      expectTypeOf(text.heading).toEqualTypeOf<string | undefined>()
      expectTypeOf(text.tagline).toEqualTypeOf<string | undefined>()
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

  it('requires every language to declare the same text keys', () => {
    video.localize({
      text: {
        en: { heading: 'H', tagline: 'T' },
        // @ts-expect-error fi is missing the `tagline` field key
        fi: { heading: 'O' },
      },
    })('T', async () => {})
  })

  it('accepts a single voice config or a per-language voice map', () => {
    video.localize({
      voice: { name: voices.Ava },
      narration: { en: { intro: 'Hi' }, fi: { intro: 'Moi' } },
    })('T', async () => {})

    video.localize({
      voice: { en: { name: voices.Ava }, fi: { name: voices.Nora } },
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
})
