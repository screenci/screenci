import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import { Readable } from 'stream'
import pc from 'picocolors'
import { logger } from './src/logger.js'

const mockSpawn = vi.fn()
const mockExec = vi.fn()
const mockExistsSync = vi.fn()
const mockRealpathSync = vi.fn((path: string) => path)
const mockMkdirSync = vi.fn()
const mockRmSync = vi.fn()
const mockReaddirSync = vi.fn(() => [] as string[])
const mockReadFileSync = vi.fn()
const mockReaddir = vi.fn()
const mockReadFile = vi.fn()
const mockStat = vi.fn()
const mockCreateReadStream = vi.fn()
const mockAppendFile = vi.fn()
const mockWriteFile = vi.fn()
const mockMkdir = vi.fn()
const mockInput = vi.fn()
const mockConfirm = vi.fn()
const mockCreateHttpServer = vi.fn()
const mockFetch = vi.fn()

const mockSpinner = {
  start: vi.fn().mockReturnThis(),
  succeed: vi.fn().mockReturnThis(),
  fail: vi.fn().mockReturnThis(),
  stop: vi.fn().mockReturnThis(),
}
const mockOra = vi.fn().mockReturnValue(mockSpinner)

function expectNpmDevInstalls(
  mockSpawn: ReturnType<typeof vi.fn>,
  cwd: string,
  screenciVersion = '0.0.32',
  includePlaywrightCli = true
) {
  const npmInstallCalls = mockSpawn.mock.calls.filter(
    (call: unknown[]) =>
      call[0] === 'npm' &&
      Array.isArray(call[1]) &&
      call[1][0] === 'install' &&
      call[1][1] === '--save-dev' &&
      call[2] &&
      typeof call[2] === 'object' &&
      'cwd' in (call[2] as Record<string, unknown>) &&
      (call[2] as { cwd?: string }).cwd === cwd &&
      'stdio' in (call[2] as Record<string, unknown>) &&
      (call[2] as { stdio?: string }).stdio === 'pipe'
  )

  const expectedPackages = [
    `@playwright/test@^1.59.0`,
    `screenci@${screenciVersion}`,
    '@types/node@^25.9.1',
    ...(includePlaywrightCli ? ['@playwright/cli@latest'] : []),
  ]

  expect(npmInstallCalls).toEqual(
    expect.arrayContaining(
      expectedPackages.map((pkg) => [
        'npm',
        ['install', '--save-dev', pkg],
        expect.objectContaining({ cwd, stdio: 'pipe' }),
      ])
    )
  )
}

function expectPnpmDevInstalls(
  mockSpawn: ReturnType<typeof vi.fn>,
  cwd: string,
  screenciVersion = '0.0.32',
  includePlaywrightCli = true
) {
  const pnpmInstallCalls = mockSpawn.mock.calls.filter(
    (call: unknown[]) =>
      call[0] === 'pnpm' &&
      Array.isArray(call[1]) &&
      call[1][0] === 'add' &&
      call[1][1] === '--save-dev' &&
      call[2] &&
      typeof call[2] === 'object' &&
      'cwd' in (call[2] as Record<string, unknown>) &&
      (call[2] as { cwd?: string }).cwd === cwd &&
      'stdio' in (call[2] as Record<string, unknown>) &&
      (call[2] as { stdio?: string }).stdio === 'pipe'
  )

  const expectedPackages = [
    ['add', '--save-dev', `@playwright/test@^1.59.0`],
    [
      'add',
      '--save-dev',
      '--allow-build=ffmpeg-static',
      `screenci@${screenciVersion}`,
    ],
    ['add', '--save-dev', '@types/node@^25.9.1'],
    ...(includePlaywrightCli
      ? [['add', '--save-dev', '@playwright/cli@latest']]
      : []),
  ]

  expect(pnpmInstallCalls).toEqual(
    expect.arrayContaining(
      expectedPackages.map((args) => [
        'pnpm',
        args,
        expect.objectContaining({ cwd, stdio: 'pipe' }),
      ])
    )
  )
}

function expectYarnDevInstalls(
  mockSpawn: ReturnType<typeof vi.fn>,
  cwd: string,
  screenciVersion = '0.0.32',
  includePlaywrightCli = true
) {
  const yarnInstallCalls = mockSpawn.mock.calls.filter(
    (call: unknown[]) =>
      call[0] === 'yarn' &&
      Array.isArray(call[1]) &&
      call[1][0] === 'add' &&
      call[1][1] === '--dev' &&
      call[2] &&
      typeof call[2] === 'object' &&
      'cwd' in (call[2] as Record<string, unknown>) &&
      (call[2] as { cwd?: string }).cwd === cwd &&
      'stdio' in (call[2] as Record<string, unknown>) &&
      (call[2] as { stdio?: string }).stdio === 'pipe'
  )

  const expectedPackages = [
    ['add', '--dev', `@playwright/test@^1.59.0`],
    ['add', '--dev', `screenci@${screenciVersion}`],
    ['add', '--dev', '@types/node@^25.9.1'],
    ...(includePlaywrightCli
      ? [['add', '--dev', '@playwright/cli@latest']]
      : []),
  ]

  expect(yarnInstallCalls).toEqual(
    expect.arrayContaining(
      expectedPackages.map((args) => [
        'yarn',
        args,
        expect.objectContaining({ cwd, stdio: 'pipe' }),
      ])
    )
  )
}

vi.mock('child_process', () => ({
  spawn: mockSpawn,
  exec: mockExec,
  createReadStream: mockCreateReadStream,
  default: {
    spawn: mockSpawn,
    exec: mockExec,
    createReadStream: mockCreateReadStream,
  },
}))

vi.mock('fs', () => ({
  createReadStream: mockCreateReadStream,
  existsSync: mockExistsSync,
  realpathSync: mockRealpathSync,
  mkdirSync: mockMkdirSync,
  rmSync: mockRmSync,
  readdirSync: mockReaddirSync,
  readFileSync: mockReadFileSync,
  default: {
    createReadStream: mockCreateReadStream,
    existsSync: mockExistsSync,
    realpathSync: mockRealpathSync,
    mkdirSync: mockMkdirSync,
    rmSync: mockRmSync,
    readdirSync: mockReaddirSync,
    readFileSync: mockReadFileSync,
  },
}))

vi.mock('fs/promises', () => ({
  appendFile: mockAppendFile,
  readdir: mockReaddir,
  readFile: mockReadFile,
  stat: mockStat,
  writeFile: mockWriteFile,
  mkdir: mockMkdir,
  default: {
    appendFile: mockAppendFile,
    readdir: mockReaddir,
    readFile: mockReadFile,
    stat: mockStat,
    writeFile: mockWriteFile,
    mkdir: mockMkdir,
  },
}))

vi.mock('@inquirer/prompts', () => ({
  input: mockInput,
  confirm: mockConfirm,
}))

vi.mock('ora', () => ({
  default: mockOra,
}))

vi.mock('http', () => ({
  createServer: mockCreateHttpServer,
  default: { createServer: mockCreateHttpServer },
}))

describe('CLI', () => {
  let mockChildProcess: EventEmitter
  let loggerErrorSpy: ReturnType<typeof vi.spyOn>
  let loggerInfoSpy: ReturnType<typeof vi.spyOn>
  let loggerWarnSpy: ReturnType<typeof vi.spyOn>
  let processExitSpy: ReturnType<typeof vi.spyOn>
  let loadEnvFileSpy: ReturnType<typeof vi.spyOn> | undefined
  let originalArgv: string[]
  let originalEnv: NodeJS.ProcessEnv
  let originalFetch: typeof global.fetch
  let originalLoadEnvFile: ((path: string | URL) => void) | undefined

  beforeEach(() => {
    // Reset all mocks (clearAllMocks only clears call history, not Once queues;
    // mockReset also clears return values/implementations including Once queue)
    vi.clearAllMocks()
    mockSpawn.mockReset()
    mockAppendFile.mockResolvedValue(undefined)
    mockWriteFile.mockResolvedValue(undefined)
    mockMkdir.mockResolvedValue(undefined)
    mockReaddir.mockResolvedValue([])
    mockReadFileSync.mockImplementation(() => {
      if (process.env.VITE_APP_BASE_URL === undefined) {
        process.env.VITE_APP_BASE_URL = 'https://env-file.example.com'
      }
      return 'VITE_APP_BASE_URL=https://env-file.example.com\n'
    })
    mockReadFile.mockImplementation(async (path: string | URL) => {
      if (String(path).endsWith('screenci.config.ts')) {
        return "export default defineConfig({ projectName: 'Test Project' })"
      }
      if (String(path).endsWith('package.json')) {
        return JSON.stringify({ version: '0.0.32' })
      }
      return ''
    })
    mockStat.mockResolvedValue({ size: 4 })
    mockCreateReadStream.mockImplementation(() => {
      const stream = new Readable({ read() {} })
      process.nextTick(() => {
        stream.push('data')
        stream.push(null)
      })
      return stream
    })
    // Default inquirer responses
    mockInput.mockImplementation(
      async (options?: { default?: string }) => options?.default ?? ''
    )
    mockConfirm.mockResolvedValue(false)
    // Restore ora mock return value after clearAllMocks
    mockOra.mockReturnValue(mockSpinner)
    mockSpinner.start.mockReturnThis()
    mockSpinner.succeed.mockReturnThis()
    mockSpinner.fail.mockReturnThis()
    mockSpinner.stop.mockReturnThis()

    // Store original values
    originalArgv = process.argv
    originalEnv = { ...process.env }
    originalFetch = global.fetch
    originalLoadEnvFile = (
      process as NodeJS.Process & {
        loadEnvFile?: (path: string | URL) => void
      }
    ).loadEnvFile
    delete process.env.npm_config_user_agent

    // Mock child process (unref needed for openBrowser's detached spawn)
    mockChildProcess = Object.assign(new EventEmitter(), {
      unref: vi.fn(),
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
    })
    mockSpawn.mockReturnValue(mockChildProcess as unknown as ChildProcess)

    // Mock file system
    mockExistsSync.mockReturnValue(true)

    // Default http server mock: does not resolve (login not triggered by default)
    mockCreateHttpServer.mockReturnValue({
      listen: vi.fn(),
      close: vi.fn(),
      address: vi.fn().mockReturnValue({ port: 12345 }),
      on: vi.fn(),
    })

    // Mock logger methods
    loggerErrorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {})
    loggerInfoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {})
    loggerWarnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {})

    // Mock process.exit
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called')
    }) as unknown as (code?: string | number | null | undefined) => never)
    if (typeof originalLoadEnvFile === 'function') {
      loadEnvFileSpy = vi
        .spyOn(
          process as NodeJS.Process & {
            loadEnvFile?: (path: string | URL) => void
          },
          'loadEnvFile'
        )
        .mockImplementation((path?: string | URL) => {
          if (
            String(path).endsWith('.env') &&
            process.env.VITE_APP_BASE_URL === undefined
          ) {
            process.env.VITE_APP_BASE_URL = 'https://env-file.example.com'
          }
        })
    } else {
      loadEnvFileSpy = undefined
      ;(
        process as NodeJS.Process & {
          loadEnvFile?: (path: string | URL) => void
        }
      ).loadEnvFile = undefined
    }

    global.fetch = mockFetch as typeof global.fetch
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({}),
      text: vi.fn().mockResolvedValue(''),
    })
  })

  afterEach(() => {
    // Restore original values
    process.argv = originalArgv
    process.env = originalEnv
    global.fetch = originalFetch
    ;(
      process as NodeJS.Process & {
        loadEnvFile?: (path: string | URL) => void
      }
    ).loadEnvFile = originalLoadEnvFile

    // Restore spies
    loggerErrorSpy?.mockRestore()
    loggerInfoSpy?.mockRestore()
    loggerWarnSpy?.mockRestore()
    processExitSpy?.mockRestore()
    loadEnvFileSpy?.mockRestore()
  })
  describe('config discovery', () => {
    function findResolvedConfigArg(): string | undefined {
      const call = mockSpawn.mock.calls.find(
        (c: unknown[]) =>
          Array.isArray(c[1]) && (c[1] as string[]).includes('--config')
      )
      if (!call) return undefined
      const args = call[1] as string[]
      return args[args.indexOf('--config') + 1]
    }

    function mockSpawnCloseZero(): void {
      mockSpawn.mockImplementation(() => {
        process.nextTick(() => mockChildProcess.emit('close', 0))
        return mockChildProcess as unknown as ChildProcess
      })
    }

    it('resolves a flat config in the current directory (inside the island)', async () => {
      process.argv = ['node', 'cli.js', 'test']
      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue('/repo/screenci')
      mockExistsSync.mockImplementation(
        (p: string) => String(p) === '/repo/screenci/screenci.config.ts'
      )
      mockSpawnCloseZero()
      try {
        const { main } = await import('./cli')
        await main()
        expect(findResolvedConfigArg()).toBe(
          '/repo/screenci/screenci.config.ts'
        )
      } finally {
        cwdSpy.mockRestore()
      }
    })

    it('resolves the island config when run from the repo root', async () => {
      process.argv = ['node', 'cli.js', 'test']
      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue('/repo')
      mockExistsSync.mockImplementation(
        (p: string) => String(p) === '/repo/screenci/screenci.config.ts'
      )
      mockSpawnCloseZero()
      try {
        const { main } = await import('./cli')
        await main()
        expect(findResolvedConfigArg()).toBe(
          '/repo/screenci/screenci.config.ts'
        )
      } finally {
        cwdSpy.mockRestore()
      }
    })

    it('walks up from a nested directory to find the island config', async () => {
      process.argv = ['node', 'cli.js', 'test']
      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue('/repo/apps/web')
      mockExistsSync.mockImplementation(
        (p: string) => String(p) === '/repo/screenci/screenci.config.ts'
      )
      mockSpawnCloseZero()
      try {
        const { main } = await import('./cli')
        await main()
        expect(findResolvedConfigArg()).toBe(
          '/repo/screenci/screenci.config.ts'
        )
      } finally {
        cwdSpy.mockRestore()
      }
    })

    it('errors when no config is found in the cwd or any parent', async () => {
      process.argv = ['node', 'cli.js', 'test']
      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue('/repo/apps/web')
      mockExistsSync.mockReturnValue(false)
      mockSpawnCloseZero()
      try {
        const { main } = await import('./cli')
        await expect(main()).rejects.toThrow('process.exit called')
        expect(loggerErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining('screenci.config.ts not found')
        )
      } finally {
        cwdSpy.mockRestore()
      }
    })

    it('honors an explicit --config path over discovery', async () => {
      process.argv = ['node', 'cli.js', 'test', '--config', 'custom.config.ts']
      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue('/repo')
      mockExistsSync.mockImplementation(
        (p: string) => String(p) === '/repo/custom.config.ts'
      )
      mockSpawnCloseZero()
      try {
        const { main } = await import('./cli')
        await main()
        expect(findResolvedConfigArg()).toBe('/repo/custom.config.ts')
      } finally {
        cwdSpy.mockRestore()
      }
    })
  })

  describe('test command', () => {
    it('disables recording timings for plain test runs', async () => {
      process.argv = ['node', 'cli.js', 'test']
      mockSpawn.mockImplementation(
        (
          _command: string,
          args: string[],
          options?: { env?: NodeJS.ProcessEnv }
        ) => {
          expect(args).not.toContain('--mock-record')
          expect(options?.env?.SCREENCI_DISABLE_RECORDING_TIMINGS).toBe('true')
          expect(options?.env?.SCREENCI_MOCK_RECORD).toBeUndefined()
          process.nextTick(() => mockChildProcess.emit('close', 0))
          return mockChildProcess as unknown as ChildProcess
        }
      )

      const { main } = await import('./cli')
      await main()
    })

    it('keeps recording timings when --mock-record is used', async () => {
      process.argv = [
        'node',
        'cli.js',
        'test',
        '--mock-record',
        '--grep',
        'demo',
      ]
      mockSpawn.mockImplementation(
        (
          _command: string,
          args: string[],
          options?: { env?: NodeJS.ProcessEnv }
        ) => {
          expect(args).not.toContain('--mock-record')
          expect(args).toContain('--grep')
          expect(args).toContain('demo')
          expect(
            options?.env?.SCREENCI_DISABLE_RECORDING_TIMINGS
          ).toBeUndefined()
          expect(options?.env?.SCREENCI_MOCK_RECORD).toBe('true')
          process.nextTick(() => mockChildProcess.emit('close', 0))
          return mockChildProcess as unknown as ChildProcess
        }
      )

      const { main } = await import('./cli')
      await main()
    })

    it('keeps recording timings when config test.mockRecord is enabled', async () => {
      process.argv = ['node', 'cli.js', 'test']
      mockReadFile.mockImplementation(async (path: string | URL) => {
        if (String(path).endsWith('screenci.config.ts')) {
          return `export default defineConfig({
  projectName: 'Test Project',
  test: {
    mockRecord: true,
  },
})`
        }
        if (String(path).endsWith('package.json')) {
          return JSON.stringify({ version: '0.0.32' })
        }
        return ''
      })
      mockSpawn.mockImplementation(
        (
          _command: string,
          args: string[],
          options?: { env?: NodeJS.ProcessEnv }
        ) => {
          expect(args).not.toContain('--mock-record')
          expect(
            options?.env?.SCREENCI_DISABLE_RECORDING_TIMINGS
          ).toBeUndefined()
          expect(options?.env?.SCREENCI_MOCK_RECORD).toBe('true')
          process.nextTick(() => mockChildProcess.emit('close', 0))
          return mockChildProcess as unknown as ChildProcess
        }
      )

      const { main } = await import('./cli')
      await main()
    })

    it('fails before execution when discovered titles are exact duplicates', async () => {
      process.argv = ['node', 'cli.js', 'test']
      let actualRunSpawned = false

      mockSpawn.mockImplementation((_command: string, args: string[]) => {
        if (args.includes('--list')) {
          process.nextTick(() => {
            mockChildProcess.stdout.emit(
              'data',
              JSON.stringify({
                suites: [
                  {
                    specs: [{ title: 'My Video' }, { title: 'My Video' }],
                  },
                ],
              })
            )
            mockChildProcess.emit('close', 0)
          })
          return mockChildProcess as unknown as ChildProcess
        }

        actualRunSpawned = true
        process.nextTick(() => mockChildProcess.emit('close', 0))
        return mockChildProcess as unknown as ChildProcess
      })

      const { main } = await import('./cli')

      await expect(main()).rejects.toThrow('Duplicate test titles detected')
      expect(actualRunSpawned).toBe(false)
    })

    it('should load envFile before spawning Playwright', async () => {
      process.argv = ['node', 'cli.js', 'test']
      process.env.CI = 'true'
      process.env.SCREENCI_RECORDING = 'true'
      mockReadFile.mockImplementation(async (path: string | URL) => {
        if (String(path).endsWith('screenci.config.ts')) {
          return `export default defineConfig({
  projectName: 'Test Project',
  envFile: '.env',
})`
        }
        if (String(path).endsWith('package.json')) {
          return JSON.stringify({ version: '0.0.32' })
        }
        return ''
      })
      mockSpawn.mockImplementation(
        (
          _command: string,
          _args: string[],
          options?: { env?: NodeJS.ProcessEnv }
        ) => {
          expect(options?.env?.VITE_APP_BASE_URL).toBe(
            'https://env-file.example.com'
          )
          process.nextTick(() => mockChildProcess.emit('close', 0))
          return mockChildProcess as unknown as ChildProcess
        }
      )

      const { main } = await import('./cli')
      await main()

      if (loadEnvFileSpy) {
        expect(loadEnvFileSpy).toHaveBeenCalledWith(
          expect.stringContaining('.env')
        )
      } else {
        expect(mockReadFileSync).toHaveBeenCalledWith(
          expect.stringContaining('.env'),
          'utf8'
        )
      }
    })

    it('should not log the config path by default', async () => {
      process.argv = ['node', 'cli.js', 'test']
      mockSpawn.mockImplementation(() => {
        process.nextTick(() => mockChildProcess.emit('close', 0))
        return mockChildProcess as unknown as ChildProcess
      })

      const { main } = await import('./cli')
      await main()

      expect(loggerInfoSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('Using config:')
      )
    })

    it('should log the config path in verbose mode', async () => {
      process.argv = ['node', 'cli.js', 'test', '--verbose']
      mockSpawn.mockImplementation(() => {
        process.nextTick(() => mockChildProcess.emit('close', 0))
        return mockChildProcess as unknown as ChildProcess
      })

      const { main } = await import('./cli')
      await main()

      expect(loggerInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining('Using config:')
      )
    })

    it('prints an npm record hint by default after tests pass', async () => {
      process.argv = ['node', 'cli.js', 'test']
      mockSpawn.mockImplementation(() => {
        process.nextTick(() => mockChildProcess.emit('close', 0))
        return mockChildProcess as unknown as ChildProcess
      })

      const { main } = await import('./cli')
      await main()

      expect(loggerInfoSpy).toHaveBeenCalledWith(
        `Tests passed. Run ${pc.cyan('npx screenci record')} to render the videos.`
      )
    })

    it('prints a pnpm record hint after tests pass when pnpm is detected', async () => {
      process.argv = ['node', 'cli.js', 'test']
      process.env.npm_config_user_agent = 'pnpm/11.0.8 npm/? node/v24.0.0'
      mockSpawn.mockImplementation(() => {
        process.nextTick(() => mockChildProcess.emit('close', 0))
        return mockChildProcess as unknown as ChildProcess
      })

      const { main } = await import('./cli')
      await main()

      expect(loggerInfoSpy).toHaveBeenCalledWith(
        `Tests passed. Run ${pc.cyan('pnpm exec screenci record')} to render the videos.`
      )
    })

    it('should not warn when configured envFile is missing', async () => {
      process.argv = [
        'node',
        'cli.js',
        'test',
        '--config',
        'test-fixtures/env-file.config.ts',
      ]
      process.env.CI = 'true'
      process.env.SCREENCI_RECORDING = 'true'
      if (loadEnvFileSpy) {
        loadEnvFileSpy.mockImplementation(() => {
          throw Object.assign(new Error('missing env file'), { code: 'ENOENT' })
        })
      } else {
        mockReadFileSync.mockImplementation(() => {
          throw Object.assign(new Error('missing env file'), { code: 'ENOENT' })
        })
      }
      mockSpawn.mockImplementation(() => {
        process.nextTick(() => mockChildProcess.emit('close', 0))
        return mockChildProcess as unknown as ChildProcess
      })

      const { main } = await import('./cli')
      await main()

      if (loadEnvFileSpy) {
        expect(loadEnvFileSpy).toHaveBeenCalledWith(
          expect.stringContaining('.env')
        )
      } else {
        expect(mockReadFileSync).toHaveBeenCalledWith(
          expect.stringContaining('.env'),
          'utf8'
        )
      }
      expect(loggerWarnSpy).not.toHaveBeenCalled()
    })

    it('loads env files on Node 18 when process.loadEnvFile is unavailable', async () => {
      process.argv = ['node', 'cli.js', 'test']
      delete process.env.VITE_APP_BASE_URL
      ;(
        process as NodeJS.Process & {
          loadEnvFile?: (path: string | URL) => void
        }
      ).loadEnvFile = undefined
      mockReadFileSync.mockReturnValue(
        'export VITE_APP_BASE_URL="https://node18.example.com"\n'
      )
      mockSpawn.mockImplementation(
        (
          _command: string,
          _args: string[],
          options?: { env?: NodeJS.ProcessEnv }
        ) => {
          expect(options?.env?.VITE_APP_BASE_URL).toBe(
            'https://node18.example.com'
          )
          process.nextTick(() => mockChildProcess.emit('close', 0))
          return mockChildProcess as unknown as ChildProcess
        }
      )

      const { main } = await import('./cli')
      await main()

      expect(mockReadFileSync).toHaveBeenCalledWith(
        `${process.cwd()}/.env`,
        'utf8'
      )
      expect(loggerWarnSpy).not.toHaveBeenCalled()
    })
  })
})
