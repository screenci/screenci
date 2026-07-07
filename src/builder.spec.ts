import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  expandRegistrations,
  createVideoBuilder,
  VIDEO_FEATURES,
  type BuilderState,
  type RecordingLocalize,
} from './builder.js'
import { normalizeFeature } from './declare.js'
import type { LocalizeNarrationValue } from './localize.js'

function state(partial: Partial<BuilderState> = {}): BuilderState {
  return {
    narration: null,
    values: null,
    overlays: null,
    audio: null,
    recordOptions: null,
    renderOptions: null,
    recordingLocalize: null,
    eachVariants: null,
    features: VIDEO_FEATURES,
    ...partial,
  }
}

const narration = (
  arg: Parameters<typeof normalizeFeature<LocalizeNarrationValue>>[1]
) => normalizeFeature<LocalizeNarrationValue>('narration', arg)

const langs = (rl: RecordingLocalize): Partial<BuilderState> => ({
  recordingLocalize: rl,
})

describe('expandRegistrations', () => {
  it('produces a single language-agnostic test pinned to en-US when not localized', () => {
    const regs = expandRegistrations({
      baseTitle: 'Demo',
      state: state(),
      requestedLanguages: null,
    })
    expect(regs).toHaveLength(1)
    // The implicit default records one round; it stays language-agnostic (no `[en]`
    // tag) but pins the browser locale to en-US for deterministic capture.
    expect(regs[0]).toMatchObject({
      leafTitle: 'Demo',
      videoName: 'Demo',
      language: null,
      locale: 'en-US',
    })
  })

  it('infers one pass per language from narration keys, with locale and grouped name', () => {
    const regs = expandRegistrations({
      baseTitle: 'Tutorial',
      state: state({
        narration: narration({ en: { intro: 'Hi' }, fi: { intro: 'Moi' } }),
      }),
      requestedLanguages: null,
    })
    expect(regs.map((r) => [r.leafTitle, r.language, r.locale])).toEqual([
      ['Tutorial [en]', 'en', 'en-US'],
      ['Tutorial [fi]', 'fi', 'fi-FI'],
    ])
    expect(regs.every((r) => r.videoName === 'Tutorial')).toBe(true)
  })

  it('does not set a locale when browserLocale is false', () => {
    const regs = expandRegistrations({
      baseTitle: 'T',
      state: state(
        langs({
          languages: 'studio',
          studioSeed: ['en', 'fi'],
          browserLocale: false,
        })
      ),
      requestedLanguages: null,
    })
    expect(regs.every((r) => r.locale === null)).toBe(true)
    expect(regs.map((r) => r.language)).toEqual(['en', 'fi'])
  })

  it('records one shared pass that carries every language', () => {
    const regs = expandRegistrations({
      baseTitle: 'Tour',
      state: state(
        langs({ languages: 'studio', studioSeed: ['en', 'fi'], mode: 'shared' })
      ),
      requestedLanguages: null,
    })
    expect(regs).toHaveLength(1)
    expect(regs[0]).toMatchObject({
      leafTitle: 'Tour',
      language: null,
      locale: null,
    })
  })

  it('infers the language set for a shared config that omits languages', () => {
    const regs = expandRegistrations({
      baseTitle: 'Tour',
      state: state({
        narration: narration({ en: { intro: 'Hi' }, fi: { intro: 'Moi' } }),
        // video.languages({ mode: 'shared' }): languages inferred from narration.
        ...langs({ languages: 'studio', mode: 'shared' }),
      }),
      requestedLanguages: null,
    })
    expect(regs).toHaveLength(1)
    expect(regs[0]).toMatchObject({ leafTitle: 'Tour', language: null })
    expect(regs[0]?.recordingLocalize.mode).toBe('shared')
    expect([...(regs[0]?.recordingLocalize.languages ?? [])].sort()).toEqual([
      'en',
      'fi',
    ])
  })

  it('records a single pending pass for a studio-owned set with none selected', () => {
    const regs = expandRegistrations({
      baseTitle: 'Pending',
      state: state(langs({ languages: 'studio' })),
      requestedLanguages: null,
    })
    expect(regs).toHaveLength(1)
    expect(regs[0]).toMatchObject({ leafTitle: 'Pending', language: null })
    expect(regs[0]?.recordingLocalize.pending).toBe(true)
  })

  it('renders a studio-seeded set until the web app changes it', () => {
    const regs = expandRegistrations({
      baseTitle: 'Seeded',
      // video.languages(['en', 'fi']) -> web-owned, seeded with en + fi.
      state: state(langs({ languages: 'studio', studioSeed: ['en', 'fi'] })),
      requestedLanguages: null,
    })
    expect(regs.map((r) => [r.leafTitle, r.language])).toEqual([
      ['Seeded [en]', 'en'],
      ['Seeded [fi]', 'fi'],
    ])
    expect(regs.every((r) => r.recordingLocalize.studioOwned)).toBe(true)
    expect(regs.every((r) => r.recordingLocalize.pending)).toBe(false)
  })

  it('merges a web injection with the seed (the web only adds languages)', () => {
    const regs = expandRegistrations({
      baseTitle: 'Seeded',
      state: state(langs({ languages: 'studio', studioSeed: ['en', 'fi'] })),
      // The web app has 'de' selected; the seed keeps en + fi, so all three record.
      requestedLanguages: ['de'],
    })
    expect(regs.map((r) => r.language).sort()).toEqual(['de', 'en', 'fi'])
    expect(regs.every((r) => r.recordingLocalize.studioOwned)).toBe(true)
  })

  it('records code-defined feature languages for a studio-owned set on first run', () => {
    const regs = expandRegistrations({
      baseTitle: 'Tour',
      // languages() with no web selection, but narration defines en + fi:
      // both record (merged in) even before anything is configured in the web.
      state: state({
        ...langs({ languages: 'studio' }),
        narration: narration({ en: { intro: 'Hi' }, fi: { intro: 'Moi' } }),
      }),
      requestedLanguages: null,
    })
    expect(regs.map((r) => r.language).sort()).toEqual(['en', 'fi'])
    expect(regs.every((r) => r.recordingLocalize.studioOwned)).toBe(true)
    expect(regs.every((r) => r.recordingLocalize.pending)).toBe(false)
  })

  it('combines a studio-owned set with shared mode (one web-owned pass)', () => {
    const regs = expandRegistrations({
      baseTitle: 'Tour',
      // The object form is how a declared set combines with options like shared
      // mode; `.languages()` with no argument defaults to per-language mode.
      state: state(langs({ languages: 'studio', mode: 'shared' })),
      requestedLanguages: ['en', 'fi'],
    })
    expect(regs).toHaveLength(1)
    expect(regs[0]).toMatchObject({ leafTitle: 'Tour', language: null })
    expect(regs[0]?.recordingLocalize.studioOwned).toBe(true)
    expect(regs[0]?.recordingLocalize.mode).toBe('shared')
  })

  it('unions a declared set with the --languages selection (web only adds)', () => {
    const regs = expandRegistrations({
      baseTitle: 'T',
      state: state(
        langs({ languages: 'studio', studioSeed: ['en', 'fi', 'de'] })
      ),
      requestedLanguages: ['fi'],
    })
    expect(regs.map((r) => r.language).sort()).toEqual(['de', 'en', 'fi'])
    expect(regs.every((r) => r.recordingLocalize.studioOwned)).toBe(true)
  })

  it('keeps the full inferred set in availableLanguages under a --languages filter', () => {
    // Only fi is rendered, but the recorded availableLanguages stays the full
    // code-defined set so the app does not gray out en/de as removed-from-code.
    const regs = expandRegistrations({
      baseTitle: 'T',
      state: state({
        narration: narration({
          en: { intro: 'Hi' },
          fi: { intro: 'Moi' },
          de: { intro: 'Hallo' },
        }),
      }),
      requestedLanguages: ['fi'],
    })
    expect(regs.map((r) => r.language)).toEqual(['fi'])
    expect(
      [...(regs[0]?.recordingLocalize.availableLanguages ?? [])].sort()
    ).toEqual(['de', 'en', 'fi'])
  })

  it('registers nothing when the filter excludes every inferred language', () => {
    const regs = expandRegistrations({
      baseTitle: 'T',
      state: state({
        narration: narration({ en: { intro: 'Hi' }, fi: { intro: 'Moi' } }),
      }),
      requestedLanguages: ['de'],
    })
    expect(regs).toHaveLength(0)
  })

  it('takes the cartesian product of each-variants and languages', () => {
    const regs = expandRegistrations({
      baseTitle: 'Landing',
      state: state({
        ...langs({ languages: 'studio', studioSeed: ['en', 'fi'] }),
        eachVariants: [{ key: 'mobile' }, { key: 'desktop' }],
      }),
      requestedLanguages: null,
    })
    expect(regs.map((r) => r.leafTitle)).toEqual([
      'Landing mobile [en]',
      'Landing mobile [fi]',
      'Landing desktop [en]',
      'Landing desktop [fi]',
    ])
    expect(regs.map((r) => r.videoName)).toEqual([
      'Landing mobile',
      'Landing mobile',
      'Landing desktop',
      'Landing desktop',
    ])
  })
})

/** A registration sink that records the Playwright calls the builder makes. */
function createTestSink() {
  const calls: {
    describes: string[]
    uses: Record<string, unknown>[]
    tests: string[]
  } = { describes: [], uses: [], tests: [] }

  const only: string[] = []
  const test = ((title: string) => {
    calls.tests.push(title)
  }) as never as Parameters<typeof createVideoBuilder>[0]

  ;(test as { describe: (t: string, fn: () => void) => void }).describe = (
    title,
    fn
  ) => {
    calls.describes.push(title)
    fn()
  }
  ;(test as { use: (o: Record<string, unknown>) => void }).use = (options) => {
    calls.uses.push(options)
  }
  for (const modifier of ['only', 'skip', 'fixme', 'fail'] as const) {
    ;(test as unknown as Record<string, (t: string) => void>)[modifier] = (
      title
    ) => {
      calls.tests.push(title)
      if (modifier === 'only') only.push(title)
    }
  }

  return { test, calls, only }
}

describe('createVideoBuilder registration', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  afterEach(() => warn.mockClear())

  it('registers one describe+test per language with scoped use options', () => {
    const { test, calls } = createTestSink()
    const builder = createVideoBuilder(test)
    builder.narration({ en: { intro: 'Hi' }, fi: { intro: 'Moi' } })(
      'Tutorial',
      async () => {}
    )

    expect(calls.tests).toEqual(['Tutorial [en]', 'Tutorial [fi]'])
    expect(calls.uses[0]).toMatchObject({
      locale: 'en-US',
      _screenciLanguage: 'en',
      _screenciVideoName: 'Tutorial',
    })
    expect(calls.uses[0]?._screenciRecordingLocalize).toMatchObject({
      languages: ['en', 'fi'],
    })
  })

  it('captures the calling script as _screenciSourceFile so asset paths resolve against it', () => {
    const { test, calls } = createTestSink()
    createVideoBuilder(test)('Plain', async () => {})
    expect(calls.uses[0]?._screenciSourceFile).toMatch(/builder\.spec\.ts$/)
  })

  it('leaves _screenciLanguage undefined for shared mode', () => {
    const { test, calls } = createTestSink()
    createVideoBuilder(test)
      .narration({ en: { intro: 'Hi' }, fi: { intro: 'Moi' } })
      .languages({ languages: ['en', 'fi'], mode: 'shared' })(
      'Tour',
      async () => {}
    )
    expect(calls.tests).toEqual(['Tour'])
    expect(calls.uses[0]?._screenciLanguage).toBeUndefined()
    expect(calls.uses[0]).not.toHaveProperty('locale')
  })

  it('languages({ languages, mode }) is web-owned and seeded with the config', () => {
    const { test, calls } = createTestSink()
    createVideoBuilder(test)
      .narration({ en: { intro: 'Hi' } })
      .languages({ languages: ['en', 'fi'], mode: 'shared' })(
      'Tour',
      async () => {}
    )
    expect(calls.tests).toEqual(['Tour'])
    expect(calls.uses[0]?._screenciRecordingLocalize).toMatchObject({
      studioOwned: true,
      mode: 'shared',
      languages: ['en', 'fi'],
    })
  })

  it('languages({ mode }) is web-owned with no seeded set (mode only)', () => {
    const { test, calls } = createTestSink()
    createVideoBuilder(test).languages({ mode: 'shared' })(
      'Tour',
      async () => {}
    )
    // Web owns the set (none seeded => pending), shared mode is the seed. 'mode'
    // is a config key, never treated as a language.
    expect(calls.uses[0]?._screenciRecordingLocalize).toMatchObject({
      studioOwned: true,
      pending: true,
      mode: 'shared',
      languages: [],
    })
  })

  it('supports the (title, details, body) signature', () => {
    const { test, calls } = createTestSink()
    createVideoBuilder(test).values(['h']).languages(['en'])(
      'Tagged',
      { tag: '@critical' },
      async () => {}
    )
    expect(calls.tests).toEqual(['Tagged [en]'])
  })

  it('warns and registers nothing when the filter excludes all languages', () => {
    const original = process.env.SCREENCI_LANGUAGES
    process.env.SCREENCI_LANGUAGES = 'de'
    try {
      const { test, calls } = createTestSink()
      // Inferred (per-feature) sets still intersect with the filter; a declared
      // `.languages(...)` set would union instead.
      createVideoBuilder(test).narration({
        en: { intro: 'Hi' },
        fi: { intro: 'Moi' },
      })('T', async () => {})
      expect(calls.tests).toEqual([])
      // Warns about the skipped video (plus the unused en/fi narration values).
      expect(warn).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining('"T" was skipped')
      )
    } finally {
      if (original === undefined) delete process.env.SCREENCI_LANGUAGES
      else process.env.SCREENCI_LANGUAGES = original
    }
  })

  it('records code languages for a studio-owned set, so no unused warning fires', () => {
    const { test, calls } = createTestSink()
    // languages({ mode }) is web-owned; the narration languages are merged
    // into the recorded set, so they are genuinely used (no "unused" warning).
    createVideoBuilder(test)
      .narration({ en: { intro: 'Hi' }, fi: { intro: 'Moi' } })
      .languages({ mode: 'shared' })('Tour', async () => {})
    expect(warn).not.toHaveBeenCalled()
    expect(calls.uses[0]?._screenciRecordingLocalize).toMatchObject({
      studioOwned: true,
      mode: 'shared',
      languages: ['en', 'fi'],
    })
  })

  it('rejects duplicate each-variant keys', () => {
    const { test } = createTestSink()
    expect(() =>
      createVideoBuilder(test).each([{ key: 'a' }, { key: 'a' }])
    ).toThrow(/Duplicate/)
  })

  it('throws when a screenshot declares narration (silent medium)', () => {
    const { test } = createTestSink()
    expect(() =>
      createVideoBuilder(test, new Set(['values', 'overlays'])).narration(['x'])
    ).toThrow(/not available for this medium/)
  })

  it('registers per-language passes with test.only via .only', () => {
    const { test, calls, only } = createTestSink()
    createVideoBuilder(test)
      .narration({ en: { intro: 'Hi' }, fi: { intro: 'Moi' } })
      .only('Focused', async () => {})
    expect(calls.tests).toEqual(['Focused [en]', 'Focused [fi]'])
    expect(only).toEqual(['Focused [en]', 'Focused [fi]'])
  })

  it('carries a flat recordOptions/renderOptions bag onto every pass', () => {
    const { test, calls } = createTestSink()
    createVideoBuilder(test)
      .recordOptions({ aspectRatio: '9:16', quality: '720p' })
      .renderOptions({ narration: { size: 0.4 } })
      .narration({ en: { intro: 'Hi' }, fi: { intro: 'Moi' } })(
      'T',
      async () => {}
    )
    for (const use of calls.uses) {
      expect(use._screenciRecordOptions).toEqual({
        aspectRatio: '9:16',
        quality: '720p',
      })
      expect(use._screenciRenderOptions).toEqual({ narration: { size: 0.4 } })
    }
  })

  it('merges the language-major default under each per-language override', () => {
    const { test, calls } = createTestSink()
    createVideoBuilder(test)
      .recordOptions({
        default: { aspectRatio: '16:9', quality: '1080p' },
        fi: { aspectRatio: '4:3' },
      })
      .narration({ en: { intro: 'Hi' }, fi: { intro: 'Moi' } })(
      'T',
      async () => {}
    )
    expect(calls.tests).toEqual(['T [en]', 'T [fi]'])
    expect(calls.uses[0]?._screenciRecordOptions).toEqual({
      aspectRatio: '16:9',
      quality: '1080p',
    })
    expect(calls.uses[1]?._screenciRecordOptions).toEqual({
      aspectRatio: '4:3',
      quality: '1080p',
    })
  })

  it('deep-merges renderOptions groups per language (voice override keeps size)', () => {
    const { test, calls } = createTestSink()
    createVideoBuilder(test)
      .renderOptions({
        default: { narration: { size: 0.3, corner: 'bottom-right' } },
        fi: { narration: { size: 0.5 } },
      })
      .narration({ en: { intro: 'Hi' }, fi: { intro: 'Moi' } })(
      'T',
      async () => {}
    )
    expect(calls.uses[0]?._screenciRenderOptions).toEqual({
      narration: { size: 0.3, corner: 'bottom-right' },
    })
    expect(calls.uses[1]?._screenciRenderOptions).toEqual({
      narration: { size: 0.5, corner: 'bottom-right' },
    })
  })

  it('infers the language set from recordOptions language keys', () => {
    const { test, calls } = createTestSink()
    createVideoBuilder(test).recordOptions({
      default: { quality: '1080p' },
      en: { aspectRatio: '16:9' },
      fi: { aspectRatio: '9:16' },
    })('T', async () => {})
    expect(calls.tests).toEqual(['T [en]', 'T [fi]'])
  })

  it('passes a flat recordOptions bag through for the pass', () => {
    const { test, calls } = createTestSink()
    createVideoBuilder(test).recordOptions({ aspectRatio: '9:16' })(
      'T',
      async () => {}
    )
    expect(calls.uses[0]?._screenciRecordOptions).toEqual({
      aspectRatio: '9:16',
    })
  })

  it('merges a per-language override over the default base', () => {
    const { test, calls } = createTestSink()
    createVideoBuilder(test)
      .recordOptions({
        default: { quality: '1080p' },
        fi: { aspectRatio: '4:3' },
      })
      .narration({ en: { intro: 'Hi' }, fi: { intro: 'Moi' } })(
      'T',
      async () => {}
    )
    expect(calls.uses[1]?._screenciRecordOptions).toEqual({
      quality: '1080p',
      aspectRatio: '4:3',
    })
  })

  it('applies the each-variant recordOptions patch over the builder options', () => {
    const { test, calls } = createTestSink()
    createVideoBuilder(test)
      .recordOptions({ aspectRatio: '16:9', quality: '1080p' })
      .each([{ key: 'mobile', recordOptions: { aspectRatio: '9:16' } }])(
      'Landing',
      async () => {}
    )
    expect(calls.uses[0]?._screenciRecordOptions).toEqual({
      aspectRatio: '9:16',
      quality: '1080p',
    })
  })

  it('throws when per-language options are set with shared mode', () => {
    const { test } = createTestSink()
    expect(() =>
      createVideoBuilder(test)
        .recordOptions({ default: {}, fi: { aspectRatio: '4:3' } })
        .languages({ languages: ['en', 'fi'], mode: 'shared' })(
        'T',
        async () => {}
      )
    ).toThrow(/per-language/)
  })
})
