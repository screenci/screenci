import { describe, expect, it, vi } from 'vitest'
import { parseEnv } from 'node:util'
import {
  assembleIsland,
  buildIslandEnvFile,
  islandInstallCommand,
  quoteDotenvValue,
  resolveIslandEnvFileName,
  resolveNetworkEnv,
  type AssembleIslandDeps,
  type AssembleIslandInput,
} from './islandAssembly.js'
import type { ProjectFilesFs } from './localProjectFiles.js'

function memoryFs(): ProjectFilesFs & { files: Map<string, Buffer> } {
  const files = new Map<string, Buffer>()
  return {
    files,
    readdir: async () => [],
    readFile: async (path) => {
      const bytes = files.get(path)
      if (!bytes) throw new Error(`ENOENT ${path}`)
      return bytes
    },
    writeFile: async (path, data) => {
      files.set(path, Buffer.from(data))
    },
    mkdir: async () => undefined,
    exists: async (path) => files.has(path),
  }
}

function makeDeps(lockfile: 'npm' | 'pnpm' | 'yarn' | null = 'npm') {
  const fs = memoryFs()
  const installs: unknown[] = []
  const logs: string[] = []
  const deps: AssembleIslandDeps = {
    fs,
    install: vi.fn(async (params) => {
      installs.push(params)
    }),
    detectPackageManager: () => lockfile,
    log: (message) => logs.push(message),
  }
  return { deps, fs, installs, logs }
}

const text = (value: string): Uint8Array => new Uint8Array(Buffer.from(value))

function input(
  overrides: Partial<AssembleIslandInput> = {}
): AssembleIslandInput {
  return {
    islandDir: '/work/island',
    files: [
      { path: 'package.json', content: text('{"name":"x"}') },
      { path: 'package-lock.json', content: text('{}') },
      {
        path: 'screenci.config.ts',
        content: text("export default defineConfig({ projectName: 'x' })"),
      },
      {
        path: 'recordings/demo.screenci.ts',
        content: text("video('Demo', async () => {})"),
      },
      {
        path: 'recordings/shared/logo.png',
        content: new Uint8Array([1, 2, 3]),
      },
    ],
    envVars: {
      SCREENCI_LOGIN_USERNAME: 'demo@example.com',
      SCREENCI_LOGIN_PASSWORD: "p@ss'w#rd $HOME",
    },
    network: null,
    secret: 'run-secret',
    backendUrl: 'https://api.screenci.com',
    appUrl: 'https://app.example.com',
    ...overrides,
  }
}

describe('quoteDotenvValue', () => {
  it.each([
    '',
    'plain',
    'with # hash',
    'dollar $HOME and ${X}',
    'double "quotes"',
    "single ' quote",
    'line\nbreak',
    '{"cookies":[],"origins":[]}',
    ' padded ',
  ])('round-trips %j through Node env parsing', (value) => {
    const quoted = quoteDotenvValue(value)
    expect(quoted).not.toBeNull()
    expect(parseEnv(`KEY=${quoted}\n`).KEY).toBe(value)
  })

  it('refuses values no quoting can carry unchanged', () => {
    expect(quoteDotenvValue('it\'s "both"')).toBeNull()
    expect(quoteDotenvValue("multi\nline 'x' \\n")).toBeNull()
  })
})

describe('buildIslandEnvFile', () => {
  it('writes one line per variable and lists unrepresentable ones', () => {
    const { text: envText, unrepresentable } = buildIslandEnvFile([
      ['A', 'one'],
      ['B', 'it\'s "both"'],
    ])
    expect(parseEnv(envText)).toEqual({ A: 'one' })
    expect(unrepresentable).toEqual(['B'])
  })
})

describe('resolveNetworkEnv', () => {
  it('passes the credential origin on', () => {
    expect(
      resolveNetworkEnv(
        { credentialOrigin: 'https://app.acme.test', extraHeaders: [] },
        {},
        () => {}
      )
    ).toEqual([['SCREENCI_CREDENTIAL_ORIGIN', 'https://app.acme.test']])
  })

  it('resolves env var references and skips missing ones', () => {
    const logs: string[] = []
    const entries = resolveNetworkEnv(
      {
        proxyServer: 'http://proxy:3128',
        proxyUsernameEnv: 'PROXY_USER',
        proxyPasswordEnv: 'PROXY_PASS',
        httpCredentialsUsernameEnv: 'BASIC_USER',
        httpCredentialsPasswordEnv: 'MISSING',
        extraHeaders: [
          { name: 'X-Bypass', valueEnv: 'BYPASS' },
          { name: 'X-Gone', valueEnv: 'NOPE' },
        ],
      },
      { PROXY_USER: 'pu', PROXY_PASS: 'pp', BASIC_USER: 'bu', BYPASS: 'tok' },
      (message) => logs.push(message)
    )
    expect(Object.fromEntries(entries)).toEqual({
      SCREENCI_PROXY_SERVER: 'http://proxy:3128',
      SCREENCI_PROXY_USERNAME: 'pu',
      SCREENCI_PROXY_PASSWORD: 'pp',
      SCREENCI_HTTP_CREDENTIALS_USERNAME: 'bu',
      SCREENCI_EXTRA_HEADERS_JSON: '{"X-Bypass":"tok"}',
    })
    expect(logs.join('\n')).toContain('MISSING')
    expect(logs.join('\n')).toContain('NOPE')
  })
})

describe('resolveIslandEnvFileName', () => {
  it('uses the config envFile and refuses one outside the island', () => {
    expect(resolveIslandEnvFileName(null)).toBe('.env')
    expect(
      resolveIslandEnvFileName("defineConfig({ envFile: './.env.local' })")
    ).toBe('.env.local')
    expect(() =>
      resolveIslandEnvFileName("defineConfig({ envFile: '../.env' })")
    ).toThrow(/outside the project folder/)
  })
})

describe('assembleIsland', () => {
  it('writes the files and the env file, then installs frozen', async () => {
    const { deps, fs, installs } = makeDeps('npm')
    const result = await assembleIsland(
      input({
        network: {
          proxyServer: 'http://proxy:3128',
          extraHeaders: [{ name: 'X-Bypass', valueEnv: 'BYPASS' }],
        },
        envVars: {
          SCREENCI_LOGIN_USERNAME: 'demo@example.com',
          SCREENCI_LOGIN_PASSWORD: "p@ss'w#rd $HOME",
          BYPASS: 'tok',
          SCREENCI_SECRET: 'user-tries-to-override',
          'bad-name': 'x',
        },
      }),
      deps
    )
    expect(fs.files.get('/work/island/recordings/shared/logo.png')).toEqual(
      Buffer.from([1, 2, 3])
    )
    const env = parseEnv(fs.files.get('/work/island/.env')!.toString())
    expect(env).toEqual({
      SCREENCI_SECRET: 'run-secret',
      SCREENCI_API_URL: 'https://api.screenci.com',
      SCREENCI_ENVIRONMENT: 'prod',
      SCREENCI_APP_URL: 'https://app.example.com',
      BYPASS: 'tok',
      SCREENCI_LOGIN_PASSWORD: "p@ss'w#rd $HOME",
      SCREENCI_LOGIN_USERNAME: 'demo@example.com',
      SCREENCI_PROXY_SERVER: 'http://proxy:3128',
      SCREENCI_EXTRA_HEADERS_JSON: '{"X-Bypass":"tok"}',
    })
    expect(result.env.SCREENCI_SECRET).toBe('run-secret')
    expect(installs).toEqual([
      { islandDir: '/work/island', packageManager: 'npm', frozen: true },
    ])
    expect(result).toMatchObject({
      envFile: '.env',
      packageManager: 'npm',
      frozen: true,
    })
  })

  it('writes the env file the config names and installs unfrozen without a lockfile', async () => {
    const { deps, fs, installs } = makeDeps(null)
    await assembleIsland(
      input({
        files: [
          { path: 'package.json', content: text('{}') },
          {
            path: 'screenci.config.ts',
            content: text("defineConfig({ envFile: '.env.screenci' })"),
          },
        ],
        appUrl: null,
        backendUrl: 'http://localhost:8787',
      }),
      deps
    )
    const env = parseEnv(fs.files.get('/work/island/.env.screenci')!.toString())
    expect(env.SCREENCI_API_URL).toBe('http://localhost:8787')
    expect(env).not.toHaveProperty('SCREENCI_ENVIRONMENT')
    expect(env).not.toHaveProperty('SCREENCI_APP_URL')
    expect(fs.files.has('/work/island/.env')).toBe(false)
    expect(installs).toEqual([
      { islandDir: '/work/island', packageManager: 'npm', frozen: false },
    ])
  })

  it('refuses unsafe and never-stored paths before writing anything', async () => {
    for (const path of [
      '../escape.ts',
      '.env',
      'recordings/shared/storage-state.json',
    ]) {
      const { deps, fs } = makeDeps()
      await expect(
        assembleIsland(
          input({
            files: [
              { path: 'package.json', content: text('{}') },
              { path, content: text('x') },
            ],
          }),
          deps
        )
      ).rejects.toThrow()
      expect(fs.files.size).toBe(0)
      expect(deps.install).not.toHaveBeenCalled()
    }
  })

  it('needs a package.json', async () => {
    const { deps } = makeDeps()
    await expect(
      assembleIsland(
        input({
          files: [{ path: 'recordings/a.screenci.ts', content: text('x') }],
        }),
        deps
      )
    ).rejects.toThrow(/package.json/)
  })
})

describe('islandInstallCommand', () => {
  it('freezes with a lockfile', () => {
    expect(
      islandInstallCommand({ packageManager: 'npm', frozen: true })
    ).toEqual({
      command: 'npm',
      args: ['ci'],
    })
    expect(
      islandInstallCommand({ packageManager: 'pnpm', frozen: true })
    ).toEqual({ command: 'pnpm', args: ['install', '--frozen-lockfile'] })
    expect(
      islandInstallCommand({ packageManager: 'yarn', frozen: false })
    ).toEqual({ command: 'yarn', args: ['install'] })
  })
})
