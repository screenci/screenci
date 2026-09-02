import { describe, expect, it, vi } from 'vitest'
import { anonCredential, secretCredential } from './anonSession.js'
import {
  ensureSourceBundleUploaded,
  fetchLatestSourceBundle,
  notifyRunComplete,
  shouldUploadSources,
  type SourceSyncDeps,
} from './sourceSync.js'
import type { SourceBundleFs } from './sourceBundle.js'

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

/** A one-file island: screenci.config.ts plus recordings/a.screenci.ts. */
function islandFs(): SourceBundleFs {
  const files = new Map<string, string>([
    ['/island/screenci.config.ts', 'cfg'],
    ['/island/recordings/a.screenci.ts', 'a'],
  ])
  return {
    readdir: async (dir) => {
      if (dir === '/island') {
        return [
          {
            name: 'recordings',
            isDirectory: () => true,
            isFile: () => false,
          },
          {
            name: 'screenci.config.ts',
            isDirectory: () => false,
            isFile: () => true,
          },
        ]
      }
      if (dir === '/island/recordings') {
        return [
          {
            name: 'a.screenci.ts',
            isDirectory: () => false,
            isFile: () => true,
          },
        ]
      }
      return []
    },
    readFile: async (path) => {
      const content = files.get(path)
      if (content === undefined) throw new Error('ENOENT')
      return Buffer.from(content)
    },
    writeFile: async () => undefined,
    mkdir: async () => undefined,
    exists: async (path) => files.has(path) || path === '/island/recordings',
  }
}

function makeDeps(
  fetchFn: ReturnType<typeof vi.fn>,
  git: { commit?: string; isDirty?: boolean } = {
    commit: 'abc12345',
    isDirty: false,
  }
): SourceSyncDeps & { logs: string[]; warnings: string[] } {
  const logs: string[] = []
  const warnings: string[] = []
  return {
    fetchFn: fetchFn as unknown as typeof fetch,
    logger: {
      info: (message) => logs.push(message),
      warn: (message) => warnings.push(message),
    },
    fs: islandFs(),
    gitMetadata: () => git,
    logs,
    warnings,
  }
}

const params = {
  islandDir: '/island',
  apiUrl: 'https://api.example.com',
  credential: secretCredential('secret-1'),
  projectName: 'Demo',
  verbose: false,
}

describe('shouldUploadSources', () => {
  it('is on for service-managed islands or an explicit opt-in', () => {
    expect(shouldUploadSources({})).toBe(false)
    expect(shouldUploadSources({ projectId: 'p1' })).toBe(true)
    expect(shouldUploadSources({ uploadSources: true })).toBe(true)
    expect(shouldUploadSources({ uploadSources: false })).toBe(false)
  })
})

describe('ensureSourceBundleUploaded', () => {
  it('skips anonymous credentials without any request', async () => {
    const fetchFn = vi.fn()
    const deps = makeDeps(fetchFn)
    const result = await ensureSourceBundleUploaded(
      { ...params, credential: anonCredential('anon-token') },
      deps
    )
    expect(result).toBeNull()
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('reuses an already uploaded bundle after the check', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ exists: true, sourceBundleId: 'sb_existing' })
    )
    const result = await ensureSourceBundleUploaded(params, makeDeps(fetchFn))
    expect(result).toBe('sb_existing')
    expect(fetchFn).toHaveBeenCalledTimes(1)
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.example.com/cli/sources/check')
    expect(init.headers).toMatchObject({ 'X-ScreenCI-Secret': 'secret-1' })
    const body = JSON.parse(init.body as string) as {
      hash: string
      projectName: string
    }
    expect(body.projectName).toBe('Demo')
    expect(body.hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('uploads the collected files with git metadata when the check misses', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ exists: false }))
      .mockResolvedValueOnce(jsonResponse({ sourceBundleId: 'sb_new' }))
    const result = await ensureSourceBundleUploaded(params, makeDeps(fetchFn))
    expect(result).toBe('sb_new')
    const [url, init] = fetchFn.mock.calls[1] as [string, RequestInit]
    expect(url).toBe('https://api.example.com/cli/sources')
    const body = JSON.parse(init.body as string) as {
      files: Array<{ path: string; content: string }>
      commit: string
      isDirty: boolean
      projectName: string
    }
    expect(body.files).toEqual([
      { path: 'recordings/a.screenci.ts', content: 'a' },
      { path: 'screenci.config.ts', content: 'cfg' },
    ])
    expect(body).toMatchObject({
      commit: 'abc12345',
      isDirty: false,
      projectName: 'Demo',
    })
  })

  it('warns and returns null on a failed upload or a network error', async () => {
    const failing = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ exists: false }))
      .mockResolvedValueOnce(new Response('nope', { status: 500 }))
    const failingDeps = makeDeps(failing)
    expect(await ensureSourceBundleUploaded(params, failingDeps)).toBeNull()
    expect(failingDeps.warnings.join('\n')).toMatch(
      /Could not upload the island sources/
    )

    const throwing = vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    })
    const throwingDeps = makeDeps(throwing)
    expect(await ensureSourceBundleUploaded(params, throwingDeps)).toBeNull()
    expect(throwingDeps.warnings.join('\n')).toMatch(/ECONNREFUSED/)
  })
})

describe('notifyRunComplete', () => {
  it('posts the run and never throws', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ ok: true, marked: true }))
    await notifyRunComplete(
      {
        apiUrl: 'https://api.example.com',
        credential: secretCredential('secret-1'),
        recordId: 'run-1',
        kind: 'preview',
        verbose: false,
      },
      makeDeps(fetchFn)
    )
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.example.com/cli/run-complete')
    expect(JSON.parse(init.body as string)).toEqual({
      recordId: 'run-1',
      kind: 'preview',
    })

    const throwing = vi.fn(async () => {
      throw new Error('boom')
    })
    await expect(
      notifyRunComplete(
        {
          apiUrl: 'https://api.example.com',
          credential: secretCredential('secret-1'),
          recordId: 'run-1',
          kind: 'export',
          verbose: true,
        },
        makeDeps(throwing)
      )
    ).resolves.toBeUndefined()
  })

  it('does nothing for anonymous credentials', async () => {
    const fetchFn = vi.fn()
    await notifyRunComplete(
      {
        apiUrl: 'https://api.example.com',
        credential: anonCredential('t'),
        recordId: 'run-1',
        kind: 'preview',
        verbose: false,
      },
      makeDeps(fetchFn)
    )
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

describe('fetchLatestSourceBundle', () => {
  it('returns the parsed files and bundle id', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(
        { files: [{ path: 'screenci.config.ts', content: 'cfg' }] },
        200,
        { 'X-ScreenCI-Source-Bundle-Id': 'sb_1' }
      )
    )
    const result = await fetchLatestSourceBundle(
      { apiUrl: 'https://api.example.com', secret: 's', projectName: 'Demo' },
      fetchFn as unknown as typeof fetch
    )
    expect(result).toEqual({
      ok: true,
      files: [{ path: 'screenci.config.ts', content: 'cfg' }],
      bundleId: 'sb_1',
    })
    expect((fetchFn.mock.calls[0] as [string])[0]).toBe(
      'https://api.example.com/cli/sources/latest?projectName=Demo'
    )
  })

  it('distinguishes no sources from other failures', async () => {
    const none = await fetchLatestSourceBundle(
      { apiUrl: 'https://api.example.com', secret: 's' },
      (async () =>
        jsonResponse(
          { error: 'No sources uploaded yet' },
          404
        )) as unknown as typeof fetch
    )
    expect(none).toMatchObject({ ok: false, status: 'none' })

    const failed = await fetchLatestSourceBundle(
      { apiUrl: 'https://api.example.com', secret: 's' },
      (async () =>
        new Response('x', { status: 500 })) as unknown as typeof fetch
    )
    expect(failed).toMatchObject({ ok: false, status: 'error' })

    const unsafe = await fetchLatestSourceBundle(
      { apiUrl: 'https://api.example.com', secret: 's' },
      (async () =>
        jsonResponse({
          files: [{ path: '../x', content: '' }],
        })) as unknown as typeof fetch
    )
    expect(unsafe).toMatchObject({ ok: false, status: 'error' })
  })
})
