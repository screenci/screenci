import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { logger } from './src/logger.js'
import { SECRET_HEADER, ANON_TOKEN_HEADER } from './src/anonSession.js'

describe('resolveUploadCredential', () => {
  let screenciDir: string
  const originalFetch = global.fetch
  const envFilePath = () => path.join(screenciDir, '.env')

  beforeEach(() => {
    screenciDir = mkdtempSync(path.join(tmpdir(), 'screenci-upload-cred-'))
    vi.spyOn(logger, 'info').mockImplementation(() => {})
  })

  afterEach(() => {
    global.fetch = originalFetch
    rmSync(screenciDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('uses the real secret unchanged when SCREENCI_SECRET is set, without touching the anon token file', async () => {
    const { resolveUploadCredential } = await import('./cli')

    const result = await resolveUploadCredential(
      screenciDir,
      'https://api.example.com',
      envFilePath(),
      'sec_real'
    )

    expect(result).toEqual({
      credential: { header: SECRET_HEADER, value: 'sec_real' },
      usedAnonCredential: false,
    })
    expect(existsSync(path.join(screenciDir, 'anon-session.json'))).toBe(false)
  })

  it('mints and uses an anon token when the session is pending', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ status: 'pending' }),
    }) as unknown as typeof fetch

    const { resolveUploadCredential } = await import('./cli')
    const result = await resolveUploadCredential(
      screenciDir,
      'https://api.example.com',
      envFilePath(),
      undefined
    )

    expect(result.usedAnonCredential).toBe(true)
    expect(result.credential.header).toBe(ANON_TOKEN_HEADER)
    expect(existsSync(path.join(screenciDir, 'anon-session.json'))).toBe(true)
  })

  it('auto-graduates to the real secret when the session was claimed, and deletes the local anon state', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ status: 'claimed', secret: 'sec_claimed' }),
    }) as unknown as typeof fetch

    const { resolveUploadCredential } = await import('./cli')
    const result = await resolveUploadCredential(
      screenciDir,
      'https://api.example.com',
      envFilePath(),
      undefined
    )

    expect(result).toEqual({
      credential: { header: SECRET_HEADER, value: 'sec_claimed' },
      usedAnonCredential: false,
    })
    expect(readFileSync(envFilePath(), 'utf-8')).toContain(
      'SCREENCI_SECRET=sec_claimed'
    )
    expect(existsSync(path.join(screenciDir, 'anon-session.json'))).toBe(false)
  })

  it('nags and starts a fresh trial when the session expired', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ status: 'expired' }),
    }) as unknown as typeof fetch

    const { resolveUploadCredential } = await import('./cli')
    const result = await resolveUploadCredential(
      screenciDir,
      'https://api.example.com',
      envFilePath(),
      undefined
    )

    expect(result.usedAnonCredential).toBe(true)
    expect(result.credential.header).toBe(ANON_TOKEN_HEADER)
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('expired or was already claimed')
    )
    // A fresh token was minted (the file exists again after being deleted).
    expect(existsSync(path.join(screenciDir, 'anon-session.json'))).toBe(true)
  })

  it('nags and starts a fresh trial when the session is not found', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ status: 'not_found' }),
    }) as unknown as typeof fetch

    const { resolveUploadCredential } = await import('./cli')
    const result = await resolveUploadCredential(
      screenciDir,
      'https://api.example.com',
      envFilePath(),
      undefined
    )

    expect(result.usedAnonCredential).toBe(true)
    expect(result.credential.header).toBe(ANON_TOKEN_HEADER)
  })
})
