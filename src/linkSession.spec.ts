import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  persistScreenCIEditToken,
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

describe('persistScreenCIEditToken', () => {
  it('appends the edit token next to an existing secret', async () => {
    const envPath = tempEnvPath()
    await persistScreenCISecret(envPath, 'sec_1')
    await persistScreenCIEditToken(envPath, 'edit_1')
    // The trailing newline of the existing file splits into an empty line
    // before the appended entry; harmless, and matches persistEnvVar's
    // long-standing behavior.
    expect(await readFile(envPath, 'utf-8')).toBe(
      'SCREENCI_SECRET=sec_1\n\nSCREENCI_EDIT_TOKEN=edit_1\n'
    )
  })

  it('replaces an existing edit token in place', async () => {
    const envPath = tempEnvPath()
    await writeFile(envPath, 'SCREENCI_EDIT_TOKEN=old\nOTHER=x\n')
    await persistScreenCIEditToken(envPath, 'edit_2')
    expect(await readFile(envPath, 'utf-8')).toBe(
      'SCREENCI_EDIT_TOKEN=edit_2\nOTHER=x\n'
    )
  })
})
