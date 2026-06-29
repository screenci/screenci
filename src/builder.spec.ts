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
  it('produces a single language-agnostic test when not localized', () => {
    const regs = expandRegistrations({
      baseTitle: 'Demo',
      state: state(),
      requestedLanguages: null,
    })
    expect(regs).toHaveLength(1)
    expect(regs[0]).toMatchObject({
      leafTitle: 'Demo',
      videoName: 'Demo',
      language: null,
      locale: null,
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
      state: state(langs({ languages: ['en', 'fi'], browserLocale: false })),
      requestedLanguages: null,
    })
    expect(regs.every((r) => r.locale === null)).toBe(true)
    expect(regs.map((r) => r.language)).toEqual(['en', 'fi'])
  })

  it('records one shared pass that carries every language', () => {
    const regs = expandRegistrations({
      baseTitle: 'Tour',
      state: state(langs({ languages: ['en', 'fi'], mode: 'shared' })),
      requestedLanguages: null,
    })
    expect(regs).toHaveLength(1)
    expect(regs[0]).toMatchObject({
      leafTitle: 'Tour',
      language: null,
      locale: null,
    })
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

  it('combines a studio-owned set with shared mode (one web-owned pass)', () => {
    const regs = expandRegistrations({
      baseTitle: 'Tour',
      // The object form is how 'studio' combines with options like shared mode;
      // `.languages('studio')` shorthand defaults to per-language mode.
      state: state(langs({ languages: 'studio', mode: 'shared' })),
      requestedLanguages: ['en', 'fi'],
    })
    expect(regs).toHaveLength(1)
    expect(regs[0]).toMatchObject({ leafTitle: 'Tour', language: null })
    expect(regs[0]?.recordingLocalize.studioOwned).toBe(true)
    expect(regs[0]?.recordingLocalize.mode).toBe('shared')
  })

  it('intersects per-language passes with the --languages filter', () => {
    const regs = expandRegistrations({
      baseTitle: 'T',
      state: state(langs({ languages: ['en', 'fi', 'de'] })),
      requestedLanguages: ['fi'],
    })
    expect(regs.map((r) => r.language)).toEqual(['fi'])
  })

  it('registers nothing when the filter excludes every declared language', () => {
    const regs = expandRegistrations({
      baseTitle: 'T',
      state: state(langs({ languages: ['en', 'fi'] })),
      requestedLanguages: ['de'],
    })
    expect(regs).toHaveLength(0)
  })

  it('takes the cartesian product of each-variants and languages', () => {
    const regs = expandRegistrations({
      baseTitle: 'Landing',
      state: state({
        ...langs({ languages: ['en', 'fi'] }),
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
      createVideoBuilder(test).values(['h']).languages(['en', 'fi'])(
        'T',
        async () => {}
      )
      expect(calls.tests).toEqual([])
      expect(warn).toHaveBeenCalledOnce()
    } finally {
      if (original === undefined) delete process.env.SCREENCI_LANGUAGES
      else process.env.SCREENCI_LANGUAGES = original
    }
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
})
