import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import { Readable } from 'stream'
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
  describe('error handling', () => {
    it('should print JSON upload start errors as plain messages', async () => {
      const { formatUploadStartFailureMessage } = await import('./cli')

      expect(
        formatUploadStartFailureMessage(
          'Example video',
          400,
          JSON.stringify({
            error:
              'Your free tier allows up to 1 active videos. You already have 1 active video. 1 new active video were requested.',
          }),
          'test-secret'
        )
      ).toBe(
        'Your free tier allows up to 1 active videos. You already have 1 active video. 1 new active video were requested.'
      )
    })

    it('adds a fix suggestion to expressive narration tier failures', async () => {
      const { formatFailedVideoMessage } = await import('./cli')

      expect(
        formatFailedVideoMessage(
          'Find ScreenCI docs and getting started',
          'Expressive narration and style prompts require the Business tier. Upgrade your subscription tier at https://app.screenci.com/billing to continue rendering.'
        )
      ).toBe(
        "Find ScreenCI docs and getting started: Expressive narration and style prompts require the Business tier. Upgrade your subscription tier at https://app.screenci.com/billing to continue rendering.\nIf you want to keep using the current tier, remove `voice.style` or `modelType: 'expressive'` from `createNarration()`."
      )
    })

    it('should exit if no command provided', async () => {
      process.argv = ['node', 'cli.js']

      const { main } = await import('./cli')

      await expect(main()).rejects.toThrow('process.exit called')

      expect(loggerErrorSpy).toHaveBeenCalledWith('Error: No command provided')
      expect(processExitSpy).toHaveBeenCalledWith(1)
    })

    it('should exit if unknown command provided', async () => {
      process.argv = ['node', 'cli.js', 'unknown']

      const { main } = await import('./cli')

      await expect(main()).rejects.toThrow('process.exit called')

      expect(loggerErrorSpy).toHaveBeenCalledWith('Unknown command: unknown')
      expect(processExitSpy).toHaveBeenCalledWith(1)
    })

    it('should reject the removed dev command', async () => {
      process.argv = ['node', 'cli.js', 'dev']

      const { main } = await import('./cli')

      await expect(main()).rejects.toThrow('process.exit called')

      expect(loggerErrorSpy).toHaveBeenCalledWith('Unknown command: dev')
      expect(processExitSpy).toHaveBeenCalledWith(1)
    })

    it('should show global help with --help', async () => {
      process.argv = ['node', 'cli.js', '--help']
      const stdoutSpy = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation(() => true)

      const { main } = await import('./cli')
      await expect(main()).resolves.toBeUndefined()

      expect(stdoutSpy).toHaveBeenCalled()
      expect(
        stdoutSpy.mock.calls.some((call) =>
          String(call[0]).includes('Usage: screenci')
        )
      ).toBe(true)
      expect(mockSpawn).not.toHaveBeenCalled()

      stdoutSpy.mockRestore()
    })

    it('should show command help with record --help', async () => {
      process.argv = ['node', 'cli.js', 'record', '--help']
      const stdoutSpy = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation(() => true)

      const { main } = await import('./cli')
      await expect(main()).resolves.toBeUndefined()

      expect(stdoutSpy).toHaveBeenCalled()
      expect(
        stdoutSpy.mock.calls.some((call) =>
          String(call[0]).includes('Usage: screenci record')
        )
      ).toBe(true)
      expect(mockSpawn).not.toHaveBeenCalled()

      stdoutSpy.mockRestore()
    })

    it('should exit if default config not found', async () => {
      process.env.SCREENCI_RECORDING = 'true'
      process.argv = ['node', 'cli.js', 'record']
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')

      await expect(main()).rejects.toThrow('process.exit called')

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('screenci.config.ts not found')
      )
      expect(processExitSpy).toHaveBeenCalledWith(1)
    })

    it('should exit if custom config not found', async () => {
      process.env.SCREENCI_RECORDING = 'true'
      process.argv = [
        'node',
        'cli.js',
        'record',
        '--config',
        'missing.config.ts',
      ]
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')

      await expect(main()).rejects.toThrow('process.exit called')

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Error: Config file not found: missing.config.ts'
        )
      )
      expect(processExitSpy).toHaveBeenCalledWith(1)
    })

    it('should exit if --config flag provided without value', async () => {
      process.argv = ['node', 'cli.js', 'record', '--config']

      const { main } = await import('./cli')

      await expect(main()).rejects.toThrow('process.exit called')

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        'Error: --config requires a path argument'
      )
      expect(processExitSpy).toHaveBeenCalledWith(1)
    })

    it('should exit if -c flag provided without value', async () => {
      process.argv = ['node', 'cli.js', 'record', '-c']

      const { main } = await import('./cli')

      await expect(main()).rejects.toThrow('process.exit called')

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        'Error: --config requires a path argument'
      )
      expect(processExitSpy).toHaveBeenCalledWith(1)
    })

    it('logs mock-record troubleshooting help when record fails', async () => {
      process.argv = ['node', 'cli.js', 'record']
      process.env.SCREENCI_SECRET = 'test-secret'
      mockSpawn.mockImplementation(() => {
        process.nextTick(() => mockChildProcess.emit('close', 1))
        return mockChildProcess as unknown as ChildProcess
      })

      const { main, logCliError } = await import('./cli')

      const error = await main().catch((err) => err)

      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toBe('Playwright exited with code 1')

      loggerErrorSpy.mockClear()
      loggerInfoSpy.mockClear()
      logCliError(error)

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        'Playwright exited with code 1'
      )
      expect(loggerInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining('screenci test --mock-record')
      )
      expect(loggerInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'https://screenci.com/docs/reference/cli/#--mock-record'
        )
      )
      expect(loggerErrorSpy.mock.invocationCallOrder[0]).toBeLessThan(
        loggerInfoSpy.mock.invocationCallOrder[0]
      )
    })

    it('surfaces the first Playwright discovery error and snippet instead of raw JSON', async () => {
      process.argv = ['node', 'cli.js', 'record']
      process.env.SCREENCI_SECRET = 'test-secret'
      mockSpawn.mockImplementation((_command: string, args: string[]) => {
        if (args.includes('--list')) {
          process.nextTick(() => {
            mockChildProcess.stdout.emit(
              'data',
              JSON.stringify({
                config: { reporter: [['json']] },
                suites: [],
                errors: [
                  {
                    message:
                      'Error: [screenci] Asset "badge" (./assets/brand-badge.svg) is an image asset and must not provide audio. Use durationMs instead.',
                    snippet:
                      "   at styled-assets.video.ts:24\n\n  22 | })\n  23 |\n> 24 | const assets = createAssets({\n     |                ^\n  25 |   badge: {\n  26 |     path: './assets/brand-badge.svg',\n  27 |     audio: 0,",
                  },
                ],
              })
            )
            mockChildProcess.emit('close', 1)
          })
          return mockChildProcess as unknown as ChildProcess
        }

        process.nextTick(() => mockChildProcess.emit('close', 0))
        return mockChildProcess as unknown as ChildProcess
      })

      const { main, logCliError } = await import('./cli')

      const error = await main().catch((err) => err)

      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toContain(
        'Error: [screenci] Asset "badge" (./assets/brand-badge.svg) is an image asset and must not provide audio. Use durationMs instead.\n\nat styled-assets.video.ts:24'
      )

      loggerErrorSpy.mockClear()
      loggerInfoSpy.mockClear()
      logCliError(error)

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Error: [screenci] Asset "badge" (./assets/brand-badge.svg) is an image asset and must not provide audio. Use durationMs instead.\n\nat styled-assets.video.ts:24'
        )
      )
      expect(loggerInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining('screenci test --mock-record')
      )
      expect(loggerErrorSpy.mock.invocationCallOrder[0]).toBeLessThan(
        loggerInfoSpy.mock.invocationCallOrder[0]
      )
    })
  })

  describe('info command', () => {
    const baseReadFile = (recordId: string | null) => {
      mockReadFile.mockImplementation(async (path: string | URL) => {
        const p = String(path)
        if (p.endsWith('last-record.json')) {
          if (recordId === null) {
            throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
          }
          return JSON.stringify({
            recordId,
            savedAt: '2026-06-16T00:00:00.000Z',
          })
        }
        if (p.endsWith('screenci.config.ts')) {
          return "export default defineConfig({ projectName: 'Test Project' })"
        }
        if (p.endsWith('package.json')) {
          return JSON.stringify({ version: '0.0.32' })
        }
        return ''
      })
    }

    it('passes the local recordId to /cli/info and prints the response', async () => {
      process.argv = [
        'node',
        'cli.js',
        'info',
        '--config',
        'test-fixtures/screenci.config.ts',
      ]
      process.env.SCREENCI_SECRET = 'test-secret'
      baseReadFile('rec_abc')

      // The backend builds the merged listing; the CLI prints it verbatim.
      const infoResponse = {
        projectName: 'Test Project',
        videos: {
          Demo: {
            videoId: 'kh74',
            latestRecordId: 'rec_abc',
            isPublic: true,
            languages: {
              en: {
                static: {
                  video: 'https://api.screenci.com/public/kh74/en/video',
                  thumbnail:
                    'https://api.screenci.com/public/kh74/en/thumbnail',
                  subtitle: 'https://api.screenci.com/public/kh74/en/subtitle',
                },
                latestRecord: {
                  status: 'finished',
                  video:
                    'https://api.screenci.com/public/kh74/en/video?record=rec_abc',
                  thumbnail:
                    'https://api.screenci.com/public/kh74/en/thumbnail?record=rec_abc',
                  subtitle:
                    'https://api.screenci.com/public/kh74/en/subtitle?record=rec_abc',
                },
              },
            },
          },
        },
      }

      const stdoutSpy = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation(() => true)
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(infoResponse),
        text: vi.fn().mockResolvedValue(''),
      })

      const { main } = await import('./cli')
      await main()

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(
          /\/cli\/info\?projectName=Test\+Project&record=rec_abc$/
        ),
        expect.objectContaining({
          headers: { 'X-ScreenCI-Secret': 'test-secret' },
        })
      )
      expect(stdoutSpy).toHaveBeenCalledWith(
        `${JSON.stringify(infoResponse, null, 2)}\n`
      )

      stdoutSpy.mockRestore()
    })

    it('omits the record param when this machine has not recorded a run', async () => {
      process.argv = [
        'node',
        'cli.js',
        'info',
        '--config',
        'test-fixtures/screenci.config.ts',
      ]
      process.env.SCREENCI_SECRET = 'test-secret'
      baseReadFile(null)

      let calledUrl = ''
      mockFetch.mockImplementation(async (input: string | URL) => {
        calledUrl = String(input)
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            projectName: 'Test Project',
            videos: {},
          }),
          text: vi.fn().mockResolvedValue(''),
        }
      })

      const { main } = await import('./cli')
      await main()

      expect(calledUrl).toContain('/cli/info?projectName=Test+Project')
      expect(calledUrl).not.toContain('record=')
    })
  })

  describe('video visibility commands', () => {
    it('should make a video public', async () => {
      process.argv = [
        'node',
        'cli.js',
        'make-public',
        'video_123',
        '--config',
        'test-fixtures/screenci.config.ts',
      ]
      process.env.SCREENCI_SECRET = 'test-secret'

      const { main } = await import('./cli')
      await main()

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/cli/public-video/video_123'),
        expect.objectContaining({
          method: 'PUT',
          headers: { 'X-ScreenCI-Secret': 'test-secret' },
        })
      )
      expect(loggerInfoSpy).toHaveBeenCalledWith('Made public: video_123')
    })

    it('should make a video private', async () => {
      process.argv = [
        'node',
        'cli.js',
        'make-private',
        'video_123',
        '--config',
        'test-fixtures/screenci.config.ts',
      ]
      process.env.SCREENCI_SECRET = 'test-secret'

      const { main } = await import('./cli')
      await main()

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/cli/public-video/video_123'),
        expect.objectContaining({
          method: 'DELETE',
          headers: { 'X-ScreenCI-Secret': 'test-secret' },
        })
      )
      expect(loggerInfoSpy).toHaveBeenCalledWith('Made private: video_123')
    })
  })

  describe('removed retry command', () => {
    it('should report retry as an unknown command', async () => {
      process.argv = ['node', 'cli.js', 'retry']

      const { main } = await import('./cli')
      await expect(main()).rejects.toThrow('process.exit called')
      expect(loggerErrorSpy).toHaveBeenCalledWith('Unknown command: retry')
    })

    it('should launch Playwright through node on Windows', async () => {
      process.argv = ['node', 'cli.js', 'test']
      const platformSpy = vi
        .spyOn(process, 'platform', 'get')
        .mockReturnValue('win32')
      try {
        mockSpawn.mockImplementation((_command: string) => {
          process.nextTick(() => mockChildProcess.emit('close', 0))
          return mockChildProcess as unknown as ChildProcess
        })

        const { main } = await import('./cli')
        await main()

        expect(mockSpawn).toHaveBeenCalledWith(
          process.execPath,
          expect.arrayContaining([
            expect.stringContaining('@playwright/test/cli'),
            'test',
          ]),
          expect.objectContaining({
            stdio: 'inherit',
          })
        )
      } finally {
        platformSpy.mockRestore()
      }
    })
  })
})
