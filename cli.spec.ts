import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import { Readable } from 'stream'
import { stripVTControlCharacters } from 'util'
import pc from 'picocolors'
import { logger } from './src/logger.js'
import type { VoiceKey } from './src/voices.js'
import type { RecordingData } from './src/recording.js'

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

  describe('record command', () => {
    beforeEach(() => {
      process.env.SCREENCI_SECRET = 'test-secret'
    })

    it('fails fast when SCREENCI_SECRET is missing', async () => {
      delete process.env.SCREENCI_SECRET
      process.argv = ['node', 'cli.js', 'record']

      const { main } = await import('./cli')

      await expect(main()).rejects.toThrow('process.exit called')

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Run')
      )
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('npx screenci login')
      )
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'https://screenci.com/docs/reference/cli/#screenci-login'
        )
      )
      expect(mockCreateHttpServer).not.toHaveBeenCalled()
      expect(mockSpawn).not.toHaveBeenCalledWith(
        expect.stringMatching(/cmd|open|xdg-open/),
        expect.anything(),
        expect.anything()
      )
    })

    it('loads SCREENCI_SECRET from the project .env when envFile is not configured', async () => {
      delete process.env.SCREENCI_SECRET
      process.argv = ['node', 'cli.js', 'record']
      if (loadEnvFileSpy) {
        loadEnvFileSpy.mockImplementation((path?: string | URL) => {
          if (String(path) === `${process.cwd()}/.env`) {
            process.env.SCREENCI_SECRET = 'env-secret'
          }
        })
      } else {
        mockReadFileSync.mockReturnValue('SCREENCI_SECRET=env-secret\n')
      }
      mockSpawn.mockImplementation(() => {
        process.nextTick(() => mockChildProcess.emit('close', 0))
        return mockChildProcess as unknown as ChildProcess
      })

      const { main } = await import('./cli')

      await main()

      if (loadEnvFileSpy) {
        expect(loadEnvFileSpy).toHaveBeenCalledWith(`${process.cwd()}/.env`)
      } else {
        expect(mockReadFileSync).toHaveBeenCalledWith(
          `${process.cwd()}/.env`,
          'utf8'
        )
      }
      expect(mockCreateHttpServer).not.toHaveBeenCalled()
    })

    it('should run Playwright locally for record command', async () => {
      process.argv = ['node', 'cli.js', 'record']
      process.env.VITE_APP_BASE_URL = 'https://example.com'
      mockSpawn.mockImplementation(
        (
          _command: string,
          _args: string[],
          options?: { env?: NodeJS.ProcessEnv }
        ) => {
          expect(options?.env?.SCREENCI_RECORDING).toBe('true')
          expect(options?.env?.VITE_APP_BASE_URL).toBe('https://example.com')
          process.nextTick(() => mockChildProcess.emit('close', 0))
          return mockChildProcess as unknown as ChildProcess
        }
      )

      const { main } = await import('./cli')

      await main()

      expect(mockSpawn).toHaveBeenCalledWith(
        'playwright',
        expect.arrayContaining(['test']),
        expect.objectContaining({
          env: expect.objectContaining({
            SCREENCI_RECORDING: 'true',
            VITE_APP_BASE_URL: 'https://example.com',
          }),
          stdio: 'inherit',
        })
      )
    })

    it('should only log the config path in verbose mode', async () => {
      process.argv = ['node', 'cli.js', 'record', '--verbose']
      process.env.VITE_APP_BASE_URL = 'https://example.com'
      mockReadFile.mockImplementation(async (path: string | URL) => {
        if (String(path).endsWith('screenci.config.ts')) {
          return `export default defineConfig({ projectName: 'Test Project' })`
        }
        if (String(path).endsWith('package.json')) {
          return JSON.stringify({ version: '0.0.32' })
        }
        return ''
      })
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ projectId: 'project_123' }),
        text: vi.fn().mockResolvedValue(''),
      })
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

    it('uploads completed recordings normally', async () => {
      mockReaddir.mockResolvedValue(['demo-video'])
      mockReadFile.mockImplementation(async (path: string | URL) => {
        const pathString = String(path)
        if (pathString.endsWith('package.json')) {
          return JSON.stringify({ version: '0.0.32' })
        }
        if (pathString.endsWith('record-upload.config.ts')) {
          return "export default { projectName: 'Test Project' }"
        }
        if (pathString.endsWith('data.json')) {
          return JSON.stringify({ events: [], metadata: { videoName: 'Demo' } })
        }
        return ''
      })
      mockExistsSync.mockImplementation(
        (path: string) =>
          path.endsWith('test-fixtures/record-upload.config.ts') ||
          path.endsWith('data.json') ||
          path.endsWith('recording.mp4')
      )
      mockFetch.mockImplementation(async (input: string | URL) => {
        const url = String(input)
        if (url.endsWith('/cli/upload/start')) {
          return {
            ok: true,
            status: 200,
            json: vi.fn().mockResolvedValue({
              recordingId: 'recording_123',
              projectId: 'project_123',
            }),
            text: vi.fn().mockResolvedValue(''),
          }
        }

        if (url.endsWith('/cli/upload/recording_123/recording')) {
          return {
            ok: true,
            status: 200,
            json: vi.fn().mockResolvedValue({}),
            text: vi.fn().mockResolvedValue(''),
          }
        }

        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({}),
          text: vi.fn().mockResolvedValue(''),
        }
      })
      mockSpawn.mockImplementation(() => {
        process.nextTick(() => mockChildProcess.emit('close', 0))
        return mockChildProcess as unknown as ChildProcess
      })

      const { uploadRecordings } = await import('./cli')

      const result = await uploadRecordings(
        '/repo/.screenci',
        'Test Project',
        'https://api.screenci.test',
        'test-secret'
      )

      expect(result).toEqual({
        projectId: 'project_123',
        hadFailures: false,
        failedVideoNames: [],
        failedVideoMessages: [],
      })
      expect(mockReaddir).toHaveBeenCalledWith('/repo/.screenci')
      expect(mockReadFile).toHaveBeenCalledWith(
        expect.stringContaining('/repo/.screenci/demo-video/data.json'),
        'utf-8'
      )
    })

    it('uploads completed recordings after partial failure with default policy, then still fails', async () => {
      process.argv = [
        'node',
        'cli.js',
        'record',
        '--config',
        'test-fixtures/record-upload.config.ts',
      ]
      mockReaddir.mockResolvedValue(['demo-video'])
      mockReadFile.mockImplementation(async (path: string | URL) => {
        const pathString = String(path)
        if (pathString.endsWith('package.json')) {
          return JSON.stringify({ version: '0.0.32' })
        }
        if (pathString.endsWith('record-upload.config.ts')) {
          return "export default { projectName: 'Test Project' }"
        }
        if (pathString.endsWith('data.json')) {
          return JSON.stringify({ events: [], metadata: { videoName: 'Demo' } })
        }
        return ''
      })
      mockExistsSync.mockImplementation(
        (path: string) =>
          path.endsWith('test-fixtures/record-upload.config.ts') ||
          path.endsWith('data.json') ||
          path.endsWith('recording.mp4')
      )
      mockFetch.mockImplementation(async (input: string | URL) => {
        const url = String(input)
        if (url.endsWith('/cli/upload/start')) {
          return {
            ok: true,
            status: 200,
            json: vi.fn().mockResolvedValue({
              recordingId: 'recording_123',
              projectId: 'project_123',
            }),
            text: vi.fn().mockResolvedValue(''),
          }
        }

        if (url.endsWith('/cli/upload/recording_123/recording')) {
          return {
            ok: true,
            status: 200,
            json: vi.fn().mockResolvedValue({}),
            text: vi.fn().mockResolvedValue(''),
          }
        }

        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({}),
          text: vi.fn().mockResolvedValue(''),
        }
      })
      mockSpawn.mockImplementation(() => {
        process.nextTick(() => mockChildProcess.emit('close', 1))
        return mockChildProcess as unknown as ChildProcess
      })

      const { main } = await import('./cli')

      await expect(main()).rejects.toThrow('Playwright exited with code 1')

      expect(mockReaddir).toHaveBeenCalledWith(
        expect.stringContaining('.screenci')
      )
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        'Some recordings failed, uploading successful videos only.'
      )
      expect(mockRmSync).toHaveBeenCalledWith(
        expect.stringContaining('/.screenci/demo-video'),
        { recursive: true, force: true }
      )
    })

    it('skips upload after partial failure with all-or-nothing policy, then still fails', async () => {
      process.argv = [
        'node',
        'cli.js',
        'record',
        '--config',
        'test-fixtures/record-upload-all-or-nothing.config.ts',
      ]
      mockReaddir.mockResolvedValue(['demo-video'])
      mockReadFile.mockImplementation(async (path: string | URL) => {
        const pathString = String(path)
        if (pathString.endsWith('package.json')) {
          return JSON.stringify({ version: '0.0.32' })
        }
        if (pathString.endsWith('data.json')) {
          return JSON.stringify({ events: [], metadata: { videoName: 'Demo' } })
        }
        return ''
      })
      mockExistsSync.mockImplementation(
        (path: string) =>
          path.endsWith(
            'test-fixtures/record-upload-all-or-nothing.config.ts'
          ) || path.endsWith('data.json')
      )
      mockSpawn.mockImplementation(() => {
        process.nextTick(() => mockChildProcess.emit('close', 1))
        return mockChildProcess as unknown as ChildProcess
      })

      const { main } = await import('./cli')

      await expect(main()).rejects.toThrow('Playwright exited with code 1')

      expect(mockFetch).not.toHaveBeenCalledWith(
        expect.stringContaining('/cli/upload/start'),
        expect.any(Object)
      )
      expect(loggerInfoSpy).toHaveBeenCalledWith(
        'Some recordings failed, skipping upload because record.upload is "all-or-nothing".'
      )
    })

    it('skips entries without data.json in passed-only upload flow', async () => {
      mockReaddir.mockResolvedValue(['failed-video'])
      mockReadFile.mockImplementation(async (path: string | URL) => {
        const pathString = String(path)
        if (pathString.endsWith('package.json')) {
          return JSON.stringify({ version: '0.0.32' })
        }
        return ''
      })
      mockExistsSync.mockImplementation((path: string) =>
        path.endsWith('recording.mp4')
      )

      const { uploadRecordings } = await import('./cli')

      const result = await uploadRecordings(
        '/repo/.screenci',
        'Test Project',
        'https://api.screenci.test',
        'test-secret'
      )

      expect(result).toEqual({
        projectId: null,
        hadFailures: false,
        failedVideoNames: [],
        failedVideoMessages: [],
      })
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('fails an upload candidate when recording.mp4 is missing', async () => {
      mockReaddir.mockResolvedValue(['demo-video'])
      mockReadFile.mockImplementation(async (path: string | URL) => {
        const pathString = String(path)
        if (pathString.endsWith('package.json')) {
          return JSON.stringify({ version: '0.0.32' })
        }
        if (pathString.endsWith('data.json')) {
          return JSON.stringify({ events: [], metadata: { videoName: 'Demo' } })
        }
        return ''
      })
      mockExistsSync.mockImplementation((path: string) =>
        path.endsWith('data.json')
      )

      const { uploadRecordings } = await import('./cli')

      const result = await uploadRecordings(
        '/repo/.screenci',
        'Test Project',
        'https://api.screenci.test',
        'test-secret'
      )

      expect(result).toEqual({
        projectId: null,
        hadFailures: true,
        failedVideoNames: ['Demo'],
        failedVideoMessages: [
          {
            videoName: 'Demo',
            message: 'Missing recording.mp4 for "Demo"',
          },
        ],
      })
      expect(mockFetch).not.toHaveBeenCalledWith(
        expect.stringContaining('/cli/upload/start'),
        expect.anything()
      )
    })

    it('fails the upload when an asset check fails', async () => {
      mockReaddir.mockResolvedValue(['demo-video'])
      mockReadFile.mockImplementation(async (path: string | URL) => {
        const pathString = String(path)
        if (pathString.endsWith('package.json')) {
          return JSON.stringify({ version: '0.0.32' })
        }
        if (pathString.endsWith('data.json')) {
          return JSON.stringify({
            events: [
              {
                type: 'assetStart',
                timeMs: 0,
                name: 'logo',
                kind: 'image',
                path: 'videos/logo.png',
                durationMs: 1200,
                fullScreen: false,
              },
            ],
            metadata: { videoName: 'Demo' },
          })
        }
        if (pathString.endsWith('videos/logo.png')) {
          return Buffer.from('logo-bytes')
        }
        return ''
      })
      mockExistsSync.mockImplementation(
        (path: string) =>
          path.endsWith('data.json') ||
          path.endsWith('recording.mp4') ||
          path.endsWith('videos/logo.png')
      )
      mockFetch.mockImplementation(async (input: string | URL) => {
        const url = String(input)
        if (url.endsWith('/cli/upload/start')) {
          return {
            ok: true,
            status: 200,
            json: vi.fn().mockResolvedValue({
              recordingId: 'recording_123',
              projectId: 'project_123',
            }),
            text: vi.fn().mockResolvedValue(''),
          }
        }
        if (url.endsWith('/asset/check')) {
          return {
            ok: false,
            status: 500,
            json: vi.fn().mockResolvedValue({}),
            text: vi.fn().mockResolvedValue('backend exploded'),
          }
        }
        if (url.endsWith('/cli/upload/recording_123/recording')) {
          return {
            ok: true,
            status: 200,
            json: vi.fn().mockResolvedValue({}),
            text: vi.fn().mockResolvedValue(''),
          }
        }
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({}),
          text: vi.fn().mockResolvedValue(''),
        }
      })

      const { uploadRecordings } = await import('./cli')

      const result = await uploadRecordings(
        '/repo/.screenci',
        'Test Project',
        'https://api.screenci.test',
        'test-secret'
      )

      expect(result).toEqual({
        projectId: 'project_123',
        hadFailures: true,
        failedVideoNames: ['Demo'],
        failedVideoMessages: [
          {
            videoName: 'Demo',
            message:
              'Failed to check asset videos/logo.png: 500 backend exploded',
          },
        ],
      })
      expect(
        mockFetch.mock.calls.some(([input]) =>
          String(input).endsWith('/cli/upload/recording_123/recording')
        )
      ).toBe(false)
    })

    it('resolves asset paths relative to the recording source file during upload', async () => {
      mockReaddir.mockResolvedValue(['demo-video'])
      mockReadFile.mockImplementation(async (path: string | URL) => {
        const pathString = String(path)
        if (pathString.endsWith('package.json')) {
          return JSON.stringify({ version: '0.0.32' })
        }
        if (pathString.endsWith('data.json')) {
          return JSON.stringify({
            events: [
              {
                type: 'assetStart',
                timeMs: 0,
                name: 'nested-clip',
                kind: 'video',
                path: './asset.mp4',
                audio: 0,
                fullScreen: true,
              },
            ],
            metadata: {
              videoName: 'Demo',
              sourceFilePath: 'videos/nested/demo.video.ts',
            },
          })
        }
        if (pathString.endsWith('videos/nested/asset.mp4')) {
          return Buffer.from('nested-asset')
        }
        throw new Error(`ENOENT: ${pathString}`)
      })
      mockExistsSync.mockImplementation(
        (path: string) =>
          path.endsWith('data.json') || path.endsWith('recording.mp4')
      )

      let startBody:
        | {
            expectedAssets?: Array<{
              path: string
              size: number
              fileHash: string
            }>
          }
        | undefined

      mockFetch.mockImplementation(
        async (input: string | URL, init?: RequestInit) => {
          const url = String(input)
          if (url.endsWith('/cli/upload/start')) {
            startBody = JSON.parse(
              String(init?.body ?? '{}')
            ) as typeof startBody
            return {
              ok: true,
              status: 200,
              json: vi.fn().mockResolvedValue({
                recordingId: 'recording_123',
                projectId: 'project_123',
              }),
              text: vi.fn().mockResolvedValue(''),
            }
          }
          if (url.endsWith('/asset/check')) {
            return {
              ok: true,
              status: 200,
              json: vi.fn().mockResolvedValue({ exists: true }),
              text: vi.fn().mockResolvedValue(''),
            }
          }
          if (url.endsWith('/cli/upload/recording_123/recording')) {
            return {
              ok: true,
              status: 200,
              json: vi.fn().mockResolvedValue({}),
              text: vi.fn().mockResolvedValue(''),
            }
          }
          return {
            ok: true,
            status: 200,
            json: vi.fn().mockResolvedValue({}),
            text: vi.fn().mockResolvedValue(''),
          }
        }
      )

      const { uploadRecordings } = await import('./cli')

      const result = await uploadRecordings(
        '/repo/.screenci',
        'Test Project',
        'https://api.screenci.test',
        'test-secret'
      )

      expect(result).toEqual({
        projectId: 'project_123',
        hadFailures: false,
        failedVideoNames: [],
        failedVideoMessages: [],
      })
      expect(startBody?.expectedAssets).toEqual([
        expect.objectContaining({
          fileHash: expect.any(String),
          path: './asset.mp4',
          size: Buffer.from('nested-asset').byteLength,
        }),
      ])
    })

    it('returns failure state when some recordings do not upload', async () => {
      mockReaddir.mockResolvedValue(['demo-video', 'failed-video'])
      mockReadFile.mockImplementation(async (path: string | URL) => {
        const pathString = String(path)
        if (pathString.endsWith('package.json')) {
          return JSON.stringify({ version: '0.0.32' })
        }
        if (pathString.endsWith('data.json')) {
          const videoName = pathString.includes('/failed-video/')
            ? 'Failed Demo'
            : 'Demo'
          return JSON.stringify({ events: [], metadata: { videoName } })
        }
        return ''
      })
      mockExistsSync.mockImplementation(
        (path: string) =>
          path.endsWith('data.json') || path.endsWith('recording.mp4')
      )
      mockFetch.mockImplementation(async (input: string | URL) => {
        const url = String(input)
        if (url.endsWith('/cli/upload/start')) {
          const body = JSON.parse(
            String(
              (mockFetch.mock.calls.at(-1)?.[1] as { body?: string })?.body ??
                '{}'
            )
          ) as { videoName?: string }
          if (body.videoName === 'Failed Demo') {
            return {
              ok: false,
              status: 402,
              json: vi.fn().mockResolvedValue({}),
              text: vi
                .fn()
                .mockResolvedValue('Upload limit reached for current plan.'),
            }
          }
          return {
            ok: true,
            status: 200,
            json: vi.fn().mockResolvedValue({
              recordingId: 'recording_123',
              projectId: 'project_123',
            }),
            text: vi.fn().mockResolvedValue(''),
          }
        }

        if (url.endsWith('/cli/upload/recording_123/recording')) {
          return {
            ok: true,
            status: 200,
            json: vi.fn().mockResolvedValue({}),
            text: vi.fn().mockResolvedValue(''),
          }
        }

        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({}),
          text: vi.fn().mockResolvedValue(''),
        }
      })

      const { uploadRecordings } = await import('./cli')

      const result = await uploadRecordings(
        '/repo/.screenci',
        'Test Project',
        'https://api.screenci.test',
        'test-secret'
      )

      expect(result).toEqual({
        projectId: 'project_123',
        hadFailures: true,
        failedVideoNames: ['Failed Demo'],
        failedVideoMessages: [
          {
            videoName: 'Failed Demo',
            message: 'Upload limit reached for current plan.',
          },
        ],
      })
    })

    it('removes uploaded recording directories after successful upload', async () => {
      mockReaddir.mockResolvedValue(['demo-video'])
      mockReadFile.mockImplementation(async (path: string | URL) => {
        const pathString = String(path)
        if (pathString.endsWith('package.json')) {
          return JSON.stringify({ version: '0.0.32' })
        }
        if (pathString.endsWith('data.json')) {
          return JSON.stringify({ events: [], metadata: { videoName: 'Demo' } })
        }
        return ''
      })
      mockExistsSync.mockImplementation(
        (path: string) =>
          path.endsWith('data.json') || path.endsWith('recording.mp4')
      )
      mockFetch.mockImplementation(async (input: string | URL) => {
        const url = String(input)
        if (url.endsWith('/cli/upload/start')) {
          return {
            ok: true,
            status: 200,
            json: vi.fn().mockResolvedValue({
              recordingId: 'recording_123',
              projectId: 'project_123',
            }),
            text: vi.fn().mockResolvedValue(''),
          }
        }

        if (url.endsWith('/cli/upload/recording_123/recording')) {
          return {
            ok: true,
            status: 200,
            json: vi.fn().mockResolvedValue({}),
            text: vi.fn().mockResolvedValue(''),
          }
        }

        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({}),
          text: vi.fn().mockResolvedValue(''),
        }
      })

      const { uploadRecordings } = await import('./cli')

      const result = await uploadRecordings(
        '/repo/.screenci',
        'Test Project',
        'https://api.screenci.test',
        'test-secret'
      )

      expect(result).toEqual({
        projectId: 'project_123',
        hadFailures: false,
        failedVideoNames: [],
        failedVideoMessages: [],
      })
      expect(mockRmSync).toHaveBeenCalledWith('/repo/.screenci/demo-video', {
        recursive: true,
        force: true,
      })
    })

    it('keeps uploaded recording directories when DEBUG=true', async () => {
      process.env.DEBUG = 'true'
      mockReaddir.mockResolvedValue(['demo-video'])
      mockReadFile.mockImplementation(async (path: string | URL) => {
        const pathString = String(path)
        if (pathString.endsWith('package.json')) {
          return JSON.stringify({ version: '0.0.32' })
        }
        if (pathString.endsWith('data.json')) {
          return JSON.stringify({ events: [], metadata: { videoName: 'Demo' } })
        }
        return ''
      })
      mockExistsSync.mockImplementation(
        (path: string) =>
          path.endsWith('data.json') || path.endsWith('recording.mp4')
      )
      mockFetch.mockImplementation(async (input: string | URL) => {
        const url = String(input)
        if (url.endsWith('/cli/upload/start')) {
          return {
            ok: true,
            status: 200,
            json: vi.fn().mockResolvedValue({
              recordingId: 'recording_123',
              projectId: 'project_123',
            }),
            text: vi.fn().mockResolvedValue(''),
          }
        }

        if (url.endsWith('/cli/upload/recording_123/recording')) {
          return {
            ok: true,
            status: 200,
            json: vi.fn().mockResolvedValue({}),
            text: vi.fn().mockResolvedValue(''),
          }
        }

        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({}),
          text: vi.fn().mockResolvedValue(''),
        }
      })

      const { uploadRecordings } = await import('./cli')

      const result = await uploadRecordings(
        '/repo/.screenci',
        'Test Project',
        'https://api.screenci.test',
        'test-secret'
      )

      expect(result).toEqual({
        projectId: 'project_123',
        hadFailures: false,
        failedVideoNames: [],
        failedVideoMessages: [],
      })
      expect(mockRmSync).not.toHaveBeenCalled()
    })

    it('uploads recordings in parallel and reports completions as they finish in CI mode', async () => {
      const stdoutWriteSpy = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation(() => true)
      mockReaddir.mockResolvedValue(['slow-video', 'fast-video'])
      mockReadFile.mockImplementation(async (path: string | URL) => {
        const pathString = String(path)
        if (pathString.endsWith('package.json')) {
          return JSON.stringify({ version: '0.0.32' })
        }
        if (pathString.endsWith('data.json')) {
          const videoName = pathString.includes('/slow-video/')
            ? 'Slow Demo'
            : 'Fast Demo'
          return JSON.stringify({ events: [], metadata: { videoName } })
        }
        return ''
      })
      mockExistsSync.mockImplementation(
        (path: string) =>
          path.endsWith('data.json') || path.endsWith('recording.mp4')
      )
      mockFetch.mockImplementation(
        async (input: string | URL, init?: RequestInit) => {
          const url = String(input)
          if (url.endsWith('/cli/upload/start')) {
            const body = JSON.parse(String(init?.body ?? '{}')) as {
              videoName?: string
            }
            if (body.videoName === 'Slow Demo') {
              return {
                ok: true,
                status: 200,
                json: vi.fn().mockResolvedValue({
                  recordingId: 'recording_slow',
                  projectId: 'project_123',
                }),
                text: vi.fn().mockResolvedValue(''),
              }
            }

            return {
              ok: true,
              status: 200,
              json: vi.fn().mockResolvedValue({
                recordingId: 'recording_fast',
                projectId: 'project_123',
              }),
              text: vi.fn().mockResolvedValue(''),
            }
          }

          if (url.endsWith('/cli/upload/recording_slow/recording')) {
            await new Promise((resolve) => setTimeout(resolve, 20))
            return {
              ok: true,
              status: 200,
              json: vi.fn().mockResolvedValue({}),
              text: vi.fn().mockResolvedValue(''),
            }
          }

          if (url.endsWith('/cli/upload/recording_fast/recording')) {
            return {
              ok: true,
              status: 200,
              json: vi.fn().mockResolvedValue({}),
              text: vi.fn().mockResolvedValue(''),
            }
          }

          return {
            ok: true,
            status: 200,
            json: vi.fn().mockResolvedValue({}),
            text: vi.fn().mockResolvedValue(''),
          }
        }
      )
      process.env.CI = 'true'

      try {
        const { uploadRecordings } = await import('./cli')

        const result = await uploadRecordings(
          '/repo/.screenci',
          'Test Project',
          'https://api.screenci.test',
          'test-secret'
        )

        expect(result).toEqual({
          projectId: 'project_123',
          hadFailures: false,
          failedVideoNames: [],
          failedVideoMessages: [],
        })

        const messages = loggerInfoSpy.mock.calls.map((call) => String(call[0]))
        expect(messages).not.toContain('Uploading 2 recordings in parallel...')
        expect(
          messages.findIndex((message) =>
            message.includes('Uploaded "Fast Demo"')
          )
        ).toBeLessThan(
          messages.findIndex((message) =>
            message.includes('Uploaded "Slow Demo"')
          )
        )
        expect(stdoutWriteSpy).not.toHaveBeenCalled()
      } finally {
        stdoutWriteSpy.mockRestore()
      }
    })

    it('updates upload rows in place outside CI on interactive terminals', async () => {
      const stdoutWriteSpy = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation(() => true)
      const originalIsTTY = Object.getOwnPropertyDescriptor(
        process.stdout,
        'isTTY'
      )
      Object.defineProperty(process.stdout, 'isTTY', {
        configurable: true,
        value: true,
      })
      delete process.env.CI

      mockReaddir.mockResolvedValue(['demo-video', 'second-video'])
      mockReadFile.mockImplementation(async (path: string | URL) => {
        const pathString = String(path)
        if (pathString.endsWith('package.json')) {
          return JSON.stringify({ version: '0.0.32' })
        }
        if (pathString.endsWith('data.json')) {
          const videoName = pathString.includes('/second-video/')
            ? 'Second Demo'
            : 'Demo'
          return JSON.stringify({ events: [], metadata: { videoName } })
        }
        return ''
      })
      mockExistsSync.mockImplementation(
        (path: string) =>
          path.endsWith('data.json') || path.endsWith('recording.mp4')
      )
      mockFetch.mockImplementation(
        async (input: string | URL, init?: RequestInit) => {
          const url = String(input)
          if (url.endsWith('/cli/upload/start')) {
            const body = JSON.parse(String(init?.body ?? '{}')) as {
              videoName?: string
            }
            return {
              ok: true,
              status: 200,
              json: vi.fn().mockResolvedValue({
                recordingId:
                  body.videoName === 'Second Demo'
                    ? 'recording_456'
                    : 'recording_123',
                projectId: 'project_123',
              }),
              text: vi.fn().mockResolvedValue(''),
            }
          }

          if (
            url.endsWith('/cli/upload/recording_123/recording') ||
            url.endsWith('/cli/upload/recording_456/recording')
          ) {
            return {
              ok: true,
              status: 200,
              json: vi.fn().mockResolvedValue({}),
              text: vi.fn().mockResolvedValue(''),
            }
          }

          return {
            ok: true,
            status: 200,
            json: vi.fn().mockResolvedValue({}),
            text: vi.fn().mockResolvedValue(''),
          }
        }
      )

      try {
        const { uploadRecordings } = await import('./cli')

        await uploadRecordings(
          '/repo/.screenci',
          'Test Project',
          'https://api.screenci.test',
          'test-secret'
        )

        const allWrites = stdoutWriteSpy.mock.calls
          .map((call) => String(call[0]))
          .join('')
        const normalizedWrites = stripVTControlCharacters(allWrites)

        expect(normalizedWrites).toContain('... Uploading "Demo"')
        expect(normalizedWrites).toContain('... Uploading "Second Demo"')
        expect(allWrites).toContain('\u001B[2A')
        expect(normalizedWrites).toContain('✔ Uploaded "Demo"')
        expect(normalizedWrites).toContain('✔ Uploaded "Second Demo"')
        expect(loggerInfoSpy).not.toHaveBeenCalledWith(
          'Uploading 2 recordings in parallel...'
        )
      } finally {
        stdoutWriteSpy.mockRestore()
        if (originalIsTTY) {
          Object.defineProperty(process.stdout, 'isTTY', originalIsTTY)
        } else {
          delete (process.stdout as NodeJS.WriteStream & { isTTY?: boolean })
            .isTTY
        }
      }
    })

    it('re-renders upload rows after asset logs on interactive terminals', async () => {
      const stdoutWriteSpy = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation(() => true)
      const originalIsTTY = Object.getOwnPropertyDescriptor(
        process.stdout,
        'isTTY'
      )
      Object.defineProperty(process.stdout, 'isTTY', {
        configurable: true,
        value: true,
      })
      delete process.env.CI

      mockReaddir.mockResolvedValue(['demo-video', 'second-video'])
      mockReadFile.mockImplementation(async (path: string | URL) => {
        const pathString = String(path)
        if (pathString.endsWith('package.json')) {
          return JSON.stringify({ version: '0.0.32' })
        }
        if (pathString.endsWith('data.json')) {
          const videoName = pathString.includes('/second-video/')
            ? 'Second Demo'
            : 'Demo'
          return JSON.stringify({
            events: [
              {
                type: 'assetStart',
                name: 'logo',
                kind: 'image',
                path: 'videos/logo.png',
                durationMs: 1200,
                fullScreen: false,
              },
            ],
            metadata: { videoName },
          })
        }
        if (pathString.endsWith('videos/logo.png')) {
          return Buffer.from('logo-bytes')
        }
        return ''
      })
      mockExistsSync.mockImplementation(
        (path: string) =>
          path.endsWith('data.json') ||
          path.endsWith('recording.mp4') ||
          path.endsWith('videos/logo.png')
      )
      mockFetch.mockImplementation(
        async (input: string | URL, init?: RequestInit) => {
          const url = String(input)
          if (url.endsWith('/cli/upload/start')) {
            const body = JSON.parse(String(init?.body ?? '{}')) as {
              videoName?: string
            }
            return {
              ok: true,
              status: 200,
              json: vi.fn().mockResolvedValue({
                recordingId:
                  body.videoName === 'Second Demo'
                    ? 'recording_456'
                    : 'recording_123',
                projectId: 'project_123',
              }),
              text: vi.fn().mockResolvedValue(''),
            }
          }

          if (url.endsWith('/asset/check')) {
            return {
              ok: true,
              status: 200,
              json: vi.fn().mockResolvedValue({ exists: true }),
              text: vi.fn().mockResolvedValue(''),
            }
          }

          if (
            url.endsWith('/cli/upload/recording_123/recording') ||
            url.endsWith('/cli/upload/recording_456/recording')
          ) {
            return {
              ok: true,
              status: 200,
              json: vi.fn().mockResolvedValue({}),
              text: vi.fn().mockResolvedValue(''),
            }
          }

          return {
            ok: true,
            status: 200,
            json: vi.fn().mockResolvedValue({}),
            text: vi.fn().mockResolvedValue(''),
          }
        }
      )

      try {
        const { uploadRecordings } = await import('./cli')

        await uploadRecordings(
          '/repo/.screenci',
          'Test Project',
          'https://api.screenci.test',
          'test-secret'
        )

        const allWrites = stdoutWriteSpy.mock.calls
          .map((call) => String(call[0]))
          .join('')
        const normalizedWrites = stripVTControlCharacters(allWrites)
        const moveUpCount = (allWrites.match(/\u001B\[2A/g) ?? []).length
        const messages = loggerInfoSpy.mock.calls.map((call) =>
          stripVTControlCharacters(String(call[0]))
        )

        expect(messages).toContain('✔ Asset already exists: videos/logo.png')
        expect(moveUpCount).toBeGreaterThanOrEqual(3)
        expect(normalizedWrites).toContain('... Uploading "Demo"')
        expect(normalizedWrites).toContain('... Uploading "Second Demo"')
        expect(normalizedWrites).toContain('✔ Uploaded "Demo"')
        expect(normalizedWrites).toContain('✔ Uploaded "Second Demo"')
      } finally {
        stdoutWriteSpy.mockRestore()
        if (originalIsTTY) {
          Object.defineProperty(process.stdout, 'isTTY', originalIsTTY)
        } else {
          delete (process.stdout as NodeJS.WriteStream & { isTTY?: boolean })
            .isTTY
        }
      }
    })

    it('fails record command when not all uploads succeed but still prints the project url', async () => {
      process.argv = [
        'node',
        'cli.js',
        'record',
        '--config',
        'test-fixtures/record-upload.config.ts',
      ]
      mockReaddir.mockResolvedValue(['demo-video', 'failed-video'])
      mockReadFile.mockImplementation(async (path: string | URL) => {
        const pathString = String(path)
        if (pathString.endsWith('package.json')) {
          return JSON.stringify({ version: '0.0.32' })
        }
        if (pathString.endsWith('record-upload.config.ts')) {
          return "export default { projectName: 'Test Project' }"
        }
        if (pathString.endsWith('data.json')) {
          const videoName = pathString.includes('/failed-video/')
            ? 'Failed Demo'
            : 'Demo'
          return JSON.stringify({ events: [], metadata: { videoName } })
        }
        return ''
      })
      mockExistsSync.mockImplementation(
        (path: string) =>
          path.endsWith('test-fixtures/record-upload.config.ts') ||
          path.endsWith('data.json') ||
          path.endsWith('recording.mp4')
      )
      mockFetch.mockImplementation(
        async (input: string | URL, init?: RequestInit) => {
          const url = String(input)
          if (url.endsWith('/cli/upload/start')) {
            const body = JSON.parse(String(init?.body ?? '{}')) as {
              videoName?: string
            }
            if (body.videoName === 'Failed Demo') {
              return {
                ok: false,
                status: 402,
                json: vi.fn().mockResolvedValue({}),
                text: vi
                  .fn()
                  .mockResolvedValue('Upload limit reached for current plan.'),
              }
            }
            return {
              ok: true,
              status: 200,
              json: vi.fn().mockResolvedValue({
                recordingId: 'recording_123',
                projectId: 'project_123',
              }),
              text: vi.fn().mockResolvedValue(''),
            }
          }

          if (url.endsWith('/cli/upload/recording_123/recording')) {
            return {
              ok: true,
              status: 200,
              json: vi.fn().mockResolvedValue({}),
              text: vi.fn().mockResolvedValue(''),
            }
          }

          return {
            ok: true,
            status: 200,
            json: vi.fn().mockResolvedValue({}),
            text: vi.fn().mockResolvedValue(''),
          }
        }
      )
      mockSpawn.mockImplementation(() => {
        process.nextTick(() => mockChildProcess.emit('close', 0))
        return mockChildProcess as unknown as ChildProcess
      })

      const { main } = await import('./cli')

      await expect(main()).rejects.toThrow(
        'Not all recordings succeeded to upload.'
      )

      expect(loggerInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining('/project/project_123')
      )
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        'Failed Demo: Upload limit reached for current plan.'
      )
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        'Not all recordings succeeded to upload. Failed videos: Failed Demo. Some videos may be missing from the project.'
      )
    })

    it('formats expressive narration tier failures with a fix suggestion', async () => {
      process.argv = [
        'node',
        'cli.js',
        'record',
        '--config',
        'test-fixtures/record-upload.config.ts',
      ]
      mockReaddir.mockResolvedValue(['failed-video'])
      mockReadFile.mockImplementation(async (path: string | URL) => {
        const pathString = String(path)
        if (pathString.endsWith('package.json')) {
          return JSON.stringify({ version: '0.0.32' })
        }
        if (pathString.endsWith('record-upload.config.ts')) {
          return "export default { projectName: 'Test Project' }"
        }
        if (pathString.endsWith('data.json')) {
          return JSON.stringify({
            events: [],
            metadata: { videoName: 'Find ScreenCI docs and getting started' },
          })
        }
        return ''
      })
      mockExistsSync.mockImplementation(
        (path: string) =>
          path.endsWith('test-fixtures/record-upload.config.ts') ||
          path.endsWith('data.json') ||
          path.endsWith('recording.mp4')
      )
      mockFetch.mockImplementation(async (input: string | URL) => {
        const url = String(input)
        if (url.endsWith('/cli/upload/start')) {
          return {
            ok: false,
            status: 402,
            json: vi.fn().mockResolvedValue({}),
            text: vi
              .fn()
              .mockResolvedValue(
                'Expressive narration and style prompts require the Business tier. Upgrade your subscription tier at https://app.screenci.com/billing to continue rendering.'
              ),
          }
        }

        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({}),
          text: vi.fn().mockResolvedValue(''),
        }
      })
      mockSpawn.mockImplementation(() => {
        process.nextTick(() => mockChildProcess.emit('close', 0))
        return mockChildProcess as unknown as ChildProcess
      })

      const { main } = await import('./cli')

      await expect(main()).rejects.toThrow(
        'Not all recordings succeeded to upload.'
      )

      expect(loggerWarnSpy).toHaveBeenCalledWith(
        "Find ScreenCI docs and getting started: Expressive narration and style prompts require the Business tier. Upgrade your subscription tier at https://app.screenci.com/billing to continue rendering.\nIf you want to keep using the current tier, remove `voice.style` or `modelType: 'expressive'` from `createNarration()`."
      )
    })

    it('reports when all recordings failed', async () => {
      process.argv = [
        'node',
        'cli.js',
        'record',
        '--config',
        'test-fixtures/record-upload-all-or-nothing.config.js',
      ]
      mockReaddir.mockResolvedValue(['failed-video'])
      mockExistsSync.mockImplementation((path: string) =>
        path.endsWith('test-fixtures/record-upload-all-or-nothing.config.js')
      )
      mockSpawn.mockImplementation(() => {
        process.nextTick(() => mockChildProcess.emit('close', 1))
        return mockChildProcess as unknown as ChildProcess
      })

      const { main } = await import('./cli')

      await expect(main()).rejects.toThrow('Playwright exited with code 1')

      const messages = loggerInfoSpy.mock.calls.map((call) => String(call[0]))
      expect(messages).toContain('All recordings failed.')
      expect(messages).not.toContain(
        'Some recordings failed, skipping upload because record.upload is "all-or-nothing".'
      )
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
        'Error: screenci.config.ts not found in current directory'
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

      const { main } = await import('./cli')

      await expect(main()).rejects.toThrow('Playwright exited with code 1')

      expect(loggerInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining('screenci test --mock-record')
      )
      expect(loggerInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'https://screenci.com/docs/reference/cli/#--mock-record'
        )
      )
    })
  })

  describe('project info commands', () => {
    it('should print project info JSON for info', async () => {
      process.argv = [
        'node',
        'cli.js',
        'info',
        '--config',
        'test-fixtures/screenci.config.ts',
      ]
      process.env.SCREENCI_SECRET = 'test-secret'
      const stdoutSpy = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation(() => true)
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          projectName: 'Test Project',
          videos: [{ id: 'video_123', name: 'Demo', isPublic: false }],
        }),
        text: vi.fn().mockResolvedValue(''),
      })

      const { main } = await import('./cli')
      await main()

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/cli/project-info?projectName=Test+Project'),
        expect.objectContaining({
          headers: { 'X-ScreenCI-Secret': 'test-secret' },
        })
      )
      expect(stdoutSpy).toHaveBeenCalledWith(
        `${JSON.stringify(
          {
            projectName: 'Test Project',
            videos: [{ id: 'video_123', name: 'Demo', isPublic: false }],
          },
          null,
          2
        )}\n`
      )

      stdoutSpy.mockRestore()
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

    it('should launch Playwright through cmd.exe on Windows', async () => {
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
          'cmd.exe',
          expect.arrayContaining(['/d', '/s', '/c']),
          expect.objectContaining({
            stdio: 'inherit',
            windowsVerbatimArguments: true,
          })
        )
      } finally {
        platformSpy.mockRestore()
      }
    })
  })

  describe('dev URL helpers', () => {
    it('should use DEV_BACKEND_PORT for local backend uploads', async () => {
      process.env.DEV_BACKEND_PORT = '8787'

      const { getDevBackendUrl } = await import('./cli')

      expect(getDevBackendUrl()).toBe('http://localhost:8787')
    })

    it('should use DEV_FRONTEND_PORT for local frontend auth and links', async () => {
      process.env.DEV_FRONTEND_PORT = '5173'

      const { getDevFrontendUrl } = await import('./cli')

      expect(getDevFrontendUrl()).toBe('http://localhost:5173')
    })

    it('should open browser via cmd start on Windows during auth flow', async () => {
      const platformSpy = vi
        .spyOn(process, 'platform', 'get')
        .mockReturnValue('win32')

      mockCreateHttpServer.mockImplementation(
        (handler: (req: unknown, res: unknown) => void) => {
          const server = {
            listen: vi.fn((_port: number, _host: string, cb: () => void) => {
              cb()
              const req = { url: '/callback?secret=auth-secret-123' }
              const res = {
                writeHead: vi.fn(),
                end: vi.fn(),
              }
              handler(req, res)
            }),
            close: vi.fn(),
            address: vi.fn().mockReturnValue({ port: 12345 }),
            on: vi.fn(),
          }
          return server
        }
      )

      const { ensureScreenciSecret } = await import('./cli')
      await ensureScreenciSecret()

      expect(mockSpawn).toHaveBeenCalledWith(
        'cmd',
        ['/c', 'start', '', expect.stringContaining('cli-auth?callback=')],
        expect.objectContaining({
          detached: true,
          stdio: 'ignore',
          shell: true,
        })
      )

      platformSpy.mockRestore()
    })

    it('should warn instead of throwing when browser open fails', async () => {
      mockSpawn.mockImplementation(() => {
        throw new Error('spawn failed')
      })
      mockCreateHttpServer.mockImplementation(
        (handler: (req: unknown, res: unknown) => void) => {
          const server = {
            listen: vi.fn((_port: number, _host: string, cb: () => void) => {
              cb()
              const req = { url: '/callback?secret=auth-secret-123' }
              const res = {
                writeHead: vi.fn(),
                end: vi.fn(),
              }
              handler(req, res)
            }),
            close: vi.fn(),
            address: vi.fn().mockReturnValue({ port: 12345 }),
            on: vi.fn(),
          }
          return server
        }
      )

      const { ensureScreenciSecret } = await import('./cli')
      await expect(ensureScreenciSecret()).resolves.toBe('auth-secret-123')

      expect(loggerWarnSpy).toHaveBeenCalledWith(
        'Failed to open browser automatically:',
        expect.any(Error)
      )
    })

    it('should save the secret to the configured envFile path', async () => {
      mockReadFile.mockImplementation(async (path: string | URL) => {
        if (String(path).endsWith('screenci.config.ts')) {
          return "export default defineConfig({ projectName: 'Test Project', envFile: '../shared/.env.local' })"
        }
        if (String(path).endsWith('package.json')) {
          return JSON.stringify({ version: '0.0.32' })
        }
        return ''
      })
      mockCreateHttpServer.mockImplementation(
        (handler: (req: unknown, res: unknown) => void) => {
          const server = {
            listen: vi.fn((_port: number, _host: string, cb: () => void) => {
              cb()
              const req = { url: '/callback?secret=auth-secret-123' }
              const res = {
                writeHead: vi.fn(),
                end: vi.fn(),
              }
              handler(req, res)
            }),
            close: vi.fn(),
            address: vi.fn().mockReturnValue({ port: 12345 }),
            on: vi.fn(),
          }
          return server
        }
      )

      const { ensureScreenciSecret } = await import('./cli')

      await expect(
        ensureScreenciSecret('/workspace/demo/screenci.config.ts')
      ).resolves.toBe('auth-secret-123')

      expect(mockWriteFile).toHaveBeenCalledWith(
        '/workspace/shared/.env.local',
        'SCREENCI_SECRET=auth-secret-123\n'
      )
      expect(mockAppendFile).not.toHaveBeenCalledWith(
        '/workspace/shared/.env.local',
        expect.any(String)
      )
    })
  })

  describe('login command', () => {
    it('prints the login URL before opening the browser with --open', async () => {
      process.argv = ['node', 'cli.js', 'login', '--open']
      mockCreateHttpServer.mockImplementation(
        (handler: (req: unknown, res: unknown) => void) => {
          const server = {
            listen: vi.fn((_port: number, _host: string, cb: () => void) => {
              cb()
              const req = { url: '/callback?secret=auth-secret-123' }
              const res = { writeHead: vi.fn(), end: vi.fn() }
              handler(req, res)
            }),
            close: vi.fn(),
            address: vi.fn().mockReturnValue({ port: 12345 }),
            on: vi.fn(),
          }
          return server
        }
      )

      const { main } = await import('./cli')
      await main()

      const urlLogOrder = loggerInfoSpy.mock.invocationCallOrder.find(
        (_callOrder, index) =>
          String(loggerInfoSpy.mock.calls[index]?.[0]).includes(
            'cli-auth?callback='
          )
      )
      const openOrder = mockSpawn.mock.invocationCallOrder[0]

      expect(urlLogOrder).toBeTypeOf('number')
      expect(openOrder).toBeTypeOf('number')
      expect((urlLogOrder ?? 0) < (openOrder ?? 0)).toBe(true)
      expect(mockConfirm).not.toHaveBeenCalled()
    })

    it('prompts instead of auto-opening by default', async () => {
      process.argv = ['node', 'cli.js', 'login']
      mockConfirm.mockResolvedValue(false)
      mockCreateHttpServer.mockImplementation(
        (handler: (req: unknown, res: unknown) => void) => {
          const server = {
            listen: vi.fn((_port: number, _host: string, cb: () => void) => {
              cb()
              const req = { url: '/callback?secret=auth-secret-123' }
              const res = { writeHead: vi.fn(), end: vi.fn() }
              handler(req, res)
            }),
            close: vi.fn(),
            address: vi.fn().mockReturnValue({ port: 12345 }),
            on: vi.fn(),
          }
          return server
        }
      )

      const { main } = await import('./cli')
      await main()

      expect(mockConfirm).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Open this link in your browser now?',
          default: false,
        }),
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        })
      )
      expect(mockSpawn).not.toHaveBeenCalledWith(
        expect.stringMatching(/cmd|open|xdg-open/),
        expect.anything(),
        expect.anything()
      )
      expect(loggerInfoSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('Browser not opened.')
      )
      expect(loggerInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining('Open this link to log in to ScreenCI:\n')
      )
      expect(loggerInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining('\nhttps://app.screenci.com/cli-auth?callback=')
      )
    })

    it('opens the browser immediately with --open', async () => {
      process.argv = ['node', 'cli.js', 'login', '--open']
      mockCreateHttpServer.mockImplementation(
        (handler: (req: unknown, res: unknown) => void) => {
          const server = {
            listen: vi.fn((_port: number, _host: string, cb: () => void) => {
              cb()
              const req = { url: '/callback?secret=auth-secret-123' }
              const res = { writeHead: vi.fn(), end: vi.fn() }
              handler(req, res)
            }),
            close: vi.fn(),
            address: vi.fn().mockReturnValue({ port: 12345 }),
            on: vi.fn(),
          }
          return server
        }
      )

      const { main } = await import('./cli')
      await main()

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.stringMatching(/open|xdg-open/),
        [expect.stringContaining('cli-auth?callback=')],
        expect.objectContaining({
          detached: true,
          stdio: 'ignore',
        })
      )
      expect(mockConfirm).not.toHaveBeenCalled()
    })

    it('saves the secret to project .env when envFile is not configured', async () => {
      process.argv = ['node', 'cli.js', 'login', '--open']
      mockCreateHttpServer.mockImplementation(
        (handler: (req: unknown, res: unknown) => void) => {
          const server = {
            listen: vi.fn((_port: number, _host: string, cb: () => void) => {
              cb()
              const req = { url: '/callback?secret=auth-secret-123' }
              const res = { writeHead: vi.fn(), end: vi.fn() }
              handler(req, res)
            }),
            close: vi.fn(),
            address: vi.fn().mockReturnValue({ port: 12345 }),
            on: vi.fn(),
          }
          return server
        }
      )

      const { main } = await import('./cli')
      await main()

      expect(mockWriteFile).toHaveBeenCalledWith(
        `${process.cwd()}/.env`,
        'SCREENCI_SECRET=auth-secret-123\n'
      )
    })

    it('replaces an existing SCREENCI_SECRET line in the target env file', async () => {
      process.argv = ['node', 'cli.js', 'login', '--open']
      mockReadFile.mockImplementation(async (path: string | URL) => {
        const pathString = String(path)
        if (pathString.endsWith('screenci.config.ts')) {
          return "export default defineConfig({ projectName: 'Test Project' })"
        }
        if (pathString.endsWith('/.env')) {
          return 'SCREENCI_SECRET=old-secret\nFOO=bar\n'
        }
        if (pathString.endsWith('package.json')) {
          return JSON.stringify({ version: '0.0.32' })
        }
        return ''
      })
      mockCreateHttpServer.mockImplementation(
        (handler: (req: unknown, res: unknown) => void) => {
          const server = {
            listen: vi.fn((_port: number, _host: string, cb: () => void) => {
              cb()
              const req = { url: '/callback?secret=auth-secret-123' }
              const res = { writeHead: vi.fn(), end: vi.fn() }
              handler(req, res)
            }),
            close: vi.fn(),
            address: vi.fn().mockReturnValue({ port: 12345 }),
            on: vi.fn(),
          }
          return server
        }
      )

      const { main } = await import('./cli')
      await main()

      expect(mockWriteFile).toHaveBeenCalledWith(
        `${process.cwd()}/.env`,
        'SCREENCI_SECRET=auth-secret-123\nFOO=bar\n'
      )
    })

    it('does not rewrite files when SCREENCI_SECRET is already configured', async () => {
      process.argv = ['node', 'cli.js', 'login', '--open']
      process.env.SCREENCI_SECRET = 'already-set'

      const { main } = await import('./cli')
      await main()

      expect(loggerInfoSpy).toHaveBeenCalledWith(
        'SCREENCI_SECRET is already configured.'
      )
      expect(mockCreateHttpServer).not.toHaveBeenCalled()
      expect(mockWriteFile).not.toHaveBeenCalled()
    })

    it('reports a missing-secret callback clearly', async () => {
      process.argv = ['node', 'cli.js', 'login', '--open']
      mockCreateHttpServer.mockImplementation(
        (handler: (req: unknown, res: unknown) => void) => {
          const server = {
            listen: vi.fn((_port: number, _host: string, cb: () => void) => {
              cb()
              const req = { url: '/callback' }
              const res = { writeHead: vi.fn(), end: vi.fn() }
              handler(req, res)
            }),
            close: vi.fn(),
            address: vi.fn().mockReturnValue({ port: 12345 }),
            on: vi.fn(),
          }
          return server
        }
      )

      const { main } = await import('./cli')
      await main()

      expect(loggerWarnSpy).toHaveBeenCalledWith(
        'Authentication failed: No secret received in callback'
      )
      expect(loggerInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining('https://app.screenci.com/secrets')
      )
      expect(loggerInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'https://screenci.com/docs/reference/cli/#screenci-login'
        )
      )
      expect(mockWriteFile).not.toHaveBeenCalled()
    })

    it('reports timeout clearly without writing files', async () => {
      process.argv = ['node', 'cli.js', 'login', '--open']
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout').mockImplementation(((
        callback: TimerHandler
      ) => {
        if (typeof callback === 'function') callback()
        return 1 as unknown as ReturnType<typeof setTimeout>
      }) as typeof setTimeout)
      mockCreateHttpServer.mockReturnValue({
        listen: vi.fn((_port: number, _host: string, cb: () => void) => cb()),
        close: vi.fn(),
        address: vi.fn().mockReturnValue({ port: 12345 }),
        on: vi.fn(),
      })

      const { main } = await import('./cli')
      await main()

      expect(loggerWarnSpy).toHaveBeenCalledWith(
        'Authentication failed: Authentication timed out after 15 minutes'
      )
      expect(loggerInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining('https://app.screenci.com/secrets')
      )
      expect(loggerInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'https://screenci.com/docs/reference/cli/#screenci-login'
        )
      )
      expect(mockWriteFile).not.toHaveBeenCalled()
      setTimeoutSpy.mockRestore()
    })
  })

  describe('config loading', () => {
    it('should convert Windows config paths to file URLs for dynamic import', async () => {
      const platformSpy = vi
        .spyOn(process, 'platform', 'get')
        .mockReturnValue('win32')

      const { getConfigModuleSpecifier } = await import('./cli')

      expect(getConfigModuleSpecifier('D:\\repo\\screenci.config.ts')).toBe(
        'file:///D:/repo/screenci.config.ts'
      )

      platformSpy.mockRestore()
    })
  })

  describe('config literal parsing', () => {
    it('should extract quoted config literals', async () => {
      const { extractConfigStringLiteral } = await import('./cli')
      const configSource = `export default defineConfig({\n  projectName: 'Quoted Project',\n  envFile: \".env.local\",\n})`

      expect(extractConfigStringLiteral(configSource, 'projectName')).toBe(
        'Quoted Project'
      )
      expect(extractConfigStringLiteral(configSource, 'envFile')).toBe(
        '.env.local'
      )
    })

    it('should extract template literal values', async () => {
      const { extractConfigStringLiteral } = await import('./cli')
      const configSource = 'export default defineConfig({ envFile: `./.env` })'

      expect(extractConfigStringLiteral(configSource, 'envFile')).toBe('./.env')
    })

    it('should extract record upload policy literals', async () => {
      const { extractRecordUploadPolicyLiteral } = await import('./cli')
      const configSource = `export default defineConfig({
  projectName: 'Quoted Project',
  record: {
    upload: 'all-or-nothing',
  },
})`

      expect(extractRecordUploadPolicyLiteral(configSource)).toBe(
        'all-or-nothing'
      )
    })
  })

  describe('upload annotation helpers', () => {
    it('should print upload start failures exactly as returned by backend', async () => {
      const stderrWriteSpy = vi
        .spyOn(process.stderr, 'write')
        .mockImplementation(() => true)
      const { printUploadStartFailureMessage } = await import('./cli')

      printUploadStartFailureMessage(
        'Demo Video',
        400,
        'Please update screenci to version 0.0.23 or later.',
        'test-secret'
      )

      expect(stderrWriteSpy).toHaveBeenCalledWith(
        'Please update screenci to version 0.0.23 or later.\n'
      )
      expect(loggerWarnSpy).not.toHaveBeenCalled()

      stderrWriteSpy.mockRestore()
    })

    it('should allow missing voice entries when annotating cue translations', async () => {
      const { annotateRecordingDataWithAssetHashes, stripVoicePath } =
        await import('./cli')

      expect(stripVoicePath('fi.Selma' as VoiceKey)).toBe('fi.Selma')
      expect(
        stripVoicePath({
          assetHash: 'abc123',
          assetPath: '../assets/custom-voice.mp3',
        })
      ).toEqual({ assetHash: 'abc123' })

      expect(
        annotateRecordingDataWithAssetHashes(
          {
            events: [
              {
                type: 'cueStart',
                timeMs: 0,
                name: 'intro',
                // intentionally missing `voice` to test runtime handling of partial data
                translations: {
                  fi: { text: 'Hei' },
                },
              },
            ],
          } as unknown as RecordingData,
          []
        )
      ).toEqual({
        events: [
          {
            type: 'cueStart',
            timeMs: 0,
            name: 'intro',
            translations: {
              fi: {
                text: 'Hei',
              },
            },
          },
        ],
      })
    })

    it('should pause stdin when removing the upload abort listener', async () => {
      const { attachUploadAbortStdinListener } = await import('./cli')
      const input = new EventEmitter() as EventEmitter & {
        pause: ReturnType<typeof vi.fn>
      }
      input.pause = vi.fn()
      const onAbort = vi.fn()

      const cleanup = attachUploadAbortStdinListener(
        input as unknown as Pick<NodeJS.ReadStream, 'on' | 'off' | 'pause'>,
        onAbort
      )

      input.emit('data', Buffer.from([0x03]))
      expect(onAbort).toHaveBeenCalledWith('SIGINT')

      cleanup()

      expect(input.pause).toHaveBeenCalledTimes(1)
      expect(input.listenerCount('data')).toBe(0)
    })
  })

  describe('init command', () => {
    beforeEach(() => {
      mockSpawn.mockImplementation((_command: string, args: string[]) => {
        if (Array.isArray(args) && args[0] === '--version') {
          process.nextTick(() => {
            mockChildProcess.stdout.emit('data', '11.0.8\n')
            mockChildProcess.emit('close', 0)
          })
          return mockChildProcess as unknown as ChildProcess
        }

        process.nextTick(() => mockChildProcess.emit('close', 0))
        return mockChildProcess as unknown as ChildProcess
      })
      process.env.SCREENCI_SECRET = 'test-secret'
    })

    it('writes init files directly into the current directory', async () => {
      process.argv = ['node', 'cli.js', 'init', 'My Project']
      process.env.SCREENCI_INIT_CWD = '/workspace/my-app'
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')
      await main()

      expect(mockMkdir).toHaveBeenCalledWith('/workspace/my-app/videos', {
        recursive: true,
      })
      expect(mockWriteFile).toHaveBeenCalledWith(
        '/workspace/my-app/screenci.config.ts',
        expect.stringContaining('"My Project"')
      )
      expect(mockWriteFile).toHaveBeenCalledWith(
        '/workspace/my-app/screenci.config.ts',
        expect.stringContaining('workers: process.env.CI ? 1 : undefined')
      )
      expect(mockWriteFile).toHaveBeenCalledWith(
        '/workspace/my-app/screenci.config.ts',
        expect.stringContaining('fullyParallel: true')
      )
      expect(mockWriteFile).toHaveBeenCalledWith(
        '/workspace/my-app/videos/example.video.ts',
        expect.stringContaining("video('How to find docs'")
      )
      expect(mockWriteFile).toHaveBeenCalledWith(
        '/workspace/my-app/videos/example.video.ts',
        expect.stringContaining("await page.goto('https://screenci.com/')")
      )
      expect(mockWriteFile).not.toHaveBeenCalledWith(
        '/workspace/my-app/tsconfig.json',
        expect.any(String)
      )
      expect(mockWriteFile).not.toHaveBeenCalledWith(
        '/workspace/my-app/.env',
        ''
      )
      expect(mockWriteFile).toHaveBeenCalledWith(
        '/workspace/my-app/package.json',
        '{\n  "type": "module"\n}\n'
      )
      expect(mockWriteFile).toHaveBeenCalledWith(
        '/workspace/my-app/.gitignore',
        expect.stringContaining('# ScreenCI')
      )
      expect(mockWriteFile).toHaveBeenCalledWith(
        '/workspace/my-app/.gitignore',
        expect.stringContaining('# Playwright')
      )
      expect(mockWriteFile).toHaveBeenCalledWith(
        '/workspace/my-app/.gitignore',
        expect.stringContaining(
          'node_modules/\n/test-results/\n/playwright-report/\n/blob-report/\n/playwright/.cache/\n/playwright/.auth/'
        )
      )
      expectNpmDevInstalls(mockSpawn, '/workspace/my-app')
      expect(loggerInfoSpy).toHaveBeenCalledWith(
        `${pc.green('✔ Success!')} Created a ScreenCI project at /workspace/my-app`
      )
    })

    it('uses adding labels for successful init spinners', async () => {
      process.argv = ['node', 'cli.js', 'init', 'My Project']
      process.env.SCREENCI_INIT_CWD = '/workspace/my-app'
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')
      await main()

      expect(mockSpinner.succeed).toHaveBeenCalledWith(
        'Installing selected AI skills'
      )
      expect(mockSpinner.succeed).toHaveBeenCalledWith(
        'Installing Playwright Test'
      )
      expect(mockSpinner.succeed).toHaveBeenCalledWith('Installing ScreenCI')
      expect(mockSpinner.succeed).toHaveBeenCalledWith(
        'Installing Node.js types'
      )
      expect(mockSpinner.succeed).toHaveBeenCalledWith(
        'Installing playwright-cli'
      )
      expect(mockSpinner.succeed).not.toHaveBeenCalledWith(
        'Selected AI skills added'
      )
    })

    it('uses the current directory basename as the default project name', async () => {
      process.argv = ['node', 'cli.js', 'init']
      process.env.SCREENCI_INIT_CWD = '/workspace/screenci-docs'
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')
      await main()

      expect(mockInput).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Project name:',
          default: 'screenci-docs',
        })
      )
      expect(mockWriteFile).toHaveBeenCalledWith(
        '/workspace/screenci-docs/screenci.config.ts',
        expect.stringContaining('"screenci-docs"')
      )
    })

    it('appends to an existing .gitignore instead of overwriting it', async () => {
      process.argv = ['node', 'cli.js', 'init', 'My Project']
      process.env.SCREENCI_INIT_CWD = '/workspace/my-app'
      mockExistsSync.mockImplementation((path: string) => {
        const pathString = String(path)
        if (pathString === '/workspace/my-app/.gitignore') {
          return true
        }
        return false
      })
      mockReadFile.mockImplementation(async (path: string | URL) => {
        if (String(path).endsWith('/workspace/my-app/.gitignore')) {
          return 'dist/'
        }
        if (String(path).endsWith('package.json')) {
          return JSON.stringify({ version: '0.0.32' })
        }
        return ''
      })

      const { main } = await import('./cli')
      await main()

      expect(mockWriteFile).not.toHaveBeenCalledWith(
        '/workspace/my-app/.gitignore',
        expect.any(String)
      )
      expect(mockAppendFile).toHaveBeenCalledWith(
        '/workspace/my-app/.gitignore',
        expect.stringContaining('\n\n# ScreenCI')
      )
      expect(mockAppendFile).toHaveBeenCalledWith(
        '/workspace/my-app/.gitignore',
        expect.stringContaining(
          '# Playwright\nnode_modules/\n/test-results/\n/playwright-report/\n/blob-report/\n/playwright/.cache/\n/playwright/.auth/'
        )
      )
    })

    it('does not rewrite an existing package.json and installs dependencies directly', async () => {
      process.argv = ['node', 'cli.js', 'init', 'My Project']
      process.env.SCREENCI_INIT_CWD = '/workspace/my-app'
      mockExistsSync.mockImplementation((path: string) => {
        const pathString = String(path)
        if (pathString === '/workspace/my-app/package.json') {
          return true
        }
        return false
      })

      const { main } = await import('./cli')
      await main()

      expect(mockWriteFile).not.toHaveBeenCalledWith(
        '/workspace/my-app/package.json',
        expect.any(String)
      )
      expectNpmDevInstalls(mockSpawn, '/workspace/my-app')
      expect(loggerInfoSpy).not.toHaveBeenCalledWith('  package.json')
    })

    it('prompts in the new order with the new wording', async () => {
      process.argv = ['node', 'cli.js', 'init']
      process.env.SCREENCI_INIT_CWD = '/workspace/demo-app'
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')
      await main()

      expect(mockInput).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Project name:',
          default: 'demo-app',
        })
      )
      expect(mockInput.mock.calls.map((call) => call[0])).toEqual([
        expect.objectContaining({
          message: 'Project name:',
          default: 'demo-app',
        }),
        expect.objectContaining({
          message: 'Add a GitHub Actions workflow? (Y/n)',
          default: 'y',
        }),
        expect.objectContaining({
          message:
            "Install Playwright browsers (can be done manually via 'npx playwright install chromium')? (Y/n)",
          default: 'y',
        }),
        expect.objectContaining({
          message:
            "Install Playwright operating system dependencies (might require sudo / root and can be done manually via 'npx playwright install-deps chromium')? (y/N)",
          default: 'n',
        }),
        expect.objectContaining({
          message:
            "Install the ScreenCI skill for AI agents (can be done manually via 'npx skills add screenci/screenci --skill screenci -y')? (Y/n)",
          default: 'y',
        }),
        expect.objectContaining({
          message:
            "Install playwright-cli for URL-based browser inspection (can be done manually via 'npx skills add screenci/screenci --skill playwright-cli -y && npm install @playwright/cli')? (Y/n)",
          default: 'y',
        }),
      ])
    })

    it('uses default answers with --yes', async () => {
      process.argv = ['node', 'cli.js', 'init', '--yes']
      process.env.SCREENCI_INIT_CWD = '/workspace/demo-app'
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')
      await main()

      expect(mockInput).not.toHaveBeenCalled()
      expect(mockWriteFile).toHaveBeenCalledWith(
        '/workspace/demo-app/.github/workflows/screenci.yaml',
        expect.any(String)
      )
      expect(mockSpawn).toHaveBeenCalledWith(
        'npm',
        [
          'exec',
          '--yes',
          '--package=skills',
          '--',
          'skills',
          'add',
          'screenci/screenci',
          '--skill',
          'screenci',
          '--skill',
          'playwright-cli',
          '-y',
        ],
        expect.objectContaining({ cwd: '/workspace/demo-app', stdio: 'pipe' })
      )
      expectNpmDevInstalls(mockSpawn, '/workspace/demo-app')
      expect(mockSpawn).toHaveBeenCalledWith(
        'npx',
        ['playwright', 'install', 'chromium'],
        expect.objectContaining({
          cwd: '/workspace/demo-app',
          stdio: 'inherit',
        })
      )
      expect(mockSpawn).not.toHaveBeenCalledWith(
        'npx',
        ['playwright', 'install-deps', 'chromium'],
        expect.anything()
      )
    })

    it('creates the workflow for the current-directory layout', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project']
      process.env.SCREENCI_INIT_CWD = '/workspace/my-project'
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')
      await main()

      const workflowCall = mockWriteFile.mock.calls.find(
        (call: unknown[]) =>
          typeof call[0] === 'string' && call[0].endsWith('screenci.yaml')
      )
      expect(workflowCall?.[0]).toBe(
        '/workspace/my-project/.github/workflows/screenci.yaml'
      )
      expect(workflowCall?.[1]).toContain('working-directory: .')
      expect(workflowCall?.[1]).toContain(
        'cache-dependency-path: package-lock.json'
      )
      expect(workflowCall?.[1]).toContain("hashFiles('package-lock.json')")
      expect(workflowCall?.[1]).toContain(
        'Copy it from https://app.screenci.com/secrets or ./.env'
      )
      expect(workflowCall?.[1]).toContain(
        'run: npx playwright install chromium'
      )
      expect(workflowCall?.[1]).not.toContain('--with-deps')
    })

    it('supports pnpm init flows end to end', async () => {
      process.argv = [
        'node',
        'cli.js',
        'init',
        'my-project',
        '--package-manager',
        'pnpm',
        '--yes',
      ]
      process.env.SCREENCI_INIT_CWD = '/workspace/my-project'
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')
      await main()

      expectPnpmDevInstalls(mockSpawn, '/workspace/my-project')
      expect(mockSpawn).toHaveBeenCalledWith(
        'pnpm',
        ['exec', 'playwright', 'install', 'chromium'],
        expect.objectContaining({
          cwd: '/workspace/my-project',
          stdio: 'inherit',
        })
      )
      expect(mockWriteFile).not.toHaveBeenCalledWith(
        '/workspace/my-project/README.md',
        expect.any(String)
      )
      const workflowCall = mockWriteFile.mock.calls.find(
        (call: unknown[]) =>
          typeof call[0] === 'string' && call[0].endsWith('screenci.yaml')
      )
      expect(workflowCall?.[1]).toContain('cache: pnpm')
      expect(workflowCall?.[1]).toContain(
        'cache-dependency-path: pnpm-lock.yaml'
      )
      expect(workflowCall?.[1]).toContain('HUSKY: 0')
      expect(workflowCall?.[1]).toContain('npm_config_strict_dep_builds: false')
      expect(workflowCall?.[1]).toContain('run: pnpm install --frozen-lockfile')
      expect(workflowCall?.[1]).toContain("hashFiles('pnpm-lock.yaml')")
      expect(workflowCall?.[1]).toContain(
        'run: pnpm exec playwright install chromium'
      )
      expect(workflowCall?.[1]).toContain('run: pnpm exec screenci record')
    })

    it('defaults to pnpm when invoked from a pnpm user agent', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project', '--yes']
      process.env.SCREENCI_INIT_CWD = '/workspace/my-project'
      process.env.npm_config_user_agent = 'pnpm/11.0.8 npm/? node/v24.0.0'
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')
      await main()

      expectPnpmDevInstalls(mockSpawn, '/workspace/my-project')
      expect(mockWriteFile).not.toHaveBeenCalledWith(
        '/workspace/my-project/README.md',
        expect.any(String)
      )
    })

    it('adds @playwright/cli only when selected', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project']
      process.env.SCREENCI_INIT_CWD = '/workspace/my-project'
      mockExistsSync.mockReturnValue(false)
      mockInput
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('n')

      const { main } = await import('./cli')
      await main()

      expect(mockSpawn).not.toHaveBeenCalledWith(
        'npm',
        ['install', '--save-dev', '@playwright/cli@latest'],
        expect.anything()
      )
    })

    it('uses the configured screenci dependency override verbatim', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project']
      process.env.SCREENCI_INIT_CWD = '/workspace/my-project'
      process.env.SCREENCI_INIT_SCREENCI_DEPENDENCY =
        'file:./screenci-0.0.44.tgz'
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')
      await main()

      expect(mockSpawn).toHaveBeenCalledWith(
        'npm',
        ['install', '--save-dev', 'screenci@file:./screenci-0.0.44.tgz'],
        expect.objectContaining({ cwd: '/workspace/my-project', stdio: 'pipe' })
      )
    })

    it('keeps ScreenCI skill and playwright-cli prompts separate', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project']
      process.env.SCREENCI_INIT_CWD = '/workspace/my-project'
      mockExistsSync.mockReturnValue(false)
      mockInput
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('n')
        .mockResolvedValueOnce('y')

      const { main } = await import('./cli')
      await main()

      expect(mockSpawn).toHaveBeenCalledWith(
        'npm',
        [
          'exec',
          '--yes',
          '--package=skills',
          '--',
          'skills',
          'add',
          'screenci/screenci',
          '--skill',
          'playwright-cli',
          '-y',
        ],
        expect.objectContaining({ cwd: '/workspace/my-project', stdio: 'pipe' })
      )
      expect(mockSpawn).toHaveBeenCalledWith(
        'npm',
        ['install', '--save-dev', '@playwright/cli@latest'],
        expect.objectContaining({ cwd: '/workspace/my-project', stdio: 'pipe' })
      )
    })

    it('passes --agent through to the executed skills command', async () => {
      process.argv = [
        'node',
        'cli.js',
        'init',
        'my-project',
        '--agent',
        'opencode',
      ]
      process.env.SCREENCI_INIT_CWD = '/workspace/my-project'
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')
      await main()

      expect(mockSpawn).toHaveBeenCalledWith(
        'npm',
        expect.arrayContaining(['--agent', 'opencode']),
        expect.objectContaining({ cwd: '/workspace/my-project' })
      )
    })

    it('splits browser install from operating system dependencies', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project']
      process.env.SCREENCI_INIT_CWD = '/workspace/my-project'
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')
      await main()

      expect(mockSpawn).toHaveBeenCalledWith(
        'npx',
        ['playwright', 'install', 'chromium'],
        expect.objectContaining({
          cwd: '/workspace/my-project',
          stdio: 'inherit',
        })
      )
      expect(mockSpawn).not.toHaveBeenCalledWith(
        'npx',
        ['playwright', 'install-deps', 'chromium'],
        expect.anything()
      )
    })

    it('runs install-deps without sudo when selected', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project']
      process.env.SCREENCI_INIT_CWD = '/workspace/my-project'
      mockExistsSync.mockReturnValue(false)
      mockInput
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('y')
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('')

      const { main } = await import('./cli')
      await main()

      expect(mockSpawn).toHaveBeenCalledWith(
        'npx',
        ['playwright', 'install-deps', 'chromium'],
        expect.objectContaining({
          cwd: '/workspace/my-project',
          stdio: 'inherit',
        })
      )
      expect(mockSpawn).not.toHaveBeenCalledWith(
        'sudo',
        expect.anything(),
        expect.anything()
      )
    })

    it('prints Playwright-style next steps without any cd command', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project']
      process.env.SCREENCI_INIT_CWD = '/workspace/my-project'
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')
      await main()

      const rawMessages = loggerInfoSpy.mock.calls.map((call) =>
        String(call[0])
      )
      const messages = rawMessages.map((message) =>
        stripVTControlCharacters(message)
      )

      expect(rawMessages).toContain(`  ${pc.cyan('npx screenci test')}`)
      expect(messages).toContain('    Tests your video scripts fast locally.')
      expect(messages).toContain(
        '    Tests your video scripts in interactive UI mode.'
      )
      expect(rawMessages).toContain(`  ${pc.cyan('npx screenci login')}`)
      expect(messages).toContain(
        '    Saves SCREENCI_SECRET for uploads and remote rendering.'
      )
      expect(messages).toContain(
        '    Records, uploads and renders final videos after login.'
      )
      expect(rawMessages).toContain(
        'Visit ' +
          pc.cyan('https://screenci.com/docs') +
          ' for more information.'
      )
      expect(messages).toContain(
        'Inside that directory, you can run several commands:'
      )
      expect(messages).toContain('We suggest that you begin by typing:')
      expect(messages).toContain('    npx screenci test')
      expect(messages).toContain(
        '  - ./videos/example.video.ts - Example video script'
      )
      expect(messages).toContain(
        '  - ./screenci.config.ts - ScreenCI configuration'
      )
      expect(messages).not.toContain('  cd my-project')
      expect(messages.every((message) => !message.startsWith('  cd '))).toBe(
        true
      )
    })

    it('prints pnpm next steps when pnpm is selected', async () => {
      process.argv = [
        'node',
        'cli.js',
        'init',
        'my-project',
        '--package-manager',
        'pnpm',
      ]
      process.env.SCREENCI_INIT_CWD = '/workspace/my-project'
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')
      await main()

      const rawMessages = loggerInfoSpy.mock.calls.map((call) =>
        String(call[0])
      )
      const messages = rawMessages.map((message) =>
        stripVTControlCharacters(message)
      )

      expect(rawMessages).toContain(`  ${pc.cyan('pnpm exec screenci test')}`)
      expect(messages).toContain('    pnpm exec screenci test')
      expect(mockSpawn).toHaveBeenCalledWith(
        'pnpm',
        ['--version'],
        expect.objectContaining({ cwd: '/workspace/my-project', stdio: 'pipe' })
      )
      expect(mockInput.mock.calls.map((call) => call[0])).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message:
              "Install the ScreenCI skill for AI agents (can be done manually via 'pnpm dlx skills add screenci/screenci --skill screenci -y')? (Y/n)",
          }),
          expect.objectContaining({
            message:
              "Install Playwright browsers (can be done manually via 'pnpm exec playwright install chromium')? (Y/n)",
          }),
          expect.objectContaining({
            message:
              "Install playwright-cli for URL-based browser inspection (can be done manually via 'pnpm dlx skills add screenci/screenci --skill playwright-cli -y && pnpm add --save-dev @playwright/cli')? (Y/n)",
          }),
        ])
      )
    })

    it('checks pnpm version before installing screenci and uses native build approval', async () => {
      process.argv = [
        'node',
        'cli.js',
        'init',
        'my-project',
        '--package-manager',
        'pnpm',
      ]
      process.env.SCREENCI_INIT_CWD = '/workspace/my-project'
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')
      await main()

      const pnpmVersionCallIndex = mockSpawn.mock.calls.findIndex(
        (call: unknown[]) =>
          call[0] === 'pnpm' &&
          Array.isArray(call[1]) &&
          call[1][0] === '--version'
      )
      const screenciInstallCallIndex = mockSpawn.mock.calls.findIndex(
        (call: unknown[]) =>
          call[0] === 'pnpm' &&
          Array.isArray(call[1]) &&
          call[1][0] === 'add' &&
          call[1][2] === '--allow-build=ffmpeg-static'
      )

      expect(pnpmVersionCallIndex).toBeGreaterThanOrEqual(0)
      expect(screenciInstallCallIndex).toBeGreaterThan(pnpmVersionCallIndex)
      expect(mockSpawn).toHaveBeenCalledWith(
        'pnpm',
        ['add', '--save-dev', '--allow-build=ffmpeg-static', 'screenci@0.0.32'],
        expect.objectContaining({ cwd: '/workspace/my-project', stdio: 'pipe' })
      )
      expect(mockWriteFile).not.toHaveBeenCalledWith(
        '/workspace/my-project/pnpm-workspace.yaml',
        expect.any(String)
      )
      expect(mockReadFile).not.toHaveBeenCalledWith(
        '/workspace/my-project/pnpm-workspace.yaml',
        'utf-8'
      )
    })

    it('fails fast when pnpm cannot be detected', async () => {
      process.argv = [
        'node',
        'cli.js',
        'init',
        'my-project',
        '--package-manager',
        'pnpm',
      ]
      process.env.SCREENCI_INIT_CWD = '/workspace/my-project'
      mockExistsSync.mockReturnValue(false)
      mockSpawn.mockImplementation((_command: string, args: string[]) => {
        const child = Object.assign(new EventEmitter(), {
          unref: vi.fn(),
          stdout: new EventEmitter(),
          stderr: new EventEmitter(),
        })

        process.nextTick(() => {
          if (Array.isArray(args) && args[0] === '--version') {
            child.emit('error', new Error('spawn pnpm ENOENT'))
            return
          }

          child.emit('close', 0)
        })

        return child as unknown as ChildProcess
      })

      const { main } = await import('./cli')

      await expect(main()).rejects.toThrow(
        [
          'pnpm could not be detected. ScreenCI requires pnpm 10.26.0 or newer to use pnpm native --allow-build support for ffmpeg-static.',
          'Upgrade pnpm and rerun, or use `--package-manager npm`.',
          'Examples:',
          '  corepack use pnpm@latest',
          '  pnpm create screenci',
          '  npm init screenci@latest',
        ].join('\n')
      )
      expect(mockSpawn).not.toHaveBeenCalledWith(
        'pnpm',
        expect.arrayContaining(['add']),
        expect.anything()
      )
    })

    it('fails fast when pnpm is older than 10.26.0', async () => {
      process.argv = [
        'node',
        'cli.js',
        'init',
        'my-project',
        '--package-manager',
        'pnpm',
      ]
      process.env.SCREENCI_INIT_CWD = '/workspace/my-project'
      mockExistsSync.mockReturnValue(false)
      mockSpawn.mockImplementation((_command: string, args: string[]) => {
        const child = Object.assign(new EventEmitter(), {
          unref: vi.fn(),
          stdout: new EventEmitter(),
          stderr: new EventEmitter(),
        })

        process.nextTick(() => {
          if (Array.isArray(args) && args[0] === '--version') {
            child.stdout.emit('data', '10.25.9\n')
            child.emit('close', 0)
            return
          }

          child.emit('close', 0)
        })

        return child as unknown as ChildProcess
      })

      const { main } = await import('./cli')

      await expect(main()).rejects.toThrow(
        [
          'Detected pnpm 10.25.9. ScreenCI requires pnpm 10.26.0 or newer because it relies on pnpm native --allow-build support for ffmpeg-static.',
          'Upgrade pnpm and rerun, or use `--package-manager npm`.',
          'Examples:',
          '  corepack use pnpm@latest',
          '  pnpm create screenci',
          '  npm init screenci@latest',
        ].join('\n')
      )
      expect(mockSpawn).not.toHaveBeenCalledWith(
        'pnpm',
        expect.arrayContaining(['add']),
        expect.anything()
      )
    })

    it('skips pnpm version checks when npm is explicitly selected', async () => {
      process.argv = [
        'node',
        'cli.js',
        'init',
        'my-project',
        '--package-manager',
        'npm',
      ]
      process.env.SCREENCI_INIT_CWD = '/workspace/my-project'
      process.env.npm_config_user_agent = 'pnpm/11.0.8 npm/? node/v24.0.0'
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')
      await main()

      expect(mockSpawn).not.toHaveBeenCalledWith(
        'pnpm',
        ['--version'],
        expect.anything()
      )
    })

    it('fails if the workflow already exists and workflow setup is selected', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project']
      process.env.SCREENCI_INIT_CWD = '/workspace/my-project'
      mockExistsSync.mockImplementation(
        (path: string) =>
          path === '/workspace/my-project/.github/workflows/screenci.yaml'
      )

      const { main } = await import('./cli')
      await expect(main()).rejects.toThrow('process.exit called')
    })

    it('surfaces package manager stderr when an init install fails', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project']
      process.env.SCREENCI_INIT_CWD = '/workspace/my-project'
      mockExistsSync.mockReturnValue(false)

      mockSpawn.mockImplementation((command: string, args: string[]) => {
        const child = Object.assign(new EventEmitter(), {
          unref: vi.fn(),
          stdout: new EventEmitter(),
          stderr: new EventEmitter(),
        })

        process.nextTick(() => {
          if (
            command === 'npm' &&
            Array.isArray(args) &&
            args[0] === 'install' &&
            args[2] === 'screenci@0.0.32'
          ) {
            child.stderr.emit('data', 'No matching version found for screenci')
            child.emit('close', 1)
            return
          }

          child.emit('close', 0)
        })

        return child as unknown as ChildProcess
      })

      const { main } = await import('./cli')
      await expect(main()).rejects.toThrow(
        'npm exited with code 1: No matching version found for screenci'
      )
    })

    it('removes the old init-only flags from the CLI', async () => {
      process.argv = ['node', 'cli.js', 'init', '--install']
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')
      await expect(main()).rejects.toThrow('process.exit called')
    })
  })

  describe('create-screenci wrapper', () => {
    beforeEach(() => {
      mockSpawn.mockImplementation((_command: string, args: string[]) => {
        if (Array.isArray(args) && args[0] === '--version') {
          process.nextTick(() => {
            mockChildProcess.stdout.emit('data', '11.0.8\n')
            mockChildProcess.emit('close', 0)
          })
          return mockChildProcess as unknown as ChildProcess
        }

        process.nextTick(() => mockChildProcess.emit('close', 0))
        return mockChildProcess as unknown as ChildProcess
      })
      process.env.SCREENCI_SECRET = 'test-secret'
      process.env.SCREENCI_INIT_CWD = '/workspace/create-app'
      mockExistsSync.mockReturnValue(false)
    })

    it('prompts for the project name when no args are provided', async () => {
      const { runCreateScreenciCli } = await import('./src/init.js')

      await runCreateScreenciCli(['node', 'create-screenci.js'])

      expect(mockInput).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Project name:',
          default: 'create-app',
        })
      )
    })

    it('accepts the project name as the first positional argument', async () => {
      const { runCreateScreenciCli } = await import('./src/init.js')

      await runCreateScreenciCli([
        'node',
        'create-screenci.js',
        'Wrapper Project',
      ])

      expect(mockWriteFile).toHaveBeenCalledWith(
        '/workspace/create-app/screenci.config.ts',
        expect.stringContaining('"Wrapper Project"')
      )
    })

    it('supports --yes without prompting', async () => {
      const { runCreateScreenciCli } = await import('./src/init.js')

      await runCreateScreenciCli(['node', 'create-screenci.js', '--yes'])

      expect(mockInput).not.toHaveBeenCalled()
      expect(mockWriteFile).toHaveBeenCalledWith(
        '/workspace/create-app/.github/workflows/screenci.yaml',
        expect.any(String)
      )
    })

    it('uses npm installs when --package-manager npm is set', async () => {
      const { runCreateScreenciCli } = await import('./src/init.js')

      await runCreateScreenciCli([
        'node',
        'create-screenci.js',
        '--package-manager',
        'npm',
        '--yes',
      ])

      expectNpmDevInstalls(mockSpawn, '/workspace/create-app')
    })

    it('uses npm through cmd.exe when --package-manager npm is set on Windows', async () => {
      const platformSpy = vi
        .spyOn(process, 'platform', 'get')
        .mockReturnValue('win32')
      try {
        const { runCreateScreenciCli } = await import('./src/init.js')

        await runCreateScreenciCli([
          'node',
          'create-screenci.js',
          '--package-manager',
          'npm',
          '--yes',
        ])

        const installCall = mockSpawn.mock.calls.find(
          (call: unknown[]) =>
            call[0] === 'cmd.exe' &&
            Array.isArray(call[1]) &&
            (call[1] as string[])[3] ===
              '""npm.cmd" "install" "--save-dev" "@playwright/test@^1.59.0""'
        )
        expect(installCall).toEqual([
          'cmd.exe',
          [
            '/d',
            '/s',
            '/c',
            '""npm.cmd" "install" "--save-dev" "@playwright/test@^1.59.0""',
          ],
          expect.objectContaining({
            cwd: '/workspace/create-app',
            stdio: 'pipe',
            windowsVerbatimArguments: true,
          }),
        ])

        const skillsCall = mockSpawn.mock.calls.find(
          (call: unknown[]) =>
            call[0] === 'cmd.exe' &&
            Array.isArray(call[1]) &&
            (call[1] as string[])[3] ===
              '""npm.cmd" "exec" "--yes" "--package=skills" "--" "skills" "add" "screenci/screenci" "--skill" "screenci" "--skill" "playwright-cli" "-y""'
        )
        expect(skillsCall).toEqual([
          'cmd.exe',
          [
            '/d',
            '/s',
            '/c',
            '""npm.cmd" "exec" "--yes" "--package=skills" "--" "skills" "add" "screenci/screenci" "--skill" "screenci" "--skill" "playwright-cli" "-y""',
          ],
          expect.objectContaining({
            cwd: '/workspace/create-app',
            stdio: 'pipe',
            windowsVerbatimArguments: true,
          }),
        ])
      } finally {
        platformSpy.mockRestore()
      }
    })

    it('uses pnpm installs when --package-manager pnpm is set', async () => {
      const { runCreateScreenciCli } = await import('./src/init.js')

      await runCreateScreenciCli([
        'node',
        'create-screenci.js',
        '--package-manager',
        'pnpm',
        '--yes',
      ])

      expectPnpmDevInstalls(mockSpawn, '/workspace/create-app')
    })

    it('defaults to pnpm when invoked from pnpm create', async () => {
      const { runCreateScreenciCli } = await import('./src/init.js')

      process.env.npm_config_user_agent = 'pnpm/11.0.8 npm/? node/v24.0.0'

      await runCreateScreenciCli(['node', 'create-screenci.js', '--yes'])

      expectPnpmDevInstalls(mockSpawn, '/workspace/create-app')
      expect(mockWriteFile).not.toHaveBeenCalledWith(
        '/workspace/create-app/README.md',
        expect.any(String)
      )
    })

    it('passes --agent through to the skills command', async () => {
      const { runCreateScreenciCli } = await import('./src/init.js')

      await runCreateScreenciCli([
        'node',
        'create-screenci.js',
        '--agent',
        'opencode',
      ])

      const skillsCall = mockSpawn.mock.calls.find(
        (call: unknown[]) =>
          call[0] === 'npm' &&
          Array.isArray(call[1]) &&
          (call[1] as string[]).includes('--agent') &&
          (call[1] as string[]).includes('opencode')
      )

      expect(skillsCall).toEqual([
        'npm',
        expect.arrayContaining(['--agent', 'opencode']),
        expect.objectContaining({ cwd: '/workspace/create-app' }),
      ])
    })

    it('prints verbose command output when --verbose is set', async () => {
      const { runCreateScreenciCli } = await import('./src/init.js')

      await runCreateScreenciCli([
        'node',
        'create-screenci.js',
        '--verbose',
        '--yes',
      ])

      expect(loggerInfoSpy).toHaveBeenCalledWith(
        "Running 'npm exec --yes --package=skills -- skills add screenci/screenci --skill screenci --skill playwright-cli -y'..."
      )
      expect(loggerInfoSpy).toHaveBeenCalledWith(
        "Running 'npm install --save-dev @playwright/test@^1.59.0'..."
      )
    })
  })

  describe('package manager detection', () => {
    it('defaults to npm without a matching user agent', async () => {
      const { determinePackageManager } = await import('./src/init.js')

      expect(determinePackageManager()).toBe('npm')
    })

    it('detects pnpm from npm_config_user_agent', async () => {
      const { determinePackageManager } = await import('./src/init.js')

      process.env.npm_config_user_agent = 'pnpm/11.0.8 npm/? node/v24.0.0'

      expect(determinePackageManager()).toBe('pnpm')
    })
  })

  describe('disallowed flags validation', () => {
    beforeEach(() => {
      process.env.SCREENCI_SECRET = 'test-secret'
    })

    it('should allow --fully-parallel to pass through', async () => {
      process.argv = ['node', 'cli.js', 'record', '--fully-parallel']
      mockSpawn.mockImplementation(
        (
          _command: string,
          args: string[],
          _options?: { env?: NodeJS.ProcessEnv }
        ) => {
          expect(args).toContain('--fully-parallel')
          process.nextTick(() => mockChildProcess.emit('close', 0))
          return mockChildProcess as unknown as ChildProcess
        }
      )

      const { main } = await import('./cli')

      await main()
    })

    it('should allow --workers to pass through', async () => {
      process.argv = ['node', 'cli.js', 'record', '--workers', '4']
      mockSpawn.mockImplementation(
        (
          _command: string,
          args: string[],
          _options?: { env?: NodeJS.ProcessEnv }
        ) => {
          expect(args).toContain('--workers')
          expect(args).toContain('4')
          process.nextTick(() => mockChildProcess.emit('close', 0))
          return mockChildProcess as unknown as ChildProcess
        }
      )

      const { main } = await import('./cli')

      await main()
    })

    it('should allow --workers=N to pass through', async () => {
      process.argv = ['node', 'cli.js', 'record', '--workers=4']
      mockSpawn.mockImplementation(
        (
          _command: string,
          args: string[],
          _options?: { env?: NodeJS.ProcessEnv }
        ) => {
          expect(args).toContain('--workers=4')
          process.nextTick(() => mockChildProcess.emit('close', 0))
          return mockChildProcess as unknown as ChildProcess
        }
      )

      const { main } = await import('./cli')

      await main()
    })

    it('should allow -j to pass through', async () => {
      process.argv = ['node', 'cli.js', 'record', '-j', '4']
      mockSpawn.mockImplementation(
        (
          _command: string,
          args: string[],
          _options?: { env?: NodeJS.ProcessEnv }
        ) => {
          expect(args).toContain('-j')
          expect(args).toContain('4')
          process.nextTick(() => mockChildProcess.emit('close', 0))
          return mockChildProcess as unknown as ChildProcess
        }
      )

      const { main } = await import('./cli')

      await main()
    })

    it('should allow -j=N to pass through', async () => {
      process.argv = ['node', 'cli.js', 'record', '-j=4']
      mockSpawn.mockImplementation(
        (
          _command: string,
          args: string[],
          _options?: { env?: NodeJS.ProcessEnv }
        ) => {
          expect(args).toContain('-j=4')
          process.nextTick(() => mockChildProcess.emit('close', 0))
          return mockChildProcess as unknown as ChildProcess
        }
      )

      const { main } = await import('./cli')

      await main()
    })

    it('should throw error when --retries is provided', async () => {
      process.argv = ['node', 'cli.js', 'record', '--retries', '2']

      const { main } = await import('./cli')

      await expect(main()).rejects.toThrow(
        'Flag "--retries" is not supported by screenci'
      )
    })

    it('should throw error when --retries=N is provided', async () => {
      process.argv = ['node', 'cli.js', 'record', '--retries=2']

      const { main } = await import('./cli')

      await expect(main()).rejects.toThrow(
        'Flag "--retries=2" is not supported by screenci'
      )
    })

    it('should reject retries even when other parallel flags are present', async () => {
      process.argv = [
        'node',
        'cli.js',
        'record',
        '--workers',
        '4',
        '--fully-parallel',
        '--retries',
        '2',
      ]

      const { main } = await import('./cli')

      await expect(main()).rejects.toThrow(
        'Flag "--retries" is not supported by screenci'
      )
    })
  })
})
