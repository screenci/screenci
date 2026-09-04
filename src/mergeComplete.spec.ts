import { describe, expect, it } from 'vitest'
import type { IslandCredentials } from './aiContextCommands.js'
import {
  MergeCompleteError,
  parsePendingMerge,
  runMergeCompleteCommand,
  type MergeCompleteDeps,
} from './mergeComplete.js'

function makeDeps(overrides: Partial<MergeCompleteDeps> = {}) {
  const logs: string[] = []
  const files = new Map<string, string>([
    [
      '/repo/screenci/.screenci/pending-merge.json',
      JSON.stringify({
        sourceBundleId: 'sb_1',
        gitUrl: 'https://github.com/acme/app',
      }),
    ],
  ])
  const requests: Array<{ url: string; body: unknown }> = []
  const creds: IslandCredentials = {
    secret: 'sec',
    apiUrl: 'https://api.example.com',
    appUrl: 'https://app.example.com',
    envFilePath: '/repo/screenci/.env',
    islandDir: '/repo/screenci',
    projectName: 'Acme',
  }
  const deps: MergeCompleteDeps = {
    fetchFn: (async (url: string, init?: RequestInit) => {
      requests.push({ url, body: JSON.parse(String(init?.body)) })
      return new Response(JSON.stringify({ ok: true, projectId: 'proj_1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as unknown as typeof fetch,
    loadCredentials: async () => creds,
    readIslandFile: async (dir, rel) => files.get(`${dir}/${rel}`) ?? null,
    removeIslandFile: async (dir, rel) => {
      files.delete(`${dir}/${rel}`)
    },
    git: {
      remoteUrl: async () => 'git@github.com:acme/app.git',
      headCommit: async () => 'abcdef1234567890',
      currentBranch: async () => 'screenci/add-video-sources',
    },
    logger: { info: (m) => logs.push(m), warn: (m) => logs.push(m) },
    ...overrides,
  }
  return { deps, logs, files, requests }
}

describe('parsePendingMerge', () => {
  it('parses and rejects', () => {
    expect(parsePendingMerge('{"sourceBundleId":"sb","gitUrl":"g"}')).toEqual({
      sourceBundleId: 'sb',
      gitUrl: 'g',
    })
    expect(parsePendingMerge('nope')).toBeNull()
    expect(parsePendingMerge('{}')).toBeNull()
  })
})

describe('runMergeCompleteCommand', () => {
  it('reports the pending bundle with git defaults and clears the marker', async () => {
    const { deps, files, requests, logs } = makeDeps()
    const result = await runMergeCompleteCommand(
      { pr: 'https://github.com/acme/app/pull/7' },
      deps
    )
    expect(requests).toEqual([
      {
        url: 'https://api.example.com/cli/dev/merge-complete',
        body: {
          sourceBundleId: 'sb_1',
          gitUrl: 'https://github.com/acme/app',
          commit: 'abcdef1234567890',
          branch: 'screenci/add-video-sources',
          prUrl: 'https://github.com/acme/app/pull/7',
        },
      },
    ])
    expect(result.projectId).toBe('proj_1')
    expect(files.size).toBe(0)
    expect(logs.join('\n')).toContain('repository-managed')
    const jsonLine = logs.find((line) => line.startsWith('{'))
    expect(jsonLine && JSON.parse(jsonLine)).toMatchObject({
      status: 'merged',
      commit: 'abcdef1234567890',
    })
  })

  it('takes explicit flags over the marker and git', async () => {
    const { deps, requests } = makeDeps()
    await runMergeCompleteCommand(
      {
        bundle: 'sb_9',
        commit: 'deadbeef',
        gitUrl: 'https://x.example/r',
        branch: 'main',
      },
      deps
    )
    expect(requests[0]?.body).toEqual({
      sourceBundleId: 'sb_9',
      gitUrl: 'https://x.example/r',
      commit: 'deadbeef',
      branch: 'main',
    })
  })

  it('fails clearly without a marker or bundle', async () => {
    const { deps } = makeDeps({ readIslandFile: async () => null })
    await expect(runMergeCompleteCommand({}, deps)).rejects.toThrow(
      MergeCompleteError
    )
  })

  it('rejects a non-hash commit and a server error', async () => {
    const { deps } = makeDeps()
    await expect(
      runMergeCompleteCommand({ commit: 'not-a-sha' }, deps)
    ).rejects.toThrow(/not a commit hash/)
    const failing = makeDeps({
      fetchFn: (async () =>
        new Response('nope', { status: 404 })) as unknown as typeof fetch,
    })
    await expect(runMergeCompleteCommand({}, failing.deps)).rejects.toThrow(
      /status 404/
    )
  })
})
