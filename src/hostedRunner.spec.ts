import { describe, expect, it, vi } from 'vitest'
import {
  buildPreviewEnv,
  previewArgsForTitle,
  HOSTED_RUN_TIMEOUT_MS,
  REPORT_MARGIN_MS,
  withoutRunnerEnv,
  parseHostedRunSpec,
  resolvePreviewCliEntry,
  runHostedRun,
  tailText,
  type HostedRunnerDeps,
  type RunPreviewResult,
} from './hostedRunner.js'
import type { AssembleIslandResult } from './islandAssembly.js'

const SPEC = {
  runId: 'run_1',
  projectName: 'Acme',
  videoName: 'Add a lead (v2)',
  videoSlug: 'add-a-lead',
  appUrl: 'https://app.acme.test',
  files: [
    {
      path: 'recordings/add-a-lead.screenci.ts',
      contentBase64: Buffer.from(
        "video('Add a lead (v2)', async () => {})"
      ).toString('base64'),
    },
    {
      path: 'package.json',
      contentBase64: Buffer.from('{}').toString('base64'),
    },
  ],
  envVars: { SCREENCI_LOGIN_USERNAME: 'demo' },
  network: { proxyServer: 'http://proxy:1', extraHeaders: [] },
  uploadSecret: 'run-secret',
  recordId: '11111111-2222-4333-8444-555555555555',
  backendUrl: 'https://api.screenci.com',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const ASSEMBLED: AssembleIslandResult = {
  envFile: '.env',
  env: { SCREENCI_SECRET: 'run-secret', SCREENCI_LOGIN_USERNAME: 'demo' },
  packageManager: 'npm',
  frozen: true,
  writtenFiles: [],
}

function makeDeps(options: {
  spec?: unknown
  specStatus?: number
  preview?: RunPreviewResult
  assembleError?: Error
  assembleMs?: number
  delay?: (ms: number) => Promise<void>
}) {
  let clock = 1_000
  const statuses: Array<Record<string, unknown>> = []
  const fetchFn = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/hosted-run/spec')) {
      return jsonResponse(options.spec ?? SPEC, options.specStatus ?? 200)
    }
    if (url.endsWith('/hosted-run/status')) {
      statuses.push(JSON.parse(String(init?.body)))
      return jsonResponse({ ok: true })
    }
    return jsonResponse({}, 404)
  })
  const assemble = vi.fn(async () => {
    if (options.assembleError !== undefined) throw options.assembleError
    clock += options.assembleMs ?? 30_000
    return ASSEMBLED
  })
  const runPreview = vi.fn(async () => {
    clock += 90_000
    return options.preview ?? { exitCode: 0, timedOut: false, errorTail: '' }
  })
  const logs: string[] = []
  const deps: HostedRunnerDeps = {
    env: {
      RUN_ID: 'run_1',
      RUN_TOKEN: 'token-abc',
      BACKEND_URL: 'https://api.screenci.com/',
      SCREENCI_WORK_DIR: '/tmp/island',
      PATH: '/usr/bin',
    },
    fetchFn: fetchFn as unknown as typeof fetch,
    assemble,
    runPreview,
    now: () => clock,
    // The deadline never fires unless a test says so.
    delay: options.delay ?? (() => new Promise<void>(() => {})),
    log: (message) => logs.push(message),
  }
  return { deps, fetchFn, statuses, assemble, runPreview, logs }
}

describe('runHostedRun', () => {
  it('fetches the spec with the run token, assembles, records, reports finished', async () => {
    const harness = makeDeps({})
    expect(await runHostedRun(harness.deps)).toBe(0)

    const [specUrl, specInit] = harness.fetchFn.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(specUrl).toBe('https://api.screenci.com/hosted-run/spec')
    expect(specInit.headers).toMatchObject({
      'X-ScreenCI-Run-Token': 'token-abc',
    })

    expect(harness.assemble).toHaveBeenCalledWith(
      expect.objectContaining({
        islandDir: '/tmp/island',
        secret: 'run-secret',
        backendUrl: 'https://api.screenci.com',
        appUrl: 'https://app.acme.test',
        envVars: { SCREENCI_LOGIN_USERNAME: 'demo' },
        network: { proxyServer: 'http://proxy:1', extraHeaders: [] },
      })
    )
    const assembled = harness.assemble.mock.calls[0]![0 as never] as {
      files: Array<{ path: string; content: Uint8Array }>
    }
    expect(Buffer.from(assembled.files[1]!.content).toString()).toBe('{}')

    const previewCall = harness.runPreview.mock.calls[0]![0 as never] as {
      islandDir: string
      videoName: string
      env: Record<string, string>
      timeoutMs: number
    }
    expect(previewCall.islandDir).toBe('/tmp/island')
    expect(previewCall.videoName).toBe('Add a lead (v2)')
    // One deadline for the run: the recording gets what is left of it after
    // the 30 s spent preparing, minus the reporting margin.
    expect(previewCall.timeoutMs).toBe(
      HOSTED_RUN_TIMEOUT_MS - 30_000 - REPORT_MARGIN_MS
    )
    expect(previewCall.env).toMatchObject({
      SCREENCI_CI: '1',
      SCREENCI_RUNNER: 'hosted',
      SCREENCI_RECORD_ID: SPEC.recordId,
      SCREENCI_SECRET: 'run-secret',
      SCREENCI_LOGIN_USERNAME: 'demo',
      PATH: '/usr/bin',
    })
    // The run token never reaches the video's code.
    expect(previewCall.env).not.toHaveProperty('RUN_TOKEN')
    expect(harness.deps.env).not.toHaveProperty('RUN_TOKEN')

    expect(harness.statuses).toEqual([
      { status: 'running' },
      { status: 'finished', recordId: SPEC.recordId, wallClockMs: 120_000 },
    ])
  })

  it('reports failed with the error tail when the recording fails', async () => {
    const harness = makeDeps({
      preview: { exitCode: 1, timedOut: false, errorTail: 'Locator not found' },
    })
    expect(await runHostedRun(harness.deps)).toBe(1)
    expect(harness.statuses.at(-1)).toEqual({
      status: 'failed',
      error: 'Locator not found',
      wallClockMs: 120_000,
    })
  })

  it('reports a timeout', async () => {
    const harness = makeDeps({
      preview: { exitCode: null, timedOut: true, errorTail: 'partial' },
    })
    expect(await runHostedRun(harness.deps)).toBe(1)
    expect(String(harness.statuses.at(-1)?.error)).toMatch(
      /within 15 minutes \(stopped while recording\)/
    )
  })

  it('fails before recording when preparing used up the deadline', async () => {
    const harness = makeDeps({ assembleMs: HOSTED_RUN_TIMEOUT_MS })
    expect(await runHostedRun(harness.deps)).toBe(1)
    expect(harness.runPreview).not.toHaveBeenCalled()
    expect(String(harness.statuses.at(-1)?.error)).toMatch(
      /stopped while preparing the project/
    )
  })

  it('stops a hanging install at the deadline and still reports', async () => {
    const delays: number[] = []
    const harness = makeDeps({
      delay: async (ms) => {
        delays.push(ms)
      },
    })
    harness.assemble.mockImplementation(() => new Promise(() => {}))
    expect(await runHostedRun(harness.deps)).toBe(1)
    // Whatever was left of 15 minutes, minus the reporting margin.
    expect(delays[0]).toBe(HOSTED_RUN_TIMEOUT_MS - REPORT_MARGIN_MS)
    expect(harness.statuses).toEqual([
      { status: 'running' },
      expect.objectContaining({
        status: 'failed',
        error: expect.stringMatching(/stopped while preparing the project/),
      }),
    ])
  })

  it('reports failed when the island cannot be assembled', async () => {
    const harness = makeDeps({
      assembleError: new Error('npm ci exited with 1'),
    })
    expect(await runHostedRun(harness.deps)).toBe(1)
    expect(harness.runPreview).not.toHaveBeenCalled()
    expect(harness.statuses.at(-1)).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('npm ci exited with 1'),
    })
  })

  it('reports failed when the spec is refused or malformed', async () => {
    const refused = makeDeps({ specStatus: 410, spec: { error: 'done' } })
    expect(await runHostedRun(refused.deps)).toBe(1)
    expect(refused.statuses).toEqual([
      expect.objectContaining({ status: 'failed' }),
    ])
    const malformed = makeDeps({ spec: { runId: 'x' } })
    expect(await runHostedRun(malformed.deps)).toBe(1)
    expect(malformed.assemble).not.toHaveBeenCalled()
  })

  it('exits 2 without its environment and reports nothing', async () => {
    const harness = makeDeps({})
    harness.deps.env = {}
    expect(await runHostedRun(harness.deps)).toBe(2)
    expect(harness.fetchFn).not.toHaveBeenCalled()
  })
})

describe('helpers', () => {
  it('parses the spec and rejects missing fields', () => {
    expect(parseHostedRunSpec(SPEC)).toMatchObject({
      runId: 'run_1',
      videoSlug: 'add-a-lead',
      network: { proxyServer: 'http://proxy:1', extraHeaders: [] },
    })
    expect(
      parseHostedRunSpec({
        ...SPEC,
        network: {
          credentialOrigin: 'https://app.acme.test',
          extraHeaders: [],
        },
      }).network
    ).toEqual({ credentialOrigin: 'https://app.acme.test', extraHeaders: [] })
    expect(() => parseHostedRunSpec({ ...SPEC, uploadSecret: '' })).toThrow(
      /uploadSecret/
    )
    expect(() => parseHostedRunSpec({ ...SPEC, files: [{ path: 1 }] })).toThrow(
      /malformed file/
    )
  })

  it('selects the video by exact title, not a regex', () => {
    expect(previewArgsForTitle('Add a lead (v2)')).toEqual([
      'preview',
      '--exact-title',
      'Add a lead (v2)',
    ])
  })

  it('refuses a malformed recordId', () => {
    expect(() => parseHostedRunSpec({ ...SPEC, recordId: '../etc' })).toThrow(
      /recordId/
    )
  })

  it('keeps the last bytes of long output', () => {
    expect(tailText('short')).toBe('short')
    const long = `${'a'.repeat(5000)}END`
    const tail = tailText(long)
    expect(Buffer.byteLength(tail)).toBeLessThanOrEqual(2048)
    expect(tail.endsWith('END')).toBe(true)
  })

  it('keeps the runner-only variables out of every child', () => {
    expect(
      withoutRunnerEnv({
        RUN_TOKEN: 't',
        RUN_ID: 'r',
        BACKEND_URL: 'https://api',
        PATH: '/bin',
      })
    ).toEqual({ PATH: '/bin' })
  })

  it('strips the run token and run id from the recording environment', () => {
    const env = buildPreviewEnv(
      { RUN_TOKEN: 't', RUN_ID: 'r', HOME: '/root', SCREENCI_SECRET: 'stale' },
      { SCREENCI_LOGIN_PASSWORD: 'pw' },
      { recordId: 'rec', uploadSecret: 'fresh' }
    )
    expect(env).toEqual({
      HOME: '/root',
      SCREENCI_LOGIN_PASSWORD: 'pw',
      SCREENCI_CI: '1',
      SCREENCI_RUNNER: 'hosted',
      SCREENCI_RECORD_ID: 'rec',
      SCREENCI_SECRET: 'fresh',
    })
  })

  it("prefers the island's own installed CLI", () => {
    expect(
      resolvePreviewCliEntry('/work/island', (path) =>
        path.endsWith('node_modules/screenci/bin/screenci.js')
      )
    ).toBe('/work/island/node_modules/screenci/bin/screenci.js')
    expect(resolvePreviewCliEntry('/work/island', () => false)).toMatch(
      /bin\/screenci\.js$/
    )
  })
})
