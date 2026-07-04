import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ANON_TOKEN_HEADER,
  SECRET_HEADER,
  anonCredential,
  checkAnonSessionStatus,
  deleteAnonSessionFile,
  getOrCreateAnonToken,
  secretCredential,
} from './anonSession.js'

describe('getOrCreateAnonToken', () => {
  let screenciDir: string

  beforeEach(() => {
    screenciDir = mkdtempSync(path.join(tmpdir(), 'screenci-anon-'))
  })

  afterEach(() => {
    rmSync(screenciDir, { recursive: true, force: true })
  })

  it('mints and persists a token on first use', async () => {
    const token = await getOrCreateAnonToken(screenciDir)
    expect(token).toMatch(/^[0-9a-f-]{36}$/)

    const filePath = path.join(screenciDir, 'anon-session.json')
    expect(existsSync(filePath)).toBe(true)
    expect(JSON.parse(readFileSync(filePath, 'utf-8'))).toEqual({ token })
  })

  it('reuses the same token across calls in the same directory', async () => {
    const first = await getOrCreateAnonToken(screenciDir)
    const second = await getOrCreateAnonToken(screenciDir)
    expect(second).toBe(first)
  })

  it('deleteAnonSessionFile removes the persisted token so a new one is minted', async () => {
    const first = await getOrCreateAnonToken(screenciDir)
    await deleteAnonSessionFile(screenciDir)
    const second = await getOrCreateAnonToken(screenciDir)
    expect(second).not.toBe(first)
  })

  it('deleteAnonSessionFile is a no-op when no file exists', async () => {
    await expect(deleteAnonSessionFile(screenciDir)).resolves.toBeUndefined()
  })
})

describe('checkAnonSessionStatus', () => {
  it('returns pending when the server reports pending', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      json: async () => ({ status: 'pending' }),
    })
    const result = await checkAnonSessionStatus('token-a', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      backendUrl: 'https://api.example.com',
    })
    expect(result).toEqual({ status: 'pending' })
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.example.com/cli/anon-session-status',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ token: 'token-a' }),
      })
    )
  })

  it('returns claimed with the secret when the server reports claimed', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      json: async () => ({ status: 'claimed', secret: 'sec_123' }),
    })
    const result = await checkAnonSessionStatus('token-a', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result).toEqual({ status: 'claimed', secret: 'sec_123' })
  })

  it('treats a claimed response missing a secret as pending (defensive)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      json: async () => ({ status: 'claimed' }),
    })
    const result = await checkAnonSessionStatus('token-a', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result).toEqual({ status: 'pending' })
  })

  it('returns expired when the server reports expired', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      json: async () => ({ status: 'expired' }),
    })
    const result = await checkAnonSessionStatus('token-a', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result).toEqual({ status: 'expired' })
  })

  it('returns not_found when the server reports not_found', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      json: async () => ({ status: 'not_found' }),
    })
    const result = await checkAnonSessionStatus('token-a', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result).toEqual({ status: 'not_found' })
  })

  it('defaults to pending on a network failure so a transient outage does not block uploads', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'))
    const result = await checkAnonSessionStatus('token-a', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result).toEqual({ status: 'pending' })
  })
})

describe('credential helpers', () => {
  it('secretCredential attaches the secret header', () => {
    expect(secretCredential('sec_123')).toEqual({
      header: SECRET_HEADER,
      value: 'sec_123',
    })
  })

  it('anonCredential attaches the anon token header', () => {
    expect(anonCredential('token-a')).toEqual({
      header: ANON_TOKEN_HEADER,
      value: 'token-a',
    })
  })
})
