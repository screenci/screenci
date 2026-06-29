import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createInitLinkSession,
  generateConfig,
  generateExampleVideo,
  generateGitignore,
  generateIslandReadme,
  generateIslandTsconfig,
  generateReactExampleVideo,
  parsePnpmVersionSupport,
  resolveBundledLogoPath,
  toIslandPackageName,
} from './init.js'

describe('generateConfig', () => {
  it('scaffolds the sharp-locally / fast-in-CI encoder by default', () => {
    expect(generateConfig('My Demo')).toContain(
      "encoder: process.env.CI ? 'fast' : 'sharp',"
    )
  })
})

describe('createInitLinkSession', () => {
  const originalFetch = global.fetch
  let islandDir: string

  beforeEach(() => {
    islandDir = mkdtempSync(path.join(tmpdir(), 'screenci-init-link-'))
  })

  afterEach(() => {
    global.fetch = originalFetch
    rmSync(islandDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('creates and persists a sign-in session, returning the sign-in URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        token: 'init-token-123',
        createdAt: '2026-06-18T10:00:00.000Z',
        expiresAt: '2026-06-19T10:00:00.000Z',
      }),
      text: async () => '',
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const url = await createInitLinkSession(islandDir, { env: {} })

    expect(url).toContain('/cli-auth?session=init-token-123')

    const specPath = path.join(islandDir, '.screenci', 'link-session.json')
    expect(existsSync(specPath)).toBe(true)
    const spec = JSON.parse(readFileSync(specPath, 'utf-8')) as {
      token: string
      resolvedConfigPath: string
      envFilePath: string
    }
    expect(spec.token).toBe('init-token-123')
    // Paths must match what `record` resolves later so the session is reusable.
    expect(spec.resolvedConfigPath).toBe(
      path.resolve(islandDir, 'screenci.config.ts')
    )
    expect(spec.envFilePath).toBe(path.resolve(islandDir, '.env'))
  })

  it('skips session creation when a secret is already configured', async () => {
    const fetchMock = vi.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    const url = await createInitLinkSession(islandDir, {
      env: { SCREENCI_SECRET: 'already-set' },
    })

    expect(url).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(
      existsSync(path.join(islandDir, '.screenci', 'link-session.json'))
    ).toBe(false)
  })

  it('is best-effort: returns null without throwing when session creation fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
      text: async () => 'boom',
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const url = await createInitLinkSession(islandDir, { env: {} })

    expect(url).toBeNull()
    expect(
      existsSync(path.join(islandDir, '.screenci', 'link-session.json'))
    ).toBe(false)
  })
})

describe('generateExampleVideo', () => {
  it('matches the installation doc video source', () => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    const installationVideoPath = path.resolve(
      currentDir,
      '../docs/video-sources/installation.screenci.ts'
    )

    const installationVideoSource = readFileSync(installationVideoPath, 'utf8')

    expect(generateExampleVideo()).toBe(installationVideoSource)
  })

  it('sets the default voice via use and declares localized narration', () => {
    const source = generateExampleVideo()
    expect(source).toContain(
      `video.use({ renderOptions: { narration: { voice: { name: voices.Sophie } } } })`
    )
    expect(source).toContain(`  .narration({
    en: {`)
    // The all-languages default voice lives in use, not in the per-feature spec.
    expect(source).not.toContain('video.localize(')
    expect(source).not.toContain('createNarration')
  })

  it('declares a logo overlay and shows it as an intro card', () => {
    const source = generateExampleVideo()
    // The overlay is declared from the bundled, gitignored asset path.
    expect(source).toContain('video\n  .overlays({')
    expect(source).toContain(
      "logo: { path: './assets/logo.png', fill: 'recording', durationMs: 2000 }"
    )
    // The body receives the overlay controllers and opens with the logo card.
    expect(source).toContain(
      "})('How to find docs', async ({ page, narration, overlays }) => {"
    )
    expect(source).toContain('await overlays.logo(2000)')
    // A comment explains the asset is gitignored and need not be committed.
    expect(source).toContain('is gitignored')
  })
})

describe('generateGitignore', () => {
  it('ignores the video asset media folder with an explanatory comment', () => {
    const gitignore = generateGitignore()
    expect(gitignore).toContain('recordings/assets/')
    expect(gitignore).toContain('uploaded to')
    // The path must match where the scaffold writes assets.
    expect(gitignore).toContain('# Video asset media')
  })
})

describe('resolveBundledLogoPath', () => {
  it('resolves to an existing, non-empty logo.png', () => {
    const logoPath = resolveBundledLogoPath()
    expect(existsSync(logoPath)).toBe(true)
    expect(path.basename(logoPath)).toBe('logo.png')
    expect(statSync(logoPath).size).toBeGreaterThan(0)
  })

  it('copies a non-empty logo.png into recordings/assets (as the scaffold does)', () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'screenci-logo-'))
    try {
      const assetsDir = path.join(tempDir, 'recordings', 'assets')
      mkdirSync(assetsDir, { recursive: true })
      const target = path.join(assetsDir, 'logo.png')
      copyFileSync(resolveBundledLogoPath(), target)
      expect(existsSync(target)).toBe(true)
      expect(statSync(target).size).toBeGreaterThan(0)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})

describe('generateIslandTsconfig', () => {
  it('omits the jsx setting by default', () => {
    const tsconfig = JSON.parse(generateIslandTsconfig()) as {
      compilerOptions: Record<string, unknown>
    }
    expect(tsconfig.compilerOptions.jsx).toBeUndefined()
  })

  it('enables the automatic JSX runtime when React overlays are scaffolded', () => {
    const tsconfig = JSON.parse(generateIslandTsconfig(true)) as {
      compilerOptions: Record<string, unknown>
    }
    expect(tsconfig.compilerOptions.jsx).toBe('react-jsx')
  })
})

describe('generateReactExampleVideo', () => {
  it('declares overlays via video.overlays from the main entry point', () => {
    const source = generateReactExampleVideo()
    expect(source).toContain(
      "import { autoZoom, hide, video, voices } from 'screenci'"
    )
    expect(source).toContain('video\n  .overlays({')
    expect(source).not.toContain('createOverlays')
  })

  it('does not import the removed screenci/react entry', () => {
    expect(generateReactExampleVideo()).not.toContain('screenci/react')
  })

  it('passes a JSX element straight into the overlay config', () => {
    expect(generateReactExampleVideo()).toContain('element: <Highlight />')
  })

  it('highlights the clicked docs link with an animated overlay', () => {
    // The example mirrors the base script (narration + autoZoom click) and adds
    // a React overlay that pulses around the docs link as it is clicked.
    const source = generateReactExampleVideo()
    expect(source).toContain('over: target')
    expect(source).toContain('animate: true')
    expect(source).toContain('@keyframes screenci-highlight')
    expect(source).toContain(
      "page.getByRole('link', { name: 'View Documentation' })"
    )
    expect(source).toContain('await highlight.start()')
    expect(source).toContain('await highlight.end()')
    expect(source).toContain('await docsLink.click()')
  })

  it('uses a distinct video title so it can coexist with the base example', () => {
    // Both examples are scaffolded into one project when React overlays are
    // enabled. Their video titles must differ, or the per-language leaf titles
    // collide and `screenci test` rejects the run as duplicate titles.
    expect(generateExampleVideo()).toContain("'How to find docs'")
    expect(generateReactExampleVideo()).toContain(
      "'How to find docs with overlays'"
    )
    expect(generateReactExampleVideo()).not.toContain("'How to find docs'")
  })
})

describe('generateIslandReadme', () => {
  it('titles the readme with the project name', () => {
    expect(generateIslandReadme('My Demo', 'npm')).toContain('# My Demo')
  })

  it('uses npm run-script invocations for npm', () => {
    const readme = generateIslandReadme('Demo', 'npm')
    expect(readme).toContain('`npm test` tests')
    expect(readme).toContain('`npm test -- --ui` tests')
    expect(readme).toContain('`npm run record` records')
  })

  it('uses pnpm invocations for pnpm', () => {
    const readme = generateIslandReadme('Demo', 'pnpm')
    expect(readme).toContain('`pnpm test` tests')
    expect(readme).toContain('`pnpm test --ui` tests')
    expect(readme).toContain('`pnpm record` records')
  })

  it('uses yarn invocations for yarn', () => {
    const readme = generateIslandReadme('Demo', 'yarn')
    expect(readme).toContain('`yarn test` tests')
    expect(readme).toContain('`yarn test --ui` tests')
    expect(readme).toContain('`yarn record` records')
  })

  it('links to the docs', () => {
    expect(generateIslandReadme('Demo', 'npm')).toContain(
      'https://screenci.com/docs'
    )
  })
})

describe('toIslandPackageName', () => {
  it('uses the project name directly without a -videos suffix', () => {
    expect(toIslandPackageName('my-app')).toBe('my-app')
  })

  it('slugifies a human project name', () => {
    expect(toIslandPackageName('My Product')).toBe('my-product')
  })

  it('falls back to screenci-videos when the slug collides with screenci', () => {
    expect(toIslandPackageName('screenci')).toBe('screenci-videos')
    expect(toIslandPackageName('ScreenCI')).toBe('screenci-videos')
  })

  it('falls back to screenci-videos when the slug is empty', () => {
    expect(toIslandPackageName('')).toBe('screenci-videos')
    expect(toIslandPackageName('---')).toBe('screenci-videos')
  })
})

describe('parsePnpmVersionSupport', () => {
  it('accepts pnpm 10.26.0', () => {
    expect(parsePnpmVersionSupport('10.26.0')).toEqual({
      supported: true,
      detectedVersion: '10.26.0',
      reason: 'supported',
    })
  })

  it('accepts newer stable pnpm versions', () => {
    expect(parsePnpmVersionSupport('10.26.1')).toEqual({
      supported: true,
      detectedVersion: '10.26.1',
      reason: 'supported',
    })
    expect(parsePnpmVersionSupport('11.0.0')).toEqual({
      supported: true,
      detectedVersion: '11.0.0',
      reason: 'supported',
    })
  })

  it('accepts prereleases at the minimum version', () => {
    expect(parsePnpmVersionSupport('10.26.0-rc.0')).toEqual({
      supported: true,
      detectedVersion: '10.26.0-rc.0',
      reason: 'supported',
    })
  })

  it('rejects older pnpm versions', () => {
    expect(parsePnpmVersionSupport('10.25.9')).toEqual({
      supported: false,
      detectedVersion: '10.25.9',
      reason: 'version-too-old',
    })
  })

  it('rejects malformed pnpm version output', () => {
    expect(parsePnpmVersionSupport('pnpm version 10.26.0')).toEqual({
      supported: false,
      detectedVersion: 'pnpm version 10.26.0',
      reason: 'malformed-version',
    })
  })
})
