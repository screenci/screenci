import { describe, expect, it } from 'vitest'
import {
  checkSingleVideoScript,
  classifyProjectFile,
  diffManifests,
  extractVideoTitles,
  isDeveloperOnlyProjectFile,
  isValidVideoSlug,
  maxProjectFileBytes,
  MAX_PROJECT_MEDIA_FILE_BYTES,
  MAX_PROJECT_TEXT_FILE_BYTES,
  projectFilePathProblem,
  selectProjectFiles,
  videoSlugFromTitle,
  videoSlugOf,
} from './projectFiles.js'

// Keep these vectors identical to the service's copy of these rules.

describe('projectFilePathProblem', () => {
  it.each([
    'screenci.config.ts',
    'package.json',
    'pnpm-lock.yaml',
    'recordings/add-lead.screenci.ts',
    'recordings/add-lead.screenci.tsx',
    'recordings/add-lead/callout.html',
    'recordings/add-lead/assets/logo.png',
    'recordings/shared/theme.ts',
    'recordings/shared/overlays/Card.tsx',
  ])('accepts %s', (path) => {
    expect(projectFilePathProblem(path)).toBeNull()
  })

  it.each([
    ['', 'empty'],
    ['/etc/passwd', 'absolute'],
    ['C:/x.ts', 'drive'],
    ['recordings\\a.screenci.ts', 'backslash'],
    ['recordings/../package.json', 'dotdot'],
    ['recordings//a.screenci.ts', 'empty segment'],
    ['.env', 'env'],
    ['recordings/shared/.env.local', 'nested env'],
    ['recordings/shared/storageState.json', 'storage state'],
    ['.npmrc', 'npmrc can hold tokens'],
    ['src/index.ts', 'outside recordings'],
    ['recordings/helper.ts', 'non-script directly in recordings'],
    ['recordings/shared.screenci.ts', 'reserved slug'],
    ['recordings/node_modules/x/index.js', 'node_modules'],
    ['recordings/shared/.hidden/x.ts', 'hidden folder'],
    ['recordings/bad slug/x.ts', 'space in folder'],
    [`recordings/${'a'.repeat(400)}.screenci.ts`, 'too long'],
  ])('rejects %s (%s)', (path) => {
    expect(projectFilePathProblem(path)).not.toBeNull()
  })
})

describe('classifyProjectFile', () => {
  it('classifies each kind', () => {
    expect(classifyProjectFile('package.json')).toEqual({ kind: 'root' })
    expect(classifyProjectFile('recordings/a-b.screenci.ts')).toEqual({
      kind: 'script',
      slug: 'a-b',
    })
    expect(classifyProjectFile('recordings/a-b/x.png')).toEqual({
      kind: 'video-file',
      slug: 'a-b',
    })
    expect(classifyProjectFile('recordings/shared/x.ts')).toEqual({
      kind: 'shared',
    })
    expect(classifyProjectFile('recordings/x.ts')).toBeNull()
  })

  it('maps paths to their video slug', () => {
    expect(videoSlugOf('recordings/a.screenci.ts')).toBe('a')
    expect(videoSlugOf('recordings/a/deep/x.svg')).toBe('a')
    expect(videoSlugOf('recordings/shared/x.ts')).toBeNull()
    expect(videoSlugOf('package.json')).toBeNull()
  })

  it('marks root and unknown files developer-only', () => {
    expect(isDeveloperOnlyProjectFile('screenci.config.ts')).toBe(true)
    expect(isDeveloperOnlyProjectFile('package.json')).toBe(true)
    expect(isDeveloperOnlyProjectFile('src/evil.ts')).toBe(true)
    expect(isDeveloperOnlyProjectFile('recordings/a.screenci.ts')).toBe(false)
    expect(isDeveloperOnlyProjectFile('recordings/shared/x.tsx')).toBe(false)
  })
})

describe('selectProjectFiles', () => {
  const entries = [
    { path: 'package.json' },
    { path: 'screenci.config.ts' },
    { path: 'recordings/a.screenci.ts' },
    { path: 'recordings/a/callout.html' },
    { path: 'recordings/b.screenci.ts' },
    { path: 'recordings/b/logo.png' },
    { path: 'recordings/shared/theme.ts' },
    { path: 'stray.txt' },
  ]

  it('returns root, shared and the chosen videos only', () => {
    expect(selectProjectFiles(entries, ['a']).map((e) => e.path)).toEqual([
      'package.json',
      'screenci.config.ts',
      'recordings/a.screenci.ts',
      'recordings/a/callout.html',
      'recordings/shared/theme.ts',
    ])
  })

  it('returns only shared files for no videos', () => {
    expect(selectProjectFiles(entries, []).map((e) => e.path)).toEqual([
      'package.json',
      'screenci.config.ts',
      'recordings/shared/theme.ts',
    ])
  })
})

describe('extractVideoTitles', () => {
  it('finds builder-chain titles', () => {
    const source = `
import { video } from 'screenci'
video
  .renderOptions(demoVoice)
  .narration({ en: { a: 'x' } })('How to add a lead', async ({ page, narration }) => {
    await page.goto('/')
  })
`
    expect(extractVideoTitles(source)).toEqual(['How to add a lead'])
  })

  it('finds plain video and screenshot calls, not describe groups', () => {
    const source = `
video.describe('Group', () => {
  video('First', async ({ page }) => {})
  screenshot("Second", async ({ page }) => {})
})
`
    expect(extractVideoTitles(source)).toEqual(['First', 'Second'])
  })

  it('ignores commented-out videos and ordinary calls', () => {
    const source = `
// video('Old', async () => {})
/* video('Older', async () => {}) */
await page.getByRole('button', { name: 'Save' }).click()
video('Only', async ({ page }) => { await page.fill('#q', 'x') })
`
    expect(extractVideoTitles(source)).toEqual(['Only'])
  })

  it('checks one video per script', () => {
    expect(checkSingleVideoScript("video('A', async () => {})")).toEqual({
      ok: true,
      title: 'A',
    })
    expect(checkSingleVideoScript('export const x = 1')).toEqual({
      ok: false,
      reason: 'none',
      titles: [],
    })
    expect(
      checkSingleVideoScript(
        "video('A', async () => {})\nvideo('B', async () => {})"
      )
    ).toEqual({ ok: false, reason: 'several', titles: ['A', 'B'] })
  })
})

describe('slugs', () => {
  it('derives file-safe slugs from titles', () => {
    expect(videoSlugFromTitle('How to add a lead')).toBe('how-to-add-a-lead')
    expect(videoSlugFromTitle('  Ääkkösiä & more!  ')).toBe('aakkosia-more')
    expect(videoSlugFromTitle('Shared')).toBe('video-shared')
    expect(videoSlugFromTitle('!!!')).toBe('video-untitled')
  })

  it('validates slugs', () => {
    expect(isValidVideoSlug('add-lead_2.v1')).toBe(true)
    expect(isValidVideoSlug('shared')).toBe(false)
    expect(isValidVideoSlug('-x')).toBe(false)
    expect(isValidVideoSlug('a..b')).toBe(false)
  })
})

describe('size limits', () => {
  it('uses the media cap for media files', () => {
    expect(maxProjectFileBytes('recordings/a/clip.mp4')).toBe(
      MAX_PROJECT_MEDIA_FILE_BYTES
    )
    expect(maxProjectFileBytes('recordings/a.screenci.ts')).toBe(
      MAX_PROJECT_TEXT_FILE_BYTES
    )
  })
})

describe('diffManifests', () => {
  it('reports changed, remote-only and local-only paths', () => {
    expect(
      diffManifests(
        [
          { path: 'a', hash: '1' },
          { path: 'b', hash: '2' },
          { path: 'c', hash: '3' },
        ],
        [
          { path: 'a', hash: '1' },
          { path: 'b', hash: 'x' },
          { path: 'd', hash: '4' },
        ]
      )
    ).toEqual({ changed: ['b'], onlyRemote: ['d'], onlyLocal: ['c'] })
  })
})
