import { describe, expect, it } from 'vitest'
import { probeSite } from './siteProbe.js'

describe('probeSite', () => {
  it('treats any HTTP response as reachable', async () => {
    const fetchFn = (async () =>
      new Response('nope', { status: 503 })) as unknown as typeof fetch
    expect(await probeSite('http://localhost:3000', fetchFn)).toBe(true)
  })

  it('treats a connection failure as unreachable', async () => {
    const fetchFn = (async () => {
      throw new Error('ECONNREFUSED')
    }) as unknown as typeof fetch
    expect(await probeSite('http://localhost:3000', fetchFn)).toBe(false)
  })

  it('gives up after the timeout', async () => {
    const fetchFn = ((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new Error('aborted'))
        )
      })) as unknown as typeof fetch
    expect(await probeSite('http://localhost:3000', fetchFn, 10)).toBe(false)
  })
})
