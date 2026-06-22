import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  buildNarrationMarkers,
  buildTextValues,
  narrationVoiceConfigFromRenderOptions,
} from './localizeRuntime.js'
import { normalizeLocalizeSpec } from './localize.js'
import { setActiveCueRecorder, setSleepFn } from './cue.js'
import { NOOP_EVENT_RECORDER, type IEventRecorder } from './events.js'
import { voices } from './voices.js'

describe('narrationVoiceConfigFromRenderOptions', () => {
  it('returns undefined for undefined or studio render options', () => {
    expect(narrationVoiceConfigFromRenderOptions(undefined)).toBeUndefined()
    expect(narrationVoiceConfigFromRenderOptions('studio')).toBeUndefined()
  })

  it('returns undefined when there is no narration block', () => {
    expect(narrationVoiceConfigFromRenderOptions({})).toBeUndefined()
  })

  it('extracts the global default voice', () => {
    const config = narrationVoiceConfigFromRenderOptions({
      narration: { voice: { name: voices.Ava } },
    })
    expect(config).toEqual({ name: voices.Ava })
  })
})

describe('buildTextValues', () => {
  it('returns the active language values for seeded text', () => {
    const localize = normalizeLocalizeSpec({
      text: { en: { heading: 'Hi' }, fi: { heading: 'Moi' } },
    })
    expect(buildTextValues(localize, 'fi')).toEqual({ heading: 'Moi' })
  })

  it('returns undefined per field for studio-managed text', () => {
    const localize = normalizeLocalizeSpec({
      languages: ['en'],
      studio: { text: ['heading'] },
    })
    expect(buildTextValues(localize, 'en')).toEqual({ heading: undefined })
  })

  it('returns an empty object when there is no text', () => {
    const localize = normalizeLocalizeSpec({
      narration: { en: { intro: 'Hi' } },
    })
    expect(buildTextValues(localize, 'en')).toEqual({})
  })

  it('lets a Studio override win over the seed for the active language', () => {
    const localize = normalizeLocalizeSpec({
      text: { en: { heading: 'Seed' }, fi: { heading: 'Siemen' } },
    })
    const overrides = { fi: { heading: 'Studio FI' } }
    expect(buildTextValues(localize, 'fi', overrides)).toEqual({
      heading: 'Studio FI',
    })
    // Languages without an override keep the seed.
    expect(buildTextValues(localize, 'en', overrides)).toEqual({
      heading: 'Seed',
    })
  })

  it('resolves Studio-managed text from overrides', () => {
    const localize = normalizeLocalizeSpec({
      languages: ['en'],
      studio: { text: ['heading'] },
    })
    expect(
      buildTextValues(localize, 'en', { en: { heading: 'From Studio' } })
    ).toEqual({ heading: 'From Studio' })
    // Still undefined (holds render) when no override is provided.
    expect(buildTextValues(localize, 'en')).toEqual({ heading: undefined })
  })
})

describe('buildNarrationMarkers', () => {
  it('returns markers keyed by the declared cue names', () => {
    const localize = normalizeLocalizeSpec({
      narration: {
        en: { intro: 'Hi', outro: 'Bye' },
        fi: { intro: 'Moi', outro: 'Hei' },
      },
    })
    const markers = buildNarrationMarkers(localize)
    expect(Object.keys(markers).sort()).toEqual(['intro', 'outro'])
    expect(typeof markers.intro).toBe('function')
  })

  it('includes Studio-managed cues alongside seeded ones', () => {
    const localize = normalizeLocalizeSpec({
      studio: { narration: ['alert'] },
      narration: { en: { intro: 'Hi' }, fi: { intro: 'Moi' } },
    })
    const markers = buildNarrationMarkers(localize)
    expect(Object.keys(markers).sort()).toEqual(['alert', 'intro'])
  })

  it('returns an empty object when there is no narration', () => {
    const localize = normalizeLocalizeSpec({
      languages: ['en'],
      studio: { text: ['h'] },
    })
    expect(buildNarrationMarkers(localize)).toEqual({})
  })

  describe('voice cascade', () => {
    let recorder: IEventRecorder
    let cueStarts: Array<{
      name: string
      translations?: Record<string, unknown>
    }>

    beforeEach(() => {
      cueStarts = []
      recorder = {
        ...NOOP_EVENT_RECORDER,
        addCueStart: vi.fn(
          (_t: string, name: string, _c: unknown, translations: never) => {
            cueStarts.push({ name, translations })
          }
        ),
        addCueEnd: vi.fn(),
      }
      setSleepFn(() => {})
      setActiveCueRecorder(recorder)
    })

    afterEach(() => {
      setActiveCueRecorder(NOOP_EVENT_RECORDER)
      setSleepFn(() => {})
    })

    const voiceOf = (lang: string): string =>
      (cueStarts[0]?.translations as Record<string, { voice: string }>)[lang]
        .voice

    it('uses the per-language localize voice map', async () => {
      const localize = normalizeLocalizeSpec({
        voice: { en: { name: voices.Ava }, fi: { name: voices.Nora } },
        narration: { en: { intro: 'Hi' }, fi: { intro: 'Moi' } },
      })
      const markers = buildNarrationMarkers(localize)

      await markers.intro()

      expect(voiceOf('en')).toBe(voices.Ava)
      expect(voiceOf('fi')).toBe(voices.Nora)
    })

    it('lets a per-cue voice override the per-language voice', async () => {
      const localize = normalizeLocalizeSpec({
        voice: { name: voices.Ava },
        narration: {
          en: { intro: 'Hi' },
          fi: { intro: { cue: 'Moi', voice: { name: voices.Nora } } },
        },
      })
      const markers = buildNarrationMarkers(localize)

      await markers.intro()

      // en falls to the localize voice; fi uses its per-cue override.
      expect(voiceOf('en')).toBe(voices.Ava)
      expect(voiceOf('fi')).toBe(voices.Nora)
    })

    it('falls back to the config default voice when localize has none', async () => {
      const localize = normalizeLocalizeSpec({
        narration: { en: { intro: 'Hi' } },
      })
      const markers = buildNarrationMarkers(localize, { name: voices.Ava })

      await markers.intro()

      expect(voiceOf('en')).toBe(voices.Ava)
    })

    it('falls back to a built-in default voice when nothing is configured', async () => {
      const localize = normalizeLocalizeSpec({
        narration: { en: { intro: 'Hi' } },
      })
      const markers = buildNarrationMarkers(localize)

      await markers.intro()

      expect(voiceOf('en')).toBe(voices.Sophie)
    })
  })
})
