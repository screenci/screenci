import { describe, it, assertType } from 'vitest'
import { createCaptions } from './caption.js'
import { voices } from './voices.js'
import type { VoiceForLang } from './voices.js'

describe('createCaptions type constraints', () => {
  it('accepts matching keys across all languages', () => {
    createCaptions({
      en: {
        voice: voices.Ava,
        captions: { intro: 'Hello', outro: 'Bye' },
      },
      fi: {
        voice: voices.Ava,
        captions: { intro: 'Hei', outro: 'Näkemiin' },
      },
    })
  })

  it('accepts mixed value types (string vs file object) for the same key', () => {
    createCaptions({
      en: {
        voice: voices.Ava,
        captions: {
          intro: 'Hello',
          clip: { path: '/clip.mp4', subtitle: 'Watch' },
        },
      },
      fi: {
        voice: voices.elevenlabs({ voiceId: 'voice-fi' }),
        captions: { intro: 'Hei', clip: 'Katso' },
      },
    })
  })

  it('rejects a language with a missing caption key', () => {
    createCaptions({
      en: {
        voice: voices.Ava,
        captions: { intro: 'Hello', outro: 'Bye' },
      },
      fi: {
        voice: voices.Ava,
        // @ts-expect-error — 'outro' is missing
        captions: { intro: 'Hei' },
      },
    })
  })

  it('accepts explicit provider voice ids for any supported language', () => {
    assertType<VoiceForLang<'en'>>(voices.elevenlabs({ voiceId: 'voice-en' }))
  })
})
