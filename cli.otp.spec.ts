import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  INIT_OTP_PREFIX,
  exchangeInitOtp,
  isPlaceholderInitOtp,
  looksLikeInitOtp,
  looksLikeScreenCISecret,
  verifyScreenCISecret,
} from './src/linkSession.js'
import { setUpInitSecret } from './src/init.js'
import { logger } from './src/logger.js'

describe('looksLikeInitOtp', () => {
  it('uses the otp_ prefix to recognize an init one-time password', () => {
    expect(INIT_OTP_PREFIX).toBe('otp_')
    expect(looksLikeInitOtp('otp_abc123')).toBe(true)
  })

  it('treats a plain project name as not an OTP', () => {
    expect(looksLikeInitOtp('my-project')).toBe(false)
    expect(looksLikeInitOtp('screenci')).toBe(false)
    expect(looksLikeInitOtp('')).toBe(false)
  })
})

describe('isPlaceholderInitOtp', () => {
  it('recognizes the docs placeholders (case-insensitively, trimmed)', () => {
    expect(isPlaceholderInitOtp('otp_your_token')).toBe(true)
    expect(isPlaceholderInitOtp('otp_your_one_time_token')).toBe(true)
    expect(isPlaceholderInitOtp('otp_PASTE_YOUR_TOKEN_HERE')).toBe(true)
    expect(isPlaceholderInitOtp('  otp_paste_your_token_here  ')).toBe(true)
  })

  it('treats a real-looking token as not a placeholder', () => {
    expect(isPlaceholderInitOtp('otp_abc123def456')).toBe(false)
    expect(isPlaceholderInitOtp('my-project')).toBe(false)
  })
})

describe('looksLikeScreenCISecret', () => {
  it('recognizes a bare v4 UUID (the SCREENCI_SECRET shape), trimmed', () => {
    expect(
      looksLikeScreenCISecret('3f9c2b1a-7d4e-4a2b-9c8f-1e2d3a4b5c6d')
    ).toBe(true)
    expect(
      looksLikeScreenCISecret('  3F9C2B1A-7D4E-4A2B-9C8F-1E2D3A4B5C6D  ')
    ).toBe(true)
  })

  it('rejects OTPs, project names, and non-v4 UUIDs', () => {
    expect(looksLikeScreenCISecret('otp_abc123')).toBe(false)
    expect(looksLikeScreenCISecret('my-project')).toBe(false)
    // v1 UUID (version nibble is 1, not 4)
    expect(
      looksLikeScreenCISecret('3f9c2b1a-7d4e-1a2b-9c8f-1e2d3a4b5c6d')
    ).toBe(false)
  })
})

describe('verifyScreenCISecret', () => {
  function asFetch(fn: ReturnType<typeof vi.fn>): typeof fetch {
    return fn as unknown as typeof fetch
  }

  it('GETs /cli/whoami with the secret header and returns the org id on 200', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ orgId: 'org_123' }),
    })

    const result = await verifyScreenCISecret('the-secret', {
      backendUrl: 'https://api.example.com',
      fetchImpl: asFetch(fetchImpl),
    })

    expect(result).toEqual({ ok: true, orgId: 'org_123' })
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.example.com/cli/whoami',
      {
        method: 'GET',
        headers: { 'X-ScreenCI-Secret': 'the-secret' },
      }
    )
  })

  it("reports 'invalid' when the backend rejects the secret", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 401, json: async () => ({}) })

    const result = await verifyScreenCISecret('nope', {
      fetchImpl: asFetch(fetchImpl),
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.kind).toBe('invalid')
  })

  it("reports 'unreachable' when fetch rejects (so the caller can accept optimistically)", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'))

    const result = await verifyScreenCISecret('the-secret', {
      fetchImpl: asFetch(fetchImpl),
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('unreachable')
      expect(result.reason).toBe('network down')
    }
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

    const result = await exchangeInitOtp('otp_token', {
      backendUrl: 'https://api.example.com',
      fetchImpl: asFetch(fetchImpl),
    })

    expect(result).toEqual({ ok: true, secret: 'sec_abc' })
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.example.com/cli-link/exchange',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ otp: 'otp_token' }),
      }
    )
  })

  it('reports an already-used token when the status is consumed', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(makeResponse({ status: 'consumed' }, false))

    const result = await exchangeInitOtp('otp_token', {
      fetchImpl: asFetch(fetchImpl),
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/already been used/i)
  })

  it('reports an expired token when the status is expired', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(makeResponse({ status: 'expired' }, false))

    const result = await exchangeInitOtp('otp_token', {
      fetchImpl: asFetch(fetchImpl),
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/expired/i)
  })

  it('reports an invalid token for any other status', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(makeResponse({ status: 'whatever' }, false))

    const result = await exchangeInitOtp('otp_token', {
      fetchImpl: asFetch(fetchImpl),
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/invalid/i)
  })

  it('never throws when fetch rejects, returning the error message as the reason', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'))

    const result = await exchangeInitOtp('otp_token', {
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

    const outcome = await setUpInitSecret(dir, 'otp_token', {
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

    const outcome = await setUpInitSecret(dir, 'otp_token', { env: {} })

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

    const outcome = await setUpInitSecret(dir, 'otp_token', { env: {} })

    expect(outcome).toBe('manual')
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('one-time setup token')
    )
  })

  it("returns 'manual' without a network call and warns when the OTP is the docs placeholder", async () => {
    const fetchSpy = vi.fn()
    stubFetch(fetchSpy)
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const dir = await makeTempDir()

    const outcome = await setUpInitSecret(dir, 'otp_PASTE_YOUR_TOKEN_HERE', {
      env: {},
    })

    expect(outcome).toBe('manual')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('placeholder'))
  })

  it("verifies a pasted secret, writes it to <islandDir>/.env, and returns 'ready'", async () => {
    stubFetch(
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ orgId: 'org_123' }),
      })
    )
    const dir = await makeTempDir()
    const secret = '3f9c2b1a-7d4e-4a2b-9c8f-1e2d3a4b5c6d'

    const outcome = await setUpInitSecret(dir, undefined, {
      env: {},
      pastedSecret: secret,
    })

    expect(outcome).toBe('ready')
    const envContents = await readFile(join(dir, '.env'), 'utf-8')
    expect(envContents).toContain(`SCREENCI_SECRET=${secret}`)
  })

  it("returns 'manual' and warns when the pasted secret is rejected", async () => {
    stubFetch(
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({}),
      })
    )
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const dir = await makeTempDir()

    const outcome = await setUpInitSecret(dir, undefined, {
      env: {},
      pastedSecret: '3f9c2b1a-7d4e-4a2b-9c8f-1e2d3a4b5c6d',
    })

    expect(outcome).toBe('manual')
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('not recognized')
    )
  })

  it("writes the pasted secret optimistically and returns 'ready' when verification is unreachable", async () => {
    stubFetch(vi.fn().mockRejectedValue(new Error('network down')))
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const dir = await makeTempDir()
    const secret = '3f9c2b1a-7d4e-4a2b-9c8f-1e2d3a4b5c6d'

    const outcome = await setUpInitSecret(dir, undefined, {
      env: {},
      pastedSecret: secret,
    })

    expect(outcome).toBe('ready')
    const envContents = await readFile(join(dir, '.env'), 'utf-8')
    expect(envContents).toContain(`SCREENCI_SECRET=${secret}`)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Could not verify the secret')
    )
  })
})
