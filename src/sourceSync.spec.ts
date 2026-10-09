import { describe, expect, it, vi } from 'vitest'
import { anonCredential, secretCredential } from './anonSession.js'
import {
  notifyRunComplete,
  resolveRunRecordId,
  shouldUploadSources,
  verifyIslandCredential,
  type SourceSyncDeps,
} from './sourceSync.js'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function makeDeps(
  fetchFn: ReturnType<typeof vi.fn>
): SourceSyncDeps & { logs: string[]; warnings: string[] } {
  const logs: string[] = []
  const warnings: string[] = []
  return {
    fetchFn: fetchFn as unknown as typeof fetch,
    logger: {
      info: (message) => logs.push(message),
      warn: (message) => warnings.push(message),
    },
    logs,
    warnings,
  }
}

describe('shouldUploadSources', () => {
  it('is on by default and off only with an explicit opt-out', () => {
    expect(shouldUploadSources({})).toBe(true)
    expect(shouldUploadSources({ uploadSources: true })).toBe(true)
    expect(shouldUploadSources({ uploadSources: false })).toBe(false)
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

describe('verifyIslandCredential', () => {
  const params = {
    apiUrl: 'https://api.example.com',
    credential: secretCredential('secret-1'),
    projectId: 'proj_1',
  }

  it('accepts an org-wide secret, the pinned project, and an unreachable backend', async () => {
    expect(
      await verifyIslandCredential(params, {
        fetchFn: (async () => jsonResponse({ orgId: 'org' })) as never,
      })
    ).toEqual({ ok: true })
    expect(
      await verifyIslandCredential(params, {
        fetchFn: (async () =>
          jsonResponse({ orgId: 'org', projectId: 'proj_1' })) as never,
      })
    ).toEqual({ ok: true })
    expect(
      await verifyIslandCredential(params, {
        fetchFn: (async () => {
          throw new Error('offline')
        }) as never,
      })
    ).toEqual({ ok: true })
    expect(
      await verifyIslandCredential(
        { ...params, credential: anonCredential('t') },
        { fetchFn: vi.fn() as never }
      )
    ).toEqual({ ok: true })
  })

  it('refuses a secret pinned to another project', async () => {
    const result = await verifyIslandCredential(params, {
      fetchFn: (async () =>
        jsonResponse({
          orgId: 'org',
          projectId: 'proj_2',
          projectName: 'Other',
        })) as never,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toMatch(/"Other"/)
    expect(result.message).toMatch(/proj_1/)
    expect(result.message).toMatch(/screenci setup/)
  })
})

describe('resolveRunRecordId', () => {
  it('uses SCREENCI_RECORD_ID when it holds a plausible id', () => {
    const id = '3f2b8c1e-1d2a-4f5b-9c7d-0a1b2c3d4e5f'
    expect(resolveRunRecordId({ SCREENCI_RECORD_ID: id }, () => 'fresh')).toBe(
      id
    )
    expect(
      resolveRunRecordId({ SCREENCI_RECORD_ID: ` ${id} ` }, () => 'fresh')
    ).toBe(id)
  })

  it('generates one when the env var is absent or malformed', () => {
    expect(resolveRunRecordId({}, () => 'fresh')).toBe('fresh')
    expect(resolveRunRecordId({ SCREENCI_RECORD_ID: '' }, () => 'fresh')).toBe(
      'fresh'
    )
    expect(
      resolveRunRecordId({ SCREENCI_RECORD_ID: '../../etc' }, () => 'fresh')
    ).toBe('fresh')
    expect(
      resolveRunRecordId({ SCREENCI_RECORD_ID: 'short' }, () => 'fresh')
    ).toBe('fresh')
  })
})
