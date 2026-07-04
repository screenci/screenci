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

  it('proceeds with the anon token (no nag, no silent re-mint) when the server has not seen the token yet', async () => {
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
    // The old "Your previous trial expired or was already claimed. Starting a
    // new one." nag is gone: gating happens before recording now.
    expect(logger.info).not.toHaveBeenCalledWith(
      expect.stringContaining('Starting a new one')
    )
  })
})

describe('ensureAnonRecordingAllowedOrExit', () => {
  let screenciDir: string
  const originalFetch = global.fetch
  let exitSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    screenciDir = mkdtempSync(path.join(tmpdir(), 'screenci-anon-gate-'))
    vi.spyOn(logger, 'error').mockImplementation(() => {})
    // Throw so the function stops at process.exit like the real process would,
    // instead of falling through past it in the test.
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit')
    }) as never)
  })

  afterEach(() => {
    global.fetch = originalFetch
    rmSync(screenciDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('is a no-op when a real SCREENCI_SECRET is set (no status call, no exit)', async () => {
    const fetchSpy = vi.fn()
    global.fetch = fetchSpy as unknown as typeof fetch

    const { ensureAnonRecordingAllowedOrExit } = await import('./cli')
    await ensureAnonRecordingAllowedOrExit(
      screenciDir,
      'https://api.example.com',
      'https://app.example.com',
      'sec_real'
    )

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(exitSpy).not.toHaveBeenCalled()
  })

  it('allows a first-run (server has not seen the token) without exiting', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ status: 'not_found' }),
    }) as unknown as typeof fetch

    const { ensureAnonRecordingAllowedOrExit } = await import('./cli')
    await ensureAnonRecordingAllowedOrExit(
      screenciDir,
      'https://api.example.com',
      'https://app.example.com',
      undefined
    )

    expect(exitSpy).not.toHaveBeenCalled()
  })

  it('blocks and exits before recording when the one free trial is already used', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ status: 'pending', used: true }),
    }) as unknown as typeof fetch

    const { ensureAnonRecordingAllowedOrExit } = await import('./cli')
    await expect(
      ensureAnonRecordingAllowedOrExit(
        screenciDir,
        'https://api.example.com',
        'https://app.example.com',
        undefined
      )
    ).rejects.toThrow('process.exit')

    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('already used your one free ScreenCI trial')
    )
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('https://app.example.com')
    )
  })

  it('blocks and exits before recording when the trial has expired', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ status: 'expired' }),
    }) as unknown as typeof fetch

    const { ensureAnonRecordingAllowedOrExit } = await import('./cli')
    await expect(
      ensureAnonRecordingAllowedOrExit(
        screenciDir,
        'https://api.example.com',
        'https://app.example.com',
        undefined
      )
    ).rejects.toThrow('process.exit')

    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('trial has expired')
    )
  })
})
