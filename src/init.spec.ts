import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { generateExampleVideo, parsePnpmVersionSupport } from './init.js'

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
