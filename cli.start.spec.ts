import { describe, expect, it, vi } from 'vitest'
import { Command } from 'commander'
import { stripVTControlCharacters } from 'node:util'
import {
  StartError,
  exchangeSetupCode,
  findVideoSourceFile,
  formatStartBrief,
  formatStartJsonLine,
  registerStartCommand,
  resolveStartWorkspace,
  runStartCommand,
  type SetupExchange,
  siteRootOf,
  type StartDeps,
  type StartResult,
} from './src/start.js'
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
    appUrl: 'https://app.example.com',
    sourceMode: 'service',
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
    clones: [] as Array<[string, string]>,
    updates: [] as string[],
    probes: [] as string[],
    sessionReads: [] as Array<{ configDir: string; profile: string }>,
    sampleDownloads: [] as string[],
  }
  let sampleDownload: DownloadBrandingSampleResult = { status: 'none' }
  /** Remotes by directory; set by tests that simulate a repository. */
  const remotes = new Map<string, string>()
  let cloneResult: { ok: true } | { ok: false; message: string } = { ok: true }
  let siteReachable = true
  let session: AppSessionStatus = { saved: false }
  const git: StartGit = {
    remoteUrl: async (dir) => remotes.get(dir) ?? null,
    clone: async (url, dir) => {
      calls.clones.push([url, dir])
      if (cloneResult.ok) remotes.set(dir, url)
      return cloneResult
    },
    update: async (dir) => {
      calls.updates.push(dir)
      return { ok: true }
    },
    headCommit: async () => 'abcdef1234567890',
    currentBranch: async () => 'main',
  }
  const deps: StartDeps = {
    fetchFn: fetchFn as unknown as typeof fetch,
    fs: mem.fs,
    existsSync: mem.existsSync,
    env: {},
    cwd: () => '/work/my-app',
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
    findRepoRoot: () => '/work/my-app',
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
      return siteReachable
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
    setCloneResult: (next: typeof cloneResult) => {
      cloneResult = next
    },
    setSiteReachable: (next: boolean) => {
      siteReachable = next
    },
    setSession: (next: AppSessionStatus) => {
      session = next
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

    // A repo-backed island has no projectId at all.
    const repo = memoryFs({
      '/w/screenci/screenci.config.ts': "export default { projectName: 'x' }",
    })
    expect(
      await resolveStartWorkspace('/w/screenci', 'proj_1', {
        existsSync: repo.existsSync,
        readConfigSource: async (path) => repo.files.get(path) ?? null,
      })
    ).toEqual({ state: 'repository-island', projectName: 'x' })
  })
})

describe('runStartCommand', () => {
  it('scaffolds a new project, writes credentials and prints the brief', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(exchangeBody()))
    const { deps, calls, logs } = makeDeps(fetchFn)

    const result = await runStartCommand(baseOptions, deps)

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
      status: 'started',
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
    await runStartCommand({ ...baseOptions, name: ' Chosen ' }, deps)
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

    const result = await runStartCommand(baseOptions, deps)

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
    const result = await runStartCommand(baseOptions, deps)
    expect(result.outcome).toBe('scaffolded')
    expect(calls.scaffold).toHaveLength(1)
  })

  it('syncs an existing island of the same project and refuses conflicting local edits', async () => {
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
      [`${island}/recordings/onboarding.screenci.ts`]: 'locally edited',
      [`${island}/node_modules/.keep`]: '',
    }

    const refused = makeDeps(fetchFn, seed)
    await expect(runStartCommand(baseOptions, refused.deps)).rejects.toThrow(
      /local changes.*--force/s
    )
    expect(
      refused.mem.files.get(`${island}/recordings/onboarding.screenci.ts`)
    ).toBe('locally edited')
    expect(refused.calls.secrets).toHaveLength(0)

    const forced = makeDeps(fetchFn, seed)
    const result = await runStartCommand(
      { ...baseOptions, force: true },
      forced.deps
    )
    expect(result.outcome).toBe('synced')
    expect(result.overwritten).toEqual(['recordings/onboarding.screenci.ts'])
    expect(result.videoSourcePath).toBe(
      'screenci/recordings/onboarding.screenci.ts'
    )
    // node_modules exists, so no install runs.
    expect(forced.calls.install).toHaveLength(0)
    expect(forced.calls.secrets).toEqual([[`${island}/.env`, 'secret-1']])
  })

  it("refuses another project's repository-managed island and accepts --dir", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(exchangeBody()))
    const { deps, calls } = makeDeps(fetchFn, {
      '/work/my-app/screenci/screenci.config.ts':
        "export default { projectName: 'other' }",
    })
    await expect(runStartCommand(baseOptions, deps)).rejects.toThrow(
      /"other".*--dir/s
    )
    expect(calls.secrets).toHaveLength(0)

    const alt = makeDeps(fetchFn, {
      '/work/my-app/screenci/screenci.config.ts':
        "export default { projectName: 'other' }",
    })
    const result = await runStartCommand(
      { ...baseOptions, dir: 'videos' },
      alt.deps
    )
    expect(result.islandDir).toBe('/work/my-app/videos')
    expect(result.islandDisplayDir).toBe('videos')
  })

  it('refuses an island of another service project after the exchange', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(exchangeBody()))
    const { deps, calls } = makeDeps(fetchFn, {
      '/work/my-app/screenci/screenci.config.ts':
        "export default { projectName: 'other', projectId: 'proj_9' }",
    })
    await expect(runStartCommand(baseOptions, deps)).rejects.toThrow(
      /proj_9.*--dir/s
    )
    expect(calls.secrets).toHaveLength(0)
  })

  it('warns when the shell exports a different SCREENCI_SECRET', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(exchangeBody()))
    const { deps, warnings, logs } = makeDeps(fetchFn)
    deps.env = { SCREENCI_SECRET: 'org-wide-secret' }
    const result = await runStartCommand(baseOptions, deps)
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

  it("uses the repository's own island when the cwd repository matches the git URL", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(
        exchangeBody({
          kind: 'edit',
          videoName: 'Onboarding',
          videoId: 'vid_1',
          sourceMode: 'local',
          aiContext: { ...EMPTY_AI_CONTEXT, gitUrl: ACME_GIT },
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

    const result = await runStartCommand(baseOptions, deps)

    expect(result.outcome).toBe('repository')
    expect(result.repo).toEqual({
      state: 'inside',
      dir: '/work/my-app',
      gitUrl: ACME_GIT,
    })
    expect(calls.clones).toHaveLength(0)
    expect(calls.scaffold).toHaveLength(0)
    expect(result.videoSourcePath).toBe(
      'screenci/recordings/onboarding.screenci.ts'
    )
    expect(calls.secrets).toEqual([[`${island}/.env`, 'secret-1']])
    expect(logs.join('\n')).toContain('commit your change on a branch')
  })

  it('clones the repository outside it and uses the island inside the clone', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(
        exchangeBody({
          kind: 'video',
          sourceMode: 'local',
          aiContext: { ...EMPTY_AI_CONTEXT, gitUrl: ACME_GIT },
        })
      )
    )
    const clone = '/work/my-app/.screenci/repo'
    const { deps, calls, mem } = makeDeps(fetchFn)
    // The clone "appears" with an island once git clone ran.
    deps.git.clone = async (url, dir) => {
      calls.clones.push([url, dir])
      mem.files.set(
        `${dir}/screenci/screenci.config.ts`,
        "export default { projectName: 'my-app', envFile: '.env' }"
      )
      return { ok: true }
    }
    deps.git.remoteUrl = async (dir) => (dir === clone ? ACME_GIT : null)

    const result = await runStartCommand(baseOptions, deps)

    expect(calls.clones).toEqual([[ACME_GIT, clone]])
    expect(mem.files.get('/work/my-app/.screenci/.gitignore')).toBe('*\n')
    expect(result.repo).toMatchObject({
      state: 'cloned',
      dir: clone,
      fresh: true,
    })
    expect(result.islandDir).toBe(`${clone}/screenci`)
    expect(result.outcome).toBe('repository')
    expect(calls.install).toEqual([`${clone}/screenci`])
  })

  it('keeps ./screenci for a service project even when the clone has no island', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(
        exchangeBody({ aiContext: { ...EMPTY_AI_CONTEXT, gitUrl: ACME_GIT } })
      )
    )
    const { deps, calls } = makeDeps(fetchFn)
    const result = await runStartCommand(baseOptions, deps)
    expect(calls.clones).toHaveLength(1)
    expect(result.islandDir).toBe('/work/my-app/screenci')
    expect(result.outcome).toBe('scaffolded')
  })

  it('reports a failed clone and continues when the site answers', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(
        exchangeBody({
          task: { description: 'x', appUrl: 'https://staging.acme.com' },
          aiContext: { ...EMPTY_AI_CONTEXT, gitUrl: ACME_GIT },
        })
      )
    )
    const { deps, warnings, logs, setCloneResult } = makeDeps(fetchFn)
    setCloneResult({ ok: false, message: 'Permission denied (publickey)' })
    const result = await runStartCommand(baseOptions, deps)
    expect(result.repo).toMatchObject({ state: 'clone-failed' })
    expect(result.stop).toBeNull()
    expect(warnings.join('\n')).toContain('Permission denied')
    expect(logs.join('\n')).toContain('could not be cloned')
  })

  it('stops for a local site that is down when starting it is not allowed', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(
        exchangeBody({
          aiContext: {
            ...EMPTY_AI_CONTEXT,
            siteUrl: 'http://localhost:3000',
            gitUrl: ACME_GIT,
          },
        })
      )
    )
    const { deps, calls, logs, setSiteReachable } = makeDeps(fetchFn)
    setSiteReachable(false)
    const result = await runStartCommand(baseOptions, deps)
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
            gitUrl: ACME_GIT,
            runLocallyIfNeeded: true,
          },
        })
      )
    )
    const { deps, logs, setSiteReachable } = makeDeps(fetchFn)
    setSiteReachable(false)
    const result = await runStartCommand(baseOptions, deps)
    expect(result.stop).toBeNull()
    const brief = logs.join('\n')
    expect(brief).toContain('start it from the repository')
    expect(brief).toContain('SCREENCI_APP_LAUNCHED_BY=agent')
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
    const stopped = await runStartCommand(baseOptions, down.deps)
    expect(stopped.stop).toMatchObject({ reason: 'site-unreachable' })

    const skipped = makeDeps(fetchFn)
    skipped.setSiteReachable(false)
    const result = await runStartCommand(
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
    await runStartCommand(baseOptions, deps)
    expect(calls.probes).toEqual(['https://staging.acme.com'])
  })

  it('tells the agent to open a sign-in browser when no session is saved', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(exchangeBody()))
    const { deps, calls, logs } = makeDeps(fetchFn)
    const result = await runStartCommand(baseOptions, deps)

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
    await runStartCommand(baseOptions, deps)
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
    await runStartCommand(baseOptions, withSession.deps)
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
    await runStartCommand(baseOptions, expired.deps)
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
    await runStartCommand(baseOptions, deps)
    const brief = logs.join('\n')
    expect(brief).toContain('The team says this site needs a sign-in.')
    expect(brief).not.toContain('If the flow you are asked to record sits')
  })

  it('leaves the sign-in conditional when the team said nothing', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(exchangeBody()))
    const { deps, logs } = makeDeps(fetchFn)
    await runStartCommand(baseOptions, deps)
    const brief = logs.join('\n')
    expect(brief).toContain('If the flow you are asked to record sits behind')
    expect(brief).not.toContain('The team says this site needs a sign-in.')
  })

  it('prepares a merge: pulls sources into the repository, strips projectId, writes the marker', async () => {
    const fetchFn = vi.fn(async (input: string | URL) => {
      const url = String(input)
      if (url.endsWith('/cli/setup/exchange')) {
        return jsonResponse(
          exchangeBody({
            kind: 'merge',
            sourcesAvailable: true,
            aiContext: { ...EMPTY_AI_CONTEXT, gitUrl: ACME_GIT },
          })
        )
      }
      if (url.includes('/cli/sources/latest')) {
        return jsonResponse(
          {
            files: [
              {
                path: 'screenci.config.ts',
                content:
                  "export default defineConfig({\n  projectName: 'my-app',\n  projectId: 'proj_1',\n  envFile: '.env',\n})\n",
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
    const { deps, mem, calls, remotes, logs } = makeDeps(fetchFn)
    remotes.set('/work/my-app', ACME_GIT)

    const result = await runStartCommand(baseOptions, deps)

    expect(result.outcome).toBe('merge-prepared')
    expect(result.islandDir).toBe('/work/my-app/screenci')
    expect(mem.files.get('/work/my-app/screenci/screenci.config.ts')).toBe(
      "export default defineConfig({\n  projectName: 'my-app',\n  envFile: '.env',\n})\n"
    )
    expect(
      JSON.parse(
        mem.files.get('/work/my-app/screenci/.screenci/pending-merge.json') ??
          ''
      )
    ).toEqual({ sourceBundleId: 'sb_1', gitUrl: ACME_GIT })
    expect(result.pendingMerge).toEqual({
      sourceBundleId: 'sb_1',
      gitUrl: ACME_GIT,
    })
    expect(calls.install).toEqual(['/work/my-app/screenci'])
    const brief = logs.join('\n')
    expect(brief).toContain('merge-complete --pr <url>')
    expect(brief).toContain('Do not change the scripts')
  })

  it('installs skills in the cwd repository, not in the clone, and keeps a new project out of a foreign repo island', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(
        exchangeBody({ aiContext: { ...EMPTY_AI_CONTEXT, gitUrl: ACME_GIT } })
      )
    )
    const clone = '/work/my-app/.screenci/repo'
    const { deps, calls, mem } = makeDeps(fetchFn)
    deps.git.clone = async (url, dir) => {
      calls.clones.push([url, dir])
      mem.files.set(
        `${dir}/screenci/screenci.config.ts`,
        "export default { projectName: 'other-product' }"
      )
      return { ok: true }
    }
    deps.git.remoteUrl = async (dir) => (dir === clone ? ACME_GIT : null)

    const result = await runStartCommand(baseOptions, deps)

    // A new project never adopts the repository's island.
    expect(result.islandDir).toBe('/work/my-app/screenci')
    expect(result.outcome).toBe('scaffolded')
    expect(calls.scaffold[0]).toMatchObject({ repoRoot: '/work/my-app' })
  })

  it('refuses a merge without a repository', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(exchangeBody({ kind: 'merge', sourcesAvailable: true }))
    )
    const { deps } = makeDeps(fetchFn)
    await expect(runStartCommand(baseOptions, deps)).rejects.toThrow(
      /No repository URL is known/
    )
  })

  it('stops with a clear error for a repository-managed project without an island', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(exchangeBody({ kind: 'video', sourceMode: 'local' }))
    )
    const { deps, calls } = makeDeps(fetchFn)
    await expect(runStartCommand(baseOptions, deps)).rejects.toThrow(
      /repository URL is not set/
    )
    expect(calls.scaffold).toHaveLength(0)
  })

  it('surfaces exchange failures as StartError with the failure kind', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(
        { error: 'That setup code was already used', code: 'setup_code_used' },
        409
      )
    )
    const { deps } = makeDeps(fetchFn)
    const error = await runStartCommand(baseOptions, deps).catch((err) => err)
    expect(error).toBeInstanceOf(StartError)
    expect((error as StartError).failure).toBe('used')
    expect((error as StartError).message).toBe(
      'That setup code was already used'
    )
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
      videoSourcePath: null,
      appUrl: 'https://app.example.com',
      repo: { state: 'not-configured' },
      site: { state: 'none' },
      session: { saved: false },
      stop: null,
      pendingMerge: null,
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
        outcome: 'synced',
      })
    )
    expect(brief).toContain('Edit screenci/recordings/onboarding.screenci.ts')
    expect(brief).toContain('pnpm exec screenci preview "Onboarding"')
    expect(brief).toContain('existing workspace, sources synced')
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
          state: 'cloned',
          dir: '/work/.screenci/repo',
          gitUrl: ACME_GIT,
          fresh: true,
        },
      }),
      '/work'
    )
    expect(brief).toContain('## Notes from the team')
    expect(brief).toContain('Use the demo tenant.')
    expect(brief).toContain('cloned at .screenci/repo/')
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
      status: 'started',
      kind: 'edit',
      projectId: 'proj_1',
      projectName: 'my-app',
      videoId: 'vid_1',
      videoName: 'Onboarding',
      videoSourcePath: 'screenci/recordings/onboarding.screenci.ts',
      workspace: '/work/my-app/screenci',
      outcome: 'scaffolded',
      sourceMode: 'service',
      appUrl: 'https://app.example.com',
      description: 'Show the onboarding flow',
      repo: { state: 'not-configured' },
      site: { state: 'none' },
      session: { saved: false, expired: false },
      siteRequiresLogin: false,
      runLocallyIfNeeded: false,
      branding: EMPTY_BRANDING,
    })
  })
})

describe('registerStartCommand', () => {
  it('parses the start options and forwards them', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(exchangeBody({ projectName: 'X' }))
    )
    const { deps, calls } = makeDeps(fetchFn, {
      '/work/my-app/tmp/screenci.config.ts':
        "export default { projectId: 'proj_1' }",
    })
    const program = new Command()
    program.exitOverride()
    registerStartCommand(program, deps, 'npm')
    await program.parseAsync(
      [
        'start',
        CODE,
        '--name',
        'X',
        '--dir',
        'tmp',
        '--force',
        '--package-manager',
        'yarn',
        '--skip-site-check',
        '--no-clone',
      ],
      { from: 'user' }
    )
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toMatchObject({
      projectName: 'X',
      packageManager: 'yarn',
    })
    // Same project, no sources: synced in place without a scaffold.
    expect(calls.scaffold).toHaveLength(0)
    expect(calls.secrets[0]?.[0]).toBe('/work/my-app/tmp/.env')
    expect(calls.probes).toHaveLength(0)
    expect(calls.clones).toHaveLength(0)
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
    registerStartCommand(program, deps, 'npm')
    const previous = process.exitCode
    try {
      await program.parseAsync(['start', CODE], { from: 'user' })
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
    const result = await runStartCommand(baseOptions, deps)
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
    await runStartCommand(baseOptions, deps)
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
    const result = await runStartCommand(baseOptions, harness.deps)
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
    const result = await runStartCommand(baseOptions, harness.deps)
    expect(result.brandingSample).toEqual({ status: 'failed', message: 'boom' })
    expect(harness.warnings.join('\n')).toContain('boom')
    const brief = harness.logs.join('\n')
    expect(brief).toContain('npx screenci context')
    expect(brief).not.toContain('voices.elevenlabs')
  })
})
