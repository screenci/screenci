import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  buildNarrationMarkers,
  buildTextDeclaration,
  buildTextValues,
  narrationVoiceConfigFromRenderOptions,
} from './localizeRuntime.js'
import { normalizeLocalizeSpec } from './localize.js'
import { setActiveCueRecorder, setSleepFn } from './cue.js'
import { NOOP_EVENT_RECORDER, type IEventRecorder } from './events.js'
import { voices } from './voices.js'

describe('narrationVoiceConfigFromRenderOptions', () => {
  it('returns undefined for undefined render options or deferred studio render options', () => {
    expect(
      narrationVoiceConfigFromRenderOptions(undefined, false)
    ).toBeUndefined()
    // When render options are deferred to Studio there is no code voice here.
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
    const localize = normalizeLocalizeSpec({
      text: { en: { heading: 'Hi' }, fi: { heading: 'Moi' } },
    })
    expect(buildTextValues(localize, 'fi')).toEqual({ heading: 'Moi' })
  })

  it('returns an empty string per field for unset studio-managed text', () => {
    const localize = normalizeLocalizeSpec({ languages: ['en'] })
    // Studio-managed text field names are passed in from the studio declaration.
    expect(buildTextValues(localize, 'en', null, ['heading'])).toEqual({
      heading: '',
    })
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
    const localize = normalizeLocalizeSpec({ languages: ['en'] })
    expect(
      buildTextValues(localize, 'en', { en: { heading: 'From Studio' } }, [
        'heading',
      ])
    ).toEqual({ heading: 'From Studio' })
    // Empty string (blank, recording succeeds) when no override is provided.
    expect(buildTextValues(localize, 'en', null, ['heading'])).toEqual({
      heading: '',
    })
  })
})

describe('buildTextDeclaration', () => {
  it('declares fields with only the active language seed', () => {
    const localize = normalizeLocalizeSpec({
      text: { en: { heading: 'Hi' }, fi: { heading: 'Moi' } },
    })
    expect(buildTextDeclaration(localize, 'fi')).toEqual({
      fields: ['heading'],
      studioFields: [],
      seed: { fi: { heading: 'Moi' } },
    })
  })

  it('declares a studio-managed field with no seed', () => {
    const localize = normalizeLocalizeSpec({ languages: ['en'] })
    expect(buildTextDeclaration(localize, 'en', ['heading'])).toEqual({
      fields: ['heading'],
      studioFields: ['heading'],
    })
  })

  it('lists seeded and studio fields together, seeding only seeded ones', () => {
    const localize = normalizeLocalizeSpec({
      text: { en: { heading: 'Hi' }, fi: { heading: 'Moi' } },
    })
    // Studio-managed field names come from the studio declaration, appended
    // after the seeded ones.
    const declaration = buildTextDeclaration(localize, 'en', ['cta'])
    expect(declaration?.fields.sort()).toEqual(['cta', 'heading'])
    expect(declaration?.studioFields).toEqual(['cta'])
    expect(declaration?.seed).toEqual({ en: { heading: 'Hi' } })
  })

  it('omits the seed when the language is undefined (shared mode)', () => {
    const localize = normalizeLocalizeSpec({
      mode: 'shared',
      text: { en: { heading: 'Hi' } },
    })
    expect(buildTextDeclaration(localize, undefined)).toEqual({
      fields: ['heading'],
      studioFields: [],
    })
  })

  it('returns null when the spec declares no text', () => {
    const localize = normalizeLocalizeSpec({
      narration: { en: { intro: 'Hi' } },
    })
    expect(buildTextDeclaration(localize, 'en')).toBeNull()
    expect(buildTextDeclaration(undefined, 'en')).toBeNull()
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
      narration: { en: { intro: 'Hi' }, fi: { intro: 'Moi' } },
    })
    // Studio-managed narration cue names come from the studio declaration.
    const markers = buildNarrationMarkers(localize, undefined, ['alert'])
    expect(Object.keys(markers).sort()).toEqual(['alert', 'intro'])
  })

  it('returns an empty object when there is no narration', () => {
    const localize = normalizeLocalizeSpec({ languages: ['en'] })
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
        voice: { en: { name: voices.Ava }, fi: { name: voices.Ava } },
        narration: {
          en: { intro: 'Hi' },
          fi: { intro: { cue: 'Moi', voice: { name: voices.Nora } } },
        },
      })
      const markers = buildNarrationMarkers(localize)

      await markers.intro()

      // en uses its per-language voice; fi uses its per-cue override.
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
      const localize = normalizeLocalizeSpec({
        narration: {
          en: { tagline: 'Just do it' },
          fi: { tagline: { cue: 'Just do it', language: 'en' } },
        },
      })
      const markers = buildNarrationMarkers(localize)

      await markers.tagline()

      // The fi version speaks this cue in English.
      expect(translationOf('fi')).toMatchObject({
        text: 'Just do it',
        language: 'en',
      })
      // en has no override, so no language field is emitted.
      expect(translationOf('en').language).toBeUndefined()
    })

    it('omits the language field when it equals the version language', async () => {
      const localize = normalizeLocalizeSpec({
        narration: { fi: { intro: { cue: 'Moi', language: 'fi' } } },
      })
      const markers = buildNarrationMarkers(localize)

      await markers.intro()

      expect(translationOf('fi').language).toBeUndefined()
    })
  })
})
