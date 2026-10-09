import { describe, expect, it, vi } from 'vitest'
import { anonCredential, secretCredential } from './anonSession.js'
import {
  fetchProjectFileBlob,
  fetchRemoteSelection,
  formatNotStoredWarning,
  manifestsOf,
  planRunFileSync,
  prepareRunSources,
  syncProjectFiles,
  type FileSyncDeps,
} from './fileSync.js'
import {
  hashProjectFileBytes,
  type ProjectFilesDirent,
  type ProjectFilesFs,
} from './localProjectFiles.js'

function memoryFs(seed: Record<string, string>): ProjectFilesFs {
  const files = new Map<string, Buffer>(
    Object.entries(seed).map(([path, content]) => [path, Buffer.from(content)])
  )
  const dirent = (name: string, isDir: boolean): ProjectFilesDirent => ({
    name,
    isDirectory: () => isDir,
    isFile: () => !isDir,
  })
  return {
    readdir: async (dir) => {
      const prefix = `${dir}/`
      const names = new Map<string, boolean>()
      for (const path of files.keys()) {
        if (!path.startsWith(prefix)) continue
        const [head, ...tail] = path.slice(prefix.length).split('/')
        if (head) names.set(head, tail.length > 0)
      }
      if (names.size === 0) throw new Error('ENOENT')
      return [...names.entries()].map(([name, isDir]) => dirent(name, isDir))
    },
    readFile: async (path) => {
      const bytes = files.get(path)
      if (!bytes) throw new Error(`ENOENT ${path}`)
      return bytes
    },
    writeFile: async (path, data) => {
      files.set(path, Buffer.from(data))
    },
    mkdir: async () => undefined,
    exists: async (path) =>
      files.has(path) ||
      [...files.keys()].some((key) => key.startsWith(`${path}/`)),
  }
}

const ISLAND = '/island'
const ISLAND_FILES = {
  [`${ISLAND}/package.json`]: '{"name":"demo"}',
  [`${ISLAND}/screenci.config.ts`]: 'export default {}',
  [`${ISLAND}/recordings/add-lead.screenci.ts`]:
    "video('Add a lead', async ({ page }) => {})",
  [`${ISLAND}/recordings/add-lead/callout.html`]: '<div/>',
  [`${ISLAND}/recordings/onboarding.screenci.ts`]:
    "video('Onboarding', async () => {})",
  [`${ISLAND}/recordings/shared/theme.ts`]: 'export const brand = 1',
  [`${ISLAND}/recordings/many.screenci.ts`]:
    "video('One', async () => {})\nvideo('Two', async () => {})",
  [`${ISLAND}/recordings/nested/deep.screenci.ts`]:
    "video('Deep', async () => {})",
}

const sha = (text: string): string => hashProjectFileBytes(text)

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function makeDeps(fetchFn: ReturnType<typeof vi.fn>): FileSyncDeps & {
  logs: string[]
  warnings: string[]
} {
  const logs: string[] = []
  const warnings: string[] = []
  return {
    fetchFn: fetchFn as unknown as typeof fetch,
    logger: {
      info: (message) => logs.push(message),
      warn: (message) => warnings.push(message),
    },
    fs: memoryFs(ISLAND_FILES),
    logs,
    warnings,
  }
}

const params = {
  apiUrl: 'https://api.example.com',
  credential: secretCredential('secret-1'),
  projectName: 'Demo',
  verbose: false,
}

/** A file server: check answers `missing`, blob and commit answer ok. */
function fileServer(missing: (hashes: string[]) => string[]) {
  return vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/cli/files/check')) {
      const body = JSON.parse(String(init?.body)) as { hashes: string[] }
      return jsonResponse({ projectId: 'p1', missing: missing(body.hashes) })
    }
    if (url.includes('/cli/files/blob/')) return jsonResponse({ ok: true })
    if (url.endsWith('/cli/files/commit')) {
      return jsonResponse({ projectId: 'p1', manifest: [] })
    }
    return jsonResponse({ error: 'unexpected' }, 500)
  })
}

describe('planRunFileSync', () => {
  it('plans conforming scripts and lists the others', async () => {
    const plan = await planRunFileSync(
      {
        islandDir: ISLAND,
        sourceFilePaths: [
          'recordings/add-lead.screenci.ts',
          'recordings/add-lead.screenci.ts',
          'recordings/many.screenci.ts',
          'recordings/nested/deep.screenci.ts',
          'recordings/gone.screenci.ts',
        ],
      },
      memoryFs(ISLAND_FILES)
    )
    expect([...plan.videos.keys()]).toEqual(['recordings/add-lead.screenci.ts'])
    const video = plan.videos.get('recordings/add-lead.screenci.ts')!
    expect(video).toMatchObject({ slug: 'add-lead', title: 'Add a lead' })
    expect(video.files.map((file) => file.path)).toEqual([
      'package.json',
      'recordings/add-lead.screenci.ts',
      'recordings/add-lead/callout.html',
      'recordings/shared/theme.ts',
      'screenci.config.ts',
    ])
    expect(plan.notStored).toEqual([
      { path: 'recordings/gone.screenci.ts', reason: 'unreadable' },
      { path: 'recordings/many.screenci.ts', reason: 'several-titles' },
      { path: 'recordings/nested/deep.screenci.ts', reason: 'layout' },
    ])
    expect(manifestsOf(plan).get('recordings/add-lead.screenci.ts')).toEqual(
      video.files.map(({ path, hash }) => ({ path, hash }))
    )
  })

  it('words the warning with the convention', () => {
    const text = formatNotStoredWarning([
      { path: 'recordings/many.screenci.ts', reason: 'several-titles' },
    ])
    expect(text).toContain(
      'not stored: put one video per recordings/<name>.screenci.ts to edit it from the app or run it hosted'
    )
    expect(text).toContain(
      'recordings/many.screenci.ts (declares several videos)'
    )
    expect(text).not.toContain(String.fromCharCode(0x2014))
  })
})

describe('syncProjectFiles', () => {
  it('checks every hash, uploads only missing ones, then commits per video', async () => {
    const deps = makeDeps(vi.fn())
    const plan = await planRunFileSync(
      {
        islandDir: ISLAND,
        sourceFilePaths: [
          'recordings/add-lead.screenci.ts',
          'recordings/onboarding.screenci.ts',
        ],
      },
      deps.fs
    )
    const themeHash = sha('export const brand = 1')
    const fetchFn = fileServer(() => [themeHash])
    const result = await syncProjectFiles(params, plan, { ...deps, fetchFn })

    const calls = fetchFn.mock.calls.map(([url, init]) => ({
      url: String(url),
      init: init as RequestInit,
    }))
    const check = calls.filter((call) => call.url.endsWith('/cli/files/check'))
    expect(check).toHaveLength(1)
    const checkBody = JSON.parse(String(check[0]!.init.body))
    expect(checkBody.projectName).toBe('Demo')
    // Shared files appear once even though two videos need them.
    expect(new Set(checkBody.hashes).size).toBe(checkBody.hashes.length)
    expect(checkBody.hashes).toContain(themeHash)

    const puts = calls.filter((call) => call.url.includes('/cli/files/blob/'))
    expect(puts).toHaveLength(1)
    expect(puts[0]!.url).toBe(
      `https://api.example.com/cli/files/blob/${themeHash}?projectName=Demo`
    )
    expect(puts[0]!.init.method).toBe('PUT')
    expect(
      (puts[0]!.init.headers as Record<string, string>)['X-ScreenCI-Secret']
    ).toBe('secret-1')
    expect(Buffer.from(puts[0]!.init.body as Uint8Array).toString()).toBe(
      'export const brand = 1'
    )

    const commits = calls
      .filter((call) => call.url.endsWith('/cli/files/commit'))
      .map((call) => JSON.parse(String(call.init.body)))
    expect(commits).toHaveLength(2)
    expect(commits[0]).toMatchObject({
      projectName: 'Demo',
      videoSlug: 'add-lead',
      videoTitle: 'Add a lead',
    })
    expect(commits[0].entries).toContainEqual({
      path: 'recordings/add-lead/callout.html',
      hash: sha('<div/>'),
      byteSize: 6,
    })
    expect(
      commits[1].entries.some((entry: { path: string }) =>
        entry.path.startsWith('recordings/add-lead')
      )
    ).toBe(false)
    expect(result).toEqual({
      uploadedBlobs: 1,
      committedVideos: ['Add a lead', 'Onboarding'],
      failedVideos: [],
    })
  })

  it('warns and stops when the check fails, never throwing', async () => {
    const deps = makeDeps(vi.fn())
    const plan = await planRunFileSync(
      {
        islandDir: ISLAND,
        sourceFilePaths: ['recordings/onboarding.screenci.ts'],
      },
      deps.fs
    )
    const fetchFn = vi.fn(async () => jsonResponse({ error: 'nope' }, 503))
    const result = await syncProjectFiles(params, plan, { ...deps, fetchFn })
    expect(result.failedVideos).toEqual(['Onboarding'])
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(deps.warnings.join('\n')).toMatch(/Could not store the video files/)
  })

  it('warns per video when a commit is refused', async () => {
    const deps = makeDeps(vi.fn())
    const plan = await planRunFileSync(
      {
        islandDir: ISLAND,
        sourceFilePaths: ['recordings/onboarding.screenci.ts'],
      },
      deps.fs
    )
    const fetchFn = vi.fn(async (input: string | URL) =>
      String(input).endsWith('/commit')
        ? jsonResponse({ error: 'not-single-video', titles: [] }, 422)
        : jsonResponse({ missing: [] })
    )
    const result = await syncProjectFiles(params, plan, { ...deps, fetchFn })
    expect(result.failedVideos).toEqual(['Onboarding'])
    expect(deps.warnings.join('\n')).toMatch(/"Onboarding".*422/)
  })
})

describe('syncProjectFiles: developer-only root files', () => {
  it('retries once with the stored root files and warns', async () => {
    const deps = makeDeps(vi.fn())
    const plan = await planRunFileSync(
      {
        islandDir: ISLAND,
        sourceFilePaths: ['recordings/onboarding.screenci.ts'],
      },
      deps.fs
    )
    const storedPackage = {
      path: 'package.json',
      hash: sha('{"name":"server"}'),
      byteSize: 17,
      kind: 'root',
    }
    const commits: Array<{ entries: Array<{ path: string; hash: string }> }> =
      []
    let selectUrl = ''
    const fetchFn = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/cli/files/check')) return jsonResponse({ missing: [] })
      if (url.includes('/cli/files/select')) {
        selectUrl = url
        // ScreenCI holds package.json but no screenci.config.ts yet.
        return jsonResponse({ projectId: 'p1', entries: [storedPackage] })
      }
      if (url.endsWith('/cli/files/commit')) {
        commits.push(JSON.parse(String(init?.body)))
        return commits.length === 1
          ? jsonResponse(
              {
                error: 'developer-only',
                message: 'Root files need a developer.',
                paths: ['package.json', 'screenci.config.ts'],
              },
              403
            )
          : jsonResponse({ projectId: 'p1', manifest: [] })
      }
      return jsonResponse({}, 404)
    })
    const result = await syncProjectFiles(params, plan, { ...deps, fetchFn })

    expect(selectUrl).toBe(
      'https://api.example.com/cli/files/select?projectName=Demo&slugs=onboarding'
    )
    expect(commits).toHaveLength(2)
    const retried = commits[1]!.entries
    expect(retried).toContainEqual({
      path: 'package.json',
      hash: storedPackage.hash,
      byteSize: 17,
    })
    expect(retried.some((entry) => entry.path === 'screenci.config.ts')).toBe(
      false
    )
    expect(
      retried.some(
        (entry) => entry.path === 'recordings/onboarding.screenci.ts'
      )
    ).toBe(true)
    expect(result.committedVideos).toEqual(['Onboarding'])
    expect(deps.warnings.join('\n')).toMatch(
      /package\.json, screenci\.config\.ts were not stored: root files can only be changed by an organisation developer or admin/
    )
  })

  it('gives up after one retry', async () => {
    const deps = makeDeps(vi.fn())
    const plan = await planRunFileSync(
      {
        islandDir: ISLAND,
        sourceFilePaths: ['recordings/onboarding.screenci.ts'],
      },
      deps.fs
    )
    const fetchFn = vi.fn(async (input: string | URL) => {
      const url = String(input)
      if (url.endsWith('/cli/files/check')) return jsonResponse({ missing: [] })
      if (url.includes('/cli/files/select'))
        return jsonResponse({ entries: [] })
      return jsonResponse({ error: 'developer-only', paths: [] }, 403)
    })
    const result = await syncProjectFiles(params, plan, { ...deps, fetchFn })
    expect(
      fetchFn.mock.calls.filter(([url]) => String(url).endsWith('/commit'))
    ).toHaveLength(2)
    expect(result.failedVideos).toEqual(['Onboarding'])
  })
})

describe('prepareRunSources', () => {
  it('returns manifests even when storing fails, and warns once about others', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('offline')
    })
    const deps = makeDeps(fetchFn)
    const manifests = await prepareRunSources(
      {
        ...params,
        islandDir: ISLAND,
        sourceFilePaths: [
          'recordings/onboarding.screenci.ts',
          'recordings/many.screenci.ts',
        ],
      },
      deps
    )
    expect(manifests.get('recordings/onboarding.screenci.ts')).toContainEqual({
      path: 'recordings/onboarding.screenci.ts',
      hash: sha("video('Onboarding', async () => {})"),
    })
    expect(manifests.has('recordings/many.screenci.ts')).toBe(false)
    const notStoredWarnings = deps.warnings.filter((w) =>
      w.includes('not stored')
    )
    expect(notStoredWarnings).toHaveLength(1)
  })

  it('computes manifests but stores nothing on a hosted run', async () => {
    const fetchFn = vi.fn()
    const deps = makeDeps(fetchFn)
    const manifests = await prepareRunSources(
      {
        ...params,
        islandDir: ISLAND,
        sourceFilePaths: ['recordings/onboarding.screenci.ts'],
        storeFiles: false,
      },
      deps
    )
    expect(manifests.get('recordings/onboarding.screenci.ts')).toContainEqual({
      path: 'recordings/onboarding.screenci.ts',
      hash: sha("video('Onboarding', async () => {})"),
    })
    expect(fetchFn).not.toHaveBeenCalled()
    expect(deps.warnings.filter((w) => w.includes('Could not store'))).toEqual(
      []
    )
  })

  it('skips anonymous credentials entirely', async () => {
    const fetchFn = vi.fn()
    const manifests = await prepareRunSources(
      {
        ...params,
        credential: anonCredential('anon'),
        islandDir: ISLAND,
        sourceFilePaths: ['recordings/onboarding.screenci.ts'],
      },
      makeDeps(fetchFn)
    )
    expect(manifests.size).toBe(0)
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

describe('fetchRemoteSelection', () => {
  it('asks for the slugs and validates every path', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        projectId: 'p1',
        entries: [
          { path: 'package.json', hash: sha('{}'), byteSize: 2, kind: 'root' },
        ],
      })
    )
    const result = await fetchRemoteSelection(
      {
        apiUrl: 'https://api.example.com',
        secret: 's',
        projectName: 'Demo',
        slugs: ['a', 'b'],
      },
      fetchFn as unknown as typeof fetch
    )
    expect(result).toEqual({
      ok: true,
      entries: [
        { path: 'package.json', hash: sha('{}'), byteSize: 2, kind: 'root' },
      ],
    })
    const [url, init] = fetchFn.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(url).toBe(
      'https://api.example.com/cli/files/select?projectName=Demo&slugs=a%2Cb'
    )
    expect(init.headers).toMatchObject({ 'X-ScreenCI-Secret': 's' })

    const unsafe = await fetchRemoteSelection(
      { apiUrl: 'https://api.example.com', secret: 's' },
      (async () =>
        jsonResponse({
          entries: [{ path: '../x', hash: sha('x'), byteSize: 1 }],
        })) as unknown as typeof fetch
    )
    expect(unsafe).toMatchObject({ ok: false, status: 'error' })

    const none = await fetchRemoteSelection(
      { apiUrl: 'https://api.example.com', secret: 's' },
      (async () => jsonResponse({ entries: [] })) as unknown as typeof fetch
    )
    expect(none).toMatchObject({ ok: false, status: 'none' })
  })
})

describe('fetchProjectFileBlob', () => {
  it('downloads by hash and refuses non-hash input', async () => {
    const fetchFn = vi.fn(async () => new Response('bytes'))
    const bytes = await fetchProjectFileBlob(
      { apiUrl: 'https://api.example.com', secret: 's' },
      sha('bytes'),
      fetchFn as unknown as typeof fetch
    )
    expect(Buffer.from(bytes).toString()).toBe('bytes')
    expect(String(fetchFn.mock.calls[0]![0 as never])).toBe(
      `https://api.example.com/cli/files/blob/${sha('bytes')}`
    )
    await expect(
      fetchProjectFileBlob(
        { apiUrl: 'https://api.example.com', secret: 's' },
        '../etc/passwd',
        fetchFn as unknown as typeof fetch
      )
    ).rejects.toThrow(/Not a file hash/)
  })
})
