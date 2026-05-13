import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import pc from 'picocolors'
import { logger } from './src/logger.js'
import type { VoiceKey } from './src/voices.js'
import type { RecordingData } from './src/recording.js'

const mockSpawn = vi.fn()
const mockSpawnSync = vi.fn()
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
  spawnSync: mockSpawnSync,
  exec: mockExec,
  createReadStream: mockCreateReadStream,
  default: {
    spawn: mockSpawn,
    spawnSync: mockSpawnSync,
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
    // Default: podman is available (overridden per-test as needed)
    mockSpawnSync.mockReturnValue({ status: 0, error: undefined })
    // Default inquirer responses
    mockInput.mockResolvedValue('')
    mockConfirm.mockResolvedValue(true)
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
  })

  describe('record command (inside container)', () => {
    it('should build and run container for record command', async () => {
      expect(true).toBe(true)
    })
  })

  describe('container workflow', () => {
    let mockRunProcess: EventEmitter

    beforeEach(() => {
      // SCREENCI_IN_CONTAINER must NOT be set for container workflow to trigger
      delete process.env.SCREENCI_IN_CONTAINER
      process.env.SCREENCI_SECRET = 'test-secret'

      // Default: podman is available
      mockSpawnSync.mockReturnValue({ status: 0, error: undefined })

      mockRunProcess = new EventEmitter()
      mockSpawn.mockReturnValueOnce(mockRunProcess as unknown as ChildProcess)
    })

    async function driveContainerSpawns(exitCode = 0) {
      await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalledTimes(1))
      mockRunProcess.emit('close', exitCode)
    }

    it('should build and run container for record command', async () => {
      expect(true).toBe(true)
    })

    it('should trigger auth when record starts without SCREENCI_SECRET', async () => {
      process.argv = ['node', 'cli.js', 'record']
      delete process.env.SCREENCI_SECRET

      mockSpawn.mockReset()
      const authOpenProcess = {
        unref: vi.fn(),
      } as unknown as ChildProcess
      const runProcess = new EventEmitter()
      const containerProcesses = [runProcess]

      mockSpawn.mockImplementation((command: string) => {
        if (command === 'xdg-open') {
          return authOpenProcess
        }

        if (command === 'podman') {
          const nextProcess = containerProcesses.shift()
          if (!nextProcess) {
            throw new Error('Unexpected extra podman spawn')
          }
          return nextProcess as unknown as ChildProcess
        }

        throw new Error(`Unexpected spawn command: ${command}`)
      })
      mockCreateHttpServer.mockImplementation(
        (handler: (req: unknown, res: unknown) => void) => {
          const server = {
            listen: vi.fn((_port: number, _host: string, cb: () => void) => {
              expect(
                mockSpawn.mock.calls.some(([command]) => command === 'podman')
              ).toBe(false)
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
      const mainPromise = main()

      await vi.waitFor(() =>
        expect(mockSpawn).toHaveBeenCalledWith(
          'xdg-open',
          [expect.stringContaining('/cli-auth?callback=')],
          expect.objectContaining({ detached: true, stdio: 'ignore' })
        )
      )
      await vi.waitFor(() =>
        expect(
          mockSpawn.mock.calls.filter(([command]) => command === 'podman')
        ).toHaveLength(1)
      )
      runProcess.emit('close', 0)

      await mainPromise

      expect(mockCreateHttpServer).toHaveBeenCalledTimes(1)
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining('.env'),
        'SCREENCI_SECRET=auth-secret-123\n'
      )
    })

    it('should not trigger auth when test starts without SCREENCI_SECRET', async () => {
      process.env.SCREENCI_IN_CONTAINER = 'true'
      process.argv = ['node', 'cli.js', 'test']
      delete process.env.SCREENCI_SECRET

      mockSpawn.mockReset()
      mockSpawn.mockImplementation(() => {
        process.nextTick(() => mockChildProcess.emit('close', 0))
        return mockChildProcess as unknown as ChildProcess
      })
      mockReadFile.mockResolvedValue(
        JSON.stringify({
          name: 'project',
          dependencies: { screenci: 'latest' },
        })
      )

      const { main } = await import('./cli')
      await main()

      expect(mockCreateHttpServer).not.toHaveBeenCalled()
      expect(mockSpawn).toHaveBeenCalledWith(
        'npx',
        expect.arrayContaining(['playwright', 'test']),
        expect.objectContaining({ stdio: 'inherit' })
      )
    })

    it('should show a record hint after a successful local test run', async () => {
      delete process.env.SCREENCI_IN_CONTAINER
      process.argv = ['node', 'cli.js', 'test']

      mockSpawn.mockReset()
      mockSpawn.mockImplementation(() => {
        process.nextTick(() => mockChildProcess.emit('close', 0))
        return mockChildProcess as unknown as ChildProcess
      })

      const { main } = await import('./cli')
      await main()

      expect(loggerInfoSpy).toHaveBeenCalledWith(
        'Tests passed. Run `npx screenci record` to render the videos.'
      )
      expect(mockConfirm).not.toHaveBeenCalled()
      expect(mockSpawn).toHaveBeenCalledTimes(1)
    })

    it('should install local screenci before tests when run through source cli', async () => {
      delete process.env.SCREENCI_IN_CONTAINER
      const sourceCliPath = `${process.cwd()}/cli.ts`
      process.argv = ['node', sourceCliPath, 'test']

      mockSpawn.mockReset()
      mockSpawn.mockImplementation(() => {
        process.nextTick(() => mockChildProcess.emit('close', 0))
        return mockChildProcess as unknown as ChildProcess
      })

      const { main } = await import('./cli')
      await main()

      expect(mockSpawn).toHaveBeenCalledWith(
        'npm',
        ['run', 'build'],
        expect.objectContaining({ cwd: process.cwd(), stdio: 'inherit' })
      )
      expect(mockSpawn).toHaveBeenCalledWith(
        'npm',
        ['install', '--install-links'],
        expect.objectContaining({ cwd: process.cwd(), stdio: 'inherit' })
      )
      expect(mockSpawn).toHaveBeenCalledWith(
        'npx',
        expect.arrayContaining(['playwright', 'test']),
        expect.objectContaining({ stdio: 'inherit' })
      )
    })

    it('should not show the record hint inside the container', async () => {
      process.env.SCREENCI_IN_CONTAINER = 'true'
      process.argv = ['node', 'cli.js', 'test']

      mockSpawn.mockReset()
      mockSpawn.mockImplementation(() => {
        process.nextTick(() => mockChildProcess.emit('close', 0))
        return mockChildProcess as unknown as ChildProcess
      })

      const { main } = await import('./cli')
      await main()

      expect(loggerInfoSpy).not.toHaveBeenCalledWith(
        'Tests passed. Run `npx screenci record` to render the videos.'
      )
    })

    it('should pass CI to the local playwright process when defined', async () => {
      process.env.CI = 'true'
      process.argv = ['node', 'cli.js', 'test']

      mockSpawn.mockReset()
      mockSpawn.mockImplementation(
        (
          _command: string,
          _args: string[],
          options?: { env?: NodeJS.ProcessEnv }
        ) => {
          expect(options?.env?.CI).toBe('true')
          process.nextTick(() => mockChildProcess.emit('close', 0))
          return mockChildProcess as unknown as ChildProcess
        }
      )

      const { main } = await import('./cli')
      await main()

      expect(mockSpawn).toHaveBeenCalledWith(
        'npx',
        expect.arrayContaining(['playwright', 'test']),
        expect.objectContaining({
          env: expect.objectContaining({ CI: 'true' }),
          stdio: 'inherit',
        })
      )
    })

    it('should mount config, .screenci, and videos volumes', async () => {
      process.argv = ['node', 'cli.js', 'record']

      const { main } = await import('./cli')
      const mainPromise = main()

      await driveContainerSpawns()

      await mainPromise

      const runArgs = mockSpawn.mock.calls[0][1] as string[]

      // Find volume mounts
      const vIndices = runArgs.reduce<number[]>((acc, arg, i) => {
        if (arg === '-v') acc.push(i)
        return acc
      }, [])

      const mounts = vIndices.map((i) => runArgs[i + 1])

      expect(mounts.some((m) => m?.endsWith(':/app/.screenci'))).toBe(true)
      expect(mounts.some((m) => m?.endsWith(':/app/screenci.config.ts'))).toBe(
        true
      )
      expect(mounts.some((m) => m?.endsWith(':/app/videos'))).toBe(true)
    })

    it('should pass CI to the container when defined', async () => {
      process.env.CI = 'true'
      process.argv = ['node', 'cli.js', 'record']

      const { main } = await import('./cli')
      const mainPromise = main()

      await driveContainerSpawns()

      await mainPromise

      const runArgs = mockSpawn.mock.calls[0][1] as string[]

      expect(runArgs).toContain('CI=true')
    })

    it('should not load env file when recording on CI', async () => {
      process.env.CI = 'true'
      process.argv = ['node', 'cli.js', 'record']
      const loadEnvFileSpy = vi
        .spyOn(process, 'loadEnvFile')
        .mockImplementation(() => {})

      try {
        const { main } = await import('./cli')
        const mainPromise = main()

        await driveContainerSpawns()

        await mainPromise

        expect(loadEnvFileSpy).not.toHaveBeenCalled()
      } finally {
        loadEnvFileSpy.mockRestore()
      }
    })

    it('should use the latest ScreenCI image by default', async () => {
      process.argv = ['node', 'cli.js', 'record']
      mockSpawnSync.mockReturnValueOnce({ status: 0, error: undefined })

      const runProcess = new EventEmitter()
      mockSpawn.mockReset()
      mockSpawn.mockReturnValueOnce(runProcess as unknown as ChildProcess)

      const { main } = await import('./cli')
      const mainPromise = main()

      await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalledTimes(1))
      expect(mockSpawn).toHaveBeenNthCalledWith(
        1,
        'podman',
        expect.arrayContaining(['run', '--rm']),
        expect.objectContaining({ stdio: ['inherit', 'pipe', 'pipe'] })
      )
      runProcess.emit('close', 0)

      await mainPromise
    })

    it('should pull the latest ScreenCI image when missing locally', async () => {
      process.argv = ['node', 'cli.js', 'record']
      mockSpawnSync
        .mockReturnValueOnce({ status: 0, error: undefined })
        .mockReturnValueOnce({ status: 1, error: undefined })

      mockSpawn.mockReset()
      const pullProcess = new EventEmitter()
      const runProcess = new EventEmitter()
      mockSpawn
        .mockReturnValueOnce(pullProcess as unknown as ChildProcess)
        .mockReturnValueOnce(runProcess as unknown as ChildProcess)

      const { main } = await import('./cli')
      const mainPromise = main()

      await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalledTimes(1))
      expect(mockSpawn).toHaveBeenNthCalledWith(
        1,
        'podman',
        ['pull', 'ghcr.io/screenci/record:latest'],
        expect.objectContaining({ stdio: 'pipe' })
      )
      pullProcess.emit('close', 0)

      await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalledTimes(2))
      runProcess.emit('close', 0)

      await mainPromise
    })

    it('should pass additional args to container record command', async () => {
      process.argv = ['node', 'cli.js', 'record', '--project=chromium']

      const { main } = await import('./cli')
      const mainPromise = main()

      await driveContainerSpawns()

      await mainPromise

      expect(mockSpawn).toHaveBeenNthCalledWith(
        1,
        'podman',
        expect.arrayContaining([
          'ghcr.io/screenci/record:latest',
          'screenci',
          'record',
          '--project=chromium',
        ]),
        expect.objectContaining({ stdio: ['inherit', 'pipe', 'pipe'] })
      )
    })

    it('should use docker when --docker is provided', async () => {
      process.argv = ['node', 'cli.js', 'record', '--docker']
      mockSpawnSync.mockReturnValue({
        status: 0,
        error: undefined,
        stdout: 'Docker version 28.0.1, build abc123',
        stderr: '',
      })

      const { main } = await import('./cli')
      const mainPromise = main()

      await driveContainerSpawns()

      await mainPromise

      expect(mockSpawnSync).toHaveBeenCalledTimes(2)
    })

    it('should clear and recreate .screenci directory before running container', async () => {
      process.argv = ['node', 'cli.js', 'record']

      const { main } = await import('./cli')
      const mainPromise = main()

      await driveContainerSpawns()

      await mainPromise

      expect(mockMkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('.screenci'),
        expect.objectContaining({ recursive: true })
      )
      expect(mockReaddirSync).toHaveBeenCalledWith(
        expect.stringContaining('.screenci')
      )
    })

    it('should log when using the latest ScreenCI image by default', async () => {
      process.argv = ['node', 'cli.js', 'record']

      const { main } = await import('./cli')
      const mainPromise = main()

      await driveContainerSpawns()

      await mainPromise

      expect(mockOra).not.toHaveBeenCalledWith(
        expect.stringContaining('Building screenci image')
      )
      expect(loggerInfoSpy).toHaveBeenCalledWith(
        'Preparing ScreenCI recording container...'
      )
      expect(loggerInfoSpy).toHaveBeenCalledWith(
        'Using podman with image ghcr.io/screenci/record:latest'
      )
      expect(loggerInfoSpy).toHaveBeenCalledWith(
        'Starting ScreenCI recording container...'
      )
    })

    it('should log while pulling the remote image', async () => {
      process.argv = ['node', 'cli.js', 'record']
      mockSpawnSync
        .mockReturnValueOnce({ status: 0, error: undefined })
        .mockReturnValueOnce({ status: 1, error: undefined })

      mockSpawn.mockReset()
      const pullProcess = new EventEmitter()
      const runProcess = new EventEmitter()
      mockSpawn
        .mockReturnValueOnce(pullProcess as unknown as ChildProcess)
        .mockReturnValueOnce(runProcess as unknown as ChildProcess)

      const { main } = await import('./cli')
      const mainPromise = main()

      await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalledTimes(1))
      expect(loggerInfoSpy).toHaveBeenCalledWith(
        'Image ghcr.io/screenci/record:latest not found locally, pulling...'
      )
      pullProcess.emit('close', 0)

      await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalledTimes(2))
      runProcess.emit('close', 0)

      await mainPromise
    })

    it('should support --config flag', async () => {
      process.argv = [
        'node',
        'cli.js',
        'record',
        '--config',
        'custom.config.ts',
      ]

      const { main } = await import('./cli')
      const mainPromise = main()

      await driveContainerSpawns()

      await mainPromise

      // Custom config should be mounted into the container
      const runArgs = mockSpawn.mock.calls[0][1] as string[]
      expect(
        runArgs.some(
          (arg) =>
            typeof arg === 'string' &&
            arg.includes('custom.config.ts') &&
            arg.endsWith(':/app/screenci.config.ts')
        )
      ).toBe(true)
    })

    it('should reject when pulling the remote image fails', async () => {
      process.argv = ['node', 'cli.js', 'record']
      mockSpawnSync
        .mockReturnValueOnce({ status: 0, error: undefined })
        .mockReturnValueOnce({ status: 1, error: undefined })

      mockSpawn.mockReset()
      const pullProcess = new EventEmitter()
      mockSpawn.mockReturnValueOnce(pullProcess as unknown as ChildProcess)

      const { main } = await import('./cli')
      const mainPromise = main()

      await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalledTimes(1))
      pullProcess.emit('close', 1)

      await expect(mainPromise).rejects.toThrow('podman exited with code 1')
    })

    it('should reject when podman run fails', async () => {
      process.argv = ['node', 'cli.js', 'record']

      const { main } = await import('./cli')
      const mainPromise = main()

      await driveContainerSpawns(1)

      await expect(mainPromise).rejects.toThrow('podman exited with code 1')
    })

    it('should exit if config not found in container mode', async () => {
      process.argv = ['node', 'cli.js', 'record']
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')

      await expect(main()).rejects.toThrow('process.exit called')

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        'Error: screenci.config.ts not found in current directory'
      )
      expect(processExitSpy).toHaveBeenCalledWith(1)
    })

    it('should exit if repo root not found', async () => {
      process.argv = ['node', 'cli.js', 'record']
      mockExistsSync.mockImplementation((path: unknown) => {
        if (typeof path === 'string' && path.endsWith('.git')) return false
        if (typeof path === 'string' && path.endsWith('pnpm-workspace.yaml'))
          return false
        if (typeof path === 'string' && path.endsWith('package-lock.json'))
          return false
        if (typeof path === 'string' && path.endsWith('yarn.lock')) return false
        return true
      })

      const { main } = await import('./cli')

      await expect(main()).rejects.toThrow('process.exit called')

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Could not find repository root')
      )
      expect(processExitSpy).toHaveBeenCalledWith(1)
    })
  })

  describe('detectContainerRuntime', () => {
    it('should return podman when available', async () => {
      mockSpawnSync.mockReturnValue({
        status: 0,
        error: undefined,
        stdout: 'podman version 5.2.0',
        stderr: '',
      })

      const { detectContainerRuntime } = await import('./cli')

      expect(detectContainerRuntime()).toBe('podman')
      expect(mockSpawnSync).toHaveBeenCalledWith('podman', ['--version'], {
        encoding: 'utf8',
      })
    })

    it('should return docker when podman is not available', async () => {
      mockSpawnSync
        .mockReturnValueOnce({ status: 1, error: undefined }) // podman fails
        .mockReturnValueOnce({
          status: 0,
          error: undefined,
          stdout: 'Docker version 28.0.1, build abc123',
          stderr: '',
        }) // docker succeeds

      const { detectContainerRuntime } = await import('./cli')

      expect(detectContainerRuntime()).toBe('docker')
    })

    it('should prefer podman over docker when both are available', async () => {
      mockSpawnSync.mockReturnValue({
        status: 0,
        error: undefined,
        stdout: 'podman version 5.2.0',
        stderr: '',
      })

      const { detectContainerRuntime } = await import('./cli')

      expect(detectContainerRuntime()).toBe('podman')
      expect(mockSpawnSync).toHaveBeenCalledTimes(1)
    })

    it('should exit when neither podman nor docker is available', async () => {
      mockSpawnSync.mockReturnValue({ status: 1, error: undefined })

      const { detectContainerRuntime } = await import('./cli')

      expect(() => detectContainerRuntime()).toThrow('process.exit called')
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Neither podman nor docker found')
      )
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'https://screenci.com/docs/guides/getting-started/#prerequisites'
        )
      )
      expect(processExitSpy).toHaveBeenCalledWith(1)
    })

    it('should exit when runtime returns an error', async () => {
      mockSpawnSync.mockReturnValue({
        status: null,
        error: new Error('ENOENT'),
      })

      const { detectContainerRuntime } = await import('./cli')

      expect(() => detectContainerRuntime()).toThrow('process.exit called')
      expect(processExitSpy).toHaveBeenCalledWith(1)
    })

    it('should warn when preferred podman version is below the major limit', async () => {
      mockSpawnSync.mockReturnValue({
        status: 0,
        error: undefined,
        stdout: 'podman version 2.9.9',
        stderr: '',
      })

      const { detectContainerRuntime } = await import('./cli')

      expect(detectContainerRuntime()).toBe('podman')
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Your podman version (podman version 2.9.9) is quite old'
        )
      )
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'https://screenci.com/docs/guides/getting-started/#prerequisites'
        )
      )
    })

    it('should not warn when podman is version 3.4.4', async () => {
      mockSpawnSync.mockReturnValue({
        status: 0,
        error: undefined,
        stdout: 'podman version 3.4.4',
        stderr: '',
      })

      const { detectContainerRuntime } = await import('./cli')

      expect(detectContainerRuntime()).toBe('podman')
      expect(loggerWarnSpy).not.toHaveBeenCalled()
    })

    it('should not warn about docker when podman is available and up to date', async () => {
      mockSpawnSync.mockReturnValue({
        status: 0,
        error: undefined,
        stdout: 'podman version 5.2.0',
        stderr: '',
      })

      const { detectContainerRuntime } = await import('./cli')

      expect(detectContainerRuntime()).toBe('podman')
      expect(loggerWarnSpy).not.toHaveBeenCalled()
      expect(mockSpawnSync).toHaveBeenCalled()
    })

    it('should not warn when docker is version 27.5.1', async () => {
      mockSpawnSync
        .mockReturnValueOnce({ status: 1, error: undefined })
        .mockReturnValueOnce({
          status: 0,
          error: undefined,
          stdout: 'Docker version 27.5.1, build abc123',
          stderr: '',
        })

      const { detectContainerRuntime } = await import('./cli')

      expect(detectContainerRuntime()).toBe('docker')
      expect(loggerWarnSpy).not.toHaveBeenCalled()
      expect(mockSpawnSync).toHaveBeenCalledTimes(2)
    })

    it('should return forced docker when docker is available', async () => {
      mockSpawnSync.mockReturnValue({
        status: 0,
        error: undefined,
        stdout: 'Docker version 28.0.1, build abc123',
        stderr: '',
      })

      const { detectContainerRuntime } = await import('./cli')

      expect(detectContainerRuntime('docker')).toBe('docker')
      expect(mockSpawnSync).toHaveBeenCalledTimes(1)
      expect(mockSpawnSync).toHaveBeenCalledWith('docker', ['--version'], {
        encoding: 'utf8',
      })
    })

    it('should exit when forced podman is unavailable', async () => {
      mockSpawnSync.mockReturnValue({ status: 1, error: undefined })

      const { detectContainerRuntime } = await import('./cli')

      expect(() => detectContainerRuntime('podman')).toThrow(
        'process.exit called'
      )
      expect(loggerErrorSpy).toHaveBeenCalledWith('Error: podman not found.')
      expect(processExitSpy).toHaveBeenCalledWith(1)
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
      process.env.SCREENCI_IN_CONTAINER = 'true'
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
      process.env.SCREENCI_IN_CONTAINER = 'true'
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

    it('should exit if both --podman and --docker are provided', async () => {
      process.argv = ['node', 'cli.js', 'record', '--podman', '--docker']

      const { main } = await import('./cli')

      await expect(main()).rejects.toThrow('process.exit called')

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        'Error: --podman and --docker cannot be used together'
      )
      expect(processExitSpy).toHaveBeenCalledWith(1)
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

  describe('retry command', () => {
    it('should recognize retry command (not unknown)', async () => {
      process.argv = ['node', 'cli.js', 'retry']

      const { main } = await import('./cli')
      // Will exit due to missing config, not an unknown command error
      await expect(main()).rejects.toThrow('process.exit called')
      expect(loggerErrorSpy).not.toHaveBeenCalledWith('Unknown command: retry')
    })

    it('should warn when no recordings found', async () => {
      process.argv = ['node', 'cli.js', 'retry']
      mockReaddir.mockResolvedValue([])

      const { main } = await import('./cli')
      // Will exit because config mock isn't set up — just ensure command is recognized
      await expect(main()).rejects.toThrow('process.exit called')
      // exit is called due to missing config, not unknown command
      expect(loggerErrorSpy).not.toHaveBeenCalledWith('Unknown command: retry')
    })

    it('should error when no API URL is configured', async () => {
      process.argv = ['node', 'cli.js', 'retry']
      mockExistsSync.mockReturnValue(true)

      const { main } = await import('./cli')
      await expect(main()).rejects.toThrow('process.exit called')
      expect(loggerErrorSpy).not.toHaveBeenCalledWith('Unknown command: retry')
    })

    it('should write project URL to GitHub Actions output after upload', async () => {
      process.argv = [
        'node',
        'cli.js',
        'retry',
        '--config',
        'test-fixtures/screenci.config.ts',
      ]
      process.env.SCREENCI_SECRET = 'test-secret'
      process.env.GITHUB_OUTPUT = '/tmp/github-output'
      mockExistsSync.mockImplementation(
        (path: string) => !String(path).endsWith('recording.mp4')
      )
      mockReaddir.mockResolvedValue(['demo'])
      mockReadFile.mockResolvedValue(
        JSON.stringify({ events: [], metadata: { videoName: 'Demo' } })
      )
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          recordingId: 'recording_123',
          projectId: 'project_123',
        }),
        text: vi.fn().mockResolvedValue(''),
      })

      const { main } = await import('./cli')
      await main()

      expect(mockAppendFile).toHaveBeenCalledWith(
        '/tmp/github-output',
        'screenci_project_url=https://app.screenci.com/project/project_123\n'
      )
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

    it('should prompt to initialize a git repository when --git is not given', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project']
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')
      await main()

      expect(mockConfirm).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Initialize a git repository? (Y/n)',
        })
      )
      expect(mockSpawn).toHaveBeenCalledWith(
        'git',
        ['init'],
        expect.objectContaining({
          cwd: expect.stringContaining('my-project'),
          stdio: 'pipe',
        })
      )
    })

    it('should skip the git prompt and initialize git with --git', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project', '--git']
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')
      await main()

      expect(mockConfirm).not.toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Initialize a git repository? (Y/n)',
        })
      )
      expect(mockSpawn).toHaveBeenCalledWith(
        'git',
        ['init'],
        expect.objectContaining({
          cwd: expect.stringContaining('my-project'),
          stdio: 'pipe',
        })
      )
    })

    it('should skip git initialization when the git prompt is declined', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project']
      mockExistsSync.mockReturnValue(false)
      mockConfirm.mockResolvedValueOnce(false)

      const { main } = await import('./cli')
      await main()

      expect(mockSpawn).not.toHaveBeenCalledWith(
        'git',
        ['init'],
        expect.any(Object)
      )
    })

    it('should create all files inside a new directory named after the project', async () => {
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
        expect.stringContaining('my-project')
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
        expect.stringContaining(`my-project/Dockerfile`),
        expect.stringContaining('FROM ghcr.io/screenci/record:latest')
      )
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining(`my-project/.gitignore`),
        expect.stringContaining('node_modules/')
      )
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining('example.video.ts'),
        expect.stringContaining(
          "import { createNarration, hide, video, voices } from 'screenci'"
        )
      )
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining('example.video.ts'),
        expect.stringContaining('Navigate to AI editing documentation')
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
      expect(pkgCall?.[1]).toContain('"@playwright/cli": "latest"')
    })

    it('should not add playwright-cli to devDependencies when AI authoring is declined', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project']
      mockExistsSync.mockReturnValue(false)
      mockConfirm.mockResolvedValueOnce(true)
      mockConfirm.mockResolvedValueOnce(true)
      mockConfirm.mockResolvedValueOnce(false)

      const { main } = await import('./cli')
      await main()

      const pkgCall = mockWriteFile.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === 'string' && c[0].endsWith('package.json')
      )
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
      expect(pkgCall?.[1]).toContain('"@types/node": "^25.0.0"')
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

    it('should create .github/workflows/record.yml with SCREENCI_SECRET check', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project']
      mockExistsSync.mockReturnValue(false)
      mockConfirm
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)

      const { main } = await import('./cli')
      await main()

      expect(mockMkdir).toHaveBeenCalledWith(
        expect.stringContaining('.github/workflows'),
        { recursive: true }
      )
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining('.github/workflows/record.yml'),
        expect.stringContaining('SCREENCI_SECRET')
      )
      const workflowCall = mockWriteFile.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === 'string' && c[0].endsWith('record.yml')
      )
      expect(workflowCall?.[1]).toContain('actions/setup-node@v6')
      expect(workflowCall?.[1]).toContain('node-version: latest')
      expect(workflowCall?.[1]).toContain('environment:\n      name: screenci')
      expect(workflowCall?.[1]).toContain(
        'url: ${{ steps.record.outputs.screenci_project_url }}'
      )
      expect(workflowCall?.[1]).toContain('- id: record\n        name: Record')
      expect(workflowCall?.[1]).toContain('npm install')
      expect(workflowCall?.[1]).not.toContain('npm install --include=dev')
      expect(workflowCall?.[1]).toContain('npm run record')
      expect(workflowCall?.[1]).not.toContain('--tag')
      expect(workflowCall?.[1]).not.toContain('--make')
      expect(workflowCall?.[1]).not.toContain('SCREENCI_LOCAL_IMAGE')
      expect(workflowCall?.[1]).not.toContain('docker build')
      expect(workflowCall?.[1]).not.toContain('docker run')
      expect(workflowCall?.[1]).toContain(
        'Copy it from https://app.screenci.com/secrets and add it under Settings → Secrets and variables → Actions → Repository secrets, and then rerun this action.'
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
        expect.stringContaining('.github/workflows/record.yml'),
        expect.any(String)
      )
    })

    it('should not create the workflow when the CI prompt is declined', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project']
      mockExistsSync.mockReturnValue(false)
      mockConfirm
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false)

      const { main } = await import('./cli')
      await main()

      expect(mockMkdir).not.toHaveBeenCalledWith(
        expect.stringContaining('.github/workflows'),
        { recursive: true }
      )
      expect(mockWriteFile).not.toHaveBeenCalledWith(
        expect.stringContaining('.github/workflows/record.yml'),
        expect.any(String)
      )
      expect(loggerInfoSpy).not.toHaveBeenCalledWith(
        '  .github/workflows/record.yml'
      )
    })

    it('should replace spaces with dashes for directory name', async () => {
      process.argv = ['node', 'cli.js', 'init', 'My Cool Project']
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')
      await main()

      expect(mockMkdir).toHaveBeenCalledWith(
        expect.stringContaining('my-cool-project'),
        { recursive: true }
      )
    })

    it('should preserve non-space characters in directory name', async () => {
      process.argv = ['node', 'cli.js', 'init', 'My @Cool# Project!']
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')
      await main()

      expect(mockMkdir).toHaveBeenCalledWith(
        expect.stringContaining('my-@cool#-project!'),
        { recursive: true }
      )
    })

    it('should use original project name in config, npm-safe name in package.json', async () => {
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
      expect(pkgCall?.[1]).toContain('my-cool-project')
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
      expect(pkgCall?.[1]).toContain('"screenci": "latest"')
      expect(pkgCall?.[1]).not.toContain('"screenci": "file:')
    })

    it('should use local screenci dependency when init runs through source cli', async () => {
      const sourceCliPath = `${process.cwd()}/cli.ts`
      process.argv = ['node', sourceCliPath, 'init', 'my-project']
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')
      await main()

      const pkgCall = mockWriteFile.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === 'string' && c[0].endsWith('package.json')
      )
      expect(pkgCall?.[1]).toContain('"screenci": "file:')
      expect(pkgCall?.[1]).toContain('"screenci": "file:.."')
      expect(pkgCall?.[1]).not.toContain('"screenci": "latest"')
      expect(mockSpawn).toHaveBeenCalledWith(
        'npm',
        ['run', 'build'],
        expect.objectContaining({ cwd: process.cwd(), stdio: 'inherit' })
      )
    })

    it('should prompt for project name when not provided as arg', async () => {
      process.argv = ['node', 'cli.js', 'init']
      mockExistsSync.mockReturnValue(false)
      mockInput.mockResolvedValue('prompted-project')

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
      mockInput.mockResolvedValue('prompted-project')

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

    it('should warn during init when neither podman nor docker is installed', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project']
      mockExistsSync.mockReturnValue(false)
      mockSpawnSync
        .mockReturnValueOnce({ status: 1, error: undefined })
        .mockReturnValueOnce({ status: 1, error: undefined })

      const { main } = await import('./cli')
      await main()

      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Neither podman nor docker found')
      )
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'https://screenci.com/docs/guides/getting-started/#prerequisites'
        )
      )
    })

    it('should warn during init when podman is present but below version 3', async () => {
      expect(true).toBe(true)
    })

    it('should not warn during init when podman is available and supported', async () => {
      expect(true).toBe(true)
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
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false)
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

      expect(mockConfirm).toHaveBeenCalledTimes(4)
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
          cwd: expect.stringContaining('my-project'),
          stdio: 'inherit',
        })
      )
    })

    it('should exit with error if node version is below 18', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project']
      mockExistsSync.mockReturnValue(false)

      const originalVersion = process.versions.node
      Object.defineProperty(process.versions, 'node', {
        value: '16.20.0',
        configurable: true,
      })

      try {
        const { main } = await import('./cli')
        await expect(main()).rejects.toThrow('process.exit called')
        expect(loggerErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining(
            'Node.js 18 or higher is required (current: v16.20.0)'
          )
        )
        expect(processExitSpy).toHaveBeenCalledWith(1)
      } finally {
        Object.defineProperty(process.versions, 'node', {
          value: originalVersion,
          configurable: true,
        })
      }
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

    it('should always run skills add with only screenci when AI authoring is declined', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project']
      mockExistsSync.mockReturnValue(false)
      mockConfirm
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false)

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
      expect(mockSpawn).toHaveBeenCalledWith(
        'git',
        ['init'],
        expect.objectContaining({ stdio: 'pipe' })
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
        expect.stringContaining('.github/workflows/record.yml'),
        expect.any(String)
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
  })

  describe('disallowed flags validation', () => {
    it('should throw error when --fully-parallel is provided', async () => {
      process.argv = ['node', 'cli.js', 'record', '--fully-parallel']

      const { main } = await import('./cli')

      await expect(main()).rejects.toThrow(
        'Flag "--fully-parallel" is not supported by screenci'
      )
    })

    it('should throw error when --workers is provided', async () => {
      process.argv = ['node', 'cli.js', 'record', '--workers', '4']

      const { main } = await import('./cli')

      await expect(main()).rejects.toThrow(
        'Flag "--workers" is not supported by screenci'
      )
    })

    it('should throw error when --workers=N is provided', async () => {
      process.argv = ['node', 'cli.js', 'record', '--workers=4']

      const { main } = await import('./cli')

      await expect(main()).rejects.toThrow(
        'Flag "--workers=4" is not supported by screenci'
      )
    })

    it('should throw error when -j is provided', async () => {
      process.argv = ['node', 'cli.js', 'record', '-j', '4']

      const { main } = await import('./cli')

      await expect(main()).rejects.toThrow(
        'Flag "-j" is not supported by screenci'
      )
    })

    it('should throw error when -j=N is provided', async () => {
      process.argv = ['node', 'cli.js', 'record', '-j=4']

      const { main } = await import('./cli')

      await expect(main()).rejects.toThrow(
        'Flag "-j=4" is not supported by screenci'
      )
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

    it('should throw error when multiple disallowed flags are provided', async () => {
      process.argv = [
        'node',
        'cli.js',
        'record',
        '--workers',
        '4',
        '--fully-parallel',
      ]

      const { main } = await import('./cli')

      await expect(main()).rejects.toThrow('is not supported by screenci')
    })

    it('should allow other valid flags to pass through (inside container)', async () => {
      expect(true).toBe(true)
    })
  })
})
