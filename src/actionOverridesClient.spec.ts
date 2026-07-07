import { describe, expect, it, vi } from 'vitest'
import { createActionOverridesClient } from './actionOverridesClient.js'

const INPUT = {
  apiUrl: 'https://api.example.test',
  secret: 'sk-test',
  projectName: 'My Project',
}

function fakeFetch(status: number, body?: unknown): typeof fetch {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch
}

describe('createActionOverridesClient', () => {
  it('fetches /cli/action-overrides with the project and secret', async () => {
    const overrides = {
      'My video': { "getByRole('button')|click|0|move.duration": 250 },
    }
    const fetchImpl = fakeFetch(200, { overrides })
    const client = createActionOverridesClient(fetchImpl)
    await expect(client.fetchActionOverrides(INPUT)).resolves.toEqual(overrides)
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit]
    expect(url).toBe(
      'https://api.example.test/cli/action-overrides?projectName=My+Project'
    )
    expect((init.headers as Record<string, string>)['X-ScreenCI-Secret']).toBe(
      'sk-test'
    )
  })

  it('treats a 404 (endpoint not deployed) as no overrides', async () => {
    const client = createActionOverridesClient(fakeFetch(404))
    await expect(client.fetchActionOverrides(INPUT)).resolves.toEqual({})
  })

  it('throws on other failures so callers can degrade loudly or quietly', async () => {
    const client = createActionOverridesClient(fakeFetch(500))
    await expect(client.fetchActionOverrides(INPUT)).rejects.toThrow('500')
  })

  it('tolerates malformed bodies', async () => {
    for (const body of [{}, { overrides: null }, { overrides: [1] }]) {
      const client = createActionOverridesClient(fakeFetch(200, body))
      await expect(client.fetchActionOverrides(INPUT)).resolves.toEqual({})
    }
    const client = createActionOverridesClient(
      fakeFetch(200, { overrides: { good: { k: 1 }, bad: 'x' } })
    )
    await expect(client.fetchActionOverrides(INPUT)).resolves.toEqual({
      good: { k: 1 },
    })
  })
})
