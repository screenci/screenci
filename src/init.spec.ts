import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  generateConfig,
  generateExampleVideo,
  generateIslandReadme,
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

describe('generateExampleVideo', () => {
  it('matches the installation doc video source', () => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    const installationVideoPath = path.resolve(
      currentDir,
      '../docs/video-sources/installation.video.ts'
    )

    const installationVideoSource = readFileSync(installationVideoPath, 'utf8')

    expect(generateExampleVideo()).toBe(installationVideoSource)
  })

  it('keeps the shared commented narration layout', () => {
    expect(generateExampleVideo())
      .toContain(`const narration = createNarration({
  // Default voice settings for all languages.
  voice: { name: voices.Sophie },
  // Localized narration cues by language.
  en: {`)
    expect(generateExampleVideo()).not
      .toContain(`voice: { name: voices.Sophie },

  en: {`)
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
