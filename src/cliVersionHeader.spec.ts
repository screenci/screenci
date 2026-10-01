import { describe, expect, it, vi } from 'vitest'
import { CLI_VERSION_HEADER, withCliVersionHeader } from './cliVersionHeader.js'

function setup() {
  const base = vi.fn(
    async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) =>
      new Response('ok')
  )
  const wrapped = withCliVersionHeader(base, '1.2.3')
  const sentHeaders = () => new Headers(base.mock.calls[0]?.[1]?.headers)
  return { base, wrapped, sentHeaders }
}

describe('withCliVersionHeader', () => {
  it('adds the version to /cli/ requests and keeps existing headers', async () => {
    const { wrapped, sentHeaders } = setup()
    await wrapped('https://api.screenci.com/cli/upload/start', {
      method: 'POST',
      headers: { 'X-ScreenCI-Secret': 's' },
    })
    expect(sentHeaders().get(CLI_VERSION_HEADER)).toBe('1.2.3')
    expect(sentHeaders().get('X-ScreenCI-Secret')).toBe('s')
  })

  it('handles URL inputs', async () => {
    const { wrapped, sentHeaders } = setup()
    await wrapped(new URL('http://localhost:8787/cli/video/abc'))
    expect(sentHeaders().get(CLI_VERSION_HEADER)).toBe('1.2.3')
  })

  it('leaves non-CLI requests untouched', async () => {
    const { base, wrapped } = setup()
    const init = { method: 'PUT' }
    await wrapped('https://storage.example.com/bucket/file', init)
    expect(base).toHaveBeenCalledWith(
      'https://storage.example.com/bucket/file',
      init
    )
  })
})
