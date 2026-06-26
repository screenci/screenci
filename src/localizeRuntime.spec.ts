import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  buildNarrationMarkers,
  buildTextDeclaration,
  buildTextValues,
  narrationVoiceConfigFromRenderOptions,
} from './localizeRuntime.js'
import { normalizeFeature } from './declare.js'
import type { LocalizeNarrationValue } from './localize.js'
import { setActiveCueRecorder, setSleepFn } from './cue.js'
import { NOOP_EVENT_RECORDER, type IEventRecorder } from './events.js'
import { voices } from './voices.js'

const text = (arg: Parameters<typeof normalizeFeature<string>>[1]) =>
  normalizeFeature<string>('text', arg)
const narr = (
  arg: Parameters<typeof normalizeFeature<LocalizeNarrationValue>>[1]
) => normalizeFeature<LocalizeNarrationValue>('narration', arg)

describe('narrationVoiceConfigFromRenderOptions', () => {
  it('returns undefined for undefined render options or deferred studio render options', () => {
    expect(
      narrationVoiceConfigFromRenderOptions(undefined, false)
    ).toBeUndefined()
    expect(
      narrationVoiceConfigFromRenderOptions(
        { narration: { voice: { name: voices.Ava } } },
        true
      )
    ).toBeUndefined()
  })

  it('returns undefined when there is no narration block', () => {
    expect(narrationVoiceConfigFromRenderOptions({}, false)).toBeUndefined()
  })

  it('extracts the global default voice', () => {
    const config = narrationVoiceConfigFromRenderOptions(
      { narration: { voice: { name: voices.Ava } } },
      false
    )
    expect(config).toEqual({ name: voices.Ava })
  })
})

describe('buildTextValues', () => {
  it('returns the active language values for seeded text', () => {
    const t = text({ en: { heading: 'Hi' }, fi: { heading: 'Moi' } })
    expect(buildTextValues(t, 'fi')).toEqual({ heading: 'Moi' })
  })

  it('falls back to the shared value when a language omits a field', () => {
    const t = text({ default: { heading: 'Hi' }, fi: { other: 'Muu' } })
    expect(buildTextValues(t, 'fi')).toEqual({ heading: 'Hi', other: 'Muu' })
  })

  it('returns an empty string per field for unset studio-managed (array) text', () => {
    const t = text(['heading'])
    expect(buildTextValues(t, 'en', null)).toEqual({ heading: '' })
  })

  it('returns an empty object when there is no text', () => {
    expect(buildTextValues(undefined, 'en')).toEqual({})
  })

  it('lets a Studio override win over the seed for the active language', () => {
    const t = text({ en: { heading: 'Seed' }, fi: { heading: 'Siemen' } })
    const overrides = { fi: { heading: 'Studio FI' } }
    expect(buildTextValues(t, 'fi', overrides)).toEqual({
      heading: 'Studio FI',
    })
    expect(buildTextValues(t, 'en', overrides)).toEqual({ heading: 'Seed' })
  })

  it('resolves Studio-managed text from overrides', () => {
    const t = text(['heading'])
    expect(
      buildTextValues(t, 'en', { en: { heading: 'From Studio' } })
    ).toEqual({ heading: 'From Studio' })
    expect(buildTextValues(t, 'en', null)).toEqual({ heading: '' })
  })
})

describe('buildTextDeclaration', () => {
  it('declares fields with only the active language seed', () => {
    const t = text({ en: { heading: 'Hi' }, fi: { heading: 'Moi' } })
    expect(buildTextDeclaration(t, 'fi')).toEqual({
      fields: ['heading'],
      studioFields: [],
      seed: { fi: { heading: 'Moi' } },
    })
  })

  it('seeds a content-major (shared) field under the active language', () => {
    const t = text({ heading: 'Hi' })
    expect(buildTextDeclaration(t, 'en')).toEqual({
      fields: ['heading'],
      studioFields: [],
      seed: { en: { heading: 'Hi' } },
    })
  })

  it('declares a studio-managed (array) field with no seed', () => {
    const t = text(['heading'])
    expect(buildTextDeclaration(t, 'en')).toEqual({
      fields: ['heading'],
      studioFields: ['heading'],
    })
  })

  it('omits the seed when the language is undefined (shared mode)', () => {
    const t = text({ en: { heading: 'Hi' } })
    expect(buildTextDeclaration(t, undefined)).toEqual({
      fields: ['heading'],
      studioFields: [],
    })
  })

  it('returns null when there is no text', () => {
    expect(buildTextDeclaration(null, 'en')).toBeNull()
    expect(buildTextDeclaration(undefined, 'en')).toBeNull()
  })
})

describe('buildNarrationMarkers', () => {
  it('returns markers keyed by the declared cue names', () => {
    const n = narr({
      en: { intro: 'Hi', outro: 'Bye' },
      fi: { intro: 'Moi', outro: 'Hei' },
    })
    const markers = buildNarrationMarkers(n, ['en', 'fi'])
    expect(Object.keys(markers).sort()).toEqual(['intro', 'outro'])
    expect(typeof markers.intro).toBe('function')
  })

  it('builds studio (array) narration cues', () => {
    const markers = buildNarrationMarkers(narr(['alert']), ['en'])
    expect(Object.keys(markers)).toEqual(['alert'])
  })

  it('returns an empty object when there is no narration', () => {
    expect(buildNarrationMarkers(undefined, ['en'])).toEqual({})
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

    it('uses the per-language voice map', async () => {
      const markers = buildNarrationMarkers(
        narr({ en: { intro: 'Hi' }, fi: { intro: 'Moi' } }),
        ['en', 'fi'],
        undefined,
        { en: { name: voices.Ava }, fi: { name: voices.Nora } }
      )
      await markers.intro()
      expect(voiceOf('en')).toBe(voices.Ava)
      expect(voiceOf('fi')).toBe(voices.Nora)
    })

    it('lets a per-cue voice override the per-language voice', async () => {
      const markers = buildNarrationMarkers(
        narr({
          en: { intro: 'Hi' },
          fi: { intro: { cue: 'Moi', voice: { name: voices.Nora } } },
        }),
        ['en', 'fi'],
        undefined,
        { en: { name: voices.Ava }, fi: { name: voices.Ava } }
      )
      await markers.intro()
      expect(voiceOf('en')).toBe(voices.Ava)
      expect(voiceOf('fi')).toBe(voices.Nora)
    })

    it('falls back to the config default voice when none is configured per language', async () => {
      const markers = buildNarrationMarkers(
        narr({ en: { intro: 'Hi' } }),
        ['en'],
        {
          name: voices.Ava,
        }
      )
      await markers.intro()
      expect(voiceOf('en')).toBe(voices.Ava)
    })

    it('falls back to a built-in default voice when nothing is configured', async () => {
      const markers = buildNarrationMarkers(narr({ en: { intro: 'Hi' } }), [
        'en',
      ])
      await markers.intro()
      expect(voiceOf('en')).toBe(voices.Sophie)
    })
  })

  describe('per-cue synthesis language', () => {
    let recorder: IEventRecorder
    let cueStarts: Array<{ translations?: Record<string, unknown> }>

    beforeEach(() => {
      cueStarts = []
      recorder = {
        ...NOOP_EVENT_RECORDER,
        addCueStart: vi.fn(
          (_t: string, _name: string, _c: unknown, translations: never) => {
            cueStarts.push({ translations })
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

    const translationOf = (lang: string): { text: string; language?: string } =>
      (
        cueStarts[0]?.translations as Record<
          string,
          { text: string; language?: string }
        >
      )[lang]

    it('records a per-cue language when it differs from the version language', async () => {
      const markers = buildNarrationMarkers(
        narr({
          en: { tagline: 'Just do it' },
          fi: { tagline: { cue: 'Just do it', language: 'en' } },
        }),
        ['en', 'fi']
      )
      await markers.tagline()
      expect(translationOf('fi')).toMatchObject({
        text: 'Just do it',
        language: 'en',
      })
      expect(translationOf('en').language).toBeUndefined()
    })

    it('omits the language field when it equals the version language', async () => {
      const markers = buildNarrationMarkers(
        narr({ fi: { intro: { cue: 'Moi', language: 'fi' } } }),
        ['fi']
      )
      await markers.intro()
      expect(translationOf('fi').language).toBeUndefined()
    })
  })
})
