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
  type StartDeps,
  type StartResult,
} from './src/start.js'
import type { SourceBundleFs } from './src/sourceBundle.js'

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
    editToken: 'token-1',
    task: { description: 'Show the onboarding flow' },
    sourcesAvailable: false,
    appUrl: 'https://app.example.com',
    ...overrides,
  }
}

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
    tokens: [] as Array<[string, string]>,
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
    persistEditToken: async (path, token) => {
      calls.tokens.push([path, token])
    },
    readConfigSource: async (path) => mem.files.get(path) ?? null,
  }
  return { deps, mem, logs, warnings, calls }
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
    ).toEqual({ state: 'other-project', existingProjectId: null })
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
    expect(calls.tokens).toEqual([['/work/my-app/screenci/.env', 'token-1']])
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

  it('refuses a repository-managed island before spending the code', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(exchangeBody()))
    const { deps, calls } = makeDeps(fetchFn, {
      '/work/my-app/screenci/screenci.config.ts':
        "export default { projectName: 'other' }",
    })
    await expect(runStartCommand(baseOptions, deps)).rejects.toThrow(/--dir/)
    expect(fetchFn).not.toHaveBeenCalled()
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
      shellSecretOverride: false,
      islandDir: '/work/my-app/screenci',
      islandDisplayDir: 'screenci',
      packageManager: 'npm',
      outcome: 'scaffolded',
      envFilePath: '/work/my-app/screenci/.env',
      overwritten: [],
      videoSourcePath: null,
      appUrl: 'https://app.example.com',
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
    expect(brief).toContain('No app URL was given')
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
      appUrl: 'https://app.example.com',
      description: 'Show the onboarding flow',
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
  })
})
