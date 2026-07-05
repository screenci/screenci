import { describe, it, assertType } from 'vitest'
import { createNarration, buildStudioNarrationCues } from './cue.js'
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

  it('accepts a shared built-in default that also works for Russian', () => {
    createNarration({
      voice: { name: voices.Ava },
      en: { intro: 'Hello' },
      ru: { intro: 'Privet' },
    })
  })

  it('rejects a shared built-in default that is unavailable for Russian', () => {
    createNarration({
      // @ts-expect-error — this built-in voice is not available for Russian
      voice: { name: voices.Sophie },
      en: { intro: 'Hello' },
      ru: { intro: 'Privet' },
    })
  })

  it('rejects an unavailable Russian built-in per-language override', () => {
    createNarration({
      en: { intro: 'Hello' },
      ru: {
        // @ts-expect-error — this built-in voice is not available for Russian
        voice: { name: voices.Sophie },
        intro: 'Privet',
      },
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

  it('accepts a per-cue volume on text and media cue values', () => {
    createNarration({
      voice: { name: voices.Ava },
      en: {
        intro: { text: 'Hello', volume: 0.5 },
        clip: { media: '/clip.mp4', subtitle: 'Watch', volume: 2 },
      },
      fi: {
        intro: { text: 'Hei', volume: 0.5 },
        clip: { path: '/clip.mp4', volume: 2 },
      },
    })
  })

  it('rejects a non-numeric volume', () => {
    createNarration({
      voice: { name: voices.Ava },
      en: {
        // @ts-expect-error — volume must be a number
        intro: { text: 'Hello', volume: 'loud' },
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

  it('accepts ElevenLabs multilingual v2 voice settings', () => {
    createNarration({
      voice: {
        name: voices.elevenlabs({ voiceId: 'voice-en' }),
        stability: 0.45,
        similarityBoost: 0.8,
        style: 0.2,
        speed: 0.9,
        useSpeakerBoost: false,
      },
      en: { intro: 'Hello' },
    })
  })

  it('rejects ElevenLabs settings for model voices', () => {
    createNarration({
      voice: {
        name: voices.Ava,
        // @ts-expect-error — stability is only available for ElevenLabs voices
        stability: 0.5,
      },
      en: { intro: 'Hello' },
    })
  })

  it('rejects model voice prompts for ElevenLabs voices', () => {
    createNarration({
      voice: {
        name: voices.elevenlabs({ voiceId: 'voice-en' }),
        // @ts-expect-error — ElevenLabs style is a numeric exaggeration setting
        style: 'Friendly and energetic',
      },
      en: { intro: 'Hello' },
    })
  })
})

describe('buildStudioNarrationCues type constraints', () => {
  // Studio-managed narration names are typed to the exact names by the
  // `video.narration(editable([...]))` builder (see index.test-d.ts). The
  // internal helper returns a generic record of NarrationCue controllers.
  it('returns a record of NarrationCue controllers', () => {
    const narration = buildStudioNarrationCues(['intro', 'checkout', 'outro'])

    assertType<Record<string, NarrationCue>>(narration)
    assertType<NarrationCue | undefined>(narration.intro)
  })
})
