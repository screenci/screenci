import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  environmentForBackendUrl,
  getDevBackendUrl,
  persistScreenCISecret,
} from './linkSession.js'

function tempEnvPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'screenci-env-')), '.env')
}

describe('persistScreenCISecret', () => {
  it('creates the env file when missing', async () => {
    const envPath = tempEnvPath()
    await persistScreenCISecret(envPath, 'sec_1')
    expect(await readFile(envPath, 'utf-8')).toBe('SCREENCI_SECRET=sec_1\n')
  })

  it('replaces an existing entry in place, keeping other lines', async () => {
    const envPath = tempEnvPath()
    await writeFile(envPath, 'A=1\nSCREENCI_SECRET=old\nB=2\n')
    await persistScreenCISecret(envPath, 'sec_2')
    expect(await readFile(envPath, 'utf-8')).toBe(
      'A=1\nSCREENCI_SECRET=sec_2\nB=2\n'
    )
  })
})

describe('getDevBackendUrl', () => {
  it('lets SCREENCI_API_URL point at an explicit backend', () => {
    const saved = process.env.SCREENCI_API_URL
    try {
      process.env.SCREENCI_API_URL = 'https://backend.example.com/'
      expect(getDevBackendUrl()).toBe('https://backend.example.com')
      process.env.SCREENCI_API_URL = '  '
      expect(getDevBackendUrl()).not.toBe('  ')
    } finally {
      if (saved === undefined) delete process.env.SCREENCI_API_URL
      else process.env.SCREENCI_API_URL = saved
    }
  })
})

describe('environmentForBackendUrl', () => {
  it('maps the known backends and nothing else', () => {
    expect(environmentForBackendUrl('https://api.screenci.com')).toBe('prod')
    expect(environmentForBackendUrl('https://dev.api.screenci.com/')).toBe(
      'dev'
    )
    expect(environmentForBackendUrl('http://localhost:8787')).toBeNull()
  })
})
