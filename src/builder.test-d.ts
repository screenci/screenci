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
      logo: { path: './logo.png', fill: 'recording', duration: 2000 },
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

  it('array (names) form keeps the declared names', () => {
    video.narration(['intro', 'cta'])('t', async ({ narration }) => {
      expectTypeOf(narration.intro).toEqualTypeOf<NarrationCue>()
      expectTypeOf<keyof typeof narration>().toEqualTypeOf<'intro' | 'cta'>()
    })
  })

  it('object seed form keeps the seeded names and value type', () => {
    video.narration({ intro: 'Hi', cta: 'Buy' })('t', async ({ narration }) => {
      expectTypeOf(narration.intro).toEqualTypeOf<NarrationCue>()
      expectTypeOf<keyof typeof narration>().toEqualTypeOf<'intro' | 'cta'>()
    })
  })

  it('rejects a missing argument for a content feature', () => {
    // @ts-expect-error narration requires an argument (names or seed values).
    video.narration()('t', async () => {})
  })

  it('accepts languages({ mode }) without an explicit set (inferred from keys)', () => {
    video
      .languages({ mode: 'shared' })
      .narration({ en: { intro: 'Hi' }, fi: { intro: 'Moi' } })(
      't',
      async () => {}
    )
  })

  it('accepts the canonical languages forms (all web-owned)', () => {
    // Blank: nothing seeded, the web app supplies the set.
    video.languages().narration(['intro'])('t', async () => {})
    // Seeded set.
    video.languages(['en', 'fi'])('t', async () => {})
    // Seeded whole config (set + mode).
    video.languages({ languages: ['en', 'fi'], mode: 'shared' })(
      't',
      async () => {}
    )
    // { mode } only is valid: web owns the set, shared mode is seeded.
    video.languages({ mode: 'shared' }).narration(['intro'])(
      't',
      async () => {}
    )
  })

  it('rejects an invalid value inside a languages config', () => {
    // @ts-expect-error languages must be an array of codes, not a bare string.
    video.languages({ languages: 'en' })('t', async () => {})
  })

  it('overlays: array (names) maps each name to a controller', () => {
    video.overlays(['logo', 'badge'])('t', async ({ overlays }) => {
      expectTypeOf(overlays.logo).toEqualTypeOf<OverlayController>()
      expectTypeOf<keyof typeof overlays>().toEqualTypeOf<'logo' | 'badge'>()
    })
  })

  it('overlays: rejects the language-major form (overlays are shared)', () => {
    video.overlays({
      // @ts-expect-error overlays no longer accept a language-major object.
      en: { badge: { path: './badge.en.png' } },
      fi: { badge: { path: './badge.fi.png' } },
    })('t', async () => {})
  })
})
