import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import { Readable } from 'stream'
import { stripVTControlCharacters } from 'util'
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

// React overlay support, scaffolded by default, appends these to the shared
// dev-dependency install (after the optional playwright-cli entry).
const REACT_INSTALL_PACKAGES = [
  'react@^19.0.0',
  'react-dom@^19.0.0',
  '@types/react@^19.0.0',
  '@types/react-dom@^19.0.0',
]

function expectNpmDevInstalls(
  mockSpawn: ReturnType<typeof vi.fn>,
  cwd: string,
  screenciVersion = '0.0.32',
  includePlaywrightCli = true,
  includeReact = true
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

  // Packages sharing identical flags install in one command; screenci is
  // installed separately.
  const expectedCalls = [
    [
      'install',
      '--save-dev',
      `@playwright/test@^1.59.0`,
      '@types/node@^25.9.1',
      ...(includePlaywrightCli ? ['@playwright/cli@latest'] : []),
      ...(includeReact ? REACT_INSTALL_PACKAGES : []),
    ],
    ['install', '--save-dev', `screenci@${screenciVersion}`],
  ]

  expect(npmInstallCalls).toEqual(
    expect.arrayContaining(
      expectedCalls.map((args) => [
        'npm',
        args,
        expect.objectContaining({ cwd, stdio: 'pipe' }),
      ])
    )
  )
}

function expectPnpmDevInstalls(
  mockSpawn: ReturnType<typeof vi.fn>,
  cwd: string,
  screenciVersion = '0.0.32',
  includePlaywrightCli = true,
  includeReact = true
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
    [
      'add',
      '--save-dev',
      `@playwright/test@^1.59.0`,
      '@types/node@^25.9.1',
      ...(includePlaywrightCli ? ['@playwright/cli@latest'] : []),
      ...(includeReact ? REACT_INSTALL_PACKAGES : []),
    ],
    [
      'add',
      '--save-dev',
      '--allow-build=ffmpeg-static',
      `screenci@${screenciVersion}`,
    ],
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
  includePlaywrightCli = true,
  includeReact = true
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
    [
      'add',
      '--dev',
      `@playwright/test@^1.59.0`,
      '@types/node@^25.9.1',
      ...(includePlaywrightCli ? ['@playwright/cli@latest'] : []),
      ...(includeReact ? REACT_INSTALL_PACKAGES : []),
    ],
    ['add', '--dev', `screenci@${screenciVersion}`],
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

    it('writes init files into a self-contained screenci/ island', async () => {
      process.argv = ['node', 'cli.js', 'init', 'My Project']
      process.env.SCREENCI_INIT_CWD = '/workspace/my-app'
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')
      await main()

      expect(mockMkdir).toHaveBeenCalledWith(
        '/workspace/my-app/screenci/recordings',
        {
          recursive: true,
        }
      )
      expect(mockWriteFile).toHaveBeenCalledWith(
        '/workspace/my-app/screenci/screenci.config.ts',
        expect.stringContaining('"My Project"')
      )
      expect(mockWriteFile).toHaveBeenCalledWith(
        '/workspace/my-app/screenci/screenci.config.ts',
        expect.stringContaining('workers: process.env.CI ? 1 : undefined')
      )
      expect(mockWriteFile).toHaveBeenCalledWith(
        '/workspace/my-app/screenci/screenci.config.ts',
        expect.stringContaining('fullyParallel: true')
      )
      expect(mockWriteFile).toHaveBeenCalledWith(
        '/workspace/my-app/screenci/recordings/example.screenci.ts',
        expect.stringContaining("'How to find docs'")
      )
      expect(mockWriteFile).toHaveBeenCalledWith(
        '/workspace/my-app/screenci/recordings/example.screenci.ts',
        expect.stringContaining("await page.goto('https://screenci.com/')")
      )
      const tsconfigCall = mockWriteFile.mock.calls.find(
        (call: unknown[]) =>
          call[0] === '/workspace/my-app/screenci/tsconfig.json'
      )
      expect(tsconfigCall).toBeDefined()
      const tsconfig = JSON.parse(tsconfigCall![1] as string) as {
        compilerOptions?: Record<string, unknown>
      }
      // `bundler` resolution lets TypeScript read screenci's ESM `exports` map.
      expect(tsconfig.compilerOptions?.['moduleResolution']).toBe('bundler')
      expect(tsconfig.compilerOptions?.['module']).toBe('ESNext')
      // `types: ['node']` makes `process.env.CI` in screenci.config.ts resolve
      // without relying on TS auto-discovery of @types/node.
      expect(tsconfig.compilerOptions?.['types']).toEqual(['node'])
      expect(mockWriteFile).not.toHaveBeenCalledWith(
        '/workspace/my-app/screenci/.env',
        ''
      )
      // The island gets its own fresh package.json (with type:module + run
      // scripts); the host package.json is never touched.
      const islandPackageJsonCall = mockWriteFile.mock.calls.find(
        (call: unknown[]) =>
          call[0] === '/workspace/my-app/screenci/package.json'
      )
      expect(islandPackageJsonCall).toBeDefined()
      const islandPkg = JSON.parse(
        islandPackageJsonCall![1] as string
      ) as Record<string, unknown>
      expect(islandPkg['type']).toBe('module')
      expect(islandPkg['name']).toBe('my-project')
      expect(islandPkg['scripts']).toMatchObject({
        test: 'screenci test',
        record: 'screenci record',
      })
      expect(islandPkg['scripts']).not.toHaveProperty('screenci')
      // The island gets a minimal README documenting the run scripts and
      // linking to the docs.
      expect(mockWriteFile).toHaveBeenCalledWith(
        '/workspace/my-app/screenci/README.md',
        expect.stringContaining('https://screenci.com/docs')
      )
      expect(mockWriteFile).not.toHaveBeenCalledWith(
        '/workspace/my-app/package.json',
        expect.any(String)
      )
      expect(mockWriteFile).toHaveBeenCalledWith(
        '/workspace/my-app/screenci/.gitignore',
        expect.stringContaining('# ScreenCI')
      )
      expect(mockWriteFile).toHaveBeenCalledWith(
        '/workspace/my-app/screenci/.gitignore',
        expect.stringContaining('# Playwright')
      )
      expect(mockWriteFile).toHaveBeenCalledWith(
        '/workspace/my-app/screenci/.gitignore',
        expect.stringContaining(
          'node_modules/\n/test-results/\n/playwright-report/\n/blob-report/\n/playwright/.cache/\n/playwright/.auth/'
        )
      )
      expectNpmDevInstalls(mockSpawn, '/workspace/my-app/screenci')
      expect(loggerInfoSpy).toHaveBeenCalledWith(
        `${pc.green('✔ Success!')} Created a ScreenCI project at /workspace/my-app/screenci`
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
        'Installing dependencies'
      )
      expect(mockSpinner.succeed).toHaveBeenCalledWith('Installing ScreenCI')
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
        '/workspace/screenci-docs/screenci/screenci.config.ts',
        expect.stringContaining('"screenci-docs"')
      )
    })

    it('appends to an existing .gitignore instead of overwriting it', async () => {
      process.argv = ['node', 'cli.js', 'init', 'My Project']
      process.env.SCREENCI_INIT_CWD = '/workspace/my-app'
      mockExistsSync.mockImplementation((path: string) => {
        const pathString = String(path)
        if (pathString === '/workspace/my-app/screenci/.gitignore') {
          return true
        }
        return false
      })
      mockReadFile.mockImplementation(async (path: string | URL) => {
        if (String(path).endsWith('/workspace/my-app/screenci/.gitignore')) {
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
        '/workspace/my-app/screenci/.gitignore',
        expect.any(String)
      )
      expect(mockAppendFile).toHaveBeenCalledWith(
        '/workspace/my-app/screenci/.gitignore',
        expect.stringContaining('\n\n# ScreenCI')
      )
      expect(mockAppendFile).toHaveBeenCalledWith(
        '/workspace/my-app/screenci/.gitignore',
        expect.stringContaining(
          '# Playwright\nnode_modules/\n/test-results/\n/playwright-report/\n/blob-report/\n/playwright/.cache/\n/playwright/.auth/'
        )
      )
    })

    it('writes a fresh island package.json and never touches an existing host package.json', async () => {
      process.argv = ['node', 'cli.js', 'init', 'My Project']
      process.env.SCREENCI_INIT_CWD = '/workspace/my-app'
      mockExistsSync.mockImplementation((path: string) => {
        const pathString = String(path)
        // A host package.json already exists at the repo root.
        if (pathString === '/workspace/my-app/package.json') {
          return true
        }
        return false
      })
      mockReadFile.mockImplementation(async (path: string | URL) => {
        if (String(path).endsWith('package.json')) {
          return JSON.stringify({ type: 'module', version: '0.0.32' })
        }
        return ''
      })

      const { main } = await import('./cli')
      await main()

      // Host package.json is left completely untouched.
      expect(mockWriteFile).not.toHaveBeenCalledWith(
        '/workspace/my-app/package.json',
        expect.any(String)
      )
      // The island gets its own fresh package.json.
      expect(mockWriteFile).toHaveBeenCalledWith(
        '/workspace/my-app/screenci/package.json',
        expect.stringContaining('"type": "module"')
      )
      expectNpmDevInstalls(mockSpawn, '/workspace/my-app/screenci')
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
            'Add React overlay support (installs react/react-dom, enables JSX, adds a .tsx example)? (Y/n)',
          default: 'y',
        }),
        expect.objectContaining({
          message:
            "Install Playwright browsers (can be done manually via 'npx playwright install --only-shell chromium')? (Y/n)",
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
            "Install playwright-cli for URL-based browser inspection (can be done manually via 'npx skills add screenci/screenci --skill playwright-cli -y && npm install --save-dev @playwright/cli')? (Y/n)",
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
      // Skills install at the repo root so coding agents discover them.
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
      expectNpmDevInstalls(mockSpawn, '/workspace/demo-app/screenci')
      expect(mockSpawn).toHaveBeenCalledWith(
        'npx',
        ['playwright', 'install', '--only-shell', 'chromium'],
        expect.objectContaining({
          cwd: '/workspace/demo-app/screenci',
          stdio: 'inherit',
        })
      )
      expect(mockSpawn).not.toHaveBeenCalledWith(
        'npx',
        ['playwright', 'install-deps', 'chromium'],
        expect.anything()
      )
    })

    it('creates the workflow at the repo root scoped to the island', async () => {
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
      expect(workflowCall?.[1]).toContain('working-directory: screenci')
      expect(workflowCall?.[1]).toContain(
        'cache-dependency-path: screenci/package-lock.json'
      )
      expect(workflowCall?.[1]).toContain(
        'Copy it from https://app.screenci.com/secrets or ./.env'
      )
      expect(workflowCall?.[1]).not.toContain('actions/cache@v5')
      expect(workflowCall?.[1]).toContain(
        'run: npx playwright install --only-shell chromium'
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

      expectPnpmDevInstalls(mockSpawn, '/workspace/my-project/screenci')
      expect(mockSpawn).toHaveBeenCalledWith(
        'pnpm',
        ['exec', 'playwright', 'install', '--only-shell', 'chromium'],
        expect.objectContaining({
          cwd: '/workspace/my-project/screenci',
          stdio: 'inherit',
        })
      )
      expect(mockWriteFile).not.toHaveBeenCalledWith(
        '/workspace/my-project/README.md',
        expect.any(String)
      )
      // The island is its own pnpm workspace root.
      expect(mockWriteFile).toHaveBeenCalledWith(
        '/workspace/my-project/screenci/pnpm-workspace.yaml',
        expect.stringContaining('ffmpeg-static')
      )
      const workflowCall = mockWriteFile.mock.calls.find(
        (call: unknown[]) =>
          typeof call[0] === 'string' && call[0].endsWith('screenci.yaml')
      )
      expect(workflowCall?.[1]).toContain('cache: pnpm')
      expect(workflowCall?.[1]).toContain(
        'cache-dependency-path: screenci/pnpm-lock.yaml'
      )
      expect(workflowCall?.[1]).toContain('HUSKY: 0')
      expect(workflowCall?.[1]).toContain('npm_config_strict_dep_builds: false')
      expect(workflowCall?.[1]).toContain('run: pnpm install --frozen-lockfile')
      expect(workflowCall?.[1]).not.toContain('actions/cache@v5')
      expect(workflowCall?.[1]).toContain(
        'run: pnpm exec playwright install --only-shell chromium'
      )
      expect(workflowCall?.[1]).toContain('pnpm exec screenci record')
      // Targeted recordings: optional `grep` input forwarded to record.
      expect(workflowCall?.[1]).toContain('SCREENCI_GREP: ${{ inputs.grep }}')
      expect(workflowCall?.[1]).toContain(
        'pnpm exec screenci record --grep "$SCREENCI_GREP"'
      )
      expect(workflowCall?.[1]).toMatch(/workflow_dispatch:\s*\n\s*inputs:/)
    })

    it('defaults to pnpm when invoked from a pnpm user agent', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project', '--yes']
      process.env.SCREENCI_INIT_CWD = '/workspace/my-project'
      process.env.npm_config_user_agent = 'pnpm/11.0.8 npm/? node/v24.0.0'
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')
      await main()

      expectPnpmDevInstalls(mockSpawn, '/workspace/my-project/screenci')
      expect(mockWriteFile).not.toHaveBeenCalledWith(
        '/workspace/my-project/README.md',
        expect.any(String)
      )
    })

    it('defaults to yarn when invoked from a yarn user agent', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project', '--yes']
      process.env.SCREENCI_INIT_CWD = '/workspace/my-project'
      process.env.npm_config_user_agent = 'yarn/4.9.1 npm/? node/v24.0.0'
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')
      await main()

      expectYarnDevInstalls(mockSpawn, '/workspace/my-project/screenci')
    })

    it('falls back to pnpm from a repo pnpm-lock.yaml when no user agent is set', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project', '--yes']
      process.env.SCREENCI_INIT_CWD = '/workspace/my-project'
      // No package manager set a user agent (e.g. a global/direct `screenci
      // init`); the island matches the surrounding pnpm repo.
      mockExistsSync.mockImplementation((p: string) =>
        p.endsWith('pnpm-lock.yaml')
      )

      const { main } = await import('./cli')
      await main()

      expectPnpmDevInstalls(mockSpawn, '/workspace/my-project/screenci')
    })

    it('falls back to pnpm from a host packageManager field when no user agent is set', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project', '--yes']
      process.env.SCREENCI_INIT_CWD = '/workspace/my-project'
      mockExistsSync.mockReturnValue(false)
      mockReadFileSync.mockImplementation((p: string) => {
        if (p.endsWith('package.json')) {
          return JSON.stringify({ packageManager: 'pnpm@11.0.9' })
        }
        return 'VITE_APP_BASE_URL=https://example.com\n'
      })

      const { main } = await import('./cli')
      await main()

      expectPnpmDevInstalls(mockSpawn, '/workspace/my-project/screenci')
    })

    it('installs into the island without -w even inside a pnpm workspace', async () => {
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
      // Simulate a surrounding pnpm workspace at the repo root.
      mockExistsSync.mockImplementation((p: string) =>
        p.endsWith('/workspace/my-project/pnpm-workspace.yaml')
      )

      const { main } = await import('./cli')
      await main()

      // No -w flag: the island is its own isolated project, installed locally.
      expect(mockSpawn).toHaveBeenCalledWith(
        'pnpm',
        [
          'add',
          '--save-dev',
          '@playwright/test@^1.59.0',
          '@types/node@^25.9.1',
          '@playwright/cli@latest',
          ...REACT_INSTALL_PACKAGES,
        ],
        expect.objectContaining({
          cwd: '/workspace/my-project/screenci',
          stdio: 'pipe',
        })
      )
      expect(mockSpawn).toHaveBeenCalledWith(
        'pnpm',
        ['add', '--save-dev', '--allow-build=ffmpeg-static', 'screenci@0.0.32'],
        expect.objectContaining({
          cwd: '/workspace/my-project/screenci',
          stdio: 'pipe',
        })
      )
      // The island declares its own pnpm workspace root so the parent does not
      // absorb it.
      expect(mockWriteFile).toHaveBeenCalledWith(
        '/workspace/my-project/screenci/pnpm-workspace.yaml',
        expect.stringContaining('ffmpeg-static')
      )
    })

    it('supports yarn init flows end to end', async () => {
      process.argv = [
        'node',
        'cli.js',
        'init',
        'my-project',
        '--package-manager',
        'yarn',
        '--yes',
      ]
      process.env.SCREENCI_INIT_CWD = '/workspace/my-project'
      mockExistsSync.mockReturnValue(false)

      const { main } = await import('./cli')
      await main()

      expectYarnDevInstalls(mockSpawn, '/workspace/my-project/screenci')
      expect(mockSpawn).toHaveBeenCalledWith(
        'yarn',
        ['playwright', 'install', '--only-shell', 'chromium'],
        expect.objectContaining({
          cwd: '/workspace/my-project/screenci',
          stdio: 'inherit',
        })
      )
      expect(mockWriteFile).toHaveBeenCalledWith(
        '/workspace/my-project/screenci/.yarnrc.yml',
        'nodeLinker: node-modules\n'
      )
      expect(mockWriteFile).toHaveBeenCalledWith(
        '/workspace/my-project/screenci/.gitignore',
        expect.stringContaining('.yarn/')
      )
      const workflowCall = mockWriteFile.mock.calls.find(
        (call: unknown[]) =>
          typeof call[0] === 'string' && call[0].endsWith('screenci.yaml')
      )
      expect(workflowCall?.[1]).toContain('cache: yarn')
      expect(workflowCall?.[1]).toContain(
        'cache-dependency-path: screenci/yarn.lock'
      )
      expect(workflowCall?.[1]).toContain('run: yarn install --frozen-lockfile')
      expect(workflowCall?.[1]).toContain(
        'run: yarn playwright install --only-shell chromium'
      )
      expect(workflowCall?.[1]).toContain('yarn screenci record')
      expect(workflowCall?.[1]).toContain(
        'yarn screenci record --grep "$SCREENCI_GREP"'
      )
    })

    it('writes a fresh island package.json without touching a host package.json that lacks type:module', async () => {
      process.argv = [
        'node',
        'cli.js',
        'init',
        'my-project',
        '--package-manager',
        'npm',
        '--yes',
      ]
      process.env.SCREENCI_INIT_CWD = '/workspace/my-project'
      // A host package.json exists at the repo root with no "type": "module".
      mockExistsSync.mockImplementation((p: string) =>
        p.endsWith('/workspace/my-project/package.json')
      )
      mockReadFile.mockImplementation(async (path: string | URL) => {
        if (String(path).endsWith('package.json')) {
          return JSON.stringify({
            name: 'smoke-workspace',
            private: true,
            version: '0.0.1',
          })
        }
        return ''
      })

      const { main } = await import('./cli')
      await main()

      // Host package.json is never modified.
      expect(mockWriteFile).not.toHaveBeenCalledWith(
        '/workspace/my-project/package.json',
        expect.any(String)
      )
      const packageJsonCall = mockWriteFile.mock.calls.find(
        (call: unknown[]) =>
          call[0] === '/workspace/my-project/screenci/package.json'
      )
      expect(packageJsonCall).toBeDefined()
      const written = JSON.parse(packageJsonCall![1] as string) as Record<
        string,
        unknown
      >
      expect(written['type']).toBe('module')
      expect(written['name']).toBe('my-project')
    })

    it('installs into the island without -W even with yarn workspaces', async () => {
      process.argv = [
        'node',
        'cli.js',
        'init',
        'my-project',
        '--package-manager',
        'yarn',
        '--yes',
      ]
      process.env.SCREENCI_INIT_CWD = '/workspace/my-project'
      mockExistsSync.mockReturnValue(false)
      mockReadFileSync.mockImplementation((p: string) => {
        if (p.endsWith('package.json')) {
          return JSON.stringify({ workspaces: ['packages/*'] })
        }
        return 'VITE_APP_BASE_URL=https://example.com\n'
      })

      const { main } = await import('./cli')
      await main()

      expect(mockSpawn).toHaveBeenCalledWith(
        'yarn',
        [
          'add',
          '--dev',
          '@playwright/test@^1.59.0',
          '@types/node@^25.9.1',
          '@playwright/cli@latest',
          ...REACT_INSTALL_PACKAGES,
        ],
        expect.objectContaining({
          cwd: '/workspace/my-project/screenci',
          stdio: 'pipe',
        })
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
        expect.objectContaining({
          cwd: '/workspace/my-project/screenci',
          stdio: 'pipe',
        })
      )
    })

    it('keeps ScreenCI skill and playwright-cli prompts separate', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project']
      process.env.SCREENCI_INIT_CWD = '/workspace/my-project'
      mockExistsSync.mockReturnValue(false)
      // Project name comes from argv, so it is not prompted.
      mockInput
        .mockResolvedValueOnce('') // github workflow
        .mockResolvedValueOnce('') // react overlays
        .mockResolvedValueOnce('') // playwright browsers
        .mockResolvedValueOnce('') // playwright OS deps
        .mockResolvedValueOnce('n') // screenci skill
        .mockResolvedValueOnce('y') // playwright-cli skill

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
      // playwright-cli is installed in the shared-flag batch alongside the
      // other dev dependencies.
      expect(mockSpawn).toHaveBeenCalledWith(
        'npm',
        [
          'install',
          '--save-dev',
          '@playwright/test@^1.59.0',
          '@types/node@^25.9.1',
          '@playwright/cli@latest',
          ...REACT_INSTALL_PACKAGES,
        ],
        expect.objectContaining({
          cwd: '/workspace/my-project/screenci',
          stdio: 'pipe',
        })
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
        ['playwright', 'install', '--only-shell', 'chromium'],
        expect.objectContaining({
          cwd: '/workspace/my-project/screenci',
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
      // Project name comes from argv, so it is not prompted.
      mockInput
        .mockResolvedValueOnce('') // github workflow
        .mockResolvedValueOnce('') // react overlays
        .mockResolvedValueOnce('') // playwright browsers
        .mockResolvedValueOnce('y') // playwright OS deps
        .mockResolvedValueOnce('') // screenci skill
        .mockResolvedValueOnce('') // playwright-cli skill

      const { main } = await import('./cli')
      await main()

      expect(mockSpawn).toHaveBeenCalledWith(
        'npx',
        ['playwright', 'install-deps', 'chromium'],
        expect.objectContaining({
          cwd: '/workspace/my-project/screenci',
          stdio: 'inherit',
        })
      )
      expect(mockSpawn).not.toHaveBeenCalledWith(
        'sudo',
        expect.anything(),
        expect.anything()
      )
    })

    it('prints next steps including cd into the island', async () => {
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
      expect(rawMessages).not.toContain(`  ${pc.cyan('npx screenci login')}`)
      expect(messages).toContain(
        '    Records locally and pauses for first-time ScreenCI setup if needed.'
      )
      expect(rawMessages).toContain(
        'Visit ' +
          pc.cyan('https://screenci.com/docs') +
          ' for more information.'
      )
      expect(messages).toContain('You can now run these commands:')
      expect(messages).toContain('We suggest that you begin by typing:')
      expect(messages).toContain('    cd screenci')
      expect(messages).toContain('    npx screenci test')
      expect(messages).toContain(
        '  - ./screenci/recordings/example.screenci.ts - Example video script'
      )
      expect(messages).toContain(
        '  - ./screenci/screenci.config.ts - ScreenCI configuration'
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
        expect.objectContaining({
          cwd: '/workspace/my-project/screenci',
          stdio: 'pipe',
        })
      )
      expect(mockInput.mock.calls.map((call) => call[0])).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message:
              "Install the ScreenCI skill for AI agents (can be done manually via 'pnpm dlx skills add screenci/screenci --skill screenci -y')? (Y/n)",
          }),
          expect.objectContaining({
            message:
              "Install Playwright browsers (can be done manually via 'pnpm exec playwright install --only-shell chromium')? (Y/n)",
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
        expect.objectContaining({
          cwd: '/workspace/my-project/screenci',
          stdio: 'pipe',
        })
      )
      // pnpm 11 (the default mocked version) approves builds via `allowBuilds`,
      // so non-interactive installs build ffmpeg-static without prompting.
      const workspaceCall = mockWriteFile.mock.calls.find(
        (call: unknown[]) =>
          call[0] === '/workspace/my-project/screenci/pnpm-workspace.yaml'
      )
      expect(workspaceCall?.[1]).toContain(
        'allowBuilds:\n  ffmpeg-static: true'
      )
      expect(workspaceCall?.[1]).not.toContain('onlyBuiltDependencies')
      // The flat (host) pnpm-workspace.yaml is never written; only the island's.
      expect(mockWriteFile).not.toHaveBeenCalledWith(
        '/workspace/my-project/pnpm-workspace.yaml',
        expect.any(String)
      )
      expect(mockReadFile).not.toHaveBeenCalledWith(
        '/workspace/my-project/pnpm-workspace.yaml',
        'utf-8'
      )
    })

    it('uses onlyBuiltDependencies build approval on pnpm 10', async () => {
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
            child.stdout.emit('data', '10.26.0\n')
          }
          child.emit('close', 0)
        })
        return child as unknown as ChildProcess
      })

      const { main } = await import('./cli')
      await main()

      const workspaceCall = mockWriteFile.mock.calls.find(
        (call: unknown[]) =>
          call[0] === '/workspace/my-project/screenci/pnpm-workspace.yaml'
      )
      expect(workspaceCall?.[1]).toContain(
        'onlyBuiltDependencies:\n  - ffmpeg-static'
      )
      expect(workspaceCall?.[1]).not.toContain('allowBuilds')
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

    it('fails fast when yarn cannot be detected', async () => {
      process.argv = [
        'node',
        'cli.js',
        'init',
        'my-project',
        '--package-manager',
        'yarn',
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
            child.emit('error', new Error('spawn yarn ENOENT'))
            return
          }
          child.emit('close', 0)
        })
        return child as unknown as ChildProcess
      })

      const { main } = await import('./cli')

      await expect(main()).rejects.toThrow(
        [
          'yarn could not be detected. ScreenCI requires yarn 2+ (yarn berry) because it uses `yarn dlx` for skill installation.',
          'Upgrade to yarn 2+ and rerun, or use a different package manager:',
          '  corepack enable && corepack prepare yarn@stable --activate',
          '  yarn create screenci',
          '  npm init screenci@latest',
        ].join('\n')
      )
      expect(mockWriteFile).not.toHaveBeenCalled()
    })

    it('fails fast when yarn 1.x is detected and corepack yarn is also v1', async () => {
      process.argv = [
        'node',
        'cli.js',
        'init',
        'my-project',
        '--package-manager',
        'yarn',
      ]
      process.env.SCREENCI_INIT_CWD = '/workspace/my-project'
      mockExistsSync.mockReturnValue(false)
      mockSpawn.mockImplementation((command: string, args: string[]) => {
        const child = Object.assign(new EventEmitter(), {
          unref: vi.fn(),
          stdout: new EventEmitter(),
          stderr: new EventEmitter(),
        })
        process.nextTick(() => {
          // yarn --version → v1; corepack yarn --version → v1 (no escape hatch)
          if (
            (command === 'yarn' && args[0] === '--version') ||
            (command === 'corepack' &&
              args[0] === 'yarn' &&
              args[1] === '--version')
          ) {
            child.stdout.emit('data', '1.22.22\n')
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
          'Detected yarn 1.22.22. ScreenCI requires yarn 2+ (yarn berry) because it uses `yarn dlx` for skill installation.',
          'Upgrade to yarn 2+ and rerun, or use a different package manager:',
          '  corepack enable && corepack prepare yarn@stable --activate',
          '  yarn create screenci',
          '  npm init screenci@latest',
        ].join('\n')
      )
      expect(mockSpawn).not.toHaveBeenCalledWith(
        'yarn',
        expect.arrayContaining(['add']),
        expect.anything()
      )
      expect(mockWriteFile).not.toHaveBeenCalled()
    })

    it('proceeds when yarn 1.x shadows the corepack shim but corepack yarn is v2+', async () => {
      process.argv = [
        'node',
        'cli.js',
        'init',
        'my-project',
        '--package-manager',
        'yarn',
        '--yes',
      ]
      process.env.SCREENCI_INIT_CWD = '/workspace/my-project'
      mockExistsSync.mockReturnValue(false)
      mockSpawn.mockImplementation((command: string, args: string[]) => {
        const child = Object.assign(new EventEmitter(), {
          unref: vi.fn(),
          stdout: new EventEmitter(),
          stderr: new EventEmitter(),
        })
        process.nextTick(() => {
          if (command === 'yarn' && args[0] === '--version') {
            // pre-installed yarn 1.x shadows corepack in PATH
            child.stdout.emit('data', '1.22.22\n')
            child.emit('close', 0)
            return
          }
          if (
            command === 'corepack' &&
            args[0] === 'yarn' &&
            args[1] === '--version'
          ) {
            // corepack has berry activated
            child.stdout.emit('data', '4.9.1\n')
            child.emit('close', 0)
            return
          }
          child.emit('close', 0)
        })
        return child as unknown as ChildProcess
      })

      const { main } = await import('./cli')

      await expect(main()).resolves.toBeUndefined()
      expect(mockWriteFile).toHaveBeenCalled()
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

    it('skips the workflow (without failing) when one already exists', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project']
      process.env.SCREENCI_INIT_CWD = '/workspace/my-project'
      mockExistsSync.mockImplementation(
        (path: string) =>
          path === '/workspace/my-project/.github/workflows/screenci.yaml'
      )

      const { main } = await import('./cli')
      await expect(main()).resolves.toBeUndefined()

      // The existing workflow is left intact and the rest of init still runs.
      expect(mockWriteFile).not.toHaveBeenCalledWith(
        '/workspace/my-project/.github/workflows/screenci.yaml',
        expect.any(String)
      )
      const messages = loggerInfoSpy.mock.calls.map((call) => String(call[0]))
      expect(
        messages.some((message) =>
          message.includes(
            'Skipping GitHub Actions workflow: .github/workflows/screenci.yaml already exists'
          )
        )
      ).toBe(true)
      expect(mockWriteFile).toHaveBeenCalledWith(
        '/workspace/my-project/screenci/screenci.config.ts',
        expect.any(String)
      )
    })

    it('fails when the screenci/ island already exists', async () => {
      process.argv = ['node', 'cli.js', 'init', 'my-project']
      process.env.SCREENCI_INIT_CWD = '/workspace/my-project'
      mockExistsSync.mockImplementation(
        (path: string) => path === '/workspace/my-project/screenci'
      )

      const { main } = await import('./cli')
      await expect(main()).rejects.toThrow('process.exit called')

      // Nothing is scaffolded when the island is already present.
      expect(mockMkdir).not.toHaveBeenCalled()
      expect(mockWriteFile).not.toHaveBeenCalled()
    })

    it('rolls back the island it created when an install fails', async () => {
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
            child.stderr.emit('data', 'boom')
            child.emit('close', 1)
            return
          }
          child.emit('close', 0)
        })
        return child as unknown as ChildProcess
      })

      const { main } = await import('./cli')
      await expect(main()).rejects.toThrow('npm exited with code 1')

      // The partially-created island is removed so a re-run starts clean.
      expect(mockRmSync).toHaveBeenCalledWith(
        '/workspace/my-project/screenci',
        {
          recursive: true,
          force: true,
        }
      )
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
        '/workspace/create-app/screenci/screenci.config.ts',
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

      expectNpmDevInstalls(mockSpawn, '/workspace/create-app/screenci')
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
              '""npm.cmd" "install" "--save-dev" "@playwright/test@^1.59.0" "@types/node@^25.9.1" "@playwright/cli@latest" "react@^19.0.0" "react-dom@^19.0.0" "@types/react@^19.0.0" "@types/react-dom@^19.0.0""'
        )
        expect(installCall).toEqual([
          'cmd.exe',
          [
            '/d',
            '/s',
            '/c',
            '""npm.cmd" "install" "--save-dev" "@playwright/test@^1.59.0" "@types/node@^25.9.1" "@playwright/cli@latest" "react@^19.0.0" "react-dom@^19.0.0" "@types/react@^19.0.0" "@types/react-dom@^19.0.0""',
          ],
          expect.objectContaining({
            cwd: '/workspace/create-app/screenci',
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

      expectPnpmDevInstalls(mockSpawn, '/workspace/create-app/screenci')
    })

    it('defaults to pnpm when invoked from pnpm create', async () => {
      const { runCreateScreenciCli } = await import('./src/init.js')

      process.env.npm_config_user_agent = 'pnpm/11.0.8 npm/? node/v24.0.0'

      await runCreateScreenciCli(['node', 'create-screenci.js', '--yes'])

      expectPnpmDevInstalls(mockSpawn, '/workspace/create-app/screenci')
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
        "Running 'npm install --save-dev @playwright/test@^1.59.0 @types/node@^25.9.1 @playwright/cli@latest react@^19.0.0 react-dom@^19.0.0 @types/react@^19.0.0 @types/react-dom@^19.0.0'..."
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
