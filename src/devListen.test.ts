import { describe, expect, it } from 'vitest'
import {
  DevAuthError,
  DevNetworkError,
  describeFetchError,
  registerDevListener,
  type DevListenConfig,
  type DevListenDeps,
} from './devListen.js'

const config: DevListenConfig = {
  apiUrl: 'https://api.example.test',
  credential: { header: 'X-ScreenCI-Secret', value: 's' },
  projectName: 'p',
  machineId: 'm',
}

const deps = (fetchFn: typeof fetch): DevListenDeps => ({
  fetchFn,
  sleep: async () => {},
  logger: { info: () => {}, warn: () => {}, error: () => {} },
})

describe('describeFetchError', () => {
  it('includes the cause chain and error codes', () => {
    const cause = Object.assign(new Error('getaddrinfo ENOTFOUND api.x'), {
      code: 'ENOTFOUND',
    })
    const err = new TypeError('fetch failed', { cause })
    expect(describeFetchError(err)).toBe(
      'fetch failed: getaddrinfo ENOTFOUND api.x'
    )
  })

  it('appends a code missing from the message', () => {
    const cause = Object.assign(new Error('connect failed'), {
      code: 'ECONNREFUSED',
    })
    expect(describeFetchError(new TypeError('fetch failed', { cause }))).toBe(
      'fetch failed: connect failed (ECONNREFUSED)'
    )
  })
})

describe('registerDevListener', () => {
  it('wraps a network failure with the URL and cause', async () => {
    const fetchFn = (async () => {
      throw new TypeError('fetch failed', {
        cause: Object.assign(new Error('connect ECONNREFUSED'), {
          code: 'ECONNREFUSED',
        }),
      })
    }) as unknown as typeof fetch
    const promise = registerDevListener(config, deps(fetchFn))
    await expect(promise).rejects.toBeInstanceOf(DevNetworkError)
    await expect(promise).rejects.toThrow(
      'Could not reach https://api.example.test/cli/dev/register: fetch failed: connect ECONNREFUSED'
    )
  })

  it('still reports a 401 as an auth error', async () => {
    const fetchFn = (async () =>
      new Response('nope', { status: 401 })) as unknown as typeof fetch
    await expect(
      registerDevListener(config, deps(fetchFn))
    ).rejects.toBeInstanceOf(DevAuthError)
  })
})
