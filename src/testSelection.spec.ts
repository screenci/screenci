import { describe, expect, it, vi } from 'vitest'
import {
  collectListedTests,
  MissingVideoTitlesError,
  recordSelectionArgs,
  selectExactTitles,
  stripTestTitleLanguageSuffix,
  type ListReport,
} from './testSelection.js'

const BUILDER = '../node_modules/screenci/dist/src/builder.js'

// The shape `playwright test --list --reporter=json` gives for a script with a
// plain `video('Intro', ...)` and builder chains (which Playwright reports at
// the builder module, wrapped in a describe).
const REPORT: ListReport = {
  config: { rootDir: '/island/recordings' },
  suites: [
    {
      title: 'intro.screenci.ts',
      file: 'intro.screenci.ts',
      specs: [
        { title: 'Intro', file: 'intro.screenci.ts' },
        { title: 'Intro v2', file: 'intro.screenci.ts' },
      ],
      suites: [
        {
          title: 'Product Intro',
          file: BUILDER,
          specs: [{ title: 'Product Intro', file: BUILDER }],
        },
        {
          title: 'en',
          file: BUILDER,
          specs: [{ title: 'Tour [en]', file: BUILDER }],
        },
        {
          title: 'fi',
          file: BUILDER,
          specs: [{ title: 'Tour [fi]', file: BUILDER }],
        },
        {
          title: '',
          specs: [{ title: 'Release [New]', file: 'intro.screenci.ts' }],
        },
      ],
    },
  ],
}

describe('stripTestTitleLanguageSuffix', () => {
  it('strips language suffixes only', () => {
    expect(stripTestTitleLanguageSuffix('Tour [en]')).toBe('Tour')
    expect(stripTestTitleLanguageSuffix('Tour [pt-BR]')).toBe('Tour')
    expect(stripTestTitleLanguageSuffix('Release [New]')).toBe('Release [New]')
  })
})

describe('selectExactTitles', () => {
  const tests = collectListedTests(REPORT)

  it('picks only exact video names, never substrings or suffixes', () => {
    expect(selectExactTitles(tests, ['Intro'])).toEqual({
      lines: ['intro.screenci.ts › Intro'],
      missing: [],
      unlistable: [],
    })
  })

  it('names the script (to load it) and the builder location (to match it)', () => {
    expect(selectExactTitles(tests, ['Product Intro']).lines).toEqual([
      'intro.screenci.ts › Product Intro › Product Intro',
      `${BUILDER} › Product Intro › Product Intro`,
    ])
  })

  it('covers every language pass, skips untitled describes, reports missing names', () => {
    const selection = selectExactTitles(tests, [
      'Tour',
      'Release [New]',
      'Gone',
    ])
    expect(selection.lines).toEqual([
      'intro.screenci.ts › en › Tour [en]',
      `${BUILDER} › en › Tour [en]`,
      'intro.screenci.ts › fi › Tour [fi]',
      `${BUILDER} › fi › Tour [fi]`,
      'intro.screenci.ts › Release [New]',
    ])
    expect(selection.missing).toEqual(['Gone'])
  })

  it('flags titles the test-list format cannot carry', () => {
    const selection = selectExactTitles(
      [
        {
          videoName: 'A › B',
          scriptFile: 'a.screenci.ts',
          locationFile: 'a.screenci.ts',
          titlePath: ['A › B'],
        },
      ],
      ['A › B']
    )
    expect(selection.unlistable).toEqual(['A › B'])
    expect(selection.lines).toEqual([])
  })
})

describe('recordSelectionArgs', () => {
  function deps(report: ListReport | null = REPORT) {
    const written: string[] = []
    return {
      written,
      list: vi.fn(async () => report),
      writeTestList: vi.fn(async (content: string) => {
        written.push(content)
        return '/tmp/list/tests.txt'
      }),
    }
  }

  it('maps every selection kind', async () => {
    const d = deps()
    expect(await recordSelectionArgs({ kind: 'all' }, d)).toEqual([])
    expect(
      await recordSelectionArgs({ kind: 'grep', pattern: 'Intro' }, d)
    ).toEqual(['--grep', 'Intro'])
    expect(d.list).not.toHaveBeenCalled()
    expect(
      await recordSelectionArgs({ kind: 'exact', titles: ['Intro v2'] }, d)
    ).toEqual(['--test-list', '/tmp/list/tests.txt'])
    expect(d.written).toEqual(['intro.screenci.ts › Intro v2\n'])
  })

  it('refuses missing names and an empty selection instead of recording everything', async () => {
    await expect(
      recordSelectionArgs({ kind: 'exact', titles: ['Nope'] }, deps())
    ).rejects.toBeInstanceOf(MissingVideoTitlesError)
    await expect(
      recordSelectionArgs({ kind: 'exact', titles: [] }, deps())
    ).rejects.toThrow(/No videos were selected/)
    await expect(
      recordSelectionArgs({ kind: 'exact', titles: ['Intro'] }, deps(null))
    ).rejects.toThrow(/No video titled "Intro"/)
  })
})
