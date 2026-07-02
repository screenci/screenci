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
  describe('ScreenCI environment URL helpers', () => {
    it('should default to production backend and frontend URLs', async () => {
      const { getDevBackendUrl, getDevFrontendUrl } = await import('./cli')

      expect(getDevBackendUrl()).toBe('https://api.screenci.com')
      expect(getDevFrontendUrl()).toBe('https://app.screenci.com')
    })

    it('should use DEV_BACKEND_PORT for local backend uploads', async () => {
      process.env.SCREENCI_ENVIRONMENT = 'local'
      process.env.DEV_BACKEND_PORT = '8787'

      const { getDevBackendUrl } = await import('./cli')

      expect(getDevBackendUrl()).toBe('http://localhost:8787')
    })

    it('should use DEV_FRONTEND_PORT for local frontend auth and links', async () => {
      process.env.SCREENCI_ENVIRONMENT = 'local'
      process.env.DEV_FRONTEND_PORT = '5173'

      const { getDevFrontendUrl } = await import('./cli')

      expect(getDevFrontendUrl()).toBe('http://localhost:5173')
    })

    it('should use the local backend URL for auth bootstrap sessions', async () => {
      process.env.SCREENCI_ENVIRONMENT = 'local'
      process.env.DEV_BACKEND_PORT = '8787'

      const { getCliLinkSessionApiUrl } = await import('./cli')

      expect(getCliLinkSessionApiUrl()).toBe('http://localhost:8787')
    })

    it('should use the production backend URL for auth bootstrap sessions', async () => {
      const { getCliLinkSessionApiUrl } = await import('./cli')

      expect(getCliLinkSessionApiUrl()).toBe('https://api.screenci.com')
    })

    it('should use dev hosted URLs when SCREENCI_ENVIRONMENT=dev', async () => {
      process.env.SCREENCI_ENVIRONMENT = 'dev'

      const { getDevBackendUrl, getDevFrontendUrl } = await import('./cli')

      expect(getDevBackendUrl()).toBe('https://dev.api.screenci.com')
      expect(getDevFrontendUrl()).toBe('https://dev.app.screenci.com')
    })
  })
})
