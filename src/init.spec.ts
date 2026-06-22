import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createInitLinkSession,
  generateConfig,
  generateExampleVideo,
  generateIslandReadme,
  generateIslandTsconfig,
  generateReactExampleVideo,
  parsePnpmVersionSupport,
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

  it('co-locates the voice and declares localized narration', () => {
    const source = generateExampleVideo()
    expect(source).toContain(`video.localize({
  // The voice (how narration is spoken) and the localized text live together.
  voice: { name: voices.Sophie },
  // Localized narration cues by language. The fixture exposes them as markers.
  narration: {
    en: {`)
    expect(source).not.toContain('renderOptions')
    expect(source).not.toContain('createNarration')
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
  it('uses createOverlays from the main entry point', () => {
    expect(generateReactExampleVideo()).toContain(
      "import { createOverlays, hide, video } from 'screenci'"
    )
  })

  it('does not import the removed screenci/react entry', () => {
    expect(generateReactExampleVideo()).not.toContain('screenci/react')
  })

  it('passes a JSX element straight into the overlay config', () => {
    expect(generateReactExampleVideo()).toContain(
      'element: <Badge label="New" />'
    )
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
