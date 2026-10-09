import { describe, expect, it, vi } from 'vitest'
import {
  deriveCiResults,
  formatDriftWarning,
  parseHostedConfig,
  runCiCommand,
  type CiCommandDeps,
  type CiRecordOutcome,
} from './ciCommand.js'
import {
  hashProjectFileBytes,
  type ProjectFilesDirent,
  type ProjectFilesFs,
} from './localProjectFiles.js'

function memoryFs(seed: Record<string, string>): ProjectFilesFs {
  const files = new Map(
    Object.entries(seed).map(([path, content]) => [path, Buffer.from(content)])
  )
  const dirent = (name: string, isDir: boolean): ProjectFilesDirent => ({
    name,
    isDirectory: () => isDir,
    isFile: () => !isDir,
  })
  return {
    readdir: async (dir) => {
      const names = new Map<string, boolean>()
      for (const path of files.keys()) {
        if (!path.startsWith(`${dir}/`)) continue
        const [head, ...tail] = path.slice(dir.length + 1).split('/')
        if (head) names.set(head, tail.length > 0)
      }
      if (names.size === 0) throw new Error('ENOENT')
      return [...names.entries()].map(([name, isDir]) => dirent(name, isDir))
    },
    readFile: async (path) => {
      const bytes = files.get(path)
      if (!bytes) throw new Error('ENOENT')
      return bytes
    },
    writeFile: async () => undefined,
    mkdir: async () => undefined,
    exists: async (path) =>
      files.has(path) ||
      [...files.keys()].some((key) => key.startsWith(`${path}/`)),
  }
}

const sha = (text: string): string => hashProjectFileBytes(text)

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const API = 'https://api.example.com'
const LOCAL = {
  '/repo/screenci/package.json': '{}',
  '/repo/screenci/recordings/add-lead.screenci.ts': 'local script',
  '/repo/screenci/recordings/shared/theme.ts': 'theme',
}

const HOSTED_CONFIG = {
  projectId: 'proj_1',
  projectName: 'Acme',
  appUrl: null,
  hostedRecordingEnabled: true,
  flaggedVideos: [
    { videoId: 'v1', name: 'Add a lead', slug: 'add-lead' },
    { videoId: 'v2', name: 'Export (beta)', slug: null },
    { videoId: 'v3', name: 'Gone video', slug: null },
  ],
  appBaseUrl: 'https://app.example.com',
}

function makeHarness(options: {
  config?: unknown
  configStatus?: number
  outcome?: CiRecordOutcome
  recordError?: Error
  secret?: string | undefined
}) {
  const requests: Array<{ url: string; body: unknown }> = []
  const fetchFn = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input)
    requests.push({
      url,
      body: init?.body !== undefined ? JSON.parse(String(init.body)) : null,
    })
    if (url.startsWith(`${API}/cli/hosted/config`)) {
      return jsonResponse(
        options.config ?? HOSTED_CONFIG,
        options.configStatus ?? 200
      )
    }
    if (url.startsWith(`${API}/cli/files/select`)) {
      return jsonResponse({
        projectId: 'proj_1',
        entries: [
          { path: 'package.json', hash: sha('{}'), byteSize: 2, kind: 'root' },
          {
            path: 'recordings/add-lead.screenci.ts',
            hash: sha('edited in the app'),
            byteSize: 17,
            kind: 'script',
          },
          {
            path: 'recordings/add-lead/callout.html',
            hash: sha('<div/>'),
            byteSize: 6,
            kind: 'video-file',
          },
        ],
      })
    }
    if (url === `${API}/cli/hosted/ci-batch`) {
      const videos = (
        JSON.parse(String(init?.body)) as {
          videos: Array<{ name: string }>
        }
      ).videos
      return jsonResponse({
        batchId: 'batch_1',
        runs: videos.map((video, index) => ({
          runId: `r${index + 1}`,
          videoName: video.name,
        })),
        resultsUrl: 'https://app.example.com/runs/batch_1',
      })
    }
    if (url === `${API}/cli/hosted/ci-report`) return jsonResponse({ ok: true })
    return jsonResponse({}, 404)
  })
  const logs: string[] = []
  const warnings: string[] = []
  const errors: string[] = []
  const recordVideos = vi.fn(async () => {
    if (options.recordError !== undefined) throw options.recordError
    return (
      options.outcome ?? {
        uploadedVideoNames: ['Add a lead', 'Export (beta)'],
        failedVideoMessages: [],
        scriptFailure: null,
      }
    )
  })
  let clock = 0
  const deps: CiCommandDeps = {
    fetchFn: fetchFn as unknown as typeof fetch,
    logger: {
      info: (message) => logs.push(message),
      warn: (message) => warnings.push(message),
      error: (message) => errors.push(message),
    },
    fs: memoryFs(LOCAL),
    loadIsland: async () => ({
      islandDir: '/repo/screenci',
      projectName: 'Acme',
      secret: 'secret' in options ? options.secret : 'sk-1',
      apiUrl: API,
    }),
    listLocalVideoNames: async () => ['Add a lead', 'Export (beta)', 'Other'],
    recordVideos,
    generateRecordId: () => 'rec-123',
    now: () => {
      clock += 5_000
      return clock
    },
  }
  return { deps, fetchFn, requests, logs, warnings, errors, recordVideos }
}

describe('runCiCommand', () => {
  it('records exactly the flagged videos and reports each one', async () => {
    const h = makeHarness({})
    expect(await runCiCommand({ verbose: false }, h.deps)).toBe(1)

    // Only the flagged titles the checkout declares are recorded.
    expect(h.recordVideos).toHaveBeenCalledWith({
      configPath: undefined,
      titles: ['Add a lead', 'Export (beta)'],
      recordId: 'rec-123',
      verbose: false,
    })

    const batch = h.requests.find((r) => r.url.endsWith('/cli/hosted/ci-batch'))
    expect(batch?.body).toEqual({
      projectName: 'Acme',
      videos: [
        { name: 'Add a lead', slug: 'add-lead' },
        { name: 'Export (beta)', slug: null },
        { name: 'Gone video', slug: null },
      ],
    })
    const report = h.requests.find((r) =>
      r.url.endsWith('/cli/hosted/ci-report')
    )
    expect(report?.body).toEqual({
      batchId: 'batch_1',
      recordId: 'rec-123',
      wallClockMs: 5_000,
      results: [
        { runId: 'r1', status: 'finished' },
        { runId: 'r2', status: 'finished' },
        {
          runId: 'r3',
          status: 'failed',
          error: 'No video titled "Gone video" in this checkout.',
        },
      ],
    })
    // The results URL prints before recording and again at the end.
    expect(
      h.logs.filter((line) =>
        line.includes('https://app.example.com/runs/batch_1')
      )
    ).toHaveLength(2)
    expect(h.errors.join('\n')).toContain('"Gone video"')
  })

  it('warns on drift without failing, and never downloads code', async () => {
    const h = makeHarness({
      config: {
        ...HOSTED_CONFIG,
        flaggedVideos: [HOSTED_CONFIG.flaggedVideos[0]],
      },
    })
    expect(await runCiCommand({ verbose: false }, h.deps)).toBe(0)
    const select = h.requests.find((r) => r.url.includes('/cli/files/select'))
    expect(select?.url).toBe(
      `${API}/cli/files/select?projectName=Acme&slugs=add-lead`
    )
    const warning = h.warnings.join('\n')
    expect(warning).toContain('changed:        recordings/add-lead.screenci.ts')
    expect(warning).toContain(
      'only in app:    recordings/add-lead/callout.html'
    )
    expect(warning).toContain('only in repo:   recordings/shared/theme.ts')
    expect(warning).toContain('hand-off')
    expect(h.requests.some((r) => r.url.includes('/cli/files/blob/'))).toBe(
      false
    )
  })

  it('exits 0 with a clear message when nothing is flagged', async () => {
    const h = makeHarness({ config: { ...HOSTED_CONFIG, flaggedVideos: [] } })
    expect(await runCiCommand({ verbose: false }, h.deps)).toBe(0)
    expect(h.logs.join('\n')).toMatch(/No videos of "Acme" are flagged/)
    expect(h.recordVideos).not.toHaveBeenCalled()
    expect(h.requests.some((r) => r.url.endsWith('/ci-batch'))).toBe(false)
  })

  it('records every video when the organisation has no recording runs', async () => {
    const disabled = makeHarness({
      config: { ...HOSTED_CONFIG, hostedRecordingEnabled: false },
    })
    expect(await runCiCommand({ verbose: true }, disabled.deps)).toBe(0)
    expect(disabled.recordVideos).toHaveBeenCalledWith(
      expect.objectContaining({ titles: null })
    )
    const old = makeHarness({ configStatus: 404, config: {} })
    expect(await runCiCommand({ verbose: false }, old.deps)).toBe(0)
    expect(old.recordVideos).toHaveBeenCalledWith(
      expect.objectContaining({ titles: null })
    )
  })

  it('reports script failures for every video that did not upload', async () => {
    const h = makeHarness({
      config: {
        ...HOSTED_CONFIG,
        flaggedVideos: HOSTED_CONFIG.flaggedVideos.slice(0, 2),
      },
      outcome: {
        uploadedVideoNames: ['Add a lead'],
        failedVideoMessages: [],
        scriptFailure: 'Timeout 30000ms exceeded',
      },
    })
    expect(await runCiCommand({ verbose: false }, h.deps)).toBe(1)
    const report = h.requests.find((r) => r.url.endsWith('/ci-report'))
    expect((report?.body as { results: unknown[] }).results).toEqual([
      { runId: 'r1', status: 'finished' },
      { runId: 'r2', status: 'failed', error: 'Timeout 30000ms exceeded' },
    ])
  })

  it('still reports when the recording throws', async () => {
    const h = makeHarness({
      config: {
        ...HOSTED_CONFIG,
        flaggedVideos: HOSTED_CONFIG.flaggedVideos.slice(0, 1),
      },
      recordError: new Error('browser crashed'),
    })
    expect(await runCiCommand({ verbose: false }, h.deps)).toBe(1)
    const report = h.requests.find((r) => r.url.endsWith('/ci-report'))
    expect(report?.body).toMatchObject({
      recordId: null,
      results: [{ runId: 'r1', status: 'failed', error: 'browser crashed' }],
    })
  })

  it('needs SCREENCI_SECRET and fails on an unreadable config', async () => {
    const noSecret = makeHarness({ secret: undefined })
    expect(await runCiCommand({ verbose: false }, noSecret.deps)).toBe(1)
    expect(noSecret.fetchFn).not.toHaveBeenCalled()
    const broken = makeHarness({ configStatus: 500, config: { error: 'x' } })
    expect(await runCiCommand({ verbose: false }, broken.deps)).toBe(1)
    expect(broken.recordVideos).not.toHaveBeenCalled()
  })
})

describe('helpers', () => {
  it('records every video and exits 1 when that recording throws', async () => {
    const h = makeHarness({
      config: { ...HOSTED_CONFIG, hostedRecordingEnabled: false },
      recordError: new Error('boom'),
    })
    expect(await runCiCommand({ verbose: false }, h.deps)).toBe(1)
    expect(h.errors.join('\n')).toContain('boom')
  })

  it('parses the hosted config defensively', () => {
    expect(parseHostedConfig(null)).toBeNull()
    expect(
      parseHostedConfig({
        projectId: 'p',
        projectName: 'n',
        flaggedVideos: [{ videoId: 'v', name: 'A' }, { name: 1 }],
      })
    ).toEqual({
      projectId: 'p',
      projectName: 'n',
      hostedRecordingEnabled: false,
      flaggedVideos: [{ videoId: 'v', name: 'A', slug: null }],
      appBaseUrl: null,
    })
  })

  it('says nothing when there is no drift', () => {
    expect(
      formatDriftWarning({ changed: [], onlyRemote: [], onlyLocal: [] })
    ).toBeNull()
  })

  it('matches per-language failure messages to their video', () => {
    expect(
      deriveCiResults({
        runs: [{ runId: 'r', videoName: 'Demo' }],
        missingLocally: new Set(),
        outcome: {
          uploadedVideoNames: [],
          failedVideoMessages: [
            { videoName: 'Demo [fi]', message: 'upload 500' },
          ],
          scriptFailure: null,
        },
        recordError: null,
      })
    ).toEqual([{ runId: 'r', status: 'failed', error: 'upload 500' }])
  })
})
