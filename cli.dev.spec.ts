import { describe, expect, it, vi } from 'vitest'
import type { DevListenConfig, DevListenDeps } from './src/devListen'
import {
  DEV_TOKEN_HEADER,
  DevAuthError,
  deregisterDevListener,
  registerDevListener,
  reportDevSyncState,
} from './src/devListen'

const config: DevListenConfig = {
  apiUrl: 'http://localhost:8787',
  credential: { header: 'X-ScreenCI-Secret', value: 'org-secret' },
  devToken: 'dev-token',
  projectName: 'demo',
  machineName: 'laptop',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function makeDeps(overrides: Partial<DevListenDeps> = {}): DevListenDeps & {
  fetchMock: ReturnType<typeof vi.fn>
} {
  const fetchMock = vi.fn(async () => jsonResponse({ ok: true }))
  return {
    fetchFn: fetchMock as unknown as typeof fetch,
    fetchMock,
    sleep: vi.fn(async () => {}),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...overrides,
  }
}

describe('registerDevListener', () => {
  it('sends both credentials and the machine name', async () => {
    const deps = makeDeps()
    deps.fetchMock.mockResolvedValueOnce(jsonResponse({ listenerId: 'lst_1' }))

    const result = await registerDevListener(config, deps)

    expect(result).toEqual({ listenerId: 'lst_1' })
    const [url, init] = deps.fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:8787/cli/dev/register')
    const headers = init.headers as Record<string, string>
    expect(headers['X-ScreenCI-Secret']).toBe('org-secret')
    expect(headers[DEV_TOKEN_HEADER]).toBe('dev-token')
    expect(JSON.parse(init.body as string)).toEqual({
      projectName: 'demo',
      machineName: 'laptop',
    })
  })

  it('throws DevAuthError on a 401', async () => {
    const deps = makeDeps()
    deps.fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'Invalid editor token' }, 401)
    )

    await expect(registerDevListener(config, deps)).rejects.toBeInstanceOf(
      DevAuthError
    )
  })
})

describe('reportDevSyncState', () => {
  it('reports the syncing video names for the listener', async () => {
    const deps = makeDeps()
    await reportDevSyncState(config, deps, 'lst_1', ['Intro video'])
    const [url, init] = deps.fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:8787/cli/dev/sync-state')
    expect(JSON.parse(init.body as string)).toEqual({
      projectName: 'demo',
      listenerId: 'lst_1',
      syncingVideoNames: ['Intro video'],
    })
  })

  it('tolerates an empty 2xx body', async () => {
    const deps = makeDeps()
    deps.fetchMock.mockResolvedValueOnce(new Response('', { status: 200 }))
    await expect(
      reportDevSyncState(config, deps, 'lst_1', [])
    ).resolves.toBeUndefined()
  })
})

describe('deregisterDevListener', () => {
  it('deregisters with the listener id', async () => {
    const deps = makeDeps()
    await deregisterDevListener(config, deps, 'lst_1')
    const [url, init] = deps.fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:8787/cli/dev/deregister')
    expect(JSON.parse(init.body as string).listenerId).toBe('lst_1')
  })
})
