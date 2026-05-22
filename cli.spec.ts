import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import { Readable } from 'stream'
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
const mockReaddir = vi.fn()
const mockReadFile = vi.fn()
const mockStat = vi.fn()
const mockCreateReadStream = vi.fn()
const mockAppendFile = vi.fn()
const mockWriteFile = vi.fn()
const mockMkdir = vi.fn()
const mockInput = vi.fn()
const mockConfirm = vi.fn()
const mockSelect = vi.fn()
const mockCreateHttpServer = vi.fn()
const mockFetch = vi.fn()

const mockSpinner = {
  start: vi.fn().mockReturnThis(),
  succeed: vi.fn().mockReturnThis(),
  fail: vi.fn().mockReturnThis(),
  stop: vi.fn().mockReturnThis(),
}
const mockOra = vi.fn().mockReturnValue(mockSpinner)

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
  existsSync: mockExistsSync,
  realpathSync: mockRealpathSync,
  mkdirSync: mockMkdirSync,
  rmSync: mockRmSync,
  readdirSync: mockReaddirSync,
  default: {
    existsSync: mockExistsSync,
    realpathSync: mockRealpathSync,
    mkdirSync: mockMkdirSync,
    rmSync: mockRmSync,
    readdirSync: mockReaddirSync,
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
  select: mockSelect,
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
  let loadEnvFileSpy: ReturnType<typeof vi.spyOn>
  let originalArgv: string[]
  let originalEnv: NodeJS.ProcessEnv
  let originalFetch: typeof global.fetch

  beforeEach(() => {
    // Reset all mocks (clearAllMocks only clears call history, not Once queues;
    // mockReset also clears return values/implementations including Once queue)
    vi.clearAllMocks()
    mockSpawn.mockReset()
    mockAppendFile.mockResolvedValue(undefined)
    mockWriteFile.mockResolvedValue(undefined)
    mockMkdir.mockResolvedValue(undefined)
    mockReaddir.mockResolvedValue([])
    mockReadFile.mockImplementation(async (path: string | URL) => {
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
    mockConfirm.mockResolvedValue(true)
    mockSelect.mockResolvedValue('standalone')
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
    loadEnvFileSpy = vi
      .spyOn(process, 'loadEnvFile')
      .mockImplementation((path?: string | URL) => {
        if (String(path).endsWith('.env')) {
          process.env.VITE_APP_BASE_URL = 'https://env-file.example.com'
        }
      })

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

      await uploadRecordings(
        '/repo/.screenci',
        'Test Project',
        'https://api.screenci.test',
        'test-secret'
      )

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
      expect(loggerInfoSpy).toHaveBeenCalledWith(
        'Some recordings failed, uploading successful videos only.'
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

      await uploadRecordings(
        '/repo/.screenci',
        'Test Project',
        'https://api.screenci.test',
        'test-secret'
      )

      expect(mockFetch).not.toHaveBeenCalled()
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

      expect(loggerInfoSpy).toHaveBeenCalledWith('All recordings failed.')
      expect(loggerInfoSpy).not.toHaveBeenCalledWith(
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

      expect(loadEnvFileSpy).toHaveBeenCalledWith(
        expect.stringContaining('.env')
      )
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
      loadEnvFileSpy.mockImplementation(() => {
        throw Object.assign(new Error('missing env file'), { code: 'ENOENT' })
      })
      mockSpawn.mockImplementation(() => {
        process.nextTick(() => mockChildProcess.emit('close', 0))
        return mockChildProcess as unknown as ChildProcess
      })

      const { main } = await import('./cli')
      await main()

      expect(loadEnvFileSpy).toHaveBeenCalledWith(
        expect.stringContaining('.env')
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

    it('should launch Playwright through cmd on Windows', async () => {
      process.argv = ['node', 'cli.js', 'test']
      const platformSpy = vi
        .spyOn(process, 'platform', 'get')
        .mockReturnValue('win32')

      mockSpawn.mockImplementation((_command: string) => {
        process.nextTick(() => mockChildProcess.emit('close', 0))
        return mockChildProcess as unknown as ChildProcess
      })

      const { main } = await import('./cli')
      await main()

      expect(mockSpawn).toHaveBeenCalledWith(
        'cmd',
        expect.arrayContaining([
          '/d',
          '/c',
          expect.stringContaining('playwright test'),
        ]),
        expect.objectContaining({ stdio: 'inherit' })
      )

      platformSpy.mockRestore()
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
      // npm install runs via spawnSilent (piped); make spawn emit close immediately
      mockSpawn.mockImplementation(() => {
        process.nextTick(() => mockChildProcess.emit('close', 0))
        return mockChildProcess as unknown as ChildProcess
      })
      // Default: confirm npm install
      mockConfirm.mockResolvedValue(true)
      // Pre-set SCREENCI_SECRET so auth is skipped by default in init tests
      process.env.SCREENCI_SECRET = 'test-secret'
    })

    it('should not initialize git during init', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project', '--yes']
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')
      await main()

      expect(mockSpawn).not.toHaveBeenCalledWith(
        'git',
        ['init'],
        expect.any(Object)
      )
    })

    it('should create all files inside a new standalone project directory', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project']
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')
      await main()

      expect(mockMkdir).toHaveBeenCalledWith(
        expect.stringContaining(`my-project/videos`),
        { recursive: true }
      )
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining(`my-project/screenci.config.ts`),
        expect.stringContaining('"my-project"')
      )
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining(`my-project/package.json`),
        expect.stringContaining('"record": "screenci record"')
      )
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining(`my-project/tsconfig.json`),
        expect.stringContaining('"types": [')
      )
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining(`my-project/README.md`),
        expect.stringContaining('https://screenci.com/docs/intro/')
      )
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining(`my-project/.gitignore`),
        expect.stringContaining('node_modules/')
      )
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining('example.video.ts'),
        expect.stringContaining(
          "import { autoZoom, createNarration, hide, video, voices } from 'screenci'"
        )
      )
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining('example.video.ts'),
        expect.stringContaining("video('See the next steps in ScreenCI docs'")
      )
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining('my-project/.env'),
        ''
      )
    })

    it('should add playwright-cli to devDependencies when AI authoring is confirmed', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project']
      mockExistsSync.mockReturnValue(false)
      mockConfirm.mockResolvedValueOnce(true).mockResolvedValueOnce(true)

      const { main } = await import('./cli')
      await main()

      const pkgCall = mockWriteFile.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === 'string' && c[0].endsWith('package.json')
      )
      const pkg = JSON.parse(String(pkgCall?.[1])) as {
        dependencies: Record<string, string>
        devDependencies: Record<string, string>
      }
      expect(pkg.dependencies['@playwright/test']).toBe('^1.59.0')
      expect(pkg.devDependencies['@playwright/test']).toBeUndefined()
      expect(pkgCall?.[1]).toContain('"@playwright/cli": "latest"')
    })

    it('should not add playwright-cli to devDependencies when AI authoring is declined', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project']
      mockExistsSync.mockReturnValue(false)
      mockConfirm.mockResolvedValueOnce(true)
      mockConfirm.mockResolvedValueOnce(false)

      const { main } = await import('./cli')
      await main()

      const pkgCall = mockWriteFile.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === 'string' && c[0].endsWith('package.json')
      )
      const pkg = JSON.parse(String(pkgCall?.[1])) as {
        dependencies: Record<string, string>
        devDependencies: Record<string, string>
      }
      expect(pkg.dependencies['@playwright/test']).toBe('^1.59.0')
      expect(pkg.devDependencies['@playwright/test']).toBeUndefined()
      expect(pkgCall?.[1]).not.toContain('"@playwright/cli": "latest"')
    })

    it('should not add tsx to devDependencies', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project']
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')
      await main()

      const pkgCall = mockWriteFile.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === 'string' && c[0].endsWith('package.json')
      )
      expect(pkgCall?.[1]).not.toContain('"tsx":')
      expect(pkgCall?.[1]).not.toContain('"@types/node":')
    })

    it('should create tsconfig.json with node types', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project']
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')
      await main()

      const tsconfigCall = mockWriteFile.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === 'string' && c[0].endsWith('tsconfig.json')
      )
      expect(tsconfigCall?.[1]).toContain('"types": [')
      expect(tsconfigCall?.[1]).toContain('"node"')
    })

    it('should create .github/workflows/screenci.yaml with SCREENCI_SECRET check', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project']
      mockExistsSync.mockReturnValue(false)
      mockConfirm
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)

      const { main } = await import('./cli')
      await main()

      expect(mockMkdir).toHaveBeenCalledWith(expect.stringContaining('.github'))
      expect(mockMkdir).toHaveBeenCalledWith(
        expect.stringContaining('.github/workflows')
      )
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining('.github/workflows/screenci.yaml'),
        expect.stringContaining('SCREENCI_SECRET')
      )
      const workflowCall = mockWriteFile.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === 'string' && c[0].endsWith('screenci.yaml')
      )
      expect(workflowCall?.[1]).toContain('name: ScreenCI')
      expect(workflowCall?.[1]).toContain('actions/setup-node@v4')
      expect(workflowCall?.[1]).toContain('node-version: 24')
      expect(workflowCall?.[1]).toContain('cache: npm')
      expect(workflowCall?.[1]).toContain(
        'cache-dependency-path: package-lock.json'
      )
      expect(workflowCall?.[1]).toContain('environment:\n      name: screenci')
      expect(workflowCall?.[1]).toContain(
        'url: ${{ steps.record.outputs.screenci_project_url }}'
      )
      expect(workflowCall?.[1]).toContain('- id: record\n        name: Record')
      expect(workflowCall?.[1]).toContain('working-directory: .')
      expect(workflowCall?.[1]).toContain('npm ci')
      expect(workflowCall?.[1]).toContain('actions/cache@v5')
      expect(workflowCall?.[1]).toContain('path: ~/.cache/ms-playwright')
      expect(workflowCall?.[1]).toContain(
        "if: steps.pw-cache.outputs.cache-hit != 'true'"
      )
      expect(workflowCall?.[1]).toContain(
        'npx playwright install chromium --with-deps'
      )
      expect(workflowCall?.[1]).toContain('npm run record')
      expect(workflowCall?.[1]).toContain(
        'Copy it from https://app.screenci.com/secrets or ./.env, add it under Settings → Secrets and variables → Actions → Repository secrets, and then rerun this action.'
      )
      expect(workflowCall?.[1]).toContain('exit 1')
    })

    it('should prompt to add GitHub Action CI when --ci is not given', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project']
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')
      await main()

      expect(mockConfirm).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Do you want to add Github Action CI? (Y/n)',
        })
      )
    })

    it('should prompt for repository mode when an existing repository is detected', async () => {
      process.argv = ['node', 'cli.js', 'init', 'My Project']
      mockExistsSync.mockImplementation((path: string) => path.endsWith('.git'))
      mockSelect.mockResolvedValueOnce('existing-repository')

      const { main } = await import('./cli')
      await main()

      expect(loggerInfoSpy).toHaveBeenCalledWith('Existing repository detected')
      expect(mockSelect).toHaveBeenCalledWith(
        expect.objectContaining({
          message:
            'Initialize ScreenCI as a standalone project or part of the existing repository?',
          default: 'standalone',
        })
      )
      expect(mockMkdir).toHaveBeenCalledWith(
        expect.stringContaining('screenci/videos'),
        { recursive: true }
      )
    })

    it('should put GitHub Action outside screenci in existing repository mode', async () => {
      process.argv = ['node', 'cli.js', 'init', 'My Project', '--ci']
      process.env.SCREENCI_INIT_CWD = '/workspace/repo'
      mockExistsSync.mockImplementation((path: string) => path.endsWith('.git'))
      mockSelect.mockResolvedValueOnce('existing-repository')

      const { main } = await import('./cli')
      await main()

      const workflowCall = mockWriteFile.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === 'string' && c[0].endsWith('screenci.yaml')
      )
      expect(workflowCall?.[0]).toEqual(
        expect.stringContaining('.github/workflows/screenci.yaml')
      )
      expect(workflowCall?.[0]).toBe(
        '/workspace/repo/.github/workflows/screenci.yaml'
      )
      expect(workflowCall?.[1]).toContain('working-directory: screenci')
      expect(workflowCall?.[1]).toContain(
        'cache-dependency-path: screenci/package-lock.json'
      )
      expect(loggerInfoSpy).toHaveBeenCalledWith(
        '  .github/workflows/screenci.yaml (outside ./screenci, at repository root)'
      )
    })

    it('should skip the CI prompt and create workflow with --ci', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project', '--ci']
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')
      await main()

      expect(mockConfirm).not.toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Do you want to add Github Action CI? (Y/n)',
        })
      )
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining('.github/workflows/screenci.yaml'),
        expect.any(String)
      )
    })

    it('should exit if the GitHub Actions workflow already exists', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project', '--ci']
      mockExistsSync.mockImplementation((path: string) =>
        path.endsWith('.github/workflows/screenci.yaml')
      )

      const { main } = await import('./cli')
      await expect(main()).rejects.toThrow('process.exit called')

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        'Error: GitHub Actions workflow ".github/workflows/screenci.yaml" already exists'
      )
      expect(mockWriteFile).not.toHaveBeenCalled()
      expect(processExitSpy).toHaveBeenCalledWith(1)
    })

    it('should reuse existing .github directories when creating workflow', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project', '--ci']
      mockExistsSync.mockImplementation(
        (path: string) =>
          path.endsWith('.github') || path.endsWith('.github/workflows')
      )

      const { main } = await import('./cli')
      await main()

      expect(mockMkdir).not.toHaveBeenCalledWith(
        expect.stringContaining('.github')
      )
      expect(mockMkdir).not.toHaveBeenCalledWith(
        expect.stringContaining('.github/workflows')
      )
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining('.github/workflows/screenci.yaml'),
        expect.any(String)
      )
    })

    it('should not create the workflow when the CI prompt is declined', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project']
      mockExistsSync.mockReturnValue(false)
      mockConfirm
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false)

      const { main } = await import('./cli')
      await main()

      expect(mockMkdir).not.toHaveBeenCalledWith(
        expect.stringContaining('.github/workflows'),
        expect.anything()
      )
      expect(mockWriteFile).not.toHaveBeenCalledWith(
        expect.stringContaining('.github/workflows/screenci.yaml'),
        expect.any(String)
      )
      expect(loggerInfoSpy).not.toHaveBeenCalledWith(
        '  .github/workflows/screenci.yaml'
      )
    })

    it('should replace spaces in standalone directory name', async () => {
      process.argv = ['node', 'cli.js', 'init', 'My Cool Project']
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')
      await main()

      expect(mockMkdir).toHaveBeenCalledWith(
        expect.stringContaining('My-Cool-Project'),
        { recursive: true }
      )
    })

    it('should preserve non-space symbols in standalone directory name', async () => {
      process.argv = ['node', 'cli.js', 'init', 'My @Cool# Project!']
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')
      await main()

      expect(mockMkdir).toHaveBeenCalledWith(
        expect.stringContaining('My-@Cool#-Project!'),
        { recursive: true }
      )
    })

    it('should use original project name in config and omit generated package name', async () => {
      process.argv = ['node', 'cli.js', 'init', 'My Cool Project']
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')
      await main()

      const configCall = mockWriteFile.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === 'string' && c[0].endsWith('screenci.config.ts')
      )
      expect(configCall?.[1]).toContain('"My Cool Project"')

      const pkgCall = mockWriteFile.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === 'string' && c[0].endsWith('package.json')
      )
      expect(pkgCall?.[1]).not.toContain('"name":')
    })

    it('should use published screenci dependency in generated package.json', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project']
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')
      await main()

      const pkgCall = mockWriteFile.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === 'string' && c[0].endsWith('package.json')
      )
      expect(pkgCall?.[1]).toContain('"screenci": "0.0.32"')
      expect(pkgCall?.[1]).not.toContain('"screenci": "file:')
    })

    it('should use SCREENCI_INIT_SCREENCI_DEPENDENCY when provided', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project']
      process.env.SCREENCI_INIT_SCREENCI_DEPENDENCY =
        'file:../screenci-0.0.32.tgz'
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')
      await main()

      const pkgCall = mockWriteFile.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === 'string' && c[0].endsWith('package.json')
      )
      expect(pkgCall?.[1]).toContain(
        '"screenci": "file:../screenci-0.0.32.tgz"'
      )
    })

    it('should use published screenci dependency when init runs through source cli', async () => {
      const sourceCliPath = `${process.cwd()}/cli.ts`
      process.argv = ['node', sourceCliPath, 'init', 'my-project']
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')
      await main()

      const pkgCall = mockWriteFile.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === 'string' && c[0].endsWith('package.json')
      )
      expect(pkgCall?.[1]).toContain('"screenci": "0.0.32"')
      expect(pkgCall?.[1]).not.toContain('"screenci": "file:')
      expect(mockSpawn).not.toHaveBeenCalledWith(
        'npm',
        ['run', 'build'],
        expect.anything()
      )
    })

    it('should prompt for project name when not provided as arg', async () => {
      process.argv = ['node', 'cli.js', 'init']
      mockExistsSync.mockReturnValue(false)
      mockInput.mockResolvedValueOnce('prompted-project')

      const { main } = await import('./cli')
      await main()

      expect(mockInput).toHaveBeenCalled()
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining('screenci.config.ts'),
        expect.stringContaining('"prompted-project"')
      )
    })

    it('should authenticate before prompting for project name', async () => {
      process.argv = ['node', 'cli.js', 'init']
      mockExistsSync.mockReturnValue(false)
      delete process.env.SCREENCI_SECRET
      mockInput.mockResolvedValueOnce('prompted-project')

      mockCreateHttpServer.mockImplementation(
        (handler: (req: unknown, res: unknown) => void) => {
          expect(mockInput).not.toHaveBeenCalled()

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

      const { main } = await import('./cli')
      await main()

      expect(mockInput).toHaveBeenCalled()
      expect(mockCreateHttpServer).not.toHaveBeenCalled()
    })

    it('should exit if project name is empty after prompt', async () => {
      process.argv = ['node', 'cli.js', 'init']
      mockExistsSync.mockReturnValue(false)
      mockInput.mockResolvedValue('')

      const { main } = await import('./cli')
      await expect(main()).rejects.toThrow('process.exit called')

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        'Error: Project name is required'
      )
      expect(processExitSpy).toHaveBeenCalledWith(1)
    })

    it('should exit if target directory already exists', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project']
      mockExistsSync.mockReturnValue(true)
      process.env.SCREENCI_SECRET = 'already-set-secret'

      const { main } = await import('./cli')
      await expect(main()).rejects.toThrow('process.exit called')

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        'Error: Directory "my-project" already exists'
      )
      expect(processExitSpy).toHaveBeenCalledWith(1)
    })

    it('should fetch auth before checking if the target directory exists', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project']
      mockExistsSync.mockReturnValue(true)
      delete process.env.SCREENCI_SECRET

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

      const { main } = await import('./cli')
      await expect(main()).rejects.toThrow('process.exit called')

      expect(mockCreateHttpServer).not.toHaveBeenCalled()
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        'Error: Directory "my-project" already exists'
      )
    })

    it('should log success message with directory name after init', async () => {
      process.argv = ['node', 'cli.js', 'init', 'Test Project']
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')
      await main()

      expect(loggerInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Initialized screenci project "Test Project" in '
        )
      )
    })

    it('should log created files clearly after init', async () => {
      process.argv = ['node', 'cli.js', 'init', 'screenci-docs']
      mockExistsSync.mockReturnValue(false)
      mockConfirm
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)

      const { main } = await import('./cli')
      await main()

      const messages = loggerInfoSpy.mock.calls.map((call) => call[0])
      const filesCreatedIndex = messages.indexOf('Files created:')

      expect(
        messages.some((message) =>
          String(message).includes(
            'Initialized screenci project "screenci-docs" in '
          )
        )
      ).toBe(true)
      expect(messages.slice(filesCreatedIndex, filesCreatedIndex + 10)).toEqual(
        [
          'Files created:',
          '  screenci.config.ts',
          '  package.json',
          '  tsconfig.json',
          '  README.md',
          '  .gitignore',
          '  videos/example.video.ts',
          '  .github/workflows/screenci.yaml',
          '  .env  (empty placeholder)',
          '',
        ]
      )
    })

    it('should include cd step in next steps', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project']
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')
      await main()

      expect(loggerInfoSpy).toHaveBeenCalledWith('  cd my-project')
    })

    it('should include README and docs link in next steps', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project']
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')
      await main()

      expect(loggerInfoSpy).toHaveBeenCalledWith(
        '  Read README.md for setup and recording flow'
      )
      expect(loggerInfoSpy).toHaveBeenCalledWith(
        '  Docs: https://screenci.com/docs/intro/'
      )
    })

    it('should include .gitignore with required entries', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project']
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')
      await main()

      const gitignoreCall = mockWriteFile.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === 'string' && c[0].endsWith('.gitignore')
      )
      const content = gitignoreCall?.[1] as string
      expect(content).toContain('/playwright-report/')
      expect(content).toContain('.screenci')
      expect(content).toContain('.playwright-cli/')
      expect(content).toContain('node_modules/')
      expect(content).toContain('.env')
    })

    it('should include envFile in generated screenci.config.ts', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project']
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')
      await main()

      const configCall = mockWriteFile.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === 'string' && c[0].endsWith('screenci.config.ts')
      )
      expect(configCall?.[1]).toContain("envFile: '.env'")
    })

    it('should default generated screenci.config.ts to 60 fps', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project']
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')
      await main()

      const configCall = mockWriteFile.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === 'string' && c[0].endsWith('screenci.config.ts')
      )
      expect(configCall?.[1]).toContain('fps: 60')
    })

    it('should generate an example video that walks through ScreenCI docs', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project']
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')
      await main()

      const exampleVideoCall = mockWriteFile.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === 'string' && c[0].endsWith('videos/example.video.ts')
      )
      expect(exampleVideoCall?.[1]).toContain(
        "import { autoZoom, createNarration, hide, video, voices } from 'screenci'"
      )
      expect(exampleVideoCall?.[1]).toContain(
        "await page.goto('https://screenci.com/')"
      )
      expect(exampleVideoCall?.[1]).toContain(
        "await page.getByRole('link', { name: 'View Documentation' }).click()"
      )
      expect(exampleVideoCall?.[1]).toContain('await autoZoom(')
    })

    it('should not create an http server during init when SCREENCI_SECRET is already set', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project']
      mockExistsSync.mockReturnValue(false)
      process.env.SCREENCI_SECRET = 'already-set-secret'

      const { main } = await import('./cli')
      await main()

      expect(mockCreateHttpServer).not.toHaveBeenCalled()
    })

    it('should not trigger browser auth during init when SCREENCI_SECRET is missing', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project']
      mockExistsSync.mockReturnValue(false)
      delete process.env.SCREENCI_SECRET

      const { main } = await import('./cli')
      await main()

      expect(mockCreateHttpServer).not.toHaveBeenCalled()
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining('my-project/.env'),
        ''
      )
    })

    it('should run npm install automatically', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project']
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')
      await main()

      expect(mockSpawn).toHaveBeenCalledWith(
        'npm',
        expect.arrayContaining(['install', '--include=dev']),
        expect.objectContaining({ stdio: 'pipe' })
      )
    })

    it('should prompt for dependency installation when --install is not given', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project']
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')
      await main()

      expect(mockConfirm).toHaveBeenCalledWith(
        expect.objectContaining({
          message:
            'Install dependencies now, including Chromium for Playwright? (Y/n)',
        })
      )
    })

    it('should skip the install prompt and install automatically with --install', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project', '--install']
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')
      await main()

      expect(mockConfirm).not.toHaveBeenCalledWith(
        expect.objectContaining({
          message:
            'Install dependencies now, including Chromium for Playwright? (Y/n)',
        })
      )
      expect(mockSpawn).toHaveBeenCalledWith(
        'npm',
        expect.arrayContaining(['install', '--include=dev']),
        expect.objectContaining({ stdio: 'pipe' })
      )
    })

    it('should skip automatic installs and print manual steps when install prompt is declined', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project']
      mockExistsSync.mockReturnValue(false)
      mockConfirm
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)

      const { main } = await import('./cli')
      await main()

      expect(mockSpawn).not.toHaveBeenCalledWith(
        'npm',
        expect.arrayContaining(['install']),
        expect.any(Object)
      )
      expect(mockSpawn).not.toHaveBeenCalledWith(
        'npx',
        ['playwright', 'install', 'chromium', '--with-deps'],
        expect.any(Object)
      )
      expect(loggerInfoSpy).toHaveBeenCalledWith(
        'Dependencies were not installed automatically.'
      )
      expect(loggerInfoSpy).toHaveBeenCalledWith('  npm install --include=dev')
      expect(loggerInfoSpy).toHaveBeenCalledWith(
        '  npx playwright install chromium --with-deps'
      )
    })

    it('should run Chromium install automatically after npm install', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project']
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')
      await main()

      expect(mockSpawn).toHaveBeenCalledWith(
        'npx',
        ['playwright', 'install', 'chromium', '--with-deps'],
        expect.objectContaining({ stdio: 'inherit' })
      )
    })

    it('should not attempt Chromium detection before install', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project']
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')
      await main()

      expect(mockConfirm).toHaveBeenCalledTimes(3)
      expect(mockSelect).not.toHaveBeenCalled()
      expect(mockSpawn).not.toHaveBeenCalledWith(
        'npx',
        ['playwright', 'install', '--list'],
        expect.any(Object)
      )
    })

    it('should show Chromium install output during init', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project']
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')
      await main()

      expect(loggerInfoSpy).toHaveBeenCalledWith(
        "Local development requires Chromium for Playwright, running 'npx playwright install chromium --with-deps'..."
      )
      expect(mockSpawn).toHaveBeenCalledWith(
        'npx',
        ['playwright', 'install', 'chromium', '--with-deps'],
        expect.objectContaining({ stdio: 'inherit' })
      )
    })

    it('should show a green Playwright success message after install', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project']
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')
      await main()

      expect(loggerInfoSpy).toHaveBeenCalledWith(
        `${pc.green('✔')} Playwright installed successfully`
      )
    })

    it('should not hide Playwright install output behind a spinner', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project']
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')
      await main()

      expect(mockOra).not.toHaveBeenCalledWith(
        'Installing Playwright Chromium...'
      )
      expect(mockSpawn).toHaveBeenCalledWith(
        'npx',
        ['playwright', 'install', 'chromium', '--with-deps'],
        expect.objectContaining({ stdio: 'inherit' })
      )
    })

    it('should show npm install output with init --verbose', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project', '--verbose']
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')
      await main()

      expect(loggerInfoSpy).toHaveBeenCalledWith(
        "Running 'npm install --include=dev'..."
      )
      expect(mockSpawn).toHaveBeenCalledWith(
        'npm',
        ['install', '--include=dev'],
        expect.objectContaining({
          cwd: expect.stringContaining('screenci'),
          stdio: 'inherit',
        })
      )
    })

    it('should show spinner during npm install', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project']
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')
      await main()

      expect(mockOra).toHaveBeenCalledWith(
        expect.stringContaining('npm install')
      )
      expect(mockSpinner.start).toHaveBeenCalled()
      expect(mockSpinner.succeed).toHaveBeenCalled()
    })

    it('should mention Chromium requirement for local development', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project']
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')
      await main()

      expect(loggerInfoSpy).toHaveBeenCalledWith(
        "Local development requires Chromium for Playwright, running 'npx playwright install chromium --with-deps'..."
      )
    })

    it('should not include install steps in next steps after automatic setup', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project']
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')
      await main()

      const allInfoCalls = loggerInfoSpy.mock.calls.map((c: unknown[]) => c[0])
      expect(allInfoCalls).not.toContain('  npm install')
      expect(allInfoCalls).not.toContain(
        '  npx playwright install chromium --with-deps'
      )
      expect(allInfoCalls).not.toContain(
        '  npx --yes skills add screenci/screenci --skill screenci --skill playwright-cli -y'
      )
    })

    it('should always run skills add with both skills when AI authoring is confirmed', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project']
      mockExistsSync.mockReturnValue(false)
      mockConfirm.mockResolvedValueOnce(true).mockResolvedValueOnce(true)

      const { main } = await import('./cli')
      await main()

      expect(mockSpawn).toHaveBeenCalledWith(
        'npx',
        [
          '--yes',
          'skills',
          'add',
          'screenci/screenci',
          '--skill',
          'screenci',
          '--skill',
          'playwright-cli',
          '-y',
        ],
        expect.objectContaining({ stdio: 'pipe' })
      )
    })

    it('should pass --agent through to skills add', async () => {
      process.argv = [
        'node',
        'cli.js',
        'init',
        'my-project',
        '--agent',
        'opencode',
      ]
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')
      await main()

      expect(mockSpawn).toHaveBeenCalledWith(
        'npx',
        [
          '--yes',
          'skills',
          'add',
          'screenci/screenci',
          '--agent',
          'opencode',
          '--skill',
          'screenci',
          '--skill',
          'playwright-cli',
          '-y',
        ],
        expect.objectContaining({ stdio: 'pipe' })
      )
    })

    it('should always run skills add with only screenci when AI authoring is declined', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project']
      mockExistsSync.mockReturnValue(false)
      mockConfirm.mockResolvedValueOnce(true).mockResolvedValueOnce(false)

      const { main } = await import('./cli')
      await main()

      expect(mockSpawn).toHaveBeenCalledWith(
        'npx',
        [
          '--yes',
          'skills',
          'add',
          'screenci/screenci',
          '--skill',
          'screenci',
          '-y',
        ],
        expect.objectContaining({ stdio: 'pipe' })
      )
    })

    it('should answer yes to all init prompts with --yes', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project', '--yes']
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')
      await main()

      expect(mockConfirm).not.toHaveBeenCalled()
      expect(mockSelect).not.toHaveBeenCalled()
      expect(mockSpawn).not.toHaveBeenCalledWith(
        'git',
        ['init'],
        expect.any(Object)
      )
      expect(mockSpawn).toHaveBeenCalledWith(
        'npx',
        [
          '--yes',
          'skills',
          'add',
          'screenci/screenci',
          '--skill',
          'screenci',
          '--skill',
          'playwright-cli',
          '-y',
        ],
        expect.objectContaining({ stdio: 'pipe' })
      )
      expect(mockSpawn).toHaveBeenCalledWith(
        'npm',
        expect.arrayContaining(['install', '--include=dev']),
        expect.objectContaining({ stdio: 'pipe' })
      )
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining('.github/workflows/screenci.yaml'),
        expect.any(String)
      )
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining('my-project/screenci.config.ts'),
        expect.stringContaining('"my-project"')
      )
      expect(loggerInfoSpy).toHaveBeenCalledWith('  cd my-project')
    })

    it('should include --agent when combined with --yes', async () => {
      process.argv = [
        'node',
        'cli.js',
        'init',
        'my-project',
        '--yes',
        '--agent',
        'opencode',
      ]
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')
      await main()

      expect(mockSpawn).toHaveBeenCalledWith(
        'npx',
        [
          '--yes',
          'skills',
          'add',
          'screenci/screenci',
          '--agent',
          'opencode',
          '--skill',
          'screenci',
          '--skill',
          'playwright-cli',
          '-y',
        ],
        expect.objectContaining({ stdio: 'pipe' })
      )
    })

    it('should answer yes to the skill question with --skill', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project', '--skill']
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')
      await main()

      expect(mockConfirm).not.toHaveBeenCalledWith(
        expect.objectContaining({
          message:
            'Do you want to write videos with an AI agent based on a URL and not just source code? If yes, playwright-cli will be also installed.',
        })
      )
      const pkgCall = mockWriteFile.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === 'string' && c[0].endsWith('package.json')
      )
      expect(pkgCall?.[1]).toContain('"@playwright/cli": "latest"')
    })

    it('should allow auth as a project name', async () => {
      process.argv = ['node', 'cli.js', 'init', 'auth', '--yes']
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')
      await main()

      expect(mockCreateHttpServer).not.toHaveBeenCalled()
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining('auth/screenci.config.ts'),
        expect.stringContaining('"auth"')
      )
      expect(loggerInfoSpy).toHaveBeenCalledWith('  cd auth')
    })

    it('should launch package commands through cmd on Windows', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project', '--yes']
      mockExistsSync.mockReturnValue(false)
      const platformSpy = vi
        .spyOn(process, 'platform', 'get')
        .mockReturnValue('win32')

      const { main } = await import('./cli')
      await main()

      expect(mockSpawn).toHaveBeenCalledWith(
        'cmd',
        [
          '/d',
          '/c',
          expect.stringContaining(
            'npx --yes skills add screenci/screenci --skill screenci --skill playwright-cli -y'
          ),
        ],
        expect.objectContaining({ stdio: 'pipe' })
      )
      expect(mockSpawn).toHaveBeenCalledWith(
        'cmd',
        ['/d', '/c', expect.stringContaining('npm install --include=dev')],
        expect.objectContaining({ stdio: 'pipe' })
      )
      expect(mockSpawn).toHaveBeenCalledWith(
        'cmd',
        [
          '/d',
          '/c',
          expect.stringContaining(
            'npx playwright install chromium --with-deps'
          ),
        ],
        expect.objectContaining({ stdio: 'inherit' })
      )

      platformSpy.mockRestore()
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
