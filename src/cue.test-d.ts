import { describe, it, assertType } from 'vitest'
import { createNarration } from './cue.js'
import type { NarrationCue } from './cue.js'
import { modelTypes, voices } from './voices.js'

describe('createNarration type constraints', () => {
  it('accepts matching flat keys across all languages', () => {
    createNarration({
      voice: { name: voices.Ava },
      en: {
        intro: 'Hello',
        outro: 'Bye',
      },
      fi: {
        intro: 'Hei',
        outro: 'Näkemiin',
      },
    })
  })

  it('accepts a per-language narration override on only one language', () => {
    createNarration({
      voice: { name: voices.Ava },
      en: { intro: 'Hello' },
      fi: {
        voice: { name: voices.Nora, seed: 42 },
        intro: 'Hei',
      },
    })
  })

  it('accepts omitted top-level voice and defaults it at runtime', () => {
    createNarration({
      en: { intro: 'Hello' },
      es: { intro: 'Hola' },
    })
  })

  it('accepts mixed value types for the same key', () => {
    createNarration({
      voice: { name: voices.Ava },
      en: {
        intro: 'Hello',
        clip: { media: '/clip.mp4', subtitle: 'Watch' },
      },
      fi: {
        voice: { name: voices.elevenlabs({ voiceId: 'voice-fi' }) },
        intro: 'Hei',
        clip: { text: 'Katso' },
      },
    })
  })

  it('rejects a language with a missing cue key', () => {
    createNarration({
      voice: { name: voices.Ava },
      en: {
        intro: 'Hello',
        outro: 'Bye',
      },
      // @ts-expect-error — 'outro' is missing
      fi: {
        intro: 'Hei',
      },
    })
  })

  it('rejects legacy nested cues shape', () => {
    createNarration({
      voice: { name: voices.Ava },
      en: {
        // @ts-expect-error — cue keys must be flat under each language
        cues: { intro: 'Hello' },
      },
    })
  })

  it('rejects the legacy languages wrapper at the root', () => {
    createNarration({
      voice: { name: voices.Ava },
      // @ts-expect-error — languages is no longer a valid root key
      languages: {
        en: { intro: 'Hello' },
      },
    })
  })

  it('rejects locale tags as top-level public language keys', () => {
    createNarration({
      voice: { name: voices.Ava },
      // @ts-expect-error — locale tags are not accepted in the public narration map
      'fi-FI': { intro: 'Hei' },
    })
  })

  it('creates narration from typed cues', () => {
    const narration = createNarration({
      voice: { name: voices.Ava },
      en: { intro: 'Hello' },
    })

    assertType<NarrationCue>(narration.intro)
    assertType<() => Promise<void>>(narration.intro)
    assertType<() => Promise<void>>(narration.intro.start)
    assertType<() => Promise<void>>(narration.intro.end)
    // @ts-expect-error finish() no longer exists on narration cues
    void narration.intro.finish
  })

  it('accepts numeric pacing for consistent narration', () => {
    createNarration({
      voice: {
        name: voices.Ava,
        modelType: modelTypes.consistent,
        pacing: 1.25,
      },
      en: { intro: 'Hello' },
    })
  })

  it('rejects text pacing for consistent narration', () => {
    createNarration({
      voice: {
        name: voices.Ava,
        modelType: modelTypes.consistent,
        // @ts-expect-error — consistent pacing must be a numeric speaking rate
        pacing: 'Measured',
      },
      en: { intro: 'Hello' },
    })
  })
})
