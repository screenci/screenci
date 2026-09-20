import { describe, expect, it, vi } from 'vitest'
import { Command } from 'commander'
import { stripVTControlCharacters } from 'node:util'
import {
  StartError,
  exchangeSetupCode,
  findVideoSourceFile,
  formatStartBrief,
  formatStartJsonLine,
  pinIslandConfigSource,
  proposedIslandDirName,
  registerSetupCommand,
  resolveStartWorkspace,
  runSetupCommand,
  type SetupExchange,
  siteRootOf,
  type StartDeps,
  type StartResult,
} from './src/setup.js'
import type { SourceBundleFs } from './src/sourceBundle.js'
import type { StartGit } from './src/repo.js'
import { EMPTY_AI_CONTEXT } from './src/aiContext.js'
import type { AppSessionStatus } from './src/appSession.js'
import {
  EMPTY_BRANDING,
  type DownloadBrandingSampleResult,
} from './src/branding.js'

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

const CODE = 'SC-ABCD-EFGH'
const API = 'https://api.example.com'

function exchange(overrides: Partial<SetupExchange> = {}): SetupExchange {
  return {
    kind: 'project',
    orgId: 'org_1',
    projectId: 'proj_1',
    projectName: 'my-app',
    secret: 'secret-1',
    task: { description: 'Show the onboarding flow' },
    sourcesAvailable: false,
    ciRecords: false,
    appUrl: 'https://app.example.com',
    aiContext: EMPTY_AI_CONTEXT,
    branding: EMPTY_BRANDING,
    ...overrides,
  }
}

const ACME_GIT = 'https://github.com/acme/app.git'

/** Server-side exchange payload (no `ok`, `appUrl` may be null). */
function exchangeBody(overrides: Partial<SetupExchange> = {}) {
  return exchange(overrides)
}

/** In-memory fs keyed by absolute paths; directories are implied by files. */
function memoryFs(seed: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(seed))
  const fs: SourceBundleFs = {
    readdir: async (dir) => {
      const prefix = `${dir}/`
      const names = new Map<string, boolean>()
      for (const path of files.keys()) {
        if (!path.startsWith(prefix)) continue
        const [head, ...tail] = path.slice(prefix.length).split('/')
        if (head) names.set(head, tail.length > 0)
      }
      if (names.size === 0) throw new Error('ENOENT')
      return [...names.entries()].map(([name, isDir]) => ({
        name,
        isDirectory: () => isDir,
        isFile: () => !isDir,
      }))
    },
    readFile: async (path) => {
      const content = files.get(path)
      if (content === undefined) throw new Error(`ENOENT ${path}`)
      return Buffer.from(content)
    },
    writeFile: async (path, data) => {
      files.set(path, data)
    },
    mkdir: async () => undefined,
    exists: async (path) =>
      files.has(path) ||
      [...files.keys()].some((key) => key.startsWith(`${path}/`)),
  }
  const existsSync = (path: string): boolean =>
    files.has(path) ||
    [...files.keys()].some((key) => key.startsWith(`${path}/`))
  return { fs, files, existsSync }
}

function makeDeps(
  fetchFn: (
    input: string | URL | Request,
    init?: RequestInit
  ) => Promise<Response>,
  seed: Record<string, string> = {}
) {
  const mem = memoryFs(seed)
  const logs: string[] = []
  const warnings: string[] = []
  const calls = {
    scaffold: [] as Array<Record<string, unknown>>,
    install: [] as string[],
    shell: [] as string[],
    skills: [] as Array<Record<string, unknown>>,
    secrets: [] as Array<[string, string]>,
    probes: [] as string[],
    sessionReads: [] as Array<{ configDir: string; profile: string }>,
    sampleDownloads: [] as string[],
  }
  let sampleDownload: DownloadBrandingSampleResult = { status: 'none' }
  /** Remotes by directory; set by tests that simulate a repository. */
  const remotes = new Map<string, string>()
  let siteReachable = true
  /** Per-URL reachability; falls back to `siteReachable`. */
  const reachableByUrl = new Map<string, boolean>()
  let cwd = '/work/my-app'
  let repoRoot = '/work/my-app'
  let session: AppSessionStatus = { saved: false }
  let dirty: boolean | null = false
  const git: StartGit = {
    remoteUrl: async (dir) => remotes.get(dir) ?? null,
    isDirty: async () => dirty,
  }
  const deps: StartDeps = {
    fetchFn: fetchFn as unknown as typeof fetch,
    fs: mem.fs,
    existsSync: mem.existsSync,
    env: {},
    cwd: () => cwd,
    hostname: () => 'laptop',
    apiUrl: API,
    appUrl: 'https://app.fallback.example',
    logger: {
      info: (message) => logs.push(stripVTControlCharacters(message)),
      warn: (message) => warnings.push(message),
    },
    scaffoldIsland: async (params) => {
      calls.scaffold.push(params as unknown as Record<string, unknown>)
      mem.files.set(
        `${params.islandDir}/screenci.config.ts`,
        `export default defineConfig({ projectName: '${params.projectName}', projectId: '${params.projectId ?? ''}', envFile: '.env' })`
      )
    },
    installIsland: async ({ islandDir }) => {
      calls.install.push(islandDir)
    },
    installPlaywrightShell: async ({ islandDir }) => {
      calls.shell.push(islandDir)
    },
    installAgentSkills: async (params) => {
      calls.skills.push(params as unknown as Record<string, unknown>)
    },
    findRepoRoot: () => repoRoot,
    persistSecret: async (path, secret) => {
      calls.secrets.push([path, secret])
    },
    downloadBrandingVoiceSample: async (params) => {
      calls.sampleDownloads.push(params.islandDir)
      return sampleDownload
    },
    readConfigSource: async (path) => mem.files.get(path) ?? null,
    git,
    probeSite: async (url) => {
      calls.probes.push(url)
      return reachableByUrl.get(url) ?? siteReachable
    },
    now: () => new Date('2026-09-03T12:00:00.000Z'),
    readAppSessionStatus: async ({ configDir, profile }) => {
      calls.sessionReads.push({ configDir, profile })
      return session
    },
  }
  return {
    deps,
    mem,
    logs,
    warnings,
    calls,
    remotes,
    setSiteReachable: (next: boolean) => {
      siteReachable = next
    },
    setSession: (next: AppSessionStatus) => {
      session = next
    },
    setDirty: (next: boolean | null) => {
      dirty = next
    },
    setReachable: (url: string, next: boolean) => {
      reachableByUrl.set(url, next)
    },
    setCwd: (next: string) => {
      cwd = next
    },
    setRepoRoot: (next: string) => {
      repoRoot = next
    },
    setSampleDownload: (next: DownloadBrandingSampleResult) => {
      sampleDownload = next
    },
  }
}

const baseOptions = {
  code: CODE,
  force: false,
  packageManager: 'npm' as const,
  verbose: false,
}

describe('exchangeSetupCode', () => {
  it('sends the code, machine, name precedence inputs and package manager', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(exchangeBody()))
    const result = await exchangeSetupCode(
      {
        apiUrl: API,
        code: ' sc-abcd-efgh ',
        machineName: 'laptop',
        projectName: 'Chosen',
        defaultProjectName: 'my-app',
        packageManager: 'pnpm',
      },
      fetchFn as unknown as typeof fetch
    )
    expect(result.ok).toBe(true)
    const [url, init] = fetchFn.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(url).toBe(`${API}/cli/setup/exchange`)
    expect(JSON.parse(init.body as string)).toEqual({
      code: CODE,
      machineName: 'laptop',
      projectName: 'Chosen',
      defaultProjectName: 'my-app',
      packageManager: 'pnpm',
    })
  })

  it('maps every failure to a typed kind', async () => {
    const attempt = async (response: () => Promise<Response>) =>
      exchangeSetupCode(
        {
          apiUrl: API,
          code: CODE,
          machineName: 'm',
          defaultProjectName: 'd',
          packageManager: 'npm',
        },
        response as unknown as typeof fetch
      )
    expect(
      await attempt(async () =>
        jsonResponse({ error: 'used', code: 'setup_code_used' }, 409)
      )
    ).toMatchObject({ ok: false, kind: 'used', message: 'used' })
    expect(
      await attempt(async () =>
        jsonResponse({ error: 'x', code: 'setup_code_expired' }, 410)
      )
    ).toMatchObject({ ok: false, kind: 'expired' })
    expect(
      await attempt(async () =>
        jsonResponse({ error: 'x', code: 'setup_code_revoked' }, 410)
      )
    ).toMatchObject({ ok: false, kind: 'revoked' })
    expect(
      await attempt(async () =>
        jsonResponse({ error: 'x', code: 'setup_code_invalid' }, 404)
      )
    ).toMatchObject({ ok: false, kind: 'invalid' })
    expect(
      await attempt(async () => {
        throw new Error('ECONNREFUSED')
      })
    ).toMatchObject({ ok: false, kind: 'unreachable' })
    expect(
      await attempt(async () => jsonResponse({ nope: true }))
    ).toMatchObject({
      ok: false,
      kind: 'malformed',
    })
    expect(
      await attempt(async () => new Response('x', { status: 500 }))
    ).toMatchObject({ ok: false, kind: 'malformed' })
  })

  it('refuses a malformed code without a request', async () => {
    const fetchFn = vi.fn()
    const result = await exchangeSetupCode(
      {
        apiUrl: API,
        code: 'not-a-code',
        machineName: 'm',
        defaultProjectName: 'd',
        packageManager: 'npm',
      },
      fetchFn as unknown as typeof fetch
    )
    expect(result).toMatchObject({ ok: false, kind: 'invalid' })
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

describe('resolveStartWorkspace', () => {
  it('classifies absent, same-project and other-project islands', async () => {
    const absent = memoryFs()
    expect(
      await resolveStartWorkspace('/w/screenci', 'proj_1', {
        existsSync: absent.existsSync,
        readConfigSource: async () => null,
      })
    ).toEqual({ state: 'absent' })

    const same = memoryFs({
      '/w/screenci/screenci.config.ts':
        "export default { projectId: 'proj_1' }",
    })
    expect(
      await resolveStartWorkspace('/w/screenci', 'proj_1', {
        existsSync: same.existsSync,
        readConfigSource: async (path) => same.files.get(path) ?? null,
      })
    ).toEqual({ state: 'same-project' })

    const other = memoryFs({
      '/w/screenci/screenci.config.ts':
        "export default { projectId: 'proj_2' }",
    })
    expect(
      await resolveStartWorkspace('/w/screenci', 'proj_1', {
        existsSync: other.existsSync,
        readConfigSource: async (path) => other.files.get(path) ?? null,
      })
    ).toEqual({ state: 'other-project', existingProjectId: 'proj_2' })

    // A folder without a config (an empty folder, `--dir .`) is usable.
    const bare = memoryFs({ '/w/screenci/notes.txt': 'x' })
    expect(
      await resolveStartWorkspace('/w/screenci', 'proj_1', {
        existsSync: bare.existsSync,
        readConfigSource: async () => null,
      })
    ).toEqual({ state: 'absent' })

    // An island scaffolded by `screenci init` has no projectId at all.
    const repo = memoryFs({
      '/w/screenci/screenci.config.ts': "export default { projectName: 'x' }",
    })
    expect(
      await resolveStartWorkspace('/w/screenci', 'proj_1', {
        existsSync: repo.existsSync,
        readConfigSource: async (path) => repo.files.get(path) ?? null,
      })
    ).toEqual({ state: 'unpinned', projectName: 'x' })
  })
})

describe('runSetupCommand', () => {
  it('scaffolds a new project, writes credentials and prints the brief', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(exchangeBody()))
    const { deps, calls, logs } = makeDeps(fetchFn)

    const result = await runSetupCommand(baseOptions, deps)

    expect(result.outcome).toBe('scaffolded')
    expect(result.islandDir).toBe('/work/my-app/screenci')
    expect(calls.scaffold[0]).toMatchObject({
      islandDir: '/work/my-app/screenci',
      repoRoot: '/work/my-app',
      projectName: 'my-app',
      projectId: 'proj_1',
      packageManager: 'npm',
      installScreenCISkill: true,
      writeGithubWorkflow: false,
    })
    expect(calls.secrets).toEqual([['/work/my-app/screenci/.env', 'secret-1']])
    // The exchange request carried the folder name as the default and no --name.
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.defaultProjectName).toBe('my-app')
    expect(body).not.toHaveProperty('projectName')
    // Brief + JSON line.
    expect(logs.some((line) => line.includes('Show the onboarding flow'))).toBe(
      true
    )
    expect(logs.some((line) => line.includes('npx screenci preview'))).toBe(
      true
    )
    const jsonLine = logs.find((line) => line.startsWith('{'))
    expect(jsonLine && JSON.parse(jsonLine)).toMatchObject({
      status: 'ready',
      kind: 'project',
      projectId: 'proj_1',
      outcome: 'scaffolded',
      appUrl: 'https://app.example.com',
    })
  })

  it('passes --name through as the explicit project name', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(exchangeBody({ projectName: 'Chosen' }))
    )
    const { deps } = makeDeps(fetchFn)
    await runSetupCommand({ ...baseOptions, name: ' Chosen ' }, deps)
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toMatchObject({
      projectName: 'Chosen',
    })
  })

  it('pulls sources for a video code when no island exists, then installs', async () => {
    const fetchFn = vi.fn(async (input: string | URL) => {
      const url = String(input)
      if (url.endsWith('/cli/setup/exchange')) {
        return jsonResponse(
          exchangeBody({ kind: 'video', sourcesAvailable: true })
        )
      }
      if (url.includes('/cli/sources/latest')) {
        return jsonResponse(
          {
            files: [
              {
                path: 'screenci.config.ts',
                content:
                  "export default { projectName: 'my-app', projectId: 'proj_1', envFile: '.env.local' }",
              },
              { path: 'recordings/a.screenci.ts', content: 'a' },
            ],
          },
          200,
          { 'X-ScreenCI-Source-Bundle-Id': 'sb_1' }
        )
      }
      return jsonResponse({}, 404)
    })
    const { deps, mem, calls } = makeDeps(fetchFn)

    const result = await runSetupCommand(baseOptions, deps)

    expect(result.outcome).toBe('pulled')
    expect(
      mem.files.get('/work/my-app/screenci/recordings/a.screenci.ts')
    ).toBe('a')
    expect(calls.scaffold).toHaveLength(0)
    expect(calls.install).toEqual(['/work/my-app/screenci'])
    expect(calls.shell).toEqual(['/work/my-app/screenci'])
    expect(calls.skills[0]).toMatchObject({
      repoRoot: '/work/my-app',
      skills: ['screenci', 'playwright-cli'],
    })
    // The pulled config names its own env file.
    expect(calls.secrets).toEqual([
      ['/work/my-app/screenci/.env.local', 'secret-1'],
    ])
    // The sources request authenticated with the freshly minted secret.
    const sourcesCall = fetchFn.mock.calls.find(([input]) =>
      String(input).includes('/cli/sources/latest')
    ) as unknown as [string, RequestInit]
    expect(sourcesCall[1].headers).toMatchObject({
      'X-ScreenCI-Secret': 'secret-1',
    })
  })

  it('falls back to scaffolding when a video code has no sources yet', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(exchangeBody({ kind: 'video', sourcesAvailable: false }))
    )
    const { deps, calls } = makeDeps(fetchFn)
    const result = await runSetupCommand(baseOptions, deps)
    expect(result.outcome).toBe('scaffolded')
    expect(calls.scaffold).toHaveLength(1)
  })

  it('uses an existing island of the same project as is, and replaces it only with --force', async () => {
    const island = '/work/my-app/screenci'
    const exchangeResponse = exchangeBody({
      kind: 'edit',
      videoId: 'vid_1',
      videoName: 'Onboarding',
      sourcesAvailable: true,
    })
    const remoteFiles = [
      {
        path: 'screenci.config.ts',
        content:
          "export default { projectName: 'my-app', projectId: 'proj_1' }",
      },
      {
        path: 'recordings/onboarding.screenci.ts',
        content: "video('Onboarding', async () => {})",
      },
    ]
    const fetchFn = vi.fn(async (input: string | URL) => {
      const url = String(input)
      if (url.endsWith('/cli/setup/exchange'))
        return jsonResponse(exchangeResponse)
      if (url.includes('/cli/sources/latest'))
        return jsonResponse({ files: remoteFiles })
      return jsonResponse({}, 404)
    })
    const seed = {
      [`${island}/screenci.config.ts`]:
        "export default { projectName: 'my-app', projectId: 'proj_1' }",
      [`${island}/recordings/onboarding.screenci.ts`]:
        "video('Onboarding', async () => { /* locally edited */ })",
      [`${island}/node_modules/.keep`]: '',
    }

    // The local workspace wins: nothing is pulled, nothing overwritten.
    const kept = makeDeps(fetchFn, seed)
    const result = await runSetupCommand(baseOptions, kept.deps)
    expect(result.outcome).toBe('existing')
    expect(
      kept.mem.files.get(`${island}/recordings/onboarding.screenci.ts`)
    ).toBe("video('Onboarding', async () => { /* locally edited */ })")
    expect(
      fetchFn.mock.calls.some(([url]) =>
        String(url).includes('/cli/sources/latest')
      )
    ).toBe(false)
    expect(result.videoSourcePath).toBe(
      'screenci/recordings/onboarding.screenci.ts'
    )
    // node_modules exists, so no install runs.
    expect(kept.calls.install).toHaveLength(0)
    expect(kept.calls.secrets).toEqual([[`${island}/.env`, 'secret-1']])
    expect(kept.logs.join('\n')).toContain('used as is')

    const forced = makeDeps(fetchFn, seed)
    const replaced = await runSetupCommand(
      { ...baseOptions, force: true },
      forced.deps
    )
    expect(replaced.outcome).toBe('existing')
    expect(replaced.overwritten).toEqual(['recordings/onboarding.screenci.ts'])
    expect(
      forced.mem.files.get(`${island}/recordings/onboarding.screenci.ts`)
    ).toBe("video('Onboarding', async () => {})")
  })

  it("refuses another project's unpinned island and accepts --dir", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(exchangeBody()))
    const { deps, calls } = makeDeps(fetchFn, {
      '/work/my-app/screenci/screenci.config.ts':
        "export default { projectName: 'other' }",
    })
    await expect(runSetupCommand(baseOptions, deps)).rejects.toThrow(
      /"other".*--dir/s
    )
    expect(calls.secrets).toHaveLength(0)

    const alt = makeDeps(fetchFn, {
      '/work/my-app/screenci/screenci.config.ts':
        "export default { projectName: 'other' }",
    })
    const result = await runSetupCommand(
      { ...baseOptions, dir: 'videos' },
      alt.deps
    )
    expect(result.islandDir).toBe('/work/my-app/videos')
    expect(result.islandDisplayDir).toBe('videos')
  })

  it('refuses an island pinned to another project after the exchange', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(exchangeBody()))
    const { deps, calls } = makeDeps(fetchFn, {
      '/work/my-app/screenci/screenci.config.ts':
        "export default { projectName: 'other', projectId: 'proj_9' }",
    })
    await expect(runSetupCommand(baseOptions, deps)).rejects.toThrow(
      /proj_9.*--dir/s
    )
    expect(calls.secrets).toHaveLength(0)
  })

  it('warns when the shell exports a different SCREENCI_SECRET', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(exchangeBody()))
    const { deps, warnings, logs } = makeDeps(fetchFn)
    deps.env = { SCREENCI_SECRET: 'org-wide-secret' }
    const result = await runSetupCommand(baseOptions, deps)
    expect(result.shellSecretOverride).toBe(true)
    expect(warnings.join('\n')).toMatch(/unset SCREENCI_SECRET/)
    expect(logs.join('\n')).toMatch(
      /WARNING: this shell exports a different SCREENCI_SECRET/
    )
    const jsonLine = logs.find((line) => line.startsWith('{'))
    expect(jsonLine && JSON.parse(jsonLine)).toMatchObject({
      shellSecretOverride: true,
    })
  })

  it("uses the repository's own island when the command runs inside a repository", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(
        exchangeBody({
          kind: 'edit',
          videoName: 'Onboarding',
          videoId: 'vid_1',
          aiContext: EMPTY_AI_CONTEXT,
        })
      )
    )
    const island = '/work/my-app/screenci'
    const { deps, calls, remotes, logs } = makeDeps(fetchFn, {
      [`${island}/screenci.config.ts`]:
        "export default { projectName: 'my-app' }",
      [`${island}/recordings/onboarding.screenci.ts`]:
        "video('Onboarding', async () => {})",
      [`${island}/node_modules/.keep`]: '',
    })
    remotes.set('/work/my-app', 'git@github.com:acme/app.git')

    const result = await runSetupCommand(baseOptions, deps)

    expect(result.outcome).toBe('existing')
    expect(result.repo).toEqual({
      state: 'inside',
      dir: '/work/my-app',
      gitUrl: 'git@github.com:acme/app.git',
    })
    expect(calls.scaffold).toHaveLength(0)
    expect(result.videoSourcePath).toBe(
      'screenci/recordings/onboarding.screenci.ts'
    )
    expect(calls.secrets).toEqual([[`${island}/.env`, 'secret-1']])
    expect(logs.join('\n')).toContain('commit your change on a branch')
  })

  it('never clones: outside any repository it works from the site and keeps the workspace in ./screenci', async () => {
    const fetchFn = vi.fn(async (input: string | URL) => {
      const url = String(input)
      if (url.endsWith('/cli/setup/exchange')) {
        return jsonResponse(
          exchangeBody({ kind: 'video', sourcesAvailable: true })
        )
      }
      if (url.includes('/cli/sources/latest')) {
        return jsonResponse({
          files: [
            {
              path: 'screenci.config.ts',
              content:
                "export default { projectName: 'my-app', projectId: 'proj_1' }",
            },
          ],
        })
      }
      return jsonResponse({}, 404)
    })
    const { deps, calls, mem, logs } = makeDeps(fetchFn)

    const result = await runSetupCommand(baseOptions, deps)

    expect(result.repo).toEqual({ state: 'none' })
    expect(mem.files.has('/work/my-app/.screenci/.gitignore')).toBe(false)
    expect(
      [...mem.files.keys()].some((path) => path.includes('/.screenci/'))
    ).toBe(false)
    expect(result.islandDir).toBe('/work/my-app/screenci')
    expect(result.outcome).toBe('pulled')
    expect(calls.install).toEqual(['/work/my-app/screenci'])
    const brief = logs.join('\n')
    expect(brief).toContain('did not run inside a repository')
    expect(brief).toContain('Work from the site alone')
    expect(brief).not.toContain('clone')
    expect(brief).not.toContain('Add to repository')
  })

  it("treats the cwd repository as the product's whatever its remote is", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(
        exchangeBody({
          kind: 'edit',
          videoName: 'Onboarding',
          videoId: 'vid_1',
          aiContext: EMPTY_AI_CONTEXT,
        })
      )
    )
    const island = '/work/my-app/screenci'
    const { deps, calls, remotes } = makeDeps(fetchFn, {
      [`${island}/screenci.config.ts`]:
        "export default { projectName: 'my-app' }",
      [`${island}/node_modules/.keep`]: '',
    })
    // A fork or a mirror: nobody told ScreenCI any URL, and none is needed.
    remotes.set('/work/my-app', 'git@github.com:fork/app.git')

    const result = await runSetupCommand(baseOptions, deps)

    expect(result.repo).toEqual({
      state: 'inside',
      dir: '/work/my-app',
      gitUrl: 'git@github.com:fork/app.git',
    })
    expect(result.outcome).toBe('existing')
    expect(calls.scaffold).toHaveLength(0)
  })

  it('tells a record code to trigger the pipeline when CI records the project', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(
        exchangeBody({
          kind: 'record',
          videoName: 'Sign up (beta)',
          videoId: 'vid_1',
          ciRecords: true,
          aiContext: EMPTY_AI_CONTEXT,
        })
      )
    )
    const island = '/work/my-app/screenci'
    const { deps, remotes, logs } = makeDeps(fetchFn, {
      [`${island}/screenci.config.ts`]:
        "export default { projectName: 'my-app' }",
      [`${island}/recordings/signup.screenci.ts`]:
        "video('Sign up (beta)', async () => {})",
      [`${island}/node_modules/.keep`]: '',
    })
    remotes.set('/work/my-app', ACME_GIT)

    const result = await runSetupCommand(baseOptions, deps)

    expect(result.videoSourcePath).toBe(
      'screenci/recordings/signup.screenci.ts'
    )
    const brief = logs.join('\n')
    expect(brief).toContain('Re-record the ScreenCI video "Sign up (beta)"')
    expect(brief).toContain(
      'Record screenci/recordings/signup.screenci.ts again as it is'
    )
    expect(brief).toContain('A CI pipeline already records this project')
    // The title is a regex for Playwright: escaped and anchored.
    expect(brief).toContain(
      "gh workflow run screenci.yaml -f grep='^Sign up \\(beta\\)$'"
    )
    expect(brief).toContain('npx screenci preview "Sign up (beta)"')
    expect(brief).toContain('"ciRecords":true')
  })

  it('tells a whole-project record code to preview without a title', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(
        exchangeBody({
          kind: 'record',
          aiContext: EMPTY_AI_CONTEXT,
        })
      )
    )
    const island = '/work/my-app/screenci'
    const { deps, remotes, logs } = makeDeps(fetchFn, {
      [`${island}/screenci.config.ts`]:
        "export default { projectName: 'my-app' }",
      [`${island}/node_modules/.keep`]: '',
    })
    remotes.set('/work/my-app', ACME_GIT)

    await runSetupCommand(baseOptions, deps)

    const brief = logs.join('\n')
    expect(brief).toContain(
      'Re-record every video of the ScreenCI project "my-app"'
    )
    expect(brief).toContain(
      'npx screenci preview                  # re-record every video'
    )
    expect(brief).not.toContain('A CI pipeline already records this project')
  })

  it('finds the script for a language code and tells the agent to translate', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(
        exchangeBody({
          kind: 'language',
          videoName: 'Onboarding',
          videoId: 'vid_1',
          task: { description: 'Add fi', language: 'fi' },
          aiContext: EMPTY_AI_CONTEXT,
        })
      )
    )
    const island = '/work/my-app/screenci'
    const { deps, remotes, logs } = makeDeps(fetchFn, {
      [`${island}/screenci.config.ts`]:
        "export default { projectName: 'my-app' }",
      [`${island}/recordings/onboarding.screenci.ts`]:
        "video('Onboarding', async () => {})",
      [`${island}/node_modules/.keep`]: '',
    })
    remotes.set('/work/my-app', ACME_GIT)

    const result = await runSetupCommand(baseOptions, deps)

    expect(result.videoSourcePath).toBe(
      'screenci/recordings/onboarding.screenci.ts'
    )
    const brief = logs.join('\n')
    expect(brief).toContain('Add the language "fi"')
    expect(brief).toContain('video.languages([...])')
    expect(brief).toContain('npx screenci preview "Onboarding"')
    expect(brief).toContain('"language":"fi"')
  })

  it('keeps ./screenci for a new project outside any repository', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(exchangeBody()))
    const { deps } = makeDeps(fetchFn)
    const result = await runSetupCommand(baseOptions, deps)
    expect(result.repo).toEqual({ state: 'none' })
    expect(result.islandDir).toBe('/work/my-app/screenci')
    expect(result.outcome).toBe('scaffolded')
  })

  it('recognises a repository by its .git directory even without a remote', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(exchangeBody()))
    const { deps } = makeDeps(fetchFn, { '/work/my-app/.git/HEAD': 'ref' })
    const result = await runSetupCommand(baseOptions, deps)
    expect(result.repo).toEqual({
      state: 'inside',
      dir: '/work/my-app',
      gitUrl: null,
    })
  })

  it('stops for a local site that is down when starting it is not allowed', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(
        exchangeBody({
          aiContext: {
            ...EMPTY_AI_CONTEXT,
            siteUrl: 'http://localhost:3000',
          },
        })
      )
    )
    const { deps, calls, logs, setSiteReachable } = makeDeps(fetchFn)
    setSiteReachable(false)
    const result = await runSetupCommand(baseOptions, deps)
    expect(calls.probes).toEqual(['http://localhost:3000'])
    expect(result.site).toEqual({
      state: 'checked',
      url: 'http://localhost:3000',
      kind: 'local',
      reachable: false,
    })
    expect(result.stop).toMatchObject({
      reason: 'site-unreachable-local',
      docsUrl: 'https://example.com/docs/guides/ai-context',
    })
    // The workspace was still prepared.
    expect(calls.secrets).toHaveLength(1)
    const brief = logs.join('\n')
    expect(brief).toContain('## STOP')
    expect(brief).toContain('switched off')
    const jsonLine = logs.find((line) => line.startsWith('{'))
    expect(jsonLine && JSON.parse(jsonLine)).toMatchObject({
      status: 'stopped',
      stop: { reason: 'site-unreachable-local' },
    })
  })

  it('lets the agent start a local site from the repository when allowed', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(
        exchangeBody({
          aiContext: {
            ...EMPTY_AI_CONTEXT,
            siteUrl: 'http://localhost:3000',
            runLocallyIfNeeded: true,
          },
        })
      )
    )
    const { deps, logs, remotes, setSiteReachable } = makeDeps(fetchFn)
    remotes.set('/work/my-app', ACME_GIT)
    setSiteReachable(false)
    const result = await runSetupCommand(baseOptions, deps)
    expect(result.stop).toBeNull()
    const brief = logs.join('\n')
    expect(brief).toContain('start it from the repository')
    expect(brief).toContain('SCREENCI_APP_LAUNCHED_BY=agent')
  })

  it('stops for a local site that is down when starting it is allowed but no repository is at hand', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(
        exchangeBody({
          aiContext: {
            ...EMPTY_AI_CONTEXT,
            siteUrl: 'http://localhost:3000',
            runLocallyIfNeeded: true,
          },
        })
      )
    )
    const { deps, setSiteReachable } = makeDeps(fetchFn)
    setSiteReachable(false)
    const result = await runSetupCommand(baseOptions, deps)
    expect(result.stop).toMatchObject({ reason: 'site-unreachable-local' })
    expect(result.stop?.message).toContain('did not run inside the repository')
  })

  it('stops for a deployed site that is down unless the check is skipped', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(
        exchangeBody({
          aiContext: { ...EMPTY_AI_CONTEXT, siteUrl: 'https://app.acme.com' },
        })
      )
    )
    const down = makeDeps(fetchFn)
    down.setSiteReachable(false)
    const stopped = await runSetupCommand(baseOptions, down.deps)
    expect(stopped.stop).toMatchObject({ reason: 'site-unreachable' })

    const skipped = makeDeps(fetchFn)
    skipped.setSiteReachable(false)
    const result = await runSetupCommand(
      { ...baseOptions, skipSiteCheck: true },
      skipped.deps
    )
    expect(result.site).toEqual({
      state: 'unchecked',
      url: 'https://app.acme.com',
      kind: 'deployed',
    })
    expect(result.stop).toBeNull()
    expect(skipped.calls.probes).toHaveLength(0)
  })

  it('prefers the task app URL over the context site URL', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(
        exchangeBody({
          task: { description: 'x', appUrl: 'https://staging.acme.com' },
          aiContext: { ...EMPTY_AI_CONTEXT, siteUrl: 'https://app.acme.com' },
        })
      )
    )
    const { deps, calls } = makeDeps(fetchFn)
    await runSetupCommand(baseOptions, deps)
    expect(calls.probes).toEqual(['https://staging.acme.com'])
  })

  it('tells the agent to open a sign-in browser when no session is saved', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(exchangeBody()))
    const { deps, calls, logs } = makeDeps(fetchFn)
    const result = await runSetupCommand(baseOptions, deps)

    // Read from the island on disk, never from the service.
    expect(calls.sessionReads).toEqual([
      { configDir: '/work/my-app/screenci', profile: 'default' },
    ])
    expect(result.session).toEqual({ saved: false })
    const brief = logs.join('\n')
    expect(brief).toContain('## Signing in')
    expect(brief).toContain('npx screenci login')
    expect(brief).toContain('npx screenci login --done')
    expect(brief).toContain('never ask them for a password or a code yourself')
    // The credential path is gone for good.
    expect(brief).not.toContain('APP_USERNAME')
    expect(brief).not.toContain('APP_PASSWORD')
    expect(brief).not.toContain('pull-login')
  })

  it('hands over the session file path and forbids a hand-rolled explore script', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(exchangeBody()))
    const { deps, logs } = makeDeps(fetchFn)
    await runSetupCommand(baseOptions, deps)
    const brief = logs.join('\n')

    // Exploring with its own Playwright script is what sent an agent chasing
    // selectors on a signed-out page for several minutes.
    expect(brief).toContain('never a Playwright script of your own')
    expect(brief).toContain(
      'playwright-cli state-load screenci/.screenci/auth/default.json'
    )
  })

  it('tells the agent not to script a sign-in when a session is already saved', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(exchangeBody()))
    const withSession = makeDeps(fetchFn)
    withSession.setSession({
      saved: true,
      path: '/work/my-app/screenci/.screenci/auth/default.json',
      meta: {
        profile: 'default',
        origin: 'https://app.example.com',
        savedAt: '2026-09-03T11:00:00.000Z',
        expiresAt: null,
      },
      expired: false,
    })
    await runSetupCommand(baseOptions, withSession.deps)
    const brief = withSession.logs.join('\n')
    expect(brief).toContain('already saved on this machine')
    expect(brief).toContain('WITHOUT any sign-in steps')
    // The exact file, so `state-load` can be copied rather than guessed at.
    expect(brief).toContain('screenci/.screenci/auth/default.json')
    expect(brief).toContain('playwright-cli state-load')
  })

  it('says the session expired and how to renew it', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(exchangeBody()))
    const expired = makeDeps(fetchFn)
    expired.setSession({
      saved: true,
      path: '/work/my-app/screenci/.screenci/auth/default.json',
      meta: {
        profile: 'default',
        origin: 'https://app.example.com',
        savedAt: '2026-08-01T12:00:00.000Z',
        expiresAt: '2026-08-30T12:00:00.000Z',
      },
      expired: true,
    })
    await runSetupCommand(baseOptions, expired.deps)
    expect(expired.logs.join('\n')).toContain('The saved session expired.')
  })

  it('states the sign-in as a fact when the team said the site needs one', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(
        exchangeBody({
          aiContext: { ...EMPTY_AI_CONTEXT, siteRequiresLogin: true },
        })
      )
    )
    const { deps, logs } = makeDeps(fetchFn)
    await runSetupCommand(baseOptions, deps)
    const brief = logs.join('\n')
    expect(brief).toContain('The team says this site needs a sign-in.')
    expect(brief).not.toContain('If the flow you are asked to record sits')
  })

  it('leaves the sign-in conditional when the team said nothing', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(exchangeBody()))
    const { deps, logs } = makeDeps(fetchFn)
    await runSetupCommand(baseOptions, deps)
    const brief = logs.join('\n')
    expect(brief).toContain('If the flow you are asked to record sits behind')
    expect(brief).not.toContain('The team says this site needs a sign-in.')
  })

  it('installs skills in the cwd repository and keeps a new project out of its foreign island', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(exchangeBody()))
    const { deps, calls, remotes } = makeDeps(fetchFn, {
      '/work/my-app/screenci/screenci.config.ts':
        "export default { projectName: 'other-product' }",
    })
    remotes.set('/work/my-app', ACME_GIT)

    await expect(runSetupCommand(baseOptions, deps)).rejects.toThrow(
      /other-product/
    )
    expect(calls.scaffold).toHaveLength(0)
  })

  it('refuses CI without a repository', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(exchangeBody({ kind: 'ci', sourcesAvailable: true }))
    )
    const { deps } = makeDeps(fetchFn)
    await expect(runSetupCommand(baseOptions, deps)).rejects.toThrow(
      /run this command inside the repository/
    )
  })

  it('uses the repository CI setup runs in', async () => {
    const fetchFn = vi.fn(async (input: string | URL) => {
      const url = String(input)
      if (url.endsWith('/cli/setup/exchange')) {
        return jsonResponse(
          exchangeBody({ kind: 'ci', sourcesAvailable: true })
        )
      }
      if (url.includes('/cli/sources/latest')) {
        return jsonResponse({
          files: [
            {
              path: 'screenci.config.ts',
              content:
                "export default defineConfig({ projectName: 'my-app', projectId: 'proj_1' })\n",
            },
          ],
        })
      }
      return jsonResponse({}, 404)
    })
    const { deps, remotes, calls } = makeDeps(fetchFn)
    // The prompt says "run this inside the repository".
    remotes.set('/work/my-app', 'git@github.com:acme/app.git')

    const result = await runSetupCommand(baseOptions, deps)

    expect(result.repo).toEqual({
      state: 'inside',
      dir: '/work/my-app',
      gitUrl: 'git@github.com:acme/app.git',
    })
    expect(result.outcome).toBe('pulled')
    expect(result.islandDir).toBe('/work/my-app/screenci')
  })

  it('prepares CI for a repository with a workspace: detects providers, skips the site check, prints the CI brief', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(
        exchangeBody({
          kind: 'ci',
          task: { description: 'Set up CI recording for this project.' },
          aiContext: {
            ...EMPTY_AI_CONTEXT,
            siteUrl: 'https://staging.acme.com',
          },
        })
      )
    )
    const island = '/work/my-app/screenci'
    const { deps, calls, remotes, logs } = makeDeps(fetchFn, {
      [`${island}/screenci.config.ts`]:
        "export default { projectName: 'my-app' }",
      '/work/my-app/.gitlab-ci.yml': 'stages: []',
      '/work/my-app/.github/workflows/deploy.yaml': 'name: deploy',
    })
    remotes.set('/work/my-app', ACME_GIT)

    const result = await runSetupCommand(baseOptions, deps)

    expect(result.outcome).toBe('existing')
    expect(result.ci).toEqual({
      providers: ['github', 'gitlab'],
      githubWorkflowExists: false,
    })
    // CI records elsewhere: the site is never probed and nothing stops.
    expect(calls.probes).toHaveLength(0)
    expect(result.stop).toBeNull()
    expect(calls.install).toEqual([island])
    const brief = logs.join('\n')
    expect(brief).toContain('Record the ScreenCI project "my-app" from CI.')
    expect(brief).toContain('GitHub Actions (.github/workflows/)')
    expect(brief).toContain('GitLab CI (.gitlab-ci.yml)')
    expect(brief).toContain(
      `gh secret set SCREENCI_SECRET --body "$(grep '^SCREENCI_SECRET=' screenci/.env | cut -d= -f2-)"`
    )
    expect(brief).toContain('glab variable set SCREENCI_SECRET --masked')
    expect(brief).toContain('npx screenci ci-workflow')
    expect(brief).toContain('/docs/ci-setup#other-providers')
    expect(brief).toContain(
      'only a run made by the pipeline completes this setup'
    )
    // The key itself never appears in the brief.
    expect(brief).not.toContain('secret-1')
    expect(brief).not.toContain('## Site')
    expect(brief).not.toContain('## Signing in')
    expect(brief).not.toContain('Commit the sources first')
  })

  it('pulls the snapshot into the repository on the way to CI when it has no workspace', async () => {
    const fetchFn = vi.fn(async (input: string | URL) => {
      const url = String(input)
      if (url.endsWith('/cli/setup/exchange')) {
        return jsonResponse(
          exchangeBody({
            kind: 'ci',
            sourcesAvailable: true,
            aiContext: EMPTY_AI_CONTEXT,
          })
        )
      }
      if (url.includes('/cli/sources/latest')) {
        return jsonResponse({
          files: [
            {
              path: 'screenci.config.ts',
              content:
                "export default defineConfig({\n  projectName: 'my-app',\n  projectId: 'proj_1',\n  envFile: '.env',\n})\n",
            },
          ],
        })
      }
      return jsonResponse({}, 404)
    })
    const { deps, mem, remotes, logs } = makeDeps(fetchFn, {
      '/work/my-app/.github/workflows/screenci.yaml': 'name: ScreenCI',
    })
    remotes.set('/work/my-app', ACME_GIT)

    const result = await runSetupCommand(baseOptions, deps)

    expect(result.outcome).toBe('pulled')
    expect(result.islandDir).toBe('/work/my-app/screenci')
    // The snapshot is committed as is; projectId stays (it is identity only).
    expect(mem.files.get('/work/my-app/screenci/screenci.config.ts')).toContain(
      "projectId: 'proj_1'"
    )
    expect(result.ci).toEqual({
      providers: ['github'],
      githubWorkflowExists: true,
    })
    const brief = logs.join('\n')
    expect(brief).toContain('## 1. Commit the sources first')
    expect(brief).not.toContain('merge-complete')
    expect(brief).toContain('screenci.yaml already exists')
    expect(brief).not.toContain('npx screenci ci-workflow')
  })

  it('leaves an existing repository workspace alone for CI even when ScreenCI holds a snapshot', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(
        exchangeBody({
          kind: 'ci',
          sourcesAvailable: true,
          aiContext: EMPTY_AI_CONTEXT,
        })
      )
    )
    const island = '/work/my-app/screenci'
    const { deps, mem, remotes } = makeDeps(fetchFn, {
      [`${island}/screenci.config.ts`]:
        "export default { projectName: 'my-app' }",
      [`${island}/recordings/a.screenci.ts`]: 'edited in git',
    })
    remotes.set('/work/my-app', ACME_GIT)

    const result = await runSetupCommand(baseOptions, deps)

    expect(result.outcome).toBe('existing')
    expect(mem.files.get(`${island}/recordings/a.screenci.ts`)).toBe(
      'edited in git'
    )
    expect(
      fetchFn.mock.calls.some(([url]) =>
        String(url).includes('/cli/sources/latest')
      )
    ).toBe(false)
  })

  it('refuses CI for a repository project whose sources are nowhere', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(
        exchangeBody({
          kind: 'ci',
          aiContext: EMPTY_AI_CONTEXT,
        })
      )
    )
    const { deps, remotes } = makeDeps(fetchFn)
    remotes.set('/work/my-app', ACME_GIT)
    await expect(runSetupCommand(baseOptions, deps)).rejects.toThrow(
      /Record a video first/
    )
  })

  it('replaces an unpinned repository workspace with the snapshot only with --force', async () => {
    const fetchFn = vi.fn(async (input: string | URL) => {
      const url = String(input)
      if (url.endsWith('/cli/setup/exchange')) {
        return jsonResponse(
          exchangeBody({
            kind: 'video',
            sourcesAvailable: true,
            aiContext: EMPTY_AI_CONTEXT,
          })
        )
      }
      if (url.includes('/cli/sources/latest')) {
        return jsonResponse({
          files: [
            {
              path: 'screenci.config.ts',
              content:
                "export default defineConfig({ projectName: 'my-app' })\n",
            },
            { path: 'recordings/a.screenci.ts', content: 'edited' },
          ],
        })
      }
      return jsonResponse({}, 404)
    })
    const island = '/work/my-app/screenci'
    const { deps, mem, remotes } = makeDeps(fetchFn, {
      [`${island}/screenci.config.ts`]:
        "export default defineConfig({ projectName: 'my-app' })\n",
      [`${island}/recordings/a.screenci.ts`]: 'original',
    })
    remotes.set('/work/my-app', ACME_GIT)

    const result = await runSetupCommand({ ...baseOptions, force: true }, deps)

    expect(result.outcome).toBe('existing')
    expect(mem.files.get(`${island}/recordings/a.screenci.ts`)).toBe('edited')
    expect(result.overwritten).toEqual(['recordings/a.screenci.ts'])
  })

  it('refuses an edit code when the script is nowhere on this machine and ScreenCI holds no snapshot', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(
        exchangeBody({
          kind: 'edit',
          videoId: 'vid_1',
          videoName: 'Onboarding',
          aiContext: EMPTY_AI_CONTEXT,
        })
      )
    )
    const { deps, calls } = makeDeps(fetchFn)
    await expect(runSetupCommand(baseOptions, deps)).rejects.toThrow(
      /"Onboarding".*inside the repository/s
    )
    expect(calls.scaffold).toHaveLength(0)
    expect(calls.secrets).toHaveLength(0)
  })

  it('scaffolds a workspace for a video code when ScreenCI holds no snapshot', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(exchangeBody({ kind: 'video' }))
    )
    const { deps, calls } = makeDeps(fetchFn)
    const result = await runSetupCommand(baseOptions, deps)
    expect(result.outcome).toBe('scaffolded')
    expect(calls.scaffold).toHaveLength(1)
  })

  it('surfaces exchange failures as StartError with the failure kind', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(
        { error: 'That setup code was already used', code: 'setup_code_used' },
        409
      )
    )
    const { deps } = makeDeps(fetchFn)
    const error = await runSetupCommand(baseOptions, deps).catch((err) => err)
    expect(error).toBeInstanceOf(StartError)
    expect((error as StartError).failure).toBe('used')
    expect((error as StartError).message).toBe(
      'That setup code was already used'
    )
  })
})

/** Exchange plus a bundle server: `/latest` and `/bundle` answer with `files`. */
function bundleServer(
  exchangeOverrides: Partial<SetupExchange>,
  files: Array<{ path: string; content: string }>,
  options: { bundleId?: string } = {}
) {
  return vi.fn(async (input: string | URL) => {
    const url = String(input)
    if (url.endsWith('/cli/setup/exchange')) {
      return jsonResponse(exchangeBody(exchangeOverrides))
    }
    if (
      url.includes('/cli/sources/latest') ||
      url.includes('/cli/sources/bundle')
    ) {
      return jsonResponse({ files }, 200, {
        'X-ScreenCI-Source-Bundle-Id': options.bundleId ?? 'sb_1',
      })
    }
    return jsonResponse({}, 404)
  })
}

const LIVE = 'https://app.example.com'
const DEV = 'http://localhost:3000'
const DEV_CONFIG = `export default defineConfig({ projectName: 'my-app', projectId: 'proj_1', webServer: { command: 'pnpm dev', url: '${DEV}' }, use: { baseURL: '${DEV}' } })`
const LIVE_CONFIG = `export default defineConfig({ projectName: 'my-app', projectId: 'proj_1', use: { baseURL: '${LIVE}' } })`
const EDIT = {
  kind: 'edit' as const,
  videoName: 'Onboarding',
  videoId: 'vid_1',
  sourcesAvailable: true,
  sourceBundleId: 'sb_v3',
  sourceVersion: {
    versionNumber: 3,
    createdAt: '2026-09-01T00:00:00.000Z',
    site: { origin: DEV, kind: 'local' as const },
  },
  videoSourcePath: 'recordings/onboarding.screenci.ts',
}

describe('runSetupCommand: every prompt from every situation', () => {
  describe('same agent window, one project after another', () => {
    const pairs: Array<[SetupExchange['kind'], SetupExchange['kind']]> = [
      ['video', 'screenshot'],
      ['project', 'edit'],
      ['edit', 'record'],
      ['screenshot', 'language'],
    ]
    for (const [first, second] of pairs) {
      it(`${first} then ${second} reuses the workspace the first one left`, async () => {
        const island = '/work/my-app/screenci'
        const seed: Record<string, string> = {
          [`${island}/screenci.config.ts`]: LIVE_CONFIG,
          [`${island}/recordings/onboarding.screenci.ts`]:
            "video('Onboarding', async () => {})",
          [`${island}/node_modules/.keep`]: '',
        }
        const overrides: Partial<SetupExchange> =
          second === 'edit' || second === 'record' || second === 'language'
            ? {
                ...EDIT,
                kind: second,
                ...(second === 'language'
                  ? { task: { description: 'x', language: 'de' } }
                  : {}),
              }
            : { kind: second, sourcesAvailable: true }
        const fetchFn = bundleServer(overrides, [
          { path: 'screenci.config.ts', content: LIVE_CONFIG },
          {
            path: 'recordings/onboarding.screenci.ts',
            content: "video('Onboarding', async () => {})",
          },
        ])
        const { deps, calls } = makeDeps(fetchFn, seed)

        const result = await runSetupCommand(baseOptions, deps)

        expect(result.outcome).toBe('existing')
        expect(result.islandDir).toBe(island)
        expect(calls.scaffold).toHaveLength(0)
        expect(calls.install).toHaveLength(0)
        expect(result.recordingTarget).toEqual({
          mode: 'configured',
          url: LIVE,
        })
      })
    }
  })

  it('names the folder to use when ./screenci belongs to another project', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(
        exchangeBody({ kind: 'video', projectName: 'Acme Billing (2)' })
      )
    )
    const { deps } = makeDeps(fetchFn, {
      '/work/my-app/screenci/screenci.config.ts':
        "export default { projectName: 'other', projectId: 'proj_9' }",
    })
    await expect(runSetupCommand(baseOptions, deps)).rejects.toThrow(
      '--dir screenci-acme-billing-2'
    )
  })

  it('no repository creates, the repository edits: pulls the version into <repo>/screenci', async () => {
    const fetchFn = bundleServer(EDIT, [
      { path: 'screenci.config.ts', content: LIVE_CONFIG },
      {
        path: 'recordings/onboarding.screenci.ts',
        content: "video('Onboarding', async () => {})",
      },
    ])
    const { deps, mem, remotes, logs } = makeDeps(fetchFn, {
      '/work/my-app/package.json': '{}',
    })
    remotes.set('/work/my-app', ACME_GIT)

    const result = await runSetupCommand(baseOptions, deps)

    expect(result.outcome).toBe('pulled')
    expect(result.islandDir).toBe('/work/my-app/screenci')
    expect(
      mem.files.get('/work/my-app/screenci/recordings/onboarding.screenci.ts')
    ).toBe("video('Onboarding', async () => {})")
    expect(result.videoSourceLocation).toBe('server')
    expect(result.startingPoint).toEqual({
      kind: 'version',
      version: EDIT.sourceVersion,
      replaced: [],
      differs: [],
    })
    // The version's bundle was fetched by id, not the project's latest.
    expect(
      fetchFn.mock.calls.some(([input]) =>
        String(input).includes('/cli/sources/bundle?sourceBundleId=sb_v3')
      )
    ).toBe(true)
    expect(logs.join('\n')).toContain('## Starting point')
    expect(logs.join('\n')).toContain('version 3')
  })

  describe('the repository edits, then someone without it adds or edits', () => {
    it('records against the live site the context names when the scripts target a dev server', async () => {
      const harness = makeDeps(
        bundleServer(
          { ...EDIT, aiContext: { ...EMPTY_AI_CONTEXT, siteUrl: LIVE } },
          [
            { path: 'screenci.config.ts', content: DEV_CONFIG },
            {
              path: 'recordings/onboarding.screenci.ts',
              content: "video('Onboarding', async () => {})",
            },
          ]
        )
      )
      harness.setReachable(DEV, false)
      harness.setReachable(LIVE, true)

      const result = await runSetupCommand(baseOptions, harness.deps)

      expect(result.stop).toBeNull()
      expect(result.recordingTarget).toEqual({
        mode: 'override',
        url: LIVE,
        configuredUrl: DEV,
      })
      expect(result.site).toEqual({
        state: 'checked',
        url: LIVE,
        kind: 'deployed',
        reachable: true,
      })
      const brief = harness.logs.join('\n')
      expect(brief).toContain(`set use.baseURL to ${LIVE}`)
      expect(brief).toContain('remove (or comment out) the webServer block')
      expect(brief).toContain(`page.goto('${DEV}/...')`)
      expect(brief).toContain('did not run inside the repository')
      expect(brief).toContain('data a dev server seeds')
      expect(brief).toContain('do not commit the base URL change')
      expect(brief).toContain(`npx screenci login ${LIVE}`)
      // The JSON line carries it for agents that parse output.
      const json = JSON.parse(harness.logs.at(-1)!)
      expect(json.recordingTarget).toEqual({
        mode: 'override',
        url: LIVE,
        configuredUrl: DEV,
      })
    })

    it('falls back to the site the chosen version was recorded against', async () => {
      const fetchFn = bundleServer(
        {
          ...EDIT,
          sourceVersion: {
            ...EDIT.sourceVersion,
            site: { origin: LIVE, kind: 'deployed' },
          },
        },
        [{ path: 'screenci.config.ts', content: DEV_CONFIG }]
      )
      const harness = makeDeps(fetchFn)
      harness.setReachable(DEV, false)

      const result = await runSetupCommand(baseOptions, harness.deps)

      expect(result.recordingTarget).toEqual({
        mode: 'override',
        url: LIVE,
        configuredUrl: DEV,
      })
    })

    it('stops with exit reason site-local-no-repo when no live address is known', async () => {
      const fetchFn = bundleServer(EDIT, [
        { path: 'screenci.config.ts', content: DEV_CONFIG },
      ])
      const harness = makeDeps(fetchFn)
      harness.setReachable(DEV, false)

      const result = await runSetupCommand(baseOptions, harness.deps)

      expect(result.recordingTarget).toEqual({
        mode: 'stop',
        configuredUrl: DEV,
      })
      expect(result.stop?.reason).toBe('site-local-no-repo')
      expect(result.stop?.message).toContain('live site URL')
      expect(result.stop?.message).toContain('set use.baseURL in the config')
      expect(harness.logs.join('\n')).toContain('## STOP')
    })

    it('stops inside the repository too when starting the app is off and no live address is known', async () => {
      const harness = makeDeps(
        bundleServer(EDIT, [
          { path: 'screenci.config.ts', content: DEV_CONFIG },
        ]),
        {
          '/work/my-app/screenci/screenci.config.ts': DEV_CONFIG,
          '/work/my-app/screenci/recordings/onboarding.screenci.ts':
            "video('Onboarding', async () => {})",
          '/work/my-app/screenci/node_modules/.keep': '',
        }
      )
      harness.remotes.set('/work/my-app', ACME_GIT)
      harness.setReachable(DEV, false)

      const result = await runSetupCommand(baseOptions, harness.deps)

      expect(result.stop?.reason).toBe('site-local-no-repo')
      expect(result.stop?.message).toContain(
        'switched off for this organisation'
      )
      expect(result.stop?.message).not.toContain('did not run inside')
    })

    it('keeps the dev server when someone started it on this machine', async () => {
      const fetchFn = bundleServer(
        { ...EDIT, aiContext: { ...EMPTY_AI_CONTEXT, siteUrl: LIVE } },
        [{ path: 'screenci.config.ts', content: DEV_CONFIG }]
      )
      const harness = makeDeps(fetchFn)
      harness.setReachable(DEV, true)

      const result = await runSetupCommand(baseOptions, harness.deps)

      expect(result.recordingTarget).toEqual({ mode: 'configured', url: DEV })
      expect(harness.logs.join('\n')).not.toContain('set use.baseURL to')
    })

    it('lets the dialog app URL override the dev server even inside the repository', async () => {
      const fetchFn = bundleServer(
        { ...EDIT, task: { description: 'x', appUrl: LIVE } },
        [{ path: 'screenci.config.ts', content: DEV_CONFIG }]
      )
      const harness = makeDeps(fetchFn, {
        '/work/my-app/screenci/screenci.config.ts': DEV_CONFIG,
        '/work/my-app/screenci/recordings/onboarding.screenci.ts':
          "video('Onboarding', async () => {})",
        '/work/my-app/screenci/node_modules/.keep': '',
      })
      harness.remotes.set('/work/my-app', ACME_GIT)
      harness.setReachable(DEV, true)

      const result = await runSetupCommand(baseOptions, harness.deps)

      expect(result.recordingTarget).toEqual({
        mode: 'override',
        url: LIVE,
        configuredUrl: DEV,
      })
      expect(harness.logs.join('\n')).toContain('you may not start')
    })
  })

  describe('an existing workspace and a code made from a version', () => {
    const versionFiles = [
      { path: 'screenci.config.ts', content: LIVE_CONFIG },
      {
        path: 'recordings/onboarding.screenci.ts',
        content: "video('Onboarding', async () => { /* v3 */ })",
      },
    ]

    it("outside a repository, replaces local files with the version's and lists them", async () => {
      const island = '/work/my-app/screenci'
      const harness = makeDeps(bundleServer(EDIT, versionFiles), {
        [`${island}/screenci.config.ts`]: LIVE_CONFIG,
        [`${island}/recordings/onboarding.screenci.ts`]:
          "video('Onboarding', async () => { /* old */ })",
        [`${island}/recordings/extra.screenci.ts`]:
          "video('Extra', async () => {})",
        [`${island}/node_modules/.keep`]: '',
      })

      const result = await runSetupCommand(baseOptions, harness.deps)

      expect(result.outcome).toBe('existing')
      expect(result.startingPoint).toEqual({
        kind: 'version',
        version: EDIT.sourceVersion,
        replaced: ['recordings/onboarding.screenci.ts'],
        differs: [],
      })
      expect(
        harness.mem.files.get(`${island}/recordings/onboarding.screenci.ts`)
      ).toContain('v3')
      // Files the version does not mention stay.
      expect(
        harness.mem.files.has(`${island}/recordings/extra.screenci.ts`)
      ).toBe(true)
      expect(harness.logs.join('\n')).toContain(
        'these files were replaced: recordings/onboarding.screenci.ts'
      )
    })

    it('inside a repository, keeps the repository and lists where the version differs', async () => {
      const island = '/work/my-app/screenci'
      const harness = makeDeps(bundleServer(EDIT, versionFiles), {
        [`${island}/screenci.config.ts`]: LIVE_CONFIG,
        [`${island}/recordings/onboarding.screenci.ts`]:
          "video('Onboarding', async () => { /* repo */ })",
        [`${island}/node_modules/.keep`]: '',
      })
      harness.remotes.set('/work/my-app', ACME_GIT)

      const result = await runSetupCommand(baseOptions, harness.deps)

      expect(result.startingPoint).toEqual({
        kind: 'version',
        version: EDIT.sourceVersion,
        replaced: [],
        differs: ['recordings/onboarding.screenci.ts'],
      })
      expect(
        harness.mem.files.get(`${island}/recordings/onboarding.screenci.ts`)
      ).toContain('repo')
      const brief = harness.logs.join('\n')
      expect(brief).toContain("repository's scripts are the starting point")
      expect(brief).toContain('rerun this command with --force')
    })

    it('inside a repository, --force pulls the version but refuses a dirty tree', async () => {
      const island = '/work/my-app/screenci'
      const seed = {
        [`${island}/screenci.config.ts`]: LIVE_CONFIG,
        [`${island}/recordings/onboarding.screenci.ts`]:
          "video('Onboarding', async () => { /* repo */ })",
        [`${island}/node_modules/.keep`]: '',
      }
      const dirty = makeDeps(bundleServer(EDIT, versionFiles), seed)
      dirty.remotes.set('/work/my-app', ACME_GIT)
      dirty.setDirty(true)
      await expect(
        runSetupCommand({ ...baseOptions, force: true }, dirty.deps)
      ).rejects.toThrow('uncommitted changes')

      const clean = makeDeps(bundleServer(EDIT, versionFiles), seed)
      clean.remotes.set('/work/my-app', ACME_GIT)
      const result = await runSetupCommand(
        { ...baseOptions, force: true },
        clean.deps
      )
      expect(result.startingPoint).toEqual({
        kind: 'version',
        version: EDIT.sourceVersion,
        replaced: ['recordings/onboarding.screenci.ts'],
        differs: [],
      })
      expect(
        clean.mem.files.get(`${island}/recordings/onboarding.screenci.ts`)
      ).toContain('v3')
    })

    it('reports the workspace already matches the version', async () => {
      const island = '/work/my-app/screenci'
      const harness = makeDeps(bundleServer(EDIT, versionFiles), {
        [`${island}/screenci.config.ts`]: LIVE_CONFIG,
        [`${island}/recordings/onboarding.screenci.ts`]:
          versionFiles[1]!.content,
        [`${island}/node_modules/.keep`]: '',
      })
      const result = await runSetupCommand(baseOptions, harness.deps)
      expect(result.startingPoint).toEqual({
        kind: 'version',
        version: EDIT.sourceVersion,
        replaced: [],
        differs: [],
      })
      expect(harness.logs.join('\n')).toContain(
        'already holds the scripts version 3'
      )
    })

    it("uses the workspace as is when the version's sources cannot be fetched", async () => {
      const fetchFn = vi.fn(async (input: string | URL) => {
        const url = String(input)
        if (url.endsWith('/cli/setup/exchange'))
          return jsonResponse(exchangeBody(EDIT))
        return new Response('down', { status: 500 })
      })
      const island = '/work/my-app/screenci'
      const harness = makeDeps(fetchFn, {
        [`${island}/screenci.config.ts`]: LIVE_CONFIG,
        [`${island}/recordings/onboarding.screenci.ts`]:
          "video('Onboarding', async () => {})",
        [`${island}/node_modules/.keep`]: '',
      })
      const result = await runSetupCommand(baseOptions, harness.deps)
      expect(result.outcome).toBe('existing')
      expect(result.startingPoint).toEqual({ kind: 'none' })
      expect(harness.warnings.join('\n')).toContain(
        "Could not fetch the version's sources"
      )
    })
  })

  describe('the script to edit', () => {
    it('uses the path the version recorded when it still declares the title', async () => {
      const island = '/work/my-app/screenci'
      const harness = makeDeps(bundleServer(EDIT, []), {
        [`${island}/screenci.config.ts`]: LIVE_CONFIG,
        [`${island}/recordings/onboarding.screenci.ts`]:
          "video('Onboarding', async () => {})",
        // Another file mentions the title first alphabetically.
        [`${island}/recordings/a-intro.screenci.ts`]:
          "video('Intro', async () => { narration: 'Onboarding' })",
        [`${island}/node_modules/.keep`]: '',
      })
      harness.remotes.set('/work/my-app', ACME_GIT)
      const result = await runSetupCommand(baseOptions, harness.deps)
      expect(result.videoSourcePath).toBe(
        'screenci/recordings/onboarding.screenci.ts'
      )
      expect(result.videoSourceLocation).toBe('server')
    })

    it('falls back to the title when the recorded path moved, and says so', async () => {
      const island = '/work/my-app/screenci'
      const harness = makeDeps(bundleServer(EDIT, []), {
        [`${island}/screenci.config.ts`]: LIVE_CONFIG,
        [`${island}/recordings/flows/onboarding.screenci.ts`]:
          "video('Onboarding', async () => {})",
        [`${island}/node_modules/.keep`]: '',
      })
      harness.remotes.set('/work/my-app', ACME_GIT)
      const result = await runSetupCommand(baseOptions, harness.deps)
      expect(result.videoSourcePath).toBe(
        'screenci/recordings/flows/onboarding.screenci.ts'
      )
      expect(result.videoSourceLocation).toBe('title')
      expect(harness.logs.join('\n')).toContain(
        'recorded from recordings/onboarding.screenci.ts, which moved'
      )
    })

    it('looks in the other islands of the repository', async () => {
      const harness = makeDeps(bundleServer(EDIT, []), {
        '/work/my-app/screenci/screenci.config.ts': LIVE_CONFIG,
        '/work/my-app/screenci/node_modules/.keep': '',
        '/work/my-app/apps/docs/screenci/screenci.config.ts':
          "export default { projectName: 'docs', projectId: 'proj_docs' }",
        '/work/my-app/apps/docs/screenci/recordings/onboarding.screenci.ts':
          "video('Onboarding', async () => {})",
      })
      harness.remotes.set('/work/my-app', ACME_GIT)
      const result = await runSetupCommand(baseOptions, harness.deps)
      expect(result.videoSourcePath).toBe(
        'apps/docs/screenci/recordings/onboarding.screenci.ts'
      )
      expect(result.videoSourceLocation).toBe('other-island')
      expect(harness.logs.join('\n')).toContain(
        'another ScreenCI workspace of this repository'
      )
    })

    it('tells the agent not to recreate a missing script', async () => {
      const island = '/work/my-app/screenci'
      const harness = makeDeps(bundleServer(EDIT, []), {
        [`${island}/screenci.config.ts`]: LIVE_CONFIG,
        [`${island}/recordings/other.screenci.ts`]:
          "video('Other', async () => {})",
        [`${island}/node_modules/.keep`]: '',
      })
      harness.remotes.set('/work/my-app', ACME_GIT)
      const result = await runSetupCommand(baseOptions, harness.deps)
      expect(result.videoSourcePath).toBeNull()
      expect(result.videoSourceLocation).toBe('missing')
      const brief = harness.logs.join('\n')
      expect(brief).toContain('do not recreate the video from scratch')
      expect(brief).toContain(
        'recorded from recordings/onboarding.screenci.ts, which is not here'
      )
    })
  })

  describe('islands elsewhere in the repository', () => {
    const pinnedIsland =
      "export default defineConfig({ projectName: 'my-app', projectId: 'proj_1' })"

    it("finds the project's island under a package from the repository root", async () => {
      const harness = makeDeps(
        bundleServer({ kind: 'video', sourcesAvailable: true }, []),
        {
          '/work/my-app/package.json': '{}',
          '/work/my-app/apps/web/screenci/screenci.config.ts': pinnedIsland,
          '/work/my-app/apps/web/screenci/node_modules/.keep': '',
        }
      )
      harness.remotes.set('/work/my-app', ACME_GIT)
      const result = await runSetupCommand(baseOptions, harness.deps)
      expect(result.islandDir).toBe('/work/my-app/apps/web/screenci')
      expect(result.outcome).toBe('existing')
      expect(harness.calls.install).toHaveLength(0)
    })

    it('finds it from a sibling package too', async () => {
      const harness = makeDeps(
        bundleServer({ kind: 'video', sourcesAvailable: true }, []),
        {
          '/work/my-app/apps/web/screenci/screenci.config.ts': pinnedIsland,
          '/work/my-app/apps/web/screenci/node_modules/.keep': '',
          '/work/my-app/apps/api/package.json': '{}',
        }
      )
      harness.remotes.set('/work/my-app', ACME_GIT)
      harness.setCwd('/work/my-app/apps/api')
      const result = await runSetupCommand(baseOptions, harness.deps)
      expect(result.islandDir).toBe('/work/my-app/apps/web/screenci')
      expect(result.islandDisplayDir).toBe('../web/screenci')
    })

    it('prefers the pinned island over one that only carries the name, then the nearest', async () => {
      const harness = makeDeps(
        bundleServer({ kind: 'video', sourcesAvailable: true }, []),
        {
          '/work/my-app/screenci/screenci.config.ts':
            "export default defineConfig({ projectName: 'my-app' })",
          '/work/my-app/screenci/node_modules/.keep': '',
          '/work/my-app/apps/web/screenci/screenci.config.ts': pinnedIsland,
          '/work/my-app/apps/web/screenci/node_modules/.keep': '',
          '/work/my-app/apps/web/screenci-old/screenci.config.ts': pinnedIsland,
          '/work/my-app/apps/web/screenci-old/node_modules/.keep': '',
        }
      )
      harness.remotes.set('/work/my-app', ACME_GIT)
      harness.setCwd('/work/my-app/apps/web')
      const result = await runSetupCommand(baseOptions, harness.deps)
      expect([
        '/work/my-app/apps/web/screenci',
        '/work/my-app/apps/web/screenci-old',
      ]).toContain(result.islandDir)
      expect(result.islandDir).not.toBe('/work/my-app/screenci')
    })

    it('pins an island that only names the project so a rename cannot detach it', async () => {
      const harness = makeDeps(
        bundleServer({ kind: 'video', sourcesAvailable: true }, []),
        {
          '/work/my-app/screenci/screenci.config.ts':
            "export default defineConfig({ projectName: 'my-app', envFile: '.env' })",
          '/work/my-app/screenci/node_modules/.keep': '',
        }
      )
      harness.remotes.set('/work/my-app', ACME_GIT)
      const result = await runSetupCommand(baseOptions, harness.deps)
      expect(result.pinnedConfig).toBe(true)
      expect(harness.logs.join('\n')).toContain('now carries projectId')
      expect(
        harness.mem.files.get('/work/my-app/screenci/screenci.config.ts')
      ).toBe(
        "export default defineConfig({ projectName: 'my-app', projectId: 'proj_1', envFile: '.env' })"
      )
    })

    it('ci honours --dir and otherwise uses the discovered island', async () => {
      const seed = {
        '/work/my-app/.github/workflows/ci.yaml': '',
        '/work/my-app/apps/web/screenci/screenci.config.ts': pinnedIsland,
        '/work/my-app/apps/web/screenci/node_modules/.keep': '',
      }
      const discovered = makeDeps(
        bundleServer({ kind: 'ci', sourcesAvailable: true }, []),
        seed
      )
      discovered.remotes.set('/work/my-app', ACME_GIT)
      const found = await runSetupCommand(baseOptions, discovered.deps)
      expect(found.islandDir).toBe('/work/my-app/apps/web/screenci')

      const explicit = makeDeps(
        bundleServer({ kind: 'ci', sourcesAvailable: true }, [
          { path: 'screenci.config.ts', content: pinnedIsland },
        ]),
        seed
      )
      explicit.remotes.set('/work/my-app', ACME_GIT)
      const chosen = await runSetupCommand(
        { ...baseOptions, dir: 'tools/screenci' },
        explicit.deps
      )
      expect(chosen.islandDir).toBe('/work/my-app/tools/screenci')
    })

    it("Add to CI after a no-repository Add video pulls the project's latest into the repository", async () => {
      const harness = makeDeps(
        bundleServer({ kind: 'ci', sourcesAvailable: true }, [
          { path: 'screenci.config.ts', content: pinnedIsland },
          { path: 'recordings/a.screenci.ts', content: 'a' },
        ]),
        { '/work/my-app/.gitlab-ci.yml': '' }
      )
      harness.remotes.set('/work/my-app', ACME_GIT)
      const result = await runSetupCommand(baseOptions, harness.deps)
      expect(result.outcome).toBe('pulled')
      expect(result.islandDir).toBe('/work/my-app/screenci')
      expect(harness.logs.join('\n')).toContain('Commit the sources first')
    })
  })

  it('a same-machine rerun in another folder still resumes the same code', async () => {
    // The server resumes by machine name; setup just has to accept whatever
    // workspace that folder holds.
    const harness = makeDeps(
      bundleServer({ ...EDIT, sourcesAvailable: true }, [
        { path: 'screenci.config.ts', content: LIVE_CONFIG },
        {
          path: 'recordings/onboarding.screenci.ts',
          content: "video('Onboarding', async () => {})",
        },
      ])
    )
    harness.setCwd('/home/me/videos')
    harness.setRepoRoot('/home/me/videos')
    const result = await runSetupCommand(baseOptions, harness.deps)
    expect(result.islandDir).toBe('/home/me/videos/screenci')
    expect(result.outcome).toBe('pulled')
  })
})

describe('proposedIslandDirName', () => {
  it('slugs the project name', () => {
    expect(proposedIslandDirName('Acme Billing (2)')).toBe(
      'screenci-acme-billing-2'
    )
    expect(proposedIslandDirName('***')).toBe('screenci-project')
  })
})

describe('pinIslandConfigSource', () => {
  it('adds projectId next to projectName in the same quote style', () => {
    expect(
      pinIslandConfigSource(
        'defineConfig({ projectName: "Demo", use: {} })',
        'p1'
      )
    ).toBe('defineConfig({ projectName: "Demo", projectId: "p1", use: {} })')
    expect(pinIslandConfigSource('defineConfig({})', 'p1')).toBeNull()
    // Any projectId already there (a literal, an env lookup) is left alone.
    expect(
      pinIslandConfigSource(
        "defineConfig({ projectName: 'Demo', projectId: process.env.PID })",
        'p1'
      )
    ).toBeNull()
  })
})

describe('siteRootOf', () => {
  it('maps app hosts to the docs site and falls back to production', () => {
    expect(siteRootOf('https://app.screenci.com')).toBe('https://screenci.com')
    expect(siteRootOf('https://dev.app.screenci.com/')).toBe(
      'https://dev.screenci.com'
    )
    expect(siteRootOf('http://localhost:5173')).toBe('https://screenci.com')
  })
})

describe('findVideoSourceFile', () => {
  it('finds the script that declares the title', async () => {
    const { fs } = memoryFs({
      '/i/recordings/a.screenci.ts': "video('Other', async () => {})",
      '/i/recordings/nested/b.screenci.tsx':
        'video("Onboarding", async () => {})',
      '/i/recordings/assets/logo.png': 'binary',
    })
    expect(await findVideoSourceFile('/i', 'Onboarding', fs)).toBe(
      '/i/recordings/nested/b.screenci.tsx'
    )
    expect(await findVideoSourceFile('/i', 'Missing', fs)).toBeNull()
  })
})

describe('formatStartBrief', () => {
  function result(overrides: Partial<StartResult> = {}): StartResult {
    return {
      exchange: exchange(),
      brandingSample: { status: 'none' },
      brandingAssetPaths: {},
      shellSecretOverride: false,
      islandDir: '/work/my-app/screenci',
      islandDisplayDir: 'screenci',
      packageManager: 'npm',
      outcome: 'scaffolded',
      envFilePath: '/work/my-app/screenci/.env',
      overwritten: [],
      pinnedConfig: false,
      videoSourcePath: null,
      videoSourceLocation: 'not-applicable',
      startingPoint: { kind: 'none' },
      recordingTarget: { mode: 'configured', url: null },
      appUrl: 'https://app.example.com',
      repo: { state: 'none' },
      site: { state: 'none' },
      session: { saved: false },
      stop: null,
      ci: null,
      ...overrides,
    }
  }

  it('describes a new project with the naming note and the app URL guidance', () => {
    const brief = stripVTControlCharacters(
      formatStartBrief(
        result({
          exchange: exchange({
            task: {
              description: 'Show billing',
              appUrl: 'https://staging.acme.com',
            },
          }),
          site: {
            state: 'checked',
            url: 'https://staging.acme.com',
            kind: 'deployed',
            reachable: true,
          },
        })
      )
    )
    expect(brief).toContain(
      'Create a video for the new ScreenCI project "my-app".'
    )
    expect(brief).toContain('Show billing')
    expect(brief).toContain('https://staging.acme.com')
    expect(brief).toContain('cd screenci')
    expect(brief).toContain('npx screenci test')
    expect(brief).toContain('npx screenci preview "<video title>"')
    expect(brief).toContain('from --name or the folder')
    expect(brief).not.toContain('—')
  })

  it('points an edit code at the located script and its preview command', () => {
    const brief = formatStartBrief(
      result({
        exchange: exchange({
          kind: 'edit',
          videoName: 'Onboarding',
          videoId: 'vid_1',
        }),
        videoSourcePath: 'screenci/recordings/onboarding.screenci.ts',
        packageManager: 'pnpm',
        outcome: 'existing',
      })
    )
    expect(brief).toContain('Edit screenci/recordings/onboarding.screenci.ts')
    expect(brief).toContain('pnpm exec screenci preview "Onboarding"')
    expect(brief).toContain('existing workspace, used as is')
  })

  it('tells a video code to add a new script and warns when no app URL exists', () => {
    const brief = formatStartBrief(
      result({ exchange: exchange({ kind: 'video' }), outcome: 'pulled' })
    )
    expect(brief).toContain(
      'Add a new script screenci/recordings/<flow>.screenci.ts'
    )
    expect(brief).toContain('No site URL was given')
  })

  it('includes the team notes and the repository context', () => {
    const brief = formatStartBrief(
      result({
        exchange: exchange({
          aiContext: { ...EMPTY_AI_CONTEXT, guide: 'Use the demo tenant.' },
        }),
        repo: {
          state: 'inside',
          dir: '/work',
          gitUrl: ACME_GIT,
        },
      }),
      '/work'
    )
    expect(brief).toContain('## Notes from the team')
    expect(brief).toContain('Use the demo tenant.')
    expect(brief).toContain(
      `You are inside the product's repository (${ACME_GIT}) at ./`
    )
    expect(brief).toContain('/docs/guides/ai-context')
  })

  it('emits a machine-readable line', () => {
    expect(
      formatStartJsonLine(
        result({
          exchange: exchange({
            kind: 'edit',
            videoName: 'Onboarding',
            videoId: 'vid_1',
          }),
          videoSourcePath: 'screenci/recordings/onboarding.screenci.ts',
        })
      )
    ).toEqual({
      status: 'ready',
      kind: 'edit',
      projectId: 'proj_1',
      projectName: 'my-app',
      videoId: 'vid_1',
      videoName: 'Onboarding',
      videoSourcePath: 'screenci/recordings/onboarding.screenci.ts',
      videoSourceLocation: 'not-applicable',
      startingPoint: { kind: 'none' },
      recordingTarget: { mode: 'configured', url: null },
      workspace: '/work/my-app/screenci',
      outcome: 'scaffolded',
      appUrl: 'https://app.example.com',
      description: 'Show the onboarding flow',
      repo: { state: 'none' },
      site: { state: 'none' },
      session: { saved: false, expired: false },
      siteRequiresLogin: false,
      runLocallyIfNeeded: false,
      branding: EMPTY_BRANDING,
      ciRecords: false,
    })
  })
})

describe('registerSetupCommand', () => {
  it('parses the setup options and forwards them', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(exchangeBody({ projectName: 'X' }))
    )
    const { deps, calls } = makeDeps(fetchFn, {
      '/work/my-app/tmp/screenci.config.ts':
        "export default { projectId: 'proj_1' }",
    })
    const program = new Command()
    program.exitOverride()
    registerSetupCommand(program, deps, 'npm')
    await program.parseAsync(
      [
        'setup',
        CODE,
        '--name',
        'X',
        '--dir',
        'tmp',
        '--force',
        '--package-manager',
        'yarn',
        '--skip-site-check',
      ],
      { from: 'user' }
    )
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toMatchObject({
      projectName: 'X',
      packageManager: 'yarn',
    })
    // Same project: the existing workspace is used without a scaffold.
    expect(calls.scaffold).toHaveLength(0)
    expect(calls.secrets[0]?.[0]).toBe('/work/my-app/tmp/.env')
    expect(calls.probes).toHaveLength(0)
  })

  it('exits with code 2 when the agent must stop', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(
        exchangeBody({
          aiContext: { ...EMPTY_AI_CONTEXT, siteUrl: 'http://localhost:3000' },
        })
      )
    )
    const { deps, setSiteReachable } = makeDeps(fetchFn)
    setSiteReachable(false)
    const program = new Command()
    program.exitOverride()
    registerSetupCommand(program, deps, 'npm')
    const previous = process.exitCode
    try {
      await program.parseAsync(['setup', CODE], { from: 'user' })
      expect(process.exitCode).toBe(2)
    } finally {
      process.exitCode = previous
    }
  })
})

describe('branding', () => {
  const HASH = 'a'.repeat(64)
  const branded = {
    ...EMPTY_BRANDING,
    backgroundCss: '#334155',
    aspectRatio: '9:16' as const,
    cursorStyle: 'black' as const,
    voice: { kind: 'builtIn' as const, name: 'Ava' },
    sources: {
      ...EMPTY_BRANDING.sources,
      backgroundCss: 'org' as const,
      aspectRatio: 'project' as const,
      cursorStyle: 'org' as const,
      voice: 'org' as const,
    },
  }

  it('falls back to the empty branding for an older server', async () => {
    const body = exchangeBody() as Record<string, unknown>
    delete body.branding
    const fetchFn = vi.fn(async () => jsonResponse(body))
    const { deps, logs } = makeDeps(fetchFn)
    const result = await runSetupCommand(baseOptions, deps)
    expect(result.exchange.branding).toEqual(EMPTY_BRANDING)
    expect(result.brandingSample).toEqual({ status: 'none' })
    const brief = logs.join('\n')
    expect(brief).toContain('## Branding')
    expect(brief).toContain('No organisation branding is set')
  })

  it('prints the branding with its code snippet and the JSON line', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(exchangeBody({ branding: branded }))
    )
    const { deps, logs, calls } = makeDeps(fetchFn)
    await runSetupCommand(baseOptions, deps)
    expect(calls.sampleDownloads).toEqual([])
    const brief = logs.join('\n')
    expect(brief).toContain('## Branding')
    expect(brief).toContain('- Aspect ratio: 9:16 (project override)')
    expect(brief).toContain('- Narration voice: Ava (built-in)')
    expect(brief).toContain('mouse: { style: "black" }')
    expect(brief).toContain('.recordOptions({ aspectRatio: "9:16" })')
    expect(brief).toContain('/docs/guides/branding')
    const jsonLine = logs.find((line) => line.startsWith('{'))
    expect(jsonLine && JSON.parse(jsonLine)).toMatchObject({
      branding: {
        cursorStyle: 'black',
        voice: { kind: 'builtIn', name: 'Ava' },
      },
    })
  })

  it('downloads the voice sample into the island and points the snippet at it', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(
        exchangeBody({
          branding: {
            ...EMPTY_BRANDING,
            voice: {
              kind: 'sample',
              fileHash: HASH,
              fileName: 'brand voice.mp3',
            },
            sources: { ...EMPTY_BRANDING.sources, voice: 'org' },
          },
        })
      )
    )
    const harness = makeDeps(fetchFn)
    harness.setSampleDownload({
      status: 'written',
      relativePath: 'branding/brand-voice.mp3',
      fileName: 'brand-voice.mp3',
    })
    const result = await runSetupCommand(baseOptions, harness.deps)
    expect(harness.calls.sampleDownloads).toEqual(['/work/my-app/screenci'])
    expect(result.brandingSample).toEqual({
      status: 'downloaded',
      relativePath: 'branding/brand-voice.mp3',
    })
    const brief = harness.logs.join('\n')
    expect(brief).toContain(
      'voices.elevenlabs({ path: "./branding/brand-voice.mp3" })'
    )
    expect(brief).toContain("import { video, voices } from 'screenci'")
    const jsonLine = harness.logs.find((line) => line.startsWith('{'))
    expect(jsonLine && JSON.parse(jsonLine)).toMatchObject({
      brandingSamplePath: 'branding/brand-voice.mp3',
    })
  })

  it('warns when the sample download fails and says how to retry', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(
        exchangeBody({
          branding: {
            ...EMPTY_BRANDING,
            voice: { kind: 'sample', fileHash: HASH, fileName: 'v.mp3' },
            sources: { ...EMPTY_BRANDING.sources, voice: 'org' },
          },
        })
      )
    )
    const harness = makeDeps(fetchFn)
    harness.setSampleDownload({ status: 'error', message: 'boom' })
    const result = await runSetupCommand(baseOptions, harness.deps)
    expect(result.brandingSample).toEqual({ status: 'failed', message: 'boom' })
    expect(harness.warnings.join('\n')).toContain('boom')
    const brief = harness.logs.join('\n')
    expect(brief).toContain('npx screenci context')
    expect(brief).not.toContain('voices.elevenlabs')
  })
})
