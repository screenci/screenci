import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { generateExampleVideo } from './init.js'

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
})
