import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { persistScreenCISecret } from './linkSession.js'

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
