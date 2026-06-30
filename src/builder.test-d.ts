import { describe, it, expectTypeOf } from 'vitest'
import { video } from './video.js'
import type { NarrationCue } from './cue.js'
import type { OverlayController } from './asset.js'
import type { AudioController } from './audio.js'

// These assertions lock the *shape* of the per-feature fixture maps. The runtime
// behavior is unchanged; what matters here is that each declared name resolves to
// a real property mapped from the declaring literal (a homomorphic map), not a
// synthesized `Record<Union, V>`. The homomorphic form is what carries each
// property's source symbol, so editors can "Go to Definition" from
// `narration.intro` to the `intro:` line. tsc cannot assert navigability
// directly, so we assert the exact key set and value type per feature instead.

describe('builder fixture controllers', () => {
  it('narration: content-major maps each name to NarrationCue', () => {
    video.narration({ intro: 'Hi', cta: 'Click' })(
      't',
      async ({ narration }) => {
        expectTypeOf(narration.intro).toEqualTypeOf<NarrationCue>()
        expectTypeOf(narration.cta).toEqualTypeOf<NarrationCue>()
        expectTypeOf<keyof typeof narration>().toEqualTypeOf<'intro' | 'cta'>()
      }
    )
  })

  it('narration: language-major unions inner names across languages', () => {
    video.narration({
      en: { intro: 'Hi', outro: 'Bye' },
      fi: { intro: 'Moi' },
    })('t', async ({ narration }) => {
      expectTypeOf(narration.intro).toEqualTypeOf<NarrationCue>()
      expectTypeOf(narration.outro).toEqualTypeOf<NarrationCue>()
      expectTypeOf<keyof typeof narration>().toEqualTypeOf<'intro' | 'outro'>()
    })
  })

  it('values: maps each declared field to string', () => {
    video.values({ en: { price: '9' }, fi: { price: '9' } })(
      't',
      async ({ values }) => {
        expectTypeOf(values.price).toEqualTypeOf<string>()
        expectTypeOf<keyof typeof values>().toEqualTypeOf<'price'>()
      }
    )
  })

  it('overlays: content-major preserves the per-name controller type', () => {
    video.overlays({
      logo: { path: './logo.png', fill: 'recording', duration: '2s' },
    })('t', async ({ overlays }) => {
      expectTypeOf(overlays.logo).toEqualTypeOf<OverlayController>()
      expectTypeOf<keyof typeof overlays>().toEqualTypeOf<'logo'>()
    })
  })

  it('audio: maps each declared track to AudioController', () => {
    video.audio({ theme: './music.mp3' })('t', async ({ audio }) => {
      expectTypeOf(audio.theme).toEqualTypeOf<AudioController>()
      expectTypeOf<keyof typeof audio>().toEqualTypeOf<'theme'>()
    })
  })

  it('studio/array form keeps the declared names', () => {
    video.narration(['intro', 'cta'])('t', async ({ narration }) => {
      expectTypeOf(narration.intro).toEqualTypeOf<NarrationCue>()
      expectTypeOf<keyof typeof narration>().toEqualTypeOf<'intro' | 'cta'>()
    })
  })
})
