import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  INIT_OTP_PREFIX,
  exchangeInitOtp,
  looksLikeInitOtp,
} from './src/linkSession.js'
import { setUpInitSecret } from './src/init.js'
import { logger } from './src/logger.js'

describe('looksLikeInitOtp', () => {
  it('uses the scotp_ prefix to recognize an init one-time password', () => {
    expect(INIT_OTP_PREFIX).toBe('scotp_')
    expect(looksLikeInitOtp('scotp_abc123')).toBe(true)
  })

  it('treats a plain project name as not an OTP', () => {
    expect(looksLikeInitOtp('my-project')).toBe(false)
    expect(looksLikeInitOtp('screenci')).toBe(false)
    expect(looksLikeInitOtp('')).toBe(false)
  })
})

describe('exchangeInitOtp', () => {
  function makeResponse(body: Record<string, unknown>, ok = true): Response {
    return {
      ok,
      status: ok ? 200 : 400,
      json: async () => body,
    } as unknown as Response
  }

  function asFetch(fn: ReturnType<typeof vi.fn>): typeof fetch {
    return fn as unknown as typeof fetch
  }

  it('POSTs the otp to /cli-link/exchange and returns the secret when completed', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        makeResponse({ status: 'completed', secret: 'sec_abc' })
      )

    const result = await exchangeInitOtp('scotp_token', {
      backendUrl: 'https://api.example.com',
      fetchImpl: asFetch(fetchImpl),
    })

    expect(result).toEqual({ ok: true, secret: 'sec_abc' })
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.example.com/cli-link/exchange',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ otp: 'scotp_token' }),
      }
    )
  })

  it('reports an already-used token when the status is consumed', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(makeResponse({ status: 'consumed' }, false))

    const result = await exchangeInitOtp('scotp_token', {
      fetchImpl: asFetch(fetchImpl),
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/already been used/i)
  })

  it('reports an expired token when the status is expired', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(makeResponse({ status: 'expired' }, false))

    const result = await exchangeInitOtp('scotp_token', {
      fetchImpl: asFetch(fetchImpl),
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/expired/i)
  })

  it('reports an invalid token for any other status', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(makeResponse({ status: 'whatever' }, false))

    const result = await exchangeInitOtp('scotp_token', {
      fetchImpl: asFetch(fetchImpl),
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/invalid/i)
  })

  it('never throws when fetch rejects, returning the error message as the reason', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'))

    const result = await exchangeInitOtp('scotp_token', {
      fetchImpl: asFetch(fetchImpl),
    })

    expect(result).toEqual({ ok: false, reason: 'network down' })
  })
})

describe('setUpInitSecret', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    for (const dir of tempDirs.splice(0)) {
      await rm(dir, { recursive: true, force: true })
    }
  })

  async function makeTempDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'screenci-otp-'))
    tempDirs.push(dir)
    return dir
  }

  function stubFetch(fn: ReturnType<typeof vi.fn>): void {
    vi.stubGlobal('fetch', fn)
  }

  it("returns 'ready' without exchanging when the env already has SCREENCI_SECRET", async () => {
    const fetchSpy = vi.fn()
    stubFetch(fetchSpy)
    const dir = await makeTempDir()

    const outcome = await setUpInitSecret(dir, 'scotp_token', {
      env: { SCREENCI_SECRET: 'existing-secret' },
    })

    expect(outcome).toBe('ready')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("returns 'manual' when no OTP is provided", async () => {
    const fetchSpy = vi.fn()
    stubFetch(fetchSpy)
    const dir = await makeTempDir()

    const outcome = await setUpInitSecret(dir, undefined, { env: {} })

    expect(outcome).toBe('manual')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("exchanges the OTP, writes SCREENCI_SECRET to <islandDir>/.env, and returns 'ready'", async () => {
    stubFetch(
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ status: 'completed', secret: 'sec_written' }),
      })
    )
    const dir = await makeTempDir()

    const outcome = await setUpInitSecret(dir, 'scotp_token', { env: {} })

    expect(outcome).toBe('ready')
    const envContents = await readFile(join(dir, '.env'), 'utf-8')
    expect(envContents).toContain('SCREENCI_SECRET=sec_written')
  })

  it("returns 'manual' and warns when the OTP exchange fails", async () => {
    stubFetch(
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ status: 'expired' }),
      })
    )
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const dir = await makeTempDir()

    const outcome = await setUpInitSecret(dir, 'scotp_token', { env: {} })

    expect(outcome).toBe('manual')
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('one-time setup token')
    )
  })
})
