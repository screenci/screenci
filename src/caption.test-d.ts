import { describe, it, assertType } from 'vitest'
import { createVoiceOvers } from './caption.js'
import { voices } from './voices.js'
import type { VoiceForLang } from './voices.js'

describe('createVoiceOvers type constraints', () => {
  it('accepts matching keys across all languages', () => {
    createVoiceOvers({
      voice: { name: voices.Ava },
      languages: {
        en: {
          captions: { intro: 'Hello', outro: 'Bye' },
        },
        fi: {
          captions: { intro: 'Hei', outro: 'Näkemiin' },
        },
      },
    })
  })

  it('accepts per-language voice override with seed', () => {
    createVoiceOvers({
      voice: { name: voices.Ava },
      languages: {
        en: { captions: { intro: 'Hello' } },
        fi: {
          voice: { name: voices.Nora, seed: 42 },
          captions: { intro: 'Hei' },
        },
      },
    })
  })

  it('accepts per-language region', () => {
    createVoiceOvers({
      voice: { name: voices.Ava },
      languages: {
        en: { region: 'en-US', captions: { intro: 'Hello' } },
      },
    })
  })

  it('accepts mixed value types (string vs file object) for the same key', () => {
    createVoiceOvers({
      voice: { name: voices.Ava },
      languages: {
        en: {
          captions: {
            intro: 'Hello',
            clip: { path: '/clip.mp4', subtitle: 'Watch' },
          },
        },
        fi: {
          voice: { name: voices.elevenlabs({ voiceId: 'voice-fi' }) },
          captions: { intro: 'Hei', clip: 'Katso' },
        },
      },
    })
  })

  it('rejects a language with a missing caption key', () => {
    createVoiceOvers({
      voice: { name: voices.Ava },
      languages: {
        en: {
          captions: { intro: 'Hello', outro: 'Bye' },
        },
        fi: {
          // @ts-expect-error — 'outro' is missing
          captions: { intro: 'Hei' },
        },
      },
    })
  })

  it('rejects seed at the top-level voice', () => {
    createVoiceOvers({
      // @ts-expect-error — seed is not allowed at the top-level voice
      voice: { name: voices.Ava, seed: 42 },
      languages: {
        en: { captions: { intro: 'Hello' } },
      },
    })
  })

  it('accepts explicit provider voice ids for any supported language', () => {
    assertType<VoiceForLang<'en'>>(voices.elevenlabs({ voiceId: 'voice-en' }))
  })
})
