import { describe, expect, it, vi } from 'vitest'
import type {
  DevCodegenRequest,
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

const codegenRequest: DevCodegenRequest = {
  requestId: 'cgr_1',
  videoName: 'Intro video',
  editId: 'delay1',
  editJson: '{"kind":"paramEdit"}',
  requiresRecord: true,
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
  it('returns the claimed trigger and codegen requests', async () => {
    const deps = makeDeps()
    deps.fetchMock.mockResolvedValueOnce(
      jsonResponse({ trigger, codegenRequests: [codegenRequest] })
    )

    await expect(pollDevListener(config, deps, 'lst_1')).resolves.toEqual({
      trigger,
      codegenRequests: [codegenRequest],
    })
  })

  it('returns an empty result when nothing is pending', async () => {
    const deps = makeDeps()
    deps.fetchMock.mockResolvedValueOnce(jsonResponse({ trigger: null }))

    await expect(pollDevListener(config, deps, 'lst_1')).resolves.toEqual({
      trigger: null,
      codegenRequests: [],
    })
  })

  it('treats an empty 2xx body as no trigger instead of throwing', async () => {
    const deps = makeDeps()
    // The /cli/dev/* proxy (or an idle keep-alive) can return an empty body;
    // res.json() on it throws "Unexpected end of JSON input".
    deps.fetchMock.mockResolvedValueOnce(new Response('', { status: 200 }))

    await expect(pollDevListener(config, deps, 'lst_1')).resolves.toEqual({
      trigger: null,
      codegenRequests: [],
    })
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

    expect(runRecord).toHaveBeenCalledWith(trigger, expect.any(AbortSignal))
    const reports = deps.fetchMock.mock.calls
      .filter(([url]) => (url as string).endsWith('/cli/dev/report'))
      .map(([, init]) => JSON.parse((init as RequestInit).body as string))
    expect(reports.map((r) => r.state)).toEqual(['running', 'done'])
    expect(reports[1].triggerId).toBe('trg_1')
  })

  it('passes a previewOnly trigger through to the record runner', async () => {
    const controller = { stopped: false }
    const runRecord = vi.fn(async () => {})
    const deps = makeDeps({ runRecord })
    const previewTrigger: DevTrigger = { ...trigger, previewOnly: true }
    deps.fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/cli/dev/poll')) {
        if (deps.fetchMock.mock.calls.length === 1) {
          return jsonResponse({ trigger: previewTrigger })
        }
        controller.stopped = true
        return jsonResponse({ trigger: null })
      }
      return jsonResponse({ ok: true })
    })

    await runDevListenLoop(config, deps, 'lst_1', controller)

    expect(runRecord).toHaveBeenCalledWith(
      expect.objectContaining({ previewOnly: true }),
      expect.any(AbortSignal)
    )
  })

  it('applies codegen requests and reports them applied', async () => {
    const controller = { stopped: false }
    const applyCodegen = vi.fn(async () => {})
    const deps = makeDeps({ applyCodegen })
    deps.fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/cli/dev/poll')) {
        if (deps.fetchMock.mock.calls.length === 1) {
          return jsonResponse({
            trigger: null,
            codegenRequests: [codegenRequest],
          })
        }
        controller.stopped = true
        return jsonResponse({ trigger: null })
      }
      return jsonResponse({ ok: true })
    })

    await runDevListenLoop(config, deps, 'lst_1', controller)

    expect(applyCodegen).toHaveBeenCalledWith(codegenRequest)
    const reports = deps.fetchMock.mock.calls
      .filter(([url]) => (url as string).endsWith('/cli/dev/report-codegen'))
      .map(([, init]) => JSON.parse((init as RequestInit).body as string))
    expect(reports).toEqual([
      expect.objectContaining({
        requestId: 'cgr_1',
        state: 'applied',
        listenerId: 'lst_1',
      }),
    ])
  })

  it('reports codegen failed with the error message when the apply throws', async () => {
    const controller = { stopped: false }
    const applyCodegen = vi.fn(async () => {
      throw new Error('editId not found in source')
    })
    const deps = makeDeps({ applyCodegen })
    deps.fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/cli/dev/poll')) {
        if (deps.fetchMock.mock.calls.length === 1) {
          return jsonResponse({ codegenRequests: [codegenRequest] })
        }
        controller.stopped = true
        return jsonResponse({})
      }
      return jsonResponse({ ok: true })
    })

    await runDevListenLoop(config, deps, 'lst_1', controller)

    const reports = deps.fetchMock.mock.calls
      .filter(([url]) => (url as string).endsWith('/cli/dev/report-codegen'))
      .map(([, init]) => JSON.parse((init as RequestInit).body as string))
    expect(reports).toEqual([
      expect.objectContaining({
        state: 'failed',
        errorMessage: 'editId not found in source',
      }),
    ])
  })

  it('serves codegen requests while a record is running', async () => {
    const controller = { stopped: false }
    let releaseRecord = () => {}
    const recordGate = new Promise<void>((resolve) => {
      releaseRecord = resolve
    })
    const runRecord = vi.fn(async () => recordGate)
    const applyCodegen = vi.fn(async () => {})
    const deps = makeDeps({ runRecord, applyCodegen })
    let polls = 0
    deps.fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/cli/dev/poll')) {
        polls += 1
        if (polls === 1) return jsonResponse({ trigger })
        if (polls === 2) {
          // The record is still running; the codegen must be served anyway.
          return jsonResponse({ codegenRequests: [codegenRequest] })
        }
        // Stop only once the codegen was served mid-record.
        if (applyCodegen.mock.calls.length > 0) {
          expect(runRecord).toHaveBeenCalled()
          controller.stopped = true
          releaseRecord()
        }
        return jsonResponse({})
      }
      return jsonResponse({ ok: true })
    })

    await runDevListenLoop(config, deps, 'lst_1', controller)

    expect(applyCodegen).toHaveBeenCalledWith(codegenRequest)
    const triggerReports = deps.fetchMock.mock.calls
      .filter(([url]) => (url as string).endsWith('/cli/dev/report'))
      .map(([, init]) => JSON.parse((init as RequestInit).body as string))
    expect(triggerReports.map((r) => r.state)).toEqual(['running', 'done'])
  })

  it('kills a young record when a new trigger arrives and runs the new one', async () => {
    const controller = { stopped: false }
    let clock = 0
    const secondTrigger: DevTrigger = { ...trigger, triggerId: 'trg_2' }
    const runRecord = vi.fn(
      (t: DevTrigger, signal?: AbortSignal) =>
        new Promise<void>((resolve, reject) => {
          if (t.triggerId === 'trg_2') {
            resolve()
            return
          }
          // First record: runs until killed.
          signal?.addEventListener('abort', () =>
            reject(new Error('Record aborted'))
          )
        })
    )
    const deps = makeDeps({ runRecord, now: () => clock })
    const seenReports: Array<{ triggerId: string; state: string }> = []
    let polls = 0
    deps.fetchMock.mockImplementation(
      async (url: string, init?: RequestInit) => {
        if (url.endsWith('/cli/dev/report')) {
          seenReports.push(JSON.parse((init as RequestInit).body as string))
        }
        if (url.endsWith('/cli/dev/poll')) {
          polls += 1
          if (polls === 1) return jsonResponse({ trigger })
          if (polls === 2) {
            clock = 5_000 // Inside the 10s kill window.
            return jsonResponse({ trigger: secondTrigger })
          }
          // Stop only once the replacement record has reported done.
          if (
            seenReports.some(
              (r) => r.triggerId === 'trg_2' && r.state === 'done'
            )
          ) {
            controller.stopped = true
          }
          return jsonResponse({})
        }
        return jsonResponse({ ok: true })
      }
    )

    await runDevListenLoop(config, deps, 'lst_1', controller)

    expect(runRecord).toHaveBeenCalledTimes(2)
    const reports = deps.fetchMock.mock.calls
      .filter(([url]) => (url as string).endsWith('/cli/dev/report'))
      .map(([, init]) => JSON.parse((init as RequestInit).body as string))
    const first = reports.filter((r) => r.triggerId === 'trg_1')
    const second = reports.filter((r) => r.triggerId === 'trg_2')
    expect(first.map((r) => r.state)).toEqual(['running', 'failed'])
    expect(first[1].errorMessage).toContain('Superseded')
    expect(second.map((r) => r.state)).toEqual(['running', 'done'])
  })

  it('queues behind an old record instead of killing it, latest trigger wins', async () => {
    const controller = { stopped: false }
    let clock = 0
    let releaseFirst = () => {}
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const secondTrigger: DevTrigger = { ...trigger, triggerId: 'trg_2' }
    const thirdTrigger: DevTrigger = { ...trigger, triggerId: 'trg_3' }
    const runRecord = vi.fn((t: DevTrigger) =>
      t.triggerId === 'trg_1' ? firstGate : Promise.resolve()
    )
    const deps = makeDeps({ runRecord, now: () => clock })
    const seenReports: Array<{ triggerId: string; state: string }> = []
    let polls = 0
    deps.fetchMock.mockImplementation(
      async (url: string, init?: RequestInit) => {
        if (url.endsWith('/cli/dev/report')) {
          seenReports.push(JSON.parse((init as RequestInit).body as string))
        }
        if (url.endsWith('/cli/dev/poll')) {
          polls += 1
          if (polls === 1) return jsonResponse({ trigger })
          if (polls === 2) {
            clock = 60_000 // Past the kill window: must queue, not kill.
            return jsonResponse({ trigger: secondTrigger })
          }
          if (polls === 3) {
            // A newer trigger replaces the queued one (latest wins).
            return jsonResponse({ trigger: thirdTrigger })
          }
          if (polls === 4) {
            releaseFirst()
            return jsonResponse({})
          }
          // Stop only once the queued trigger has reported done.
          if (
            seenReports.some(
              (r) => r.triggerId === 'trg_3' && r.state === 'done'
            )
          ) {
            controller.stopped = true
          }
          return jsonResponse({})
        }
        return jsonResponse({ ok: true })
      }
    )

    await runDevListenLoop(config, deps, 'lst_1', controller)

    // trg_1 completes, trg_2 was replaced in the queue, trg_3 runs after.
    const recorded = runRecord.mock.calls.map(
      (call) => (call[0] as DevTrigger).triggerId
    )
    expect(recorded).toEqual(['trg_1', 'trg_3'])
    const reports = deps.fetchMock.mock.calls
      .filter(([url]) => (url as string).endsWith('/cli/dev/report'))
      .map(([, init]) => JSON.parse((init as RequestInit).body as string))
    const byTrigger = (id: string) =>
      reports.filter((r) => r.triggerId === id).map((r) => r.state)
    expect(byTrigger('trg_1')).toEqual(['running', 'done'])
    expect(byTrigger('trg_2')).toEqual(['failed'])
    expect(byTrigger('trg_3')).toEqual(['running', 'done'])
  })

  it('polls faster inside the activity window after receiving work', async () => {
    const controller = { stopped: false }
    let clock = 0
    const sleep = vi.fn(async () => {})
    const deps = makeDeps({ sleep, now: () => clock })
    const fastConfig: DevListenConfig = {
      ...config,
      pollIntervalMs: 2_500,
      fastPollIntervalMs: 750,
      fastPollWindowMs: 60_000,
    }
    let polls = 0
    deps.fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/cli/dev/poll')) {
        polls += 1
        if (polls === 1) return jsonResponse({}) // idle: slow poll
        if (polls === 2)
          return jsonResponse({ codegenRequests: [codegenRequest] })
        if (polls === 3) {
          clock = 120_000 // Window elapsed: back to slow polling.
          return jsonResponse({})
        }
        controller.stopped = true
        return jsonResponse({})
      }
      return jsonResponse({ ok: true })
    })

    await runDevListenLoop(fastConfig, deps, 'lst_1', controller)

    const delays = sleep.mock.calls.map((call) => call[0] as number)
    expect(delays[0]).toBe(2_500) // idle
    expect(delays[1]).toBe(750) // right after codegen activity
    expect(delays[2]).toBe(2_500) // window elapsed
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
