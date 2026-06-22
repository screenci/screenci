import { describe, it, expect, vi, afterEach } from 'vitest'
import { expandRegistrations, createVideoBuilder } from './builder.js'

describe('expandRegistrations', () => {
  it('produces a single language-agnostic test when no specs are set', () => {
    const regs = expandRegistrations({
      baseTitle: 'Demo',
      languageSpec: null,
      eachVariants: null,
      requestedLanguages: null,
    })
    expect(regs).toHaveLength(1)
    expect(regs[0]).toMatchObject({
      leafTitle: 'Demo',
      videoName: 'Demo',
      language: null,
      locale: null,
      declaredLanguages: [],
    })
  })

  it('registers one pass per language with locale and grouped video name', () => {
    const regs = expandRegistrations({
      baseTitle: 'Tutorial',
      languageSpec: { languages: ['en', 'fi'], mode: 'per-language' },
      eachVariants: null,
      requestedLanguages: null,
    })
    expect(regs).toEqual([
      expect.objectContaining({
        leafTitle: 'Tutorial [en]',
        videoName: 'Tutorial',
        language: 'en',
        locale: 'en-US',
        declaredLanguages: ['en', 'fi'],
      }),
      expect.objectContaining({
        leafTitle: 'Tutorial [fi]',
        videoName: 'Tutorial',
        language: 'fi',
        locale: 'fi-FI',
        declaredLanguages: ['en', 'fi'],
      }),
    ])
  })

  it('honors per-language locale overrides', () => {
    const regs = expandRegistrations({
      baseTitle: 'T',
      languageSpec: {
        languages: ['en'],
        mode: 'per-language',
        locales: { en: 'en-GB' },
      },
      eachVariants: null,
      requestedLanguages: null,
    })
    expect(regs[0]?.locale).toBe('en-GB')
  })

  it('records one shared pass that carries every language', () => {
    const regs = expandRegistrations({
      baseTitle: 'Tour',
      languageSpec: { languages: ['en', 'fi'], mode: 'shared' },
      eachVariants: null,
      requestedLanguages: null,
    })
    expect(regs).toHaveLength(1)
    expect(regs[0]).toMatchObject({
      leafTitle: 'Tour',
      videoName: 'Tour',
      language: null,
      locale: null,
      declaredLanguages: ['en', 'fi'],
    })
  })

  it('intersects per-language passes with the --languages filter', () => {
    const regs = expandRegistrations({
      baseTitle: 'T',
      languageSpec: { languages: ['en', 'fi', 'de'], mode: 'per-language' },
      eachVariants: null,
      requestedLanguages: ['fi'],
    })
    expect(regs.map((r) => r.language)).toEqual(['fi'])
  })

  it('yields nothing when the filter excludes every declared language', () => {
    const regs = expandRegistrations({
      baseTitle: 'T',
      languageSpec: { languages: ['en', 'fi'], mode: 'per-language' },
      eachVariants: null,
      requestedLanguages: ['de'],
    })
    expect(regs).toEqual([])
  })

  it('does not split a shared recording by the --languages filter', () => {
    const regs = expandRegistrations({
      baseTitle: 'T',
      languageSpec: { languages: ['en', 'fi'], mode: 'shared' },
      eachVariants: null,
      requestedLanguages: ['fi'],
    })
    expect(regs).toHaveLength(1)
    expect(regs[0]?.language).toBeNull()
  })

  it('produces a separate video per each-variant with distinct names', () => {
    const regs = expandRegistrations({
      baseTitle: 'Landing',
      languageSpec: null,
      eachVariants: [
        { key: 'mobile', recordOptions: { aspectRatio: '9:16' } },
        { key: 'desktop', recordOptions: { aspectRatio: '16:9' } },
      ],
      requestedLanguages: null,
    })
    expect(regs.map((r) => r.videoName)).toEqual([
      'Landing mobile',
      'Landing desktop',
    ])
    expect(regs[0]?.recordOptions).toEqual({ aspectRatio: '9:16' })
  })

  it('takes the cartesian product of each-variants and languages', () => {
    const regs = expandRegistrations({
      baseTitle: 'Landing',
      languageSpec: { languages: ['en', 'fi'], mode: 'per-language' },
      eachVariants: [{ key: 'mobile' }, { key: 'desktop' }],
      requestedLanguages: null,
    })
    expect(regs.map((r) => r.leafTitle)).toEqual([
      'Landing mobile [en]',
      'Landing mobile [fi]',
      'Landing desktop [en]',
      'Landing desktop [fi]',
    ])
    // each-variant is the video identity; language is a version within it.
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

  return { test, calls }
}

describe('createVideoBuilder registration', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  afterEach(() => warn.mockClear())

  it('registers one describe+test per language with scoped use options', () => {
    const { test, calls } = createTestSink()
    const builder = createVideoBuilder(test)
    builder.languages(['en', 'fi'])('Tutorial', async () => {})

    expect(calls.tests).toEqual(['Tutorial [en]', 'Tutorial [fi]'])
    expect(calls.uses[0]).toMatchObject({
      locale: 'en-US',
      _screenciLanguage: 'en',
      _screenciVideoName: 'Tutorial',
      _screenciLanguages: ['en', 'fi'],
    })
    expect(calls.uses[1]).toMatchObject({
      locale: 'fi-FI',
      _screenciLanguage: 'fi',
    })
  })

  it('leaves _screenciLanguage undefined for shared mode', () => {
    const { test, calls } = createTestSink()
    createVideoBuilder(test).languages(['en', 'fi'], { mode: 'shared' })(
      'Tour',
      async () => {}
    )
    expect(calls.tests).toEqual(['Tour'])
    expect(calls.uses[0]?._screenciLanguage).toBeUndefined()
    expect(calls.uses[0]).not.toHaveProperty('locale')
  })

  it('supports the (title, details, body) signature', () => {
    const { test, calls } = createTestSink()
    createVideoBuilder(test).languages(['en'])(
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
      createVideoBuilder(test).languages(['en', 'fi'])('T', async () => {})
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

  it('rejects an empty language list', () => {
    const { test } = createTestSink()
    expect(() => createVideoBuilder(test).languages([])).toThrow(
      /at least one language/
    )
  })
})
