import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  buildNarrationMarkers,
  buildValuesDeclaration,
  buildValues,
  narrationVoiceConfigFromRenderOptions,
} from './localizeRuntime.js'
import { normalizeFeature } from './declare.js'
import type { LocalizeNarrationValue } from './localize.js'
import { setActiveCueRecorder, setSleepFn } from './cue.js'
import { NOOP_EVENT_RECORDER, type IEventRecorder } from './events.js'
import { voices } from './voices.js'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { createHash } from 'crypto'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  assetCandidatePaths,
  hashAssetFile,
  resetAssetHashCache,
} from './assetHash.js'

const text = (arg: Parameters<typeof normalizeFeature<string>>[1]) =>
  normalizeFeature<string>('text', arg)
const narr = (
  arg: Parameters<typeof normalizeFeature<LocalizeNarrationValue>>[1]
) => normalizeFeature<LocalizeNarrationValue>('narration', arg)

describe('narrationVoiceConfigFromRenderOptions', () => {
  it('returns undefined for undefined render options', () => {
    expect(narrationVoiceConfigFromRenderOptions(undefined)).toBeUndefined()
  })

  it('returns undefined when there is no narration block or voice', () => {
    expect(narrationVoiceConfigFromRenderOptions({})).toBeUndefined()
    expect(
      narrationVoiceConfigFromRenderOptions({ narration: {} })
    ).toBeUndefined()
  })

  it('extracts the global default voice', () => {
    const config = narrationVoiceConfigFromRenderOptions({
      narration: { voice: { name: voices.Ava } },
    })
    expect(config).toEqual({ name: voices.Ava })
  })
})

describe('buildValues', () => {
  it('returns the active language values for seeded text', () => {
    const t = text({ en: { heading: 'Hi' }, fi: { heading: 'Moi' } })
    expect(buildValues(t, 'fi')).toEqual({ heading: 'Moi' })
  })

  it('falls back to the shared value when a language omits a field', () => {
    const t = text({ default: { heading: 'Hi' }, fi: { other: 'Muu' } })
    expect(buildValues(t, 'fi')).toEqual({ heading: 'Hi', other: 'Muu' })
  })

  it('returns an empty string per field for unset editor-owned (array) text', () => {
    const t = text(['heading'])
    expect(buildValues(t, 'en', null)).toEqual({ heading: '' })
  })

  it('falls back to the code seed for an unset field, but a web edit wins', () => {
    const t = text({ heading: 'Hi' })
    // No override: the seed renders, so the first capture is not blank.
    expect(buildValues(t, 'en', null)).toEqual({ heading: 'Hi' })
    // A Studio edit overrides the seed.
    expect(buildValues(t, 'en', { en: { heading: 'Edited' } })).toEqual({
      heading: 'Edited',
    })
  })

  it('returns an empty object when there is no text', () => {
    expect(buildValues(undefined, 'en')).toEqual({})
  })

  it('lets a Studio override win over the seed for the active language', () => {
    const t = text({ en: { heading: 'Seed' }, fi: { heading: 'Siemen' } })
    const overrides = { fi: { heading: 'Studio FI' } }
    expect(buildValues(t, 'fi', overrides)).toEqual({
      heading: 'Studio FI',
    })
    expect(buildValues(t, 'en', overrides)).toEqual({ heading: 'Seed' })
  })

  it('resolves editor-owned text from overrides', () => {
    const t = text(['heading'])
    expect(buildValues(t, 'en', { en: { heading: 'From Studio' } })).toEqual({
      heading: 'From Studio',
    })
    expect(buildValues(t, 'en', null)).toEqual({ heading: '' })
  })
})

describe('buildValuesDeclaration', () => {
  it('declares fields with only the active language seed', () => {
    const t = text({ en: { heading: 'Hi' }, fi: { heading: 'Moi' } })
    expect(buildValuesDeclaration(t, 'fi')).toEqual({
      fields: ['heading'],
      studioFields: [],
      seed: { fi: { heading: 'Moi' } },
    })
  })

  it('seeds a content-major (shared) field under the active language', () => {
    const t = text({ heading: 'Hi' })
    expect(buildValuesDeclaration(t, 'en')).toEqual({
      fields: ['heading'],
      studioFields: [],
      seed: { en: { heading: 'Hi' } },
    })
  })

  it('declares an editor-owned (array) field with no seed', () => {
    const t = text(['heading'])
    expect(buildValuesDeclaration(t, 'en')).toEqual({
      fields: ['heading'],
      studioFields: ['heading'],
    })
  })

  it('merges the default seed with the active language override in the seed', () => {
    // Language-major with a default: the active language seed merges the shared
    // fallback with the per-language values; a web edit later wins over the seed.
    const t = text({ default: { heading: 'Hi' }, fi: { sub: 'Ala' } })
    expect(buildValuesDeclaration(t, 'fi')).toEqual({
      fields: ['heading', 'sub'],
      studioFields: [],
      seed: { fi: { heading: 'Hi', sub: 'Ala' } },
    })
  })

  it('omits the seed when the language is undefined (shared mode)', () => {
    const t = text({ en: { heading: 'Hi' } })
    expect(buildValuesDeclaration(t, undefined)).toEqual({
      fields: ['heading'],
      studioFields: [],
    })
  })

  it('returns null when there is no text', () => {
    expect(buildValuesDeclaration(null, 'en')).toBeNull()
    expect(buildValuesDeclaration(undefined, 'en')).toBeNull()
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

  it('builds editor-owned (array) narration cues', () => {
    const markers = buildNarrationMarkers(narr(['alert']), ['en'])
    expect(Object.keys(markers)).toEqual(['alert'])
  })

  it('returns an empty object when there is no narration', () => {
    expect(buildNarrationMarkers(undefined, ['en'])).toEqual({})
  })

  it('pre-warms file-cue media hashes when an anchor file is given', async () => {
    resetAssetHashCache()
    const dir = await mkdtemp(join(tmpdir(), 'screenci-narr-prewarm-'))
    try {
      const media = join(dir, 'pitch.mov')
      await writeFile(media, 'pitch-audio')
      const anchor = join(dir, 'video.screenci.ts')

      // Building with an anchor file should pre-warm the file cue's media.
      buildNarrationMarkers(
        narr({ en: { pitch: { path: media } } }),
        ['en'],
        undefined,
        {},
        anchor
      )
      // Let the fire-and-forget read settle (the same cached promise).
      const warmed = await hashAssetFile(assetCandidatePaths(media, anchor))
      expect(warmed).toBe(
        createHash('sha256').update('pitch-audio').digest('hex')
      )

      // Changing the file must not change the result: the build pre-warmed it,
      // so a later lookup is served from cache without re-reading.
      await writeFile(media, 'different-content')
      expect(await hashAssetFile(assetCandidatePaths(media, anchor))).toBe(
        warmed
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
      resetAssetHashCache()
    }
  })

  it('does not pre-warm when no anchor file is given', async () => {
    resetAssetHashCache()
    const dir = await mkdtemp(join(tmpdir(), 'screenci-narr-noprewarm-'))
    try {
      const media = join(dir, 'pitch.mov')
      await writeFile(media, 'first')
      // No anchor: the build must not warm the cache.
      buildNarrationMarkers(narr({ en: { pitch: { path: media } } }), ['en'])
      await Promise.resolve()
      // A fresh hash reads the current (changed) content, proving no warm entry.
      await writeFile(media, 'second')
      expect(await hashAssetFile(assetCandidatePaths(media, null))).toBe(
        createHash('sha256').update('second').digest('hex')
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
      resetAssetHashCache()
    }
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
      expect(voiceOf('en')).toBe(voices.Ava)
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

describe('code-seeded vs blank editor-owned narration cues', () => {
  let cueStarts: Array<{
    name: string
    translations?: Record<string, unknown>
    studio?: boolean
  }>
  let studioCueStarts: string[]
  let recorder: IEventRecorder

  beforeEach(() => {
    cueStarts = []
    studioCueStarts = []
    recorder = {
      ...NOOP_EVENT_RECORDER,
      addCueStart: vi.fn(
        (
          _t: string,
          name: string,
          _c: unknown,
          translations: never,
          _v: unknown,
          _u: unknown,
          studio?: boolean
        ) => {
          cueStarts.push({ name, translations, studio })
        }
      ),
      addStudioCueStart: vi.fn((name: string) => {
        studioCueStarts.push(name)
      }),
      addCueEnd: vi.fn(),
    }
    setSleepFn(() => {})
    setActiveCueRecorder(recorder)
  })

  afterEach(() => {
    setActiveCueRecorder(NOOP_EVENT_RECORDER)
    setSleepFn(() => {})
  })

  it('emits code seed translations as regular cue starts (web may still edit)', async () => {
    const markers = buildNarrationMarkers(
      narr({ en: { intro: 'Hi' }, fi: { intro: 'Moi' } }),
      ['en', 'fi']
    )
    await markers.intro()
    expect(studioCueStarts).toEqual([])
    expect(cueStarts).toHaveLength(1)
    expect(cueStarts[0]?.studio).toBe(false)
    expect(Object.keys(cueStarts[0]?.translations ?? {}).sort()).toEqual([
      'en',
      'fi',
    ])
  })

  it('emits a text-less studio cue for a blank array declaration', async () => {
    const markers = buildNarrationMarkers(narr(['intro']), ['en'])
    await markers.intro()
    expect(cueStarts).toEqual([])
    expect(studioCueStarts).toEqual(['intro'])
  })
})
