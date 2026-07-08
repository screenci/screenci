import { describe, expect, it, vi } from 'vitest'
import type {
  DevListenConfig,
  DevListenDeps,
  DevTrigger,
} from './src/devListen'
import {
  DEV_TOKEN_HEADER,
  DevAuthError,
  deregisterDevListener,
  pollDevListener,
  registerDevListener,
  reportDevTrigger,
  runDevListenLoop,
} from './src/devListen'

const config: DevListenConfig = {
  apiUrl: 'http://localhost:8787',
  secret: 'org-secret',
  devToken: 'dev-token',
  projectName: 'demo',
  machineName: 'laptop',
  pollIntervalMs: 1,
  errorBackoffMs: 1,
  runHeartbeatMs: 1000,
}

const trigger: DevTrigger = {
  triggerId: 'trg_1',
  videoName: 'Intro video',
  language: 'fi',
  requestedByName: 'Olli',
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
    runRecord: vi.fn(async () => {}),
    setIntervalFn: vi.fn(() => () => {}),
    ...overrides,
  }
}

describe('registerDevListener', () => {
  it('sends both credentials and the machine name', async () => {
    const deps = makeDeps()
    deps.fetchMock.mockResolvedValueOnce(
      jsonResponse({ listenerId: 'lst_1', userName: 'Olli' })
    )

    const result = await registerDevListener(config, deps)

    expect(result).toEqual({ listenerId: 'lst_1', userName: 'Olli' })
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
      jsonResponse({ error: 'Invalid dev token' }, 401)
    )

    await expect(registerDevListener(config, deps)).rejects.toBeInstanceOf(
      DevAuthError
    )
  })
})

describe('pollDevListener', () => {
  it('returns the claimed trigger', async () => {
    const deps = makeDeps()
    deps.fetchMock.mockResolvedValueOnce(jsonResponse({ trigger }))

    await expect(pollDevListener(config, deps, 'lst_1')).resolves.toEqual(
      trigger
    )
  })

  it('returns null when nothing is pending', async () => {
    const deps = makeDeps()
    deps.fetchMock.mockResolvedValueOnce(jsonResponse({ trigger: null }))

    await expect(pollDevListener(config, deps, 'lst_1')).resolves.toBeNull()
  })

  it('treats an empty 2xx body as no trigger instead of throwing', async () => {
    const deps = makeDeps()
    // The /cli/dev/* proxy (or an idle keep-alive) can return an empty body;
    // res.json() on it throws "Unexpected end of JSON input".
    deps.fetchMock.mockResolvedValueOnce(new Response('', { status: 200 }))

    await expect(pollDevListener(config, deps, 'lst_1')).resolves.toBeNull()
  })
})

describe('runDevListenLoop', () => {
  it('claims a trigger, reports running, records, and reports done', async () => {
    const controller = { stopped: false }
    const runRecord = vi.fn(async () => {})
    const deps = makeDeps({ runRecord })
    deps.fetchMock.mockImplementation(
      async (url: string, init: RequestInit) => {
        if (url.endsWith('/cli/dev/poll')) {
          // First poll returns the trigger, later polls stop the loop.
          if (deps.fetchMock.mock.calls.length === 1) {
            return jsonResponse({ trigger })
          }
          controller.stopped = true
          return jsonResponse({ trigger: null })
        }
        expect(url.endsWith('/cli/dev/report')).toBe(true)
        void init
        return jsonResponse({ ok: true })
      }
    )

    await runDevListenLoop(config, deps, 'lst_1', controller)

    expect(runRecord).toHaveBeenCalledWith(trigger)
    const reports = deps.fetchMock.mock.calls
      .filter(([url]) => (url as string).endsWith('/cli/dev/report'))
      .map(([, init]) => JSON.parse((init as RequestInit).body as string))
    expect(reports.map((r) => r.state)).toEqual(['running', 'done'])
    expect(reports[1].triggerId).toBe('trg_1')
  })

  it('reports failed with the error message when the record throws', async () => {
    const controller = { stopped: false }
    const runRecord = vi.fn(async () => {
      throw new Error('Playwright exited with code 1')
    })
    const deps = makeDeps({ runRecord })
    deps.fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/cli/dev/poll')) {
        if (deps.fetchMock.mock.calls.length === 1) {
          return jsonResponse({ trigger })
        }
        controller.stopped = true
        return jsonResponse({ trigger: null })
      }
      return jsonResponse({ ok: true })
    })

    await runDevListenLoop(config, deps, 'lst_1', controller)

    const reports = deps.fetchMock.mock.calls
      .filter(([url]) => (url as string).endsWith('/cli/dev/report'))
      .map(([, init]) => JSON.parse((init as RequestInit).body as string))
    expect(reports.map((r) => r.state)).toEqual(['running', 'failed'])
    expect(reports[1].errorMessage).toBe('Playwright exited with code 1')
  })

  it('keeps polling with a backoff after a network error', async () => {
    const controller = { stopped: false }
    const sleep = vi.fn(async () => {})
    const deps = makeDeps({ sleep })
    deps.fetchMock.mockImplementation(async () => {
      if (deps.fetchMock.mock.calls.length === 1) {
        throw new Error('ECONNREFUSED')
      }
      controller.stopped = true
      return jsonResponse({ trigger: null })
    })

    await runDevListenLoop(config, deps, 'lst_1', controller)

    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('ECONNREFUSED')
    )
    expect(sleep).toHaveBeenCalledWith(config.errorBackoffMs)
    expect(deps.fetchMock.mock.calls.length).toBe(2)
  })

  it('stops and propagates DevAuthError when the token is revoked', async () => {
    const controller = { stopped: false }
    const deps = makeDeps()
    deps.fetchMock.mockResolvedValue(
      jsonResponse({ error: 'Invalid dev token' }, 401)
    )

    await expect(
      runDevListenLoop(config, deps, 'lst_1', controller)
    ).rejects.toBeInstanceOf(DevAuthError)
  })
})

describe('reportDevTrigger and deregisterDevListener', () => {
  it('omits errorMessage unless provided', async () => {
    const deps = makeDeps()
    await reportDevTrigger(config, deps, 'lst_1', 'trg_1', 'done')
    const body = JSON.parse(
      (deps.fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string
    )
    expect(body).toEqual({
      projectName: 'demo',
      listenerId: 'lst_1',
      triggerId: 'trg_1',
      state: 'done',
    })
  })

  it('deregisters with the listener id', async () => {
    const deps = makeDeps()
    await deregisterDevListener(config, deps, 'lst_1')
    const [url, init] = deps.fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:8787/cli/dev/deregister')
    expect(JSON.parse(init.body as string).listenerId).toBe('lst_1')
  })
})
