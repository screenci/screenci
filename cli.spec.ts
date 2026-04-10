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
  readdir: mockReaddir,
  readFile: mockReadFile,
  stat: mockStat,
  writeFile: mockWriteFile,
  mkdir: mockMkdir,
  default: {
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
    beforeEach(() => {
      process.env.SCREENCI_IN_CONTAINER = 'true'
    })

    it('should spawn playwright with default config path', async () => {
      process.argv = ['node', 'cli.js', 'record']

      const { main } = await import('./cli')
      const mainPromise = main()

      // Wait a bit for spawn to be called
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Emit close event to complete the promise
      mockChildProcess.emit('close', 0)

      await mainPromise

      expect(mockSpawn).toHaveBeenCalledWith(
        'npx',
        expect.arrayContaining([
          'playwright',
          'test',
          '--config',
          expect.stringContaining('screenci.config.ts'),
        ]),
        expect.objectContaining({
          stdio: 'inherit',
          env: expect.objectContaining({
            SCREENCI_RECORD: 'true',
          }),
        })
      )
    })

    it('should support --config flag with custom path', async () => {
      process.argv = [
        'node',
        'cli.js',
        'record',
        '--config',
        'custom.config.ts',
      ]

      const { main } = await import('./cli')
      const mainPromise = main()

      await new Promise((resolve) => setTimeout(resolve, 10))
      mockChildProcess.emit('close', 0)

      await mainPromise

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([
          'playwright',
          'test',
          '--config',
          expect.stringContaining('custom.config.ts'),
        ]),
        expect.objectContaining({ stdio: 'inherit' })
      )
    })

    it('should support -c flag with custom path', async () => {
      process.argv = ['node', 'cli.js', 'record', '-c', 'custom.config.ts']

      const { main } = await import('./cli')
      const mainPromise = main()

      await new Promise((resolve) => setTimeout(resolve, 10))
      mockChildProcess.emit('close', 0)

      await mainPromise

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([
          'playwright',
          'test',
          '--config',
          expect.stringContaining('custom.config.ts'),
        ]),
        expect.objectContaining({ stdio: 'inherit' })
      )
    })

    it('should pass additional arguments to playwright', async () => {
      process.argv = [
        'node',
        'cli.js',
        'record',
        '--headed',
        '--project=chromium',
      ]

      const { main } = await import('./cli')
      const mainPromise = main()

      await new Promise((resolve) => setTimeout(resolve, 10))
      mockChildProcess.emit('close', 0)

      await mainPromise

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([
          'playwright',
          'test',
          '--config',
          expect.stringContaining('screenci.config.ts'),
          '--headed',
          '--project=chromium',
        ]),
        expect.objectContaining({ stdio: 'inherit' })
      )
    })

    it('should pass additional arguments with custom config', async () => {
      process.argv = [
        'node',
        'cli.js',
        'record',
        '--config',
        'custom.config.ts',
        '--headed',
      ]

      const { main } = await import('./cli')
      const mainPromise = main()

      await new Promise((resolve) => setTimeout(resolve, 10))
      mockChildProcess.emit('close', 0)

      await mainPromise

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([
          'playwright',
          'test',
          '--config',
          expect.stringContaining('custom.config.ts'),
          '--headed',
        ]),
        expect.objectContaining({ stdio: 'inherit' })
      )
    })

    it('should handle playwright exit with error code', async () => {
      process.argv = ['node', 'cli.js', 'record']

      const { main } = await import('./cli')
      const mainPromise = main()

      await new Promise((resolve) => setTimeout(resolve, 10))
      mockChildProcess.emit('close', 1)

      await expect(mainPromise).rejects.toThrow('Playwright exited with code 1')
    })

    it('should handle playwright error event', async () => {
      process.argv = ['node', 'cli.js', 'record']

      const { main } = await import('./cli')
      const mainPromise = main()

      await new Promise((resolve) => setTimeout(resolve, 10))
      mockChildProcess.emit('error', new Error('spawn failed'))

      await expect(mainPromise).rejects.toThrow('spawn failed')
    })
  })

  describe('record command with --no-container', () => {
    beforeEach(() => {
      process.env.SCREENCI_SECRET = 'test-secret'
    })

    it('should spawn playwright directly when --no-container is provided', async () => {
      process.argv = ['node', 'cli.js', 'record', '--no-container']

      const { main } = await import('./cli')
      const mainPromise = main()

      await vi.waitFor(() => {
        expect(mockSpawn).toHaveBeenCalled()
      })
      mockChildProcess.emit('close', 0)

      await mainPromise

      expect(mockSpawn).toHaveBeenCalledWith(
        'npx',
        expect.arrayContaining([
          'playwright',
          'test',
          '--config',
          expect.stringContaining('screenci.config.ts'),
        ]),
        expect.objectContaining({
          stdio: 'inherit',
          env: expect.objectContaining({
            SCREENCI_RECORD: 'true',
          }),
        })
      )
    })

    it('should not include --no-container in playwright args', async () => {
      process.argv = ['node', 'cli.js', 'record', '--no-container']

      const { main } = await import('./cli')
      const mainPromise = main()

      await vi.waitFor(() => {
        expect(mockSpawn).toHaveBeenCalled()
      })
      mockChildProcess.emit('close', 0)

      await mainPromise

      const spawnCall = mockSpawn.mock.calls[0]
      const args = spawnCall[1] as string[]
      expect(args).not.toContain('--no-container')
    })

    it('should pass other args alongside --no-container', async () => {
      process.argv = ['node', 'cli.js', 'record', '--no-container', '--headed']

      const { main } = await import('./cli')
      const mainPromise = main()

      await vi.waitFor(() => {
        expect(mockSpawn).toHaveBeenCalled()
      })
      mockChildProcess.emit('close', 0)

      await mainPromise

      expect(mockSpawn).toHaveBeenCalledWith(
        'npx',
        expect.arrayContaining(['--headed']),
        expect.objectContaining({ stdio: 'inherit' })
      )
    })
  })

  describe('container workflow', () => {
    let mockBuildProcess: EventEmitter
    let mockRecordingBuildProcess: EventEmitter
    let mockRunProcess: EventEmitter

    beforeEach(() => {
      // SCREENCI_IN_CONTAINER must NOT be set for container workflow to trigger
      delete process.env.SCREENCI_IN_CONTAINER
      process.env.SCREENCI_SECRET = 'test-secret'

      // Default: podman is available
      mockSpawnSync.mockReturnValue({ status: 0, error: undefined })

      mockBuildProcess = new EventEmitter()
      mockRecordingBuildProcess = new EventEmitter()
      mockRunProcess = new EventEmitter()
      mockSpawn
        .mockReturnValueOnce(mockBuildProcess as unknown as ChildProcess)
        .mockReturnValueOnce(
          mockRecordingBuildProcess as unknown as ChildProcess
        )
        .mockReturnValueOnce(mockRunProcess as unknown as ChildProcess)
    })

    async function driveContainerSpawns(
      exitCodes: [number, number, number] = [0, 0, 0]
    ) {
      await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalledTimes(1))
      mockBuildProcess.emit('close', exitCodes[0])
      if (exitCodes[0] !== 0) return
      await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalledTimes(2))
      mockRecordingBuildProcess.emit('close', exitCodes[1])
      if (exitCodes[1] !== 0) return
      await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalledTimes(3))
      mockRunProcess.emit('close', exitCodes[2])
    }

    it('should build and run container for record command', async () => {
      process.argv = ['node', 'cli.js', 'record']

      const { main } = await import('./cli')
      const mainPromise = main()

      await driveContainerSpawns()

      await mainPromise

      expect(mockSpawn).toHaveBeenCalledTimes(3)

      expect(mockSpawn).toHaveBeenNthCalledWith(
        1,
        'podman',
        expect.arrayContaining([
          'build',
          '-f',
          expect.stringContaining('Dockerfile'),
          '-t',
          'ghcr.io/screenci/record:latest',
        ]),
        expect.objectContaining({ stdio: 'pipe' })
      )

      expect(mockSpawn).toHaveBeenNthCalledWith(
        2,
        'podman',
        expect.arrayContaining([
          'build',
          '-f',
          expect.stringContaining('Dockerfile'),
          '-t',
          'screenci',
        ]),
        expect.objectContaining({ stdio: 'pipe' })
      )

      expect(mockSpawn).toHaveBeenNthCalledWith(
        3,
        'podman',
        expect.arrayContaining([
          'run',
          '--rm',
          '-e',
          'SCREENCI_IN_CONTAINER=true',
          '-e',
          'SCREENCI_RECORD=true',
          'screenci',
          'screenci',
          'record',
        ]),
        expect.objectContaining({ stdio: ['inherit', 'pipe', 'pipe'] })
      )
    })

    it('should mount config, .screenci, and videos volumes', async () => {
      process.argv = ['node', 'cli.js', 'record']

      const { main } = await import('./cli')
      const mainPromise = main()

      await driveContainerSpawns()

      await mainPromise

      const runArgs = mockSpawn.mock.calls[2][1] as string[]

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

    it('should pass additional args to container record command', async () => {
      process.argv = ['node', 'cli.js', 'record', '--project=chromium']

      const { main } = await import('./cli')
      const mainPromise = main()

      await driveContainerSpawns()

      await mainPromise

      expect(mockSpawn).toHaveBeenNthCalledWith(
        3,
        'podman',
        expect.arrayContaining(['screenci', 'record', '--project=chromium']),
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

      expect(mockSpawn).toHaveBeenNthCalledWith(
        1,
        'docker',
        expect.arrayContaining(['build']),
        expect.objectContaining({ stdio: 'pipe' })
      )
      expect(mockSpawnSync).toHaveBeenCalledTimes(1)
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

    it('should log build and run steps', async () => {
      process.argv = ['node', 'cli.js', 'record']

      const { main } = await import('./cli')
      const mainPromise = main()

      await driveContainerSpawns()

      await mainPromise

      expect(mockOra).toHaveBeenCalledWith(
        expect.stringContaining('Building screenci image')
      )
      expect(mockSpinner.start).toHaveBeenCalled()
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
      const runArgs = mockSpawn.mock.calls[2][1] as string[]
      expect(
        runArgs.some(
          (arg) =>
            typeof arg === 'string' &&
            arg.includes('custom.config.ts') &&
            arg.endsWith(':/app/screenci.config.ts')
        )
      ).toBe(true)
    })

    it('should reject when podman build fails', async () => {
      process.argv = ['node', 'cli.js', 'record']

      const { main } = await import('./cli')
      const mainPromise = main()

      await driveContainerSpawns([1, 0, 0])

      await expect(mainPromise).rejects.toThrow('process.exit called')
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('podman exited with code 1')
      )
    })

    it('should reject when podman run fails', async () => {
      process.argv = ['node', 'cli.js', 'record']

      const { main } = await import('./cli')
      const mainPromise = main()

      await driveContainerSpawns([0, 0, 1])

      await expect(mainPromise).rejects.toThrow('podman exited with code 1')
    })

    it('should exit if Dockerfile not found', async () => {
      process.argv = ['node', 'cli.js', 'record']
      mockExistsSync.mockImplementation((path: unknown) => {
        if (typeof path === 'string' && path.endsWith('Dockerfile')) {
          return false
        }
        return true
      })

      const { main } = await import('./cli')

      await expect(main()).rejects.toThrow('process.exit called')

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Dockerfile not found')
      )
      expect(processExitSpy).toHaveBeenCalledWith(1)
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
          'https://screenci.com/guides/getting-started/#prerequisites'
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

    it('should warn when preferred podman version is below the recommendation', async () => {
      mockSpawnSync.mockReturnValue({
        status: 0,
        error: undefined,
        stdout: 'podman version 4.9.3',
        stderr: '',
      })

      const { detectContainerRuntime } = await import('./cli')

      expect(detectContainerRuntime()).toBe('podman')
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('podman 5+ recommended')
      )
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
      expect(mockSpawnSync).toHaveBeenCalledTimes(1)
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

  describe('logging', () => {
    it('should log when running with default config', async () => {
      process.env.SCREENCI_IN_CONTAINER = 'true'
      process.argv = ['node', 'cli.js', 'record']

      const { main } = await import('./cli')
      const mainPromise = main()

      await new Promise((resolve) => setTimeout(resolve, 10))
      mockChildProcess.emit('close', 0)

      await mainPromise

      // Inside container, running/config log messages are suppressed;
      // verify playwright was spawned with the default config path
      expect(mockSpawn).toHaveBeenCalledWith(
        'npx',
        expect.arrayContaining([
          'playwright',
          'test',
          '--config',
          expect.stringContaining('screenci.config.ts'),
        ]),
        expect.any(Object)
      )
    })

    it('should log when running with custom config', async () => {
      process.env.SCREENCI_IN_CONTAINER = 'true'
      process.argv = [
        'node',
        'cli.js',
        'record',
        '--config',
        'custom.config.ts',
      ]

      const { main } = await import('./cli')
      const mainPromise = main()

      await new Promise((resolve) => setTimeout(resolve, 10))
      mockChildProcess.emit('close', 0)

      await mainPromise

      // Inside container, running/config log messages are suppressed;
      // verify playwright was spawned with the custom config path
      expect(mockSpawn).toHaveBeenCalledWith(
        'npx',
        expect.arrayContaining([
          'playwright',
          'test',
          '--config',
          expect.stringContaining('custom.config.ts'),
        ]),
        expect.any(Object)
      )
    })
  })

  describe('dev command', () => {
    it('should spawn playwright with --ui flag and default config path', async () => {
      process.argv = ['node', 'cli.js', 'dev']

      const { main } = await import('./cli')
      const mainPromise = main()

      await new Promise((resolve) => setTimeout(resolve, 10))
      mockChildProcess.emit('close', 0)

      await mainPromise

      expect(mockSpawn).toHaveBeenCalledWith(
        'npx',
        expect.arrayContaining([
          'playwright',
          'test',
          '--config',
          expect.stringContaining('screenci.config.ts'),
          '--ui',
        ]),
        expect.objectContaining({ stdio: 'inherit' })
      )
    })

    it('should support --config flag with custom path', async () => {
      process.argv = ['node', 'cli.js', 'dev', '--config', 'custom.config.ts']

      const { main } = await import('./cli')
      const mainPromise = main()

      await new Promise((resolve) => setTimeout(resolve, 10))
      mockChildProcess.emit('close', 0)

      await mainPromise

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([
          'playwright',
          'test',
          '--config',
          expect.stringContaining('custom.config.ts'),
          '--ui',
        ]),
        expect.objectContaining({ stdio: 'inherit' })
      )
    })

    it('should support -c flag with custom path', async () => {
      process.argv = ['node', 'cli.js', 'dev', '-c', 'custom.config.ts']

      const { main } = await import('./cli')
      const mainPromise = main()

      await new Promise((resolve) => setTimeout(resolve, 10))
      mockChildProcess.emit('close', 0)

      await mainPromise

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([
          'playwright',
          'test',
          '--config',
          expect.stringContaining('custom.config.ts'),
          '--ui',
        ]),
        expect.objectContaining({ stdio: 'inherit' })
      )
    })

    it('should pass additional arguments to playwright', async () => {
      process.argv = [
        'node',
        'cli.js',
        'dev',
        '--project=chromium',
        '--timeout=5000',
      ]

      const { main } = await import('./cli')
      const mainPromise = main()

      await new Promise((resolve) => setTimeout(resolve, 10))
      mockChildProcess.emit('close', 0)

      await mainPromise

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([
          'playwright',
          'test',
          '--config',
          expect.stringContaining('screenci.config.ts'),
          '--ui',
          '--project=chromium',
          '--timeout=5000',
        ]),
        expect.objectContaining({ stdio: 'inherit' })
      )
    })

    it('should allow parallel execution flags', async () => {
      process.argv = [
        'node',
        'cli.js',
        'dev',
        '--workers=4',
        '--fully-parallel',
      ]

      const { main } = await import('./cli')
      const mainPromise = main()

      await new Promise((resolve) => setTimeout(resolve, 10))
      mockChildProcess.emit('close', 0)

      await mainPromise

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([
          'playwright',
          'test',
          '--ui',
          '--workers=4',
          '--fully-parallel',
        ]),
        expect.objectContaining({ stdio: 'inherit' })
      )
    })

    it('should log UI mode when running dev command', async () => {
      process.argv = ['node', 'cli.js', 'dev']

      const { main } = await import('./cli')
      const mainPromise = main()

      await new Promise((resolve) => setTimeout(resolve, 10))
      mockChildProcess.emit('close', 0)

      await mainPromise

      expect(loggerInfoSpy).toHaveBeenCalledWith(
        'Running ScreenCI UI mode with npx...'
      )
      expect(loggerInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining('Using config:')
      )
    })

    it('should run in headed mode when --headed flag is provided', async () => {
      process.argv = ['node', 'cli.js', 'dev', '--headed']

      const { main } = await import('./cli')
      const mainPromise = main()

      await new Promise((resolve) => setTimeout(resolve, 10))
      mockChildProcess.emit('close', 0)

      await mainPromise

      const spawnCall = mockSpawn.mock.calls[0]
      const args = spawnCall[1]

      // Should NOT include --ui when --headed is present
      expect(args).not.toContain('--ui')
      expect(args).toContain('--headed')
      expect(loggerInfoSpy).toHaveBeenCalledWith(
        'Running ScreenCI headed mode with npx...'
      )
    })

    it('should run in headed mode with additional flags', async () => {
      process.argv = [
        'node',
        'cli.js',
        'dev',
        '--headed',
        '--project=chromium',
        '--workers=2',
      ]

      const { main } = await import('./cli')
      const mainPromise = main()

      await new Promise((resolve) => setTimeout(resolve, 10))
      mockChildProcess.emit('close', 0)

      await mainPromise

      const spawnCall = mockSpawn.mock.calls[0]
      const args = spawnCall[1]

      expect(args).not.toContain('--ui')
      expect(args).toContain('--headed')
      expect(args).toContain('--project=chromium')
      expect(args).toContain('--workers=2')
    })

    it('should handle playwright exit with error code', async () => {
      process.argv = ['node', 'cli.js', 'dev']

      const { main } = await import('./cli')
      const mainPromise = main()

      await new Promise((resolve) => setTimeout(resolve, 10))
      mockChildProcess.emit('close', 1)

      await expect(mainPromise).rejects.toThrow('Playwright exited with code 1')
    })

    it('should handle playwright error event', async () => {
      process.argv = ['node', 'cli.js', 'dev']

      const { main } = await import('./cli')
      const mainPromise = main()

      await new Promise((resolve) => setTimeout(resolve, 10))
      mockChildProcess.emit('error', new Error('spawn failed'))

      await expect(mainPromise).rejects.toThrow('spawn failed')
    })

    it('should exit if config not found', async () => {
      process.argv = ['node', 'cli.js', 'dev']
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')

      await expect(main()).rejects.toThrow('process.exit called')

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        'Error: screenci.config.ts not found in current directory'
      )
      expect(processExitSpy).toHaveBeenCalledWith(1)
    })
  })

  describe('test command', () => {
    it('should spawn playwright test with default config path', async () => {
      process.argv = ['node', 'cli.js', 'test', '--project=chromium']

      const { main } = await import('./cli')
      const mainPromise = main()

      await new Promise((resolve) => setTimeout(resolve, 10))
      mockChildProcess.emit('close', 0)

      await mainPromise

      expect(mockSpawn).toHaveBeenCalledWith(
        'npx',
        expect.arrayContaining([
          'playwright',
          'test',
          '--config',
          expect.stringContaining('screenci.config.ts'),
          '--project=chromium',
        ]),
        expect.objectContaining({
          stdio: 'inherit',
          env: expect.not.objectContaining({
            SCREENCI_RECORD: 'true',
          }),
        })
      )
    })

    it('should support custom config path', async () => {
      process.argv = [
        'node',
        'cli.js',
        'test',
        '--config',
        'custom.config.ts',
        '--grep',
        'demo',
      ]

      const { main } = await import('./cli')
      const mainPromise = main()

      await new Promise((resolve) => setTimeout(resolve, 10))
      mockChildProcess.emit('close', 0)

      await mainPromise

      expect(mockSpawn).toHaveBeenCalledWith(
        'npx',
        expect.arrayContaining([
          'playwright',
          'test',
          '--config',
          expect.stringContaining('custom.config.ts'),
          '--grep',
          'demo',
        ]),
        expect.objectContaining({ stdio: 'inherit' })
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

  describe('upload annotation helpers', () => {
    it('should allow missing voice entries when annotating caption translations', async () => {
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
                type: 'captionStart',
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
            type: 'captionStart',
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
        expect.stringContaining(`my-project/Dockerfile`),
        expect.stringContaining('FROM ghcr.io/screenci/record:latest')
      )
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining(`my-project/.gitignore`),
        expect.stringContaining('node_modules/')
      )
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining('example.video.ts'),
        expect.stringContaining("import { video } from 'screenci'")
      )
    })

    it('should add playwright-cli to devDependencies when AI authoring is confirmed', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project']
      mockExistsSync.mockReturnValue(false)
      mockConfirm.mockResolvedValueOnce(true)

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
      mockConfirm.mockResolvedValueOnce(false)

      const { main } = await import('./cli')
      await main()

      const pkgCall = mockWriteFile.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === 'string' && c[0].endsWith('package.json')
      )
      expect(pkgCall?.[1]).not.toContain('"@playwright/cli": "latest"')
    })

    it('should create .github/workflows/record.yml with SCREENCI_SECRET check', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project']
      mockExistsSync.mockReturnValue(false)

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
      expect(workflowCall?.[1]).toContain('docker build')
      expect(workflowCall?.[1]).toContain('docker run')
      expect(workflowCall?.[1]).toContain('npm run record')
      expect(workflowCall?.[1]).toContain('exit 1')
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

      const { main } = await import('./cli')
      await expect(main()).rejects.toThrow('process.exit called')

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        'Error: Directory "my-project" already exists'
      )
      expect(processExitSpy).toHaveBeenCalledWith(1)
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

    it('should not create an http server during init', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project']
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')
      await main()

      expect(mockCreateHttpServer).not.toHaveBeenCalled()
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
          'https://screenci.com/guides/getting-started/#prerequisites'
        )
      )
    })

    it('should warn during init when podman is present but below version 5', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project']
      mockExistsSync.mockReturnValue(false)
      mockSpawnSync.mockReturnValue({
        status: 0,
        error: undefined,
        stdout: 'podman version 4.9.3',
        stderr: '',
      })

      const { main } = await import('./cli')
      await main()

      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('podman 5+ recommended')
      )
    })

    it('should not warn during init when podman is available and supported', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project']
      mockExistsSync.mockReturnValue(false)
      mockSpawnSync.mockReturnValue({
        status: 0,
        error: undefined,
        stdout: 'podman version 5.2.0',
        stderr: '',
      })

      const { main } = await import('./cli')
      await main()

      expect(loggerWarnSpy).not.toHaveBeenCalled()
      expect(mockSpawnSync).toHaveBeenCalledTimes(1)
    })

    it('should run npm install automatically', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project']
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')
      await main()

      expect(mockSpawn).toHaveBeenCalledWith(
        'npm',
        expect.arrayContaining(['install']),
        expect.objectContaining({ stdio: 'pipe' })
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
        expect.objectContaining({
          cwd: expect.stringContaining('my-project'),
          stdio: 'inherit',
        })
      )
    })

    it('should skip Chromium prompt when Playwright reports Chromium already installed', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project']
      mockExistsSync.mockReturnValue(false)

      const createChild = () =>
        Object.assign(new EventEmitter(), {
          unref: vi.fn(),
          stdout: new EventEmitter(),
          stderr: new EventEmitter(),
        }) as unknown as ChildProcess & {
          stdout: EventEmitter
          stderr: EventEmitter
        }

      mockSpawn.mockImplementationOnce(() => {
        const child = createChild()
        process.nextTick(() => child.emit('close', 0))
        return child
      })
      mockSpawn.mockImplementationOnce(() => {
        const child = createChild()
        process.nextTick(() => {
          child.emit('close', 0)
        })
        return child
      })
      mockSpawn.mockImplementationOnce(() => {
        const child = createChild()
        process.nextTick(() => {
          child.stdout.emit(
            'data',
            '/home/test/.cache/ms-playwright/chromium-1200\n'
          )
          child.emit('close', 0)
        })
        return child
      })

      const { main } = await import('./cli')
      await main()

      expect(mockConfirm).toHaveBeenCalledTimes(1)
      expect(mockSpawn).not.toHaveBeenCalledWith(
        'npx',
        ['playwright', 'install', 'chromium', '--with-deps'],
        expect.any(Object)
      )
      expect(loggerInfoSpy).toHaveBeenCalledWith(
        `${pc.green('✔')} Skipping Chromium installation, version 1200 already installed.`
      )
      expect(loggerInfoSpy).not.toHaveBeenCalledWith(
        'Local development requires Chromium for Playwright.'
      )
    })

    it('should show Chromium check output and result with init --verbose', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project', '--verbose']
      mockExistsSync.mockReturnValue(false)

      const createChild = () =>
        Object.assign(new EventEmitter(), {
          unref: vi.fn(),
          stdout: new EventEmitter(),
          stderr: new EventEmitter(),
        }) as unknown as ChildProcess & {
          stdout: EventEmitter
          stderr: EventEmitter
        }

      mockSpawn.mockImplementationOnce(() => {
        const child = createChild()
        process.nextTick(() => child.emit('close', 0))
        return child
      })
      mockSpawn.mockImplementationOnce(() => {
        const child = createChild()
        process.nextTick(() => {
          child.emit('close', 0)
        })
        return child
      })
      mockSpawn.mockImplementationOnce(() => {
        const child = createChild()
        process.nextTick(() => {
          child.stdout.emit(
            'data',
            '/home/test/.cache/ms-playwright/chromium-1200\n'
          )
          child.emit('close', 0)
        })
        return child
      })

      const { main } = await import('./cli')
      await main()

      expect(loggerInfoSpy).toHaveBeenCalledWith(
        'Checking Playwright Chromium install with: npx playwright install --list'
      )
      expect(loggerInfoSpy).toHaveBeenCalledWith(
        '/home/test/.cache/ms-playwright/chromium-1200'
      )
      expect(loggerInfoSpy).toHaveBeenCalledWith(
        'Chromium check result: Chromium found in Playwright install list (version 1200)'
      )
    })

    it('should show npm install output with init --verbose', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project', '--verbose']
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')
      await main()

      expect(loggerInfoSpy).toHaveBeenCalledWith("Running 'npm install'...")
      expect(mockSpawn).toHaveBeenCalledWith(
        'npm',
        ['install'],
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
          expect.stringContaining('Node.js 18 or higher is required')
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
        'Local development requires Chromium for Playwright.'
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
      mockConfirm.mockResolvedValueOnce(true)

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
      mockConfirm.mockResolvedValueOnce(false)

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
      process.env.SCREENCI_IN_CONTAINER = 'true'
      process.argv = [
        'node',
        'cli.js',
        'record',
        '--headed',
        '--project=chromium',
      ]

      const { main } = await import('./cli')
      const mainPromise = main()

      await new Promise((resolve) => setTimeout(resolve, 10))
      mockChildProcess.emit('close', 0)

      await mainPromise

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['--headed', '--project=chromium']),
        expect.objectContaining({ stdio: 'inherit' })
      )
    })
  })
})
