import { describe, it, expect, vi, afterEach } from 'vitest'
import { expandRegistrations, createVideoBuilder } from './builder.js'
import { normalizeLocalizeSpec } from './localize.js'

const perLanguage = (spec: Parameters<typeof normalizeLocalizeSpec>[0]) =>
  normalizeLocalizeSpec(spec)

describe('expandRegistrations', () => {
  it('produces a single language-agnostic test when not localized', () => {
    const regs = expandRegistrations({
      baseTitle: 'Demo',
      localize: null,
      eachVariants: null,
      requestedLanguages: null,
    })
    expect(regs).toHaveLength(1)
    expect(regs[0]).toMatchObject({
      leafTitle: 'Demo',
      videoName: 'Demo',
      language: null,
      locale: null,
      localize: null,
    })
  })

  it('registers one pass per language with locale and grouped video name', () => {
    const regs = expandRegistrations({
      baseTitle: 'Tutorial',
      localize: perLanguage({
        narration: { en: { intro: 'Hi' }, fi: { intro: 'Moi' } },
      }),
      eachVariants: null,
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
      localize: perLanguage({
        languages: ['en', 'fi'],
        studio: { text: ['heading'] },
        browserLocale: false,
      }),
      eachVariants: null,
      requestedLanguages: null,
    })
    expect(regs.every((r) => r.locale === null)).toBe(true)
    expect(regs.map((r) => r.language)).toEqual(['en', 'fi'])
  })

  it('records one shared pass that carries every language', () => {
    const regs = expandRegistrations({
      baseTitle: 'Tour',
      localize: perLanguage({
        narration: { en: { intro: 'Hi' }, fi: { intro: 'Moi' } },
        mode: 'shared',
      }),
      eachVariants: null,
      requestedLanguages: null,
    })
    expect(regs).toHaveLength(1)
    expect(regs[0]).toMatchObject({
      leafTitle: 'Tour',
      language: null,
      locale: null,
    })
  })

  it('intersects per-language passes with the --languages filter', () => {
    const regs = expandRegistrations({
      baseTitle: 'T',
      localize: perLanguage({
        languages: ['en', 'fi', 'de'],
        studio: { text: ['heading'] },
      }),
      eachVariants: null,
      requestedLanguages: ['fi'],
    })
    expect(regs.map((r) => r.language)).toEqual(['fi'])
  })

  it('takes the cartesian product of each-variants and languages', () => {
    const regs = expandRegistrations({
      baseTitle: 'Landing',
      localize: perLanguage({
        languages: ['en', 'fi'],
        studio: { text: ['heading'] },
      }),
      eachVariants: [{ key: 'mobile' }, { key: 'desktop' }],
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
    builder.localize({
      narration: { en: { intro: 'Hi' }, fi: { intro: 'Moi' } },
    })('Tutorial', async () => {})

    expect(calls.tests).toEqual(['Tutorial [en]', 'Tutorial [fi]'])
    expect(calls.uses[0]).toMatchObject({
      locale: 'en-US',
      _screenciLanguage: 'en',
      _screenciVideoName: 'Tutorial',
    })
    expect(calls.uses[0]?._screenciLocalize).toMatchObject({
      languages: ['en', 'fi'],
    })
  })

  it('captures the calling script as _screenciSourceFile so asset paths resolve against it', () => {
    const { test, calls } = createTestSink()
    createVideoBuilder(test)('Plain', async () => {})
    // Playwright would attribute the test to builder.ts (it is registered
    // there), so the builder captures the real caller, this spec file.
    expect(calls.uses[0]?._screenciSourceFile).toMatch(/builder\.spec\.ts$/)
  })

  it('leaves _screenciLanguage undefined for shared mode', () => {
    const { test, calls } = createTestSink()
    createVideoBuilder(test).localize({
      narration: { en: { intro: 'Hi' }, fi: { intro: 'Moi' } },
      mode: 'shared',
    })('Tour', async () => {})
    expect(calls.tests).toEqual(['Tour'])
    expect(calls.uses[0]?._screenciLanguage).toBeUndefined()
    expect(calls.uses[0]).not.toHaveProperty('locale')
  })

  it('supports the (title, details, body) signature', () => {
    const { test, calls } = createTestSink()
    createVideoBuilder(test).localize({
      languages: ['en'],
      studio: { text: ['h'] },
    })('Tagged', { tag: '@critical' }, async () => {})
    expect(calls.tests).toEqual(['Tagged [en]'])
  })

  it('warns and registers nothing when the filter excludes all languages', () => {
    const original = process.env.SCREENCI_LANGUAGES
    process.env.SCREENCI_LANGUAGES = 'de'
    try {
      const { test, calls } = createTestSink()
      createVideoBuilder(test).localize({
        languages: ['en', 'fi'],
        studio: { text: ['h'] },
      })('T', async () => {})
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

  it('registers per-language passes with test.only via .only', () => {
    const { test, calls, only } = createTestSink()
    createVideoBuilder(test)
      .localize({ narration: { en: { intro: 'Hi' }, fi: { intro: 'Moi' } } })
      .only('Focused', async () => {})
    expect(calls.tests).toEqual(['Focused [en]', 'Focused [fi]'])
    expect(only).toEqual(['Focused [en]', 'Focused [fi]'])
  })
})
