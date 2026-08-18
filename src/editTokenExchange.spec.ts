import { describe, expect, it, vi } from 'vitest'
import { exchangeEditToken } from './editTokenExchange.js'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('exchangeEditToken', () => {
  it('posts the machine name with the secret header and returns the token', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ editToken: 'tok-1' }))
    const result = await exchangeEditToken({
      apiUrl: 'https://api.example.com',
      secret: 'secret-1',
      machineName: 'laptop',
      fetchFn: fetchFn as unknown as typeof fetch,
    })
    expect(result).toEqual({ ok: true, editToken: 'tok-1' })
    expect(fetchFn).toHaveBeenCalledWith(
      'https://api.example.com/cli/dev/exchange-token',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-ScreenCI-Secret': 'secret-1' }),
        body: JSON.stringify({ machineName: 'laptop' }),
      })
    )
  })

  it('surfaces the server error message on a non-ok response', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ error: 'Invalid secret' }, 401)
    )
    const result = await exchangeEditToken({
      apiUrl: 'https://api.example.com',
      secret: 'bad',
      machineName: 'laptop',
      fetchFn: fetchFn as unknown as typeof fetch,
    })
    expect(result).toEqual({ ok: false, error: 'Invalid secret' })
  })

  it('falls back to a status message when the error body is not JSON', async () => {
    const fetchFn = vi.fn(async () => new Response('nope', { status: 500 }))
    const result = await exchangeEditToken({
      apiUrl: 'https://api.example.com',
      secret: 's',
      machineName: 'laptop',
      fetchFn: fetchFn as unknown as typeof fetch,
    })
    expect(result).toEqual({
      ok: false,
      error: 'Token exchange failed with status 500',
    })
  })

  it('rejects an ok response without an editToken', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}))
    const result = await exchangeEditToken({
      apiUrl: 'https://api.example.com',
      secret: 's',
      machineName: 'laptop',
      fetchFn: fetchFn as unknown as typeof fetch,
    })
    expect(result).toEqual({
      ok: false,
      error: 'Token exchange returned an invalid response',
    })
  })

  it('reports network failures without throwing', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    })
    const result = await exchangeEditToken({
      apiUrl: 'https://api.example.com',
      secret: 's',
      machineName: 'laptop',
      fetchFn: fetchFn as unknown as typeof fetch,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('ECONNREFUSED')
  })
})
