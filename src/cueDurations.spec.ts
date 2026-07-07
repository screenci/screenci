import { describe, it, expect, vi } from 'vitest'
import {
  fetchCueDurations,
  cueDurationCacheKey,
  type CueDurationEvent,
  type FetchCueDurationsDeps,
} from './cueDurations.js'

const CUE: CueDurationEvent = {
  type: 'cueStart',
  name: 'intro',
  translations: { en: { text: 'hello', voice: 'en.Jude' } },
}

function makeDeps(
  overrides: Partial<FetchCueDurationsDeps> = {}
): FetchCueDurationsDeps & { written: Record<string, string> } {
  const written: Record<string, string> = {}
  return {
    written,
    fetchFn: vi.fn(async () =>
      Response.json({
        durations: [{ name: 'intro', inputHash: 'h', durationMs: 1234 }],
      })
    ) as unknown as typeof fetch,
    readFile: vi.fn(async () => {
      throw new Error('no cache')
    }),
    writeFile: vi.fn(async (path: string, content: string) => {
      written[path] = content
    }),
    mkdir: vi.fn(async () => undefined),
    ...overrides,
  }
}

const params = (deps: FetchCueDurationsDeps) => ({
  language: 'en',
  cueEvents: [CUE],
  backendUrl: 'https://api.example',
  secret: 's3cret',
  cacheDir: '/repo/.screenci',
  deps,
})

describe('fetchCueDurations', () => {
  it('fetches durations from the backend and caches them', async () => {
    const deps = makeDeps()
    const result = await fetchCueDurations(params(deps))

    expect(result.get('intro')).toBe(1234)
    expect(deps.fetchFn).toHaveBeenCalledWith(
      'https://api.example/cli/cue-durations',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-ScreenCI-Secret': 's3cret' }),
      })
    )
    const cached = JSON.parse(
      deps.written['/repo/.screenci/cue-durations.json']!
    ) as Record<string, number>
    const key = cueDurationCacheKey('en', CUE.translations['en'])
    expect(cached[key]).toBe(1234)
  })

  it('serves from the disk cache without a network call', async () => {
    const key = cueDurationCacheKey('en', CUE.translations['en'])
    const deps = makeDeps({
      readFile: vi.fn(async () => JSON.stringify({ [key]: 900 })),
    })

    const result = await fetchCueDurations(params(deps))

    expect(result.get('intro')).toBe(900)
    expect(deps.fetchFn).not.toHaveBeenCalled()
  })

  it('resolves null for every cue when the backend errors, without caching', async () => {
    const deps = makeDeps({
      fetchFn: vi.fn(async () =>
        Response.json({ error: 'nope' }, { status: 500 })
      ) as unknown as typeof fetch,
    })

    const result = await fetchCueDurations(params(deps))

    expect(result.get('intro')).toBeNull()
    expect(deps.written).toEqual({})
  })

  it('resolves null when the network is unreachable (offline)', async () => {
    const deps = makeDeps({
      fetchFn: vi.fn(async () => {
        throw new Error('ECONNREFUSED')
      }) as unknown as typeof fetch,
    })

    const result = await fetchCueDurations(params(deps))
    expect(result.get('intro')).toBeNull()
  })

  it('does not cache a null duration so a later run retries', async () => {
    const deps = makeDeps({
      fetchFn: vi.fn(async () =>
        Response.json({ durations: [{ name: 'intro', durationMs: null }] })
      ) as unknown as typeof fetch,
    })

    const result = await fetchCueDurations(params(deps))
    expect(result.get('intro')).toBeNull()
    expect(deps.written).toEqual({})
  })
})
