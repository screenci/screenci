import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import { Readable } from 'stream'
import { stripVTControlCharacters } from 'util'
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
  describe('record command', () => {
    beforeEach(() => {
      process.env.SCREENCI_SECRET = 'test-secret'
    })

    it('bootstraps auth interactively when SCREENCI_SECRET is missing', async () => {
      delete process.env.SCREENCI_SECRET
      // Force an interactive session so record runs the blocking browser flow.
      // detectInteractiveSession() also treats CI=true and SCREENCI_NONINTERACTIVE
      // as non-interactive, so clear them (GitHub Actions sets CI=true).
      delete process.env.CI
      delete process.env.SCREENCI_NONINTERACTIVE
      const originalStdoutTTY = process.stdout.isTTY
      const originalStdinTTY = process.stdin.isTTY
      process.stdout.isTTY = true
      process.stdin.isTTY = true
      process.argv = ['node', 'cli.js', 'record']
      const timeoutSpy = vi.spyOn(global, 'setTimeout').mockImplementation(((
        fn: () => void
      ) => {
        fn()
        return 0 as unknown as ReturnType<typeof setTimeout>
      }) as unknown as typeof setTimeout)
      let pollCount = 0
      mockFetch.mockImplementation(
        async (input: string | URL, init?: RequestInit) => {
          const url = String(input)
          if (url.endsWith('/cli-link/session') && init?.method === 'POST') {
            return {
              ok: true,
              status: 201,
              json: vi.fn().mockResolvedValue({
                token: 'session-token-123',
                createdAt: '2026-06-11T10:00:00.000Z',
                expiresAt: '2099-06-11T10:15:00.000Z',
              }),
              text: vi.fn().mockResolvedValue(''),
            }
          }
          if (url.includes('/cli-link/session?token=session-token-123')) {
            pollCount += 1
            // Pending through the initial check and one in-loop poll, then
            // completed: the human opens the printed link and signs in while the
            // interactive loop waits (and sleeps once on the 2s cadence).
            if (pollCount < 3) {
              return {
                ok: true,
                status: 200,
                json: vi.fn().mockResolvedValue({ status: 'pending' }),
                text: vi.fn().mockResolvedValue(''),
              }
            }
            return {
              ok: true,
              status: 200,
              json: vi.fn().mockResolvedValue({
                status: 'completed',
                secret: 'auth-secret-123',
              }),
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

      await main()

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.screenci.com/cli-link/session',
        { method: 'POST' }
      )
      expect(loggerInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining('https://app.screenci.com/cli-auth?session=')
      )
      // Interactive sessions poll on the 2-second cadence while waiting.
      expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), 2_000)
      expect(mockWriteFile).toHaveBeenCalledWith(
        `${process.cwd()}/.screenci/link-session.json`,
        expect.stringContaining('"token": "session-token-123"')
      )
      expect(mockWriteFile).toHaveBeenCalledWith(
        `${process.cwd()}/.env`,
        'SCREENCI_SECRET=auth-secret-123\n'
      )

      timeoutSpy.mockRestore()
      process.stdout.isTTY = originalStdoutTTY
      process.stdin.isTTY = originalStdinTTY
    })

    it('with sign-in waiting disabled (SCREENCI_NONINTERACTIVE), prints the link and exits 0 without recording', async () => {
      delete process.env.SCREENCI_SECRET
      process.env.SCREENCI_NONINTERACTIVE = '1'
      process.argv = ['node', 'cli.js', 'record']
      mockFetch.mockImplementation(
        async (input: string | URL, init?: RequestInit) => {
          const url = String(input)
          if (url.endsWith('/cli-link/session') && init?.method === 'POST') {
            return {
              ok: true,
              status: 201,
              json: vi.fn().mockResolvedValue({
                token: 'session-token-123',
                createdAt: '2026-06-11T10:00:00.000Z',
                expiresAt: '2099-06-11T10:15:00.000Z',
              }),
              text: vi.fn().mockResolvedValue(''),
            }
          }
          if (url.includes('/cli-link/session?token=session-token-123')) {
            return {
              ok: true,
              status: 200,
              json: vi.fn().mockResolvedValue({ status: 'pending' }),
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

      const { main } = await import('./cli')

      await expect(main()).rejects.toThrow('process.exit called')

      expect(loggerInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining('https://app.screenci.com/cli-auth?session=')
      )
      // A pending sign-in is an expected handoff, not a failure, so we exit 0.
      expect(processExitSpy).toHaveBeenCalledWith(0)
      // Never starts Playwright when sign-in has not completed.
      expect(mockSpawn).not.toHaveBeenCalled()
      expect(mockWriteFile).not.toHaveBeenCalledWith(
        `${process.cwd()}/.env`,
        expect.stringContaining('SCREENCI_SECRET=')
      )
    })

    it('with --poll-auth, waits for sign-in then records in a non-interactive session', async () => {
      delete process.env.SCREENCI_SECRET
      process.env.SCREENCI_NONINTERACTIVE = '1'
      process.argv = ['node', 'cli.js', 'record', '--poll-auth']
      const timeoutSpy = vi.spyOn(global, 'setTimeout').mockImplementation(((
        fn: () => void
      ) => {
        fn()
        return 0 as unknown as ReturnType<typeof setTimeout>
      }) as unknown as typeof setTimeout)
      let pollCount = 0
      mockFetch.mockImplementation(
        async (input: string | URL, init?: RequestInit) => {
          const url = String(input)
          if (url.endsWith('/cli-link/session') && init?.method === 'POST') {
            return {
              ok: true,
              status: 201,
              json: vi.fn().mockResolvedValue({
                token: 'session-token-123',
                createdAt: '2026-06-11T10:00:00.000Z',
                expiresAt: '2099-06-11T10:15:00.000Z',
              }),
              text: vi.fn().mockResolvedValue(''),
            }
          }
          if (url.includes('/cli-link/session?token=session-token-123')) {
            pollCount += 1
            // Stay pending through the initial check and one in-loop poll, then
            // complete: proves --poll-auth keeps waiting (and delays between
            // checks) instead of exiting on the first pending.
            if (pollCount < 3) {
              return {
                ok: true,
                status: 200,
                json: vi.fn().mockResolvedValue({ status: 'pending' }),
                text: vi.fn().mockResolvedValue(''),
              }
            }
            return {
              ok: true,
              status: 200,
              json: vi.fn().mockResolvedValue({
                status: 'completed',
                secret: 'auth-secret-123',
              }),
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

      await main()

      expect(loggerInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining('https://app.screenci.com/cli-auth?session=')
      )
      // Waited for sign-in (polled past the first pending) on the 5s cadence.
      expect(pollCount).toBe(3)
      expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), 5_000)
      // Persisted the secret and went on to record once sign-in completed.
      expect(mockWriteFile).toHaveBeenCalledWith(
        `${process.cwd()}/.env`,
        'SCREENCI_SECRET=auth-secret-123\n'
      )
      expect(mockSpawn).toHaveBeenCalled()
      timeoutSpy.mockRestore()
    })

    it('with --poll-auth, stops polling and exits non-zero once the timeout elapses', async () => {
      delete process.env.SCREENCI_SECRET
      process.env.SCREENCI_NONINTERACTIVE = '1'
      // A zero timeout makes the deadline elapse on the first pending check, so
      // the loop stops without waiting in real time.
      process.env.SCREENCI_POLL_AUTH_TIMEOUT_MS = '0'
      process.argv = ['node', 'cli.js', 'record', '--poll-auth']
      mockFetch.mockImplementation(
        async (input: string | URL, init?: RequestInit) => {
          const url = String(input)
          if (url.endsWith('/cli-link/session') && init?.method === 'POST') {
            return {
              ok: true,
              status: 201,
              json: vi.fn().mockResolvedValue({
                token: 'session-token-123',
                createdAt: '2026-06-11T10:00:00.000Z',
                expiresAt: '2099-06-11T10:15:00.000Z',
              }),
              text: vi.fn().mockResolvedValue(''),
            }
          }
          if (url.includes('/cli-link/session?token=session-token-123')) {
            // Never completes: proves --poll-auth gives up at the timeout.
            return {
              ok: true,
              status: 200,
              json: vi.fn().mockResolvedValue({ status: 'pending' }),
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

      const { main } = await import('./cli')

      await expect(main()).rejects.toThrow('process.exit called')

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Timed out')
      )
      // A timed-out sign-in means nothing was recorded, so fail loud: exit 1.
      expect(processExitSpy).toHaveBeenCalledWith(1)
      // Never starts Playwright and never persists a secret when it times out.
      expect(mockSpawn).not.toHaveBeenCalled()
      expect(mockWriteFile).not.toHaveBeenCalledWith(
        `${process.cwd()}/.env`,
        expect.stringContaining('SCREENCI_SECRET=')
      )
    })

    it('waits for sign-in by default (no flag) in a non-interactive agent session, then records', async () => {
      delete process.env.SCREENCI_SECRET
      // A coding agent: no terminal, no CI marker. record should wait and record
      // without needing --poll-auth.
      delete process.env.CI
      delete process.env.SCREENCI_NONINTERACTIVE
      const originalStdoutTTY = process.stdout.isTTY
      const originalStdinTTY = process.stdin.isTTY
      process.stdout.isTTY = false
      process.stdin.isTTY = false
      process.argv = ['node', 'cli.js', 'record']
      const timeoutSpy = vi.spyOn(global, 'setTimeout').mockImplementation(((
        fn: () => void
      ) => {
        fn()
        return 0 as unknown as ReturnType<typeof setTimeout>
      }) as unknown as typeof setTimeout)
      let pollCount = 0
      mockFetch.mockImplementation(
        async (input: string | URL, init?: RequestInit) => {
          const url = String(input)
          if (url.endsWith('/cli-link/session') && init?.method === 'POST') {
            return {
              ok: true,
              status: 201,
              json: vi.fn().mockResolvedValue({
                token: 'session-token-123',
                createdAt: '2026-06-11T10:00:00.000Z',
                expiresAt: '2099-06-11T10:15:00.000Z',
              }),
              text: vi.fn().mockResolvedValue(''),
            }
          }
          if (url.includes('/cli-link/session?token=session-token-123')) {
            pollCount += 1
            if (pollCount < 3) {
              return {
                ok: true,
                status: 200,
                json: vi.fn().mockResolvedValue({ status: 'pending' }),
                text: vi.fn().mockResolvedValue(''),
              }
            }
            return {
              ok: true,
              status: 200,
              json: vi.fn().mockResolvedValue({
                status: 'completed',
                secret: 'auth-secret-123',
              }),
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

      await main()

      // Polled past the first pending on the 5s agent cadence, then recorded.
      expect(pollCount).toBe(3)
      expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), 5_000)
      expect(mockWriteFile).toHaveBeenCalledWith(
        `${process.cwd()}/.env`,
        'SCREENCI_SECRET=auth-secret-123\n'
      )
      expect(mockSpawn).toHaveBeenCalled()

      timeoutSpy.mockRestore()
      process.stdout.isTTY = originalStdoutTTY
      process.stdin.isTTY = originalStdinTTY
    })

    it('with --no-poll-auth, prints the link and exits 0 without waiting even off-CI', async () => {
      delete process.env.SCREENCI_SECRET
      delete process.env.CI
      delete process.env.SCREENCI_NONINTERACTIVE
      const originalStdoutTTY = process.stdout.isTTY
      const originalStdinTTY = process.stdin.isTTY
      process.stdout.isTTY = false
      process.stdin.isTTY = false
      process.argv = ['node', 'cli.js', 'record', '--no-poll-auth']
      const timeoutSpy = vi.spyOn(global, 'setTimeout')
      mockFetch.mockImplementation(
        async (input: string | URL, init?: RequestInit) => {
          const url = String(input)
          if (url.endsWith('/cli-link/session') && init?.method === 'POST') {
            return {
              ok: true,
              status: 201,
              json: vi.fn().mockResolvedValue({
                token: 'session-token-123',
                createdAt: '2026-06-11T10:00:00.000Z',
                expiresAt: '2099-06-11T10:15:00.000Z',
              }),
              text: vi.fn().mockResolvedValue(''),
            }
          }
          if (url.includes('/cli-link/session?token=session-token-123')) {
            return {
              ok: true,
              status: 200,
              json: vi.fn().mockResolvedValue({ status: 'pending' }),
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

      const { main } = await import('./cli')

      await expect(main()).rejects.toThrow('process.exit called')

      expect(loggerInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining('https://app.screenci.com/cli-auth?session=')
      )
      // Did not poll, did not record, and handed off cleanly (exit 0).
      expect(timeoutSpy).not.toHaveBeenCalled()
      expect(processExitSpy).toHaveBeenCalledWith(0)
      expect(mockSpawn).not.toHaveBeenCalled()

      timeoutSpy.mockRestore()
      process.stdout.isTTY = originalStdoutTTY
      process.stdin.isTTY = originalStdinTTY
    })

    it('under CI, prints the link and exits 0 without waiting', async () => {
      delete process.env.SCREENCI_SECRET
      delete process.env.SCREENCI_NONINTERACTIVE
      process.env.CI = 'true'
      process.argv = ['node', 'cli.js', 'record']
      const timeoutSpy = vi.spyOn(global, 'setTimeout')
      mockFetch.mockImplementation(
        async (input: string | URL, init?: RequestInit) => {
          const url = String(input)
          if (url.endsWith('/cli-link/session') && init?.method === 'POST') {
            return {
              ok: true,
              status: 201,
              json: vi.fn().mockResolvedValue({
                token: 'session-token-123',
                createdAt: '2026-06-11T10:00:00.000Z',
                expiresAt: '2099-06-11T10:15:00.000Z',
              }),
              text: vi.fn().mockResolvedValue(''),
            }
          }
          if (url.includes('/cli-link/session?token=session-token-123')) {
            return {
              ok: true,
              status: 200,
              json: vi.fn().mockResolvedValue({ status: 'pending' }),
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

      const { main } = await import('./cli')

      await expect(main()).rejects.toThrow('process.exit called')

      expect(timeoutSpy).not.toHaveBeenCalled()
      expect(processExitSpy).toHaveBeenCalledWith(0)
      expect(mockSpawn).not.toHaveBeenCalled()

      timeoutSpy.mockRestore()
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
        process.execPath,
        expect.arrayContaining([
          expect.stringContaining('@playwright/test/cli'),
          'test',
        ]),
        expect.objectContaining({
          env: expect.objectContaining({
            SCREENCI_RECORDING: 'true',
            VITE_APP_BASE_URL: 'https://example.com',
          }),
          stdio: 'inherit',
        })
      )
    })

    it('injects Studio text overrides into the recording env', async () => {
      process.argv = ['node', 'cli.js', 'record']
      const overrides = { en: { heading: 'From Studio' } }
      mockFetch.mockImplementation(async (input: string | URL) => {
        const url = String(input)
        if (url.includes('/cli/text-overrides')) {
          return {
            ok: true,
            status: 200,
            json: vi.fn().mockResolvedValue({ overrides }),
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
      let capturedEnv: NodeJS.ProcessEnv | undefined
      mockSpawn.mockImplementation(
        (
          _command: string,
          _args: string[],
          options?: { env?: NodeJS.ProcessEnv }
        ) => {
          capturedEnv = options?.env
          process.nextTick(() => mockChildProcess.emit('close', 0))
          return mockChildProcess as unknown as ChildProcess
        }
      )

      const { main } = await import('./cli')
      await main()

      expect(capturedEnv?.SCREENCI_TEXT_OVERRIDES).toBe(
        JSON.stringify(overrides)
      )
    })

    it('records without text overrides when the endpoint fails', async () => {
      process.argv = ['node', 'cli.js', 'record']
      mockFetch.mockImplementation(async (input: string | URL) => {
        const url = String(input)
        if (url.includes('/cli/text-overrides')) {
          return {
            ok: false,
            status: 500,
            json: vi.fn().mockResolvedValue({}),
            text: vi.fn().mockResolvedValue('boom'),
          }
        }
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({}),
          text: vi.fn().mockResolvedValue(''),
        }
      })
      let capturedEnv: NodeJS.ProcessEnv | undefined
      mockSpawn.mockImplementation(
        (
          _command: string,
          _args: string[],
          options?: { env?: NodeJS.ProcessEnv }
        ) => {
          capturedEnv = options?.env
          process.nextTick(() => mockChildProcess.emit('close', 0))
          return mockChildProcess as unknown as ChildProcess
        }
      )

      const { main } = await import('./cli')
      await main()

      expect(mockSpawn).toHaveBeenCalled()
      expect(capturedEnv?.SCREENCI_TEXT_OVERRIDES).toBeUndefined()
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
        recordId: expect.any(String),
        hadFailures: false,
        studioNotices: [],
        failedVideoNames: [],
        failedVideoMessages: [],
        plan: null,
      })
      expect(mockReaddir).toHaveBeenCalledWith('/repo/.screenci')
      expect(mockReadFile).toHaveBeenCalledWith(
        expect.stringContaining('/repo/.screenci/demo-video/data.json'),
        'utf-8'
      )
    })

    it('prints the result URL and an upgrade mention after a successful record', async () => {
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

      await main()

      const messages = loggerInfoSpy.mock.calls.map((call) =>
        stripVTControlCharacters(String(call[0]))
      )
      expect(messages).toContain(
        'Recording finished, rendering in progress. Results available at:'
      )
      expect(messages.some((message) => message.includes('/select-plan'))).toBe(
        true
      )
    })

    it('omits the upgrade mention for business plans', async () => {
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
              plan: 'business',
            }),
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

      const { main } = await import('./cli')

      await main()

      const messages = loggerInfoSpy.mock.calls.map((call) =>
        stripVTControlCharacters(String(call[0]))
      )
      expect(messages).toContain(
        'Recording finished, rendering in progress. Results available at:'
      )
      expect(messages.some((message) => message.includes('/select-plan'))).toBe(
        false
      )
    })

    it('surfaces studio hold and override notices from the upload start response', async () => {
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
              videoId: 'video_123',
              studio: { held: true },
            }),
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

      expect(result.studioNotices).toEqual([
        {
          videoName: 'Demo',
          videoId: 'video_123',
          studio: { held: true },
        },
      ])
    })

    it('surfaces an applied studio notice when configuration was applied', async () => {
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
              videoId: 'video_123',
              studio: { applied: true },
            }),
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

      expect(result.studioNotices).toEqual([
        {
          videoName: 'Demo',
          videoId: 'video_123',
          studio: { applied: true },
        },
      ])
    })

    it('formats studio URLs', async () => {
      const { formatStudioUrl } = await import('./cli')

      expect(
        formatStudioUrl('https://app.screenci.test', 'project_1', 'video_2')
      ).toBe('https://app.screenci.test/project/project_1/video/video_2/studio')
    })

    it('forwards ELEVENLABS_API_KEY during upload requests when configured', async () => {
      process.env.ELEVENLABS_API_KEY = 'elevenlabs-byok-key'
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

      const { uploadRecordings } = await import('./cli')

      await uploadRecordings(
        '/repo/.screenci',
        'Test Project',
        'https://api.screenci.test',
        'test-secret'
      )

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.screenci.test/cli/upload/start',
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-ScreenCI-Secret': 'test-secret',
            'X-ElevenLabs-Api-Key': 'elevenlabs-byok-key',
          }),
        })
      )
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.screenci.test/cli/upload/recording_123/recording',
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-ScreenCI-Secret': 'test-secret',
            'X-ElevenLabs-Api-Key': 'elevenlabs-byok-key',
          }),
        })
      )
    })

    it('does not forward arbitrary env vars (e.g. user app secrets) to the service', async () => {
      process.env.YOUR_PRIVATE_SECRET = 'super-secret-app-key'
      process.env.GOOGLE_CLOUD_API_KEY = 'should-never-leave-the-machine'
      delete process.env.ELEVENLABS_API_KEY
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

        return {
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({}),
          text: vi.fn().mockResolvedValue(''),
        }
      })

      const { uploadRecordings } = await import('./cli')

      await uploadRecordings(
        '/repo/.screenci',
        'Test Project',
        'https://api.screenci.test',
        'test-secret'
      )

      const sentHeaders = mockFetch.mock.calls.flatMap((call) => {
        const init = call[1] as { headers?: Record<string, string> } | undefined
        return init?.headers ? [init.headers] : []
      })
      expect(sentHeaders.length).toBeGreaterThan(0)
      for (const headers of sentHeaders) {
        const allowedHeaderNames = new Set([
          'Content-Type',
          'Content-Length',
          'X-ScreenCI-Secret',
        ])
        for (const name of Object.keys(headers)) {
          expect(allowedHeaderNames.has(name)).toBe(true)
        }
        const serialized = JSON.stringify(headers)
        expect(serialized).not.toContain('super-secret-app-key')
        expect(serialized).not.toContain('should-never-leave-the-machine')
        expect(serialized.toUpperCase()).not.toContain('GOOGLE')
        expect(serialized.toUpperCase()).not.toContain('VERTEX')
      }
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
        recordId: null,
        hadFailures: false,
        studioNotices: [],
        failedVideoNames: [],
        failedVideoMessages: [],
        plan: null,
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
        recordId: expect.any(String),
        hadFailures: true,
        studioNotices: [],
        failedVideoNames: ['Demo'],
        failedVideoMessages: [
          {
            videoName: 'Demo',
            message: 'Missing recording.mp4 for "Demo"',
          },
        ],
        plan: null,
      })
      expect(mockFetch).not.toHaveBeenCalledWith(
        expect.stringContaining('/cli/upload/start'),
        expect.anything()
      )
    })

    it('uploads a screenshot recording as image/png from screenshot.png', async () => {
      mockReaddir.mockResolvedValue(['home'])
      mockReadFile.mockImplementation(async (path: string | URL) => {
        const pathString = String(path)
        if (pathString.endsWith('package.json')) {
          return JSON.stringify({ version: '0.0.32' })
        }
        if (pathString.endsWith('data.json')) {
          return JSON.stringify({
            events: [],
            output: 'screenshot',
            screenshot: {
              path: 'screenshot.png',
              width: 1920,
              height: 1080,
              deviceScaleFactor: 1,
            },
            metadata: { videoName: 'home' },
          })
        }
        return ''
      })
      // The screenshot capture exists, but there is no recording.mp4.
      mockExistsSync.mockImplementation(
        (path: string) =>
          path.endsWith('data.json') || path.endsWith('screenshot.png')
      )

      let recordingPut: RequestInit | undefined
      mockFetch.mockImplementation(
        async (input: string | URL, init?: RequestInit) => {
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
            recordingPut = init
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
        recordId: expect.any(String),
        hadFailures: false,
        studioNotices: [],
        failedVideoNames: [],
        failedVideoMessages: [],
        plan: null,
      })
      // The capture is streamed from screenshot.png with an image content type.
      expect(mockCreateReadStream).toHaveBeenCalledWith(
        expect.stringContaining('screenshot.png')
      )
      expect(
        (recordingPut?.headers as Record<string, string> | undefined)?.[
          'Content-Type'
        ]
      ).toBe('image/png')
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
        recordId: expect.any(String),
        hadFailures: true,
        studioNotices: [],
        failedVideoNames: ['Demo'],
        failedVideoMessages: [
          {
            videoName: 'Demo',
            message:
              'Failed to check asset videos/logo.png: 500 backend exploded',
          },
        ],
        plan: null,
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
              sourceFilePath: 'videos/nested/demo.screenci.ts',
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
        recordId: expect.any(String),
        hadFailures: false,
        studioNotices: [],
        failedVideoNames: [],
        failedVideoMessages: [],
        plan: null,
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
        recordId: expect.any(String),
        hadFailures: true,
        studioNotices: [],
        failedVideoNames: ['Failed Demo'],
        failedVideoMessages: [
          {
            videoName: 'Failed Demo',
            message: 'Upload limit reached for current plan.',
          },
        ],
        plan: null,
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
        recordId: expect.any(String),
        hadFailures: false,
        studioNotices: [],
        failedVideoNames: [],
        failedVideoMessages: [],
        plan: null,
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
        recordId: expect.any(String),
        hadFailures: false,
        studioNotices: [],
        failedVideoNames: [],
        failedVideoMessages: [],
        plan: null,
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
          recordId: expect.any(String),
          hadFailures: false,
          studioNotices: [],
          failedVideoNames: [],
          failedVideoMessages: [],
          plan: null,
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

    it('logs upload completions normally on interactive terminals', async () => {
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

        const messages = loggerInfoSpy.mock.calls.map((call) =>
          stripVTControlCharacters(String(call[0]))
        )
        expect(messages).toContain('✔ Uploaded "Demo"')
        expect(messages).toContain('✔ Uploaded "Second Demo"')
        expect(stdoutWriteSpy).not.toHaveBeenCalled()
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

    it('logs assets without reserving upload rows on interactive terminals', async () => {
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

        const messages = loggerInfoSpy.mock.calls.map((call) =>
          stripVTControlCharacters(String(call[0]))
        )

        expect(messages).toContain('✔ Asset already exists: videos/logo.png')
        expect(messages).toContain('✔ Uploaded "Demo"')
        expect(messages).toContain('✔ Uploaded "Second Demo"')
        expect(stdoutWriteSpy).not.toHaveBeenCalled()
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

    it('warns when not all uploads succeed after a partial upload', async () => {
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
        "Find ScreenCI docs and getting started: Expressive narration and style prompts require the Business tier. Upgrade your subscription tier at https://app.screenci.com/billing to continue rendering.\nIf you want to keep using the current tier, remove `voice.style` or `modelType: 'expressive'` from the localize `voice`."
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

    describe('--remote', () => {
      it('dispatches the workflow and does not record locally', async () => {
        process.argv = ['node', 'cli.js', 'record', '--remote']

        const { main } = await import('./cli')
        await main()

        // Pure dispatch: no Playwright child process is spawned.
        expect(mockSpawn).not.toHaveBeenCalled()

        const triggerCall = mockFetch.mock.calls.find((call) =>
          String(call[0]).endsWith('/cli/trigger-run')
        )
        expect(triggerCall).toBeDefined()

        const init = triggerCall?.[1] as RequestInit
        expect(init.method).toBe('POST')
        expect(
          (init.headers as Record<string, string>)['X-ScreenCI-Secret']
        ).toBe('test-secret')
        expect(JSON.parse(String(init.body))).toEqual({
          projectName: 'Test Project',
        })

        const messages = loggerInfoSpy.mock.calls.map((call) => String(call[0]))
        expect(
          messages.some((message) =>
            message.includes('Triggered the remote recording workflow')
          )
        ).toBe(true)
      })

      it('forwards a --grep filter to the backend', async () => {
        process.argv = [
          'node',
          'cli.js',
          'record',
          '--remote',
          '--grep',
          'Onboarding',
        ]

        const { main } = await import('./cli')
        await main()

        expect(mockSpawn).not.toHaveBeenCalled()

        const triggerCall = mockFetch.mock.calls.find((call) =>
          String(call[0]).endsWith('/cli/trigger-run')
        )
        const init = triggerCall?.[1] as RequestInit
        expect(JSON.parse(String(init.body))).toEqual({
          projectName: 'Test Project',
          grep: 'Onboarding',
        })
      })

      it('throws when the backend rejects the trigger', async () => {
        process.argv = ['node', 'cli.js', 'record', '--remote']
        mockFetch.mockResolvedValue({
          ok: false,
          status: 400,
          json: vi.fn().mockResolvedValue({}),
          text: vi
            .fn()
            .mockResolvedValue(
              'No GitHub repository is linked to this project.'
            ),
        })

        const { main } = await import('./cli')
        await expect(main()).rejects.toThrow('Failed to trigger remote run')

        expect(mockSpawn).not.toHaveBeenCalled()
      })
    })
  })
})
