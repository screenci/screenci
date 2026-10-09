import { describe, expect, it, vi } from 'vitest'
import {
  buildScreenCIContextOptions,
  FORWARDED_CONTEXT_OPTION_KEYS,
} from './contextOptions.js'
import {
  installOriginHeaders,
  isSameOrigin,
  mergeNetworkContextOptions,
  originHeadersExcluding,
  parseExtraHeadersJson,
  readNetworkContextOptions,
  readNetworkEnv,
} from './networkEnv.js'

describe('readNetworkContextOptions', () => {
  it('is empty without the variables', () => {
    expect(readNetworkContextOptions({})).toEqual({})
    expect(readNetworkContextOptions({ SCREENCI_PROXY_SERVER: ' ' })).toEqual(
      {}
    )
  })

  it('reads proxy, HTTP credentials and extra headers', () => {
    expect(
      readNetworkContextOptions({
        SCREENCI_PROXY_SERVER: 'http://proxy.example.com:3128',
        SCREENCI_PROXY_USERNAME: 'p-user',
        SCREENCI_PROXY_PASSWORD: 'p-pass',
        SCREENCI_HTTP_CREDENTIALS_USERNAME: 'basic',
        SCREENCI_HTTP_CREDENTIALS_PASSWORD: 'secret',
        SCREENCI_EXTRA_HEADERS_JSON: '{"X-Bypass":"token","X-Env":"preview"}',
      })
    ).toEqual({
      proxy: {
        server: 'http://proxy.example.com:3128',
        username: 'p-user',
        password: 'p-pass',
      },
      httpCredentials: { username: 'basic', password: 'secret' },
      extraHTTPHeaders: { 'X-Bypass': 'token', 'X-Env': 'preview' },
    })
  })

  it('ignores a proxy password without a username', () => {
    expect(
      readNetworkContextOptions({
        SCREENCI_PROXY_SERVER: 'http://proxy:1',
        SCREENCI_PROXY_PASSWORD: 'x',
      })
    ).toEqual({ proxy: { server: 'http://proxy:1' } })
  })

  it('explains a malformed headers variable', () => {
    expect(() => parseExtraHeadersJson('{nope')).toThrow(/not valid JSON/)
    expect(() => parseExtraHeadersJson('["a"]')).toThrow(/JSON object/)
    expect(() => parseExtraHeadersJson('{"A":1}')).toThrow(/must be a string/)
  })
})

describe('mergeNetworkContextOptions', () => {
  const network = readNetworkContextOptions({
    SCREENCI_PROXY_SERVER: 'http://env-proxy:1',
    SCREENCI_HTTP_CREDENTIALS_USERNAME: 'env-user',
    SCREENCI_HTTP_CREDENTIALS_PASSWORD: 'env-pass',
    SCREENCI_EXTRA_HEADERS_JSON: '{"X-A":"env","X-B":"env"}',
  })

  it('fills what the config leaves unset', () => {
    expect(mergeNetworkContextOptions({ locale: 'fi-FI' }, network)).toEqual({
      locale: 'fi-FI',
      proxy: { server: 'http://env-proxy:1' },
      httpCredentials: { username: 'env-user', password: 'env-pass' },
      extraHTTPHeaders: { 'X-A': 'env', 'X-B': 'env' },
    })
  })

  it('lets the config win, header by header', () => {
    expect(
      mergeNetworkContextOptions(
        {
          proxy: { server: 'http://config-proxy:2' },
          httpCredentials: { username: 'cfg', password: 'cfg' },
          extraHTTPHeaders: { 'X-A': 'config' },
        },
        network
      )
    ).toEqual({
      proxy: { server: 'http://config-proxy:2' },
      httpCredentials: { username: 'cfg', password: 'cfg' },
      extraHTTPHeaders: { 'X-A': 'config', 'X-B': 'env' },
    })
  })

  it('reaches the browser context options', () => {
    expect(FORWARDED_CONTEXT_OPTION_KEYS).toContain('proxy')
    const options = buildScreenCIContextOptions({
      dimensions: { width: 1920, height: 1080 },
      forwarded: mergeNetworkContextOptions({}, network),
      applyLocaleDefault: false,
    })
    expect(options.proxy).toEqual({ server: 'http://env-proxy:1' })
    expect(options.extraHTTPHeaders).toEqual({ 'X-A': 'env', 'X-B': 'env' })
  })
})

describe('SCREENCI_CREDENTIAL_ORIGIN', () => {
  const env = {
    SCREENCI_CREDENTIAL_ORIGIN: 'https://app.example.com/some/path',
    SCREENCI_PROXY_SERVER: 'http://proxy:1',
    SCREENCI_HTTP_CREDENTIALS_USERNAME: 'u',
    SCREENCI_HTTP_CREDENTIALS_PASSWORD: 'p',
    SCREENCI_EXTRA_HEADERS_JSON: '{"X-Bypass":"t","X-Config":"env"}',
  }

  it('binds credentials and headers to the origin; the proxy stays global', () => {
    expect(readNetworkEnv(env)).toEqual({
      contextOptions: {
        proxy: { server: 'http://proxy:1' },
        httpCredentials: {
          username: 'u',
          password: 'p',
          origin: 'https://app.example.com',
        },
      },
      originHeaders: {
        origin: 'https://app.example.com',
        headers: { 'X-Bypass': 't', 'X-Config': 'env' },
      },
    })
  })

  it('refuses an origin that is not http(s)', () => {
    expect(() =>
      readNetworkEnv({ SCREENCI_CREDENTIAL_ORIGIN: 'file:///etc' })
    ).toThrow(/http or https/)
    expect(() =>
      readNetworkEnv({ SCREENCI_CREDENTIAL_ORIGIN: 'not a url' })
    ).toThrow(/origin like/)
  })

  it('leaves out headers the config sets itself', () => {
    const { originHeaders } = readNetworkEnv(env)
    expect(
      originHeadersExcluding(originHeaders, { 'x-config': 'cfg' })
    ).toEqual({
      origin: 'https://app.example.com',
      headers: { 'X-Bypass': 't' },
    })
    expect(
      originHeadersExcluding(originHeaders, {
        'X-Bypass': 'a',
        'X-Config': 'b',
      })
    ).toBeNull()
    expect(originHeadersExcluding(null, undefined)).toBeNull()
  })

  it('adds the headers only to requests for the origin', async () => {
    let handler:
      | ((route: {
          request(): { url(): string; headers(): Record<string, string> }
          fallback(options?: {
            headers?: Record<string, string>
          }): Promise<void>
        }) => Promise<void>)
      | undefined
    await installOriginHeaders(
      {
        route: async (_url, h) => {
          handler = h
        },
      },
      { origin: 'https://app.example.com', headers: { 'X-Bypass': 't' } }
    )
    const fallbacks: Array<Record<string, string> | undefined> = []
    const request = (url: string) => ({
      request: () => ({ url: () => url, headers: () => ({ accept: '*/*' }) }),
      fallback: async (options?: { headers?: Record<string, string> }) => {
        fallbacks.push(options?.headers)
      },
    })
    await handler!(request('https://app.example.com/api'))
    await handler!(request('https://app.example.com.evil.test/'))
    await handler!(request('http://app.example.com/'))
    expect(fallbacks).toEqual([
      { accept: '*/*', 'X-Bypass': 't' },
      undefined,
      undefined,
    ])
    expect(
      isSameOrigin('https://app.example.com:443/x', 'https://app.example.com')
    ).toBe(true)
  })

  it('installs nothing without origin headers', async () => {
    const route = vi.fn()
    await installOriginHeaders({ route }, null)
    expect(route).not.toHaveBeenCalled()
  })
})
