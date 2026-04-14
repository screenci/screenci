import { describe, it, assertType } from 'vitest'
import { createNarration } from './cue.js'
import { voices } from './voices.js'
import type { VoiceForLang } from './voices.js'

describe('createNarration type constraints', () => {
  it('accepts matching keys across all languages', () => {
    createNarration({
      voice: { name: voices.Ava },
      languages: {
        en: {
          cues: { intro: 'Hello', outro: 'Bye' },
        },
        fi: {
          cues: { intro: 'Hei', outro: 'Näkemiin' },
        },
      },
    })
  })

  it('accepts per-language narration override with seed', () => {
    createNarration({
      voice: { name: voices.Ava },
      languages: {
        en: { cues: { intro: 'Hello' } },
        fi: {
          voice: { name: voices.Nora, seed: 42 },
          cues: { intro: 'Hei' },
        },
      },
    })
  })

  it('accepts per-language region', () => {
    createNarration({
      voice: { name: voices.Ava },
      languages: {
        en: { region: 'en-US', cues: { intro: 'Hello' } },
      },
    })
  })

  it('accepts mixed value types (string vs file object) for the same key', () => {
    createNarration({
      voice: { name: voices.Ava },
      languages: {
        en: {
          cues: {
            intro: 'Hello',
            clip: { media: '/clip.mp4', subtitle: 'Watch' },
          },
        },
        fi: {
          voice: { name: voices.elevenlabs({ voiceId: 'voice-fi' }) },
          cues: { intro: 'Hei', clip: { text: 'Katso' } },
        },
      },
    })
  })

  it('rejects a language with a missing cue key', () => {
    createNarration({
      voice: { name: voices.Ava },
      languages: {
        en: {
          cues: { intro: 'Hello', outro: 'Bye' },
        },
        fi: {
          // @ts-expect-error — 'outro' is missing
          cues: { intro: 'Hei' },
        },
      },
    })
  })

  it('rejects seed at the top-level voice', () => {
    createNarration({
      // @ts-expect-error — seed is not allowed at the top-level voice
      voice: { name: voices.Ava, seed: 42 },
      languages: {
        en: { cues: { intro: 'Hello' } },
      },
    })
  })

  it('accepts explicit provider voice ids for any supported language', () => {
    assertType<VoiceForLang<'en'>>(voices.elevenlabs({ voiceId: 'voice-en' }))
  })

  it('creates narration from typed cues', () => {
    createNarration({
      voice: { name: voices.Ava },
      languages: {
        en: { cues: { intro: 'Hello' } },
      },
    })
  })
})
