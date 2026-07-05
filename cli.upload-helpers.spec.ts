import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ChildProcess } from 'child_process'
import { createHash } from 'crypto'
import { EventEmitter } from 'events'
import { Readable } from 'stream'
import { logger } from './src/logger.js'
import type { VoiceKey } from './src/voices.js'
import type { RecordingData } from './src/recording.js'
// Not a static top-level import: `./src/anonSession.js` imports `fs`, and a
// static import here would resolve it before this file's own mock* variables
// (below) initialize, breaking the `vi.mock('fs', ...)` hoisting below. Each
// test instead destructures `secretCredential` off the same dynamic
// `await import('./cli')` it already uses for the function under test.

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
const mockRm = vi.fn()
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
  rm: mockRm,
  readdir: mockReaddir,
  readFile: mockReadFile,
  stat: mockStat,
  writeFile: mockWriteFile,
  mkdir: mockMkdir,
  default: {
    appendFile: mockAppendFile,
    rm: mockRm,
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
    mockRm.mockResolvedValue(undefined)
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

    it('skips studio asset events when collecting upload assets', async () => {
      const { collectUploadAssets } = await import('./cli')

      const assets = await collectUploadAssets(
        {
          events: [
            { type: 'videoStart', timeMs: 0 },
            {
              type: 'assetStart',
              timeMs: 100,
              name: 'intro',
              studio: true,
            },
          ],
        } as unknown as RecordingData,
        '/project'
      )

      expect(assets).toEqual([])
      expect(loggerWarnSpy).not.toHaveBeenCalled()
    })

    it('skips render-dependency asset events when collecting upload assets', async () => {
      const { collectUploadAssets } = await import('./cli')

      const assets = await collectUploadAssets(
        {
          events: [
            { type: 'videoStart', timeMs: 0 },
            {
              type: 'assetStart',
              timeMs: 100,
              name: 'intro',
              kind: 'dependency',
              dependency: { name: 'Intro Clip' },
              durationMs: 1000,
              fullScreen: false,
            },
          ],
        } as unknown as RecordingData,
        '/project'
      )

      expect(assets).toEqual([])
      expect(loggerWarnSpy).not.toHaveBeenCalled()
    })

    it('collects a custom cursor image referenced by renderOptions.mouse.image', async () => {
      const { collectUploadAssets } = await import('./cli')
      const cursorBytes = Buffer.from('cursor-png-bytes')
      mockReadFile.mockImplementation(async (path: string | URL) => {
        if (String(path).endsWith('my-cursor.png')) return cursorBytes
        return ''
      })

      const assets = await collectUploadAssets(
        {
          events: [{ type: 'videoStart', timeMs: 0 }],
          renderOptions: { mouse: { image: './assets/my-cursor.png' } },
        } as unknown as RecordingData,
        '/project'
      )

      expect(assets).toEqual([
        {
          kind: 'cursor',
          fileHash: createHash('sha256').update(cursorBytes).digest('hex'),
          path: './assets/my-cursor.png',
          size: cursorBytes.byteLength,
          fileBuffer: cursorBytes,
          contentType: 'image/png',
        },
      ])
    })

    it('marks a locally missing custom cursor image for resolution', async () => {
      const { collectUploadAssets } = await import('./cli')
      mockReadFile.mockRejectedValue(new Error('ENOENT'))

      const assets = await collectUploadAssets(
        {
          events: [{ type: 'videoStart', timeMs: 0 }],
          renderOptions: { mouse: { image: './assets/my-cursor.png' } },
        } as unknown as RecordingData,
        '/project'
      )

      expect(assets).toEqual([
        {
          kind: 'cursor',
          fileHash: '',
          path: './assets/my-cursor.png',
          size: 0,
          needsResolve: true,
        },
      ])
    })

    it('does not re-collect a custom cursor image that is already uploaded', async () => {
      const { collectUploadAssets } = await import('./cli')

      const assets = await collectUploadAssets(
        {
          events: [{ type: 'videoStart', timeMs: 0 }],
          renderOptions: {
            mouse: {
              image: {
                assetPath: './assets/my-cursor.png',
                fileHash: 'x'.repeat(64),
              },
            },
          },
        } as unknown as RecordingData,
        '/project'
      )

      expect(assets).toEqual([])
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

  describe('locally missing assets', () => {
    const HASH_A = 'a'.repeat(64)
    const HASH_B = 'b'.repeat(64)
    const HASH_C = 'c'.repeat(64)
    const HASH_D = 'd'.repeat(64)

    it('marks a locally missing overlay for resolution from a previous upload', async () => {
      const { collectUploadAssets } = await import('./cli')
      mockReadFile.mockRejectedValue(new Error('ENOENT'))

      const assets = await collectUploadAssets(
        {
          events: [
            {
              type: 'assetStart',
              timeMs: 0,
              name: 'logo',
              kind: 'image',
              path: './assets/logo.png',
              fullScreen: false,
            },
          ],
        } as unknown as RecordingData,
        '/project'
      )

      expect(assets).toEqual([
        {
          kind: 'overlay',
          fileHash: '',
          path: './assets/logo.png',
          name: 'logo',
          size: 0,
          needsResolve: true,
        },
      ])
    })

    it('treats a missing audio track with a known hash as already uploaded', async () => {
      const { collectUploadAssets } = await import('./cli')
      mockReadFile.mockRejectedValue(new Error('ENOENT'))

      const assets = await collectUploadAssets(
        {
          events: [
            {
              type: 'audioStart',
              timeMs: 0,
              name: 'music',
              path: './assets/music.mp3',
              fileHash: HASH_A,
              volume: 1,
              repeat: false,
            },
          ],
        } as unknown as RecordingData,
        '/project'
      )

      expect(assets).toEqual([
        {
          kind: 'audio',
          fileHash: HASH_A,
          path: './assets/music.mp3',
          size: 0,
          assumedUploaded: true,
        },
      ])
    })

    it('marks a missing audio track without a hash for resolution', async () => {
      const { collectUploadAssets } = await import('./cli')
      mockReadFile.mockRejectedValue(new Error('ENOENT'))

      const assets = await collectUploadAssets(
        {
          events: [
            {
              type: 'audioStart',
              timeMs: 0,
              name: 'music',
              path: './assets/music.mp3',
              volume: 1,
              repeat: false,
            },
          ],
        } as unknown as RecordingData,
        '/project'
      )

      expect(assets).toEqual([
        {
          kind: 'audio',
          fileHash: '',
          path: './assets/music.mp3',
          size: 0,
          needsResolve: true,
        },
      ])
    })

    it('fills a resolved audio hash by path when annotating', async () => {
      const { annotateRecordingDataWithAssetHashes } = await import('./cli')

      const result = annotateRecordingDataWithAssetHashes(
        {
          events: [
            {
              type: 'audioStart',
              timeMs: 0,
              name: 'music',
              path: './assets/music.mp3',
              volume: 1,
              repeat: false,
            },
          ],
        } as unknown as RecordingData,
        [
          {
            kind: 'audio',
            fileHash: HASH_B,
            path: './assets/music.mp3',
            size: 10,
            assumedUploaded: true,
          },
        ]
      )

      expect(result.events[0]).toMatchObject({
        type: 'audioStart',
        fileHash: HASH_B,
      })
    })

    it('fills a resolved narration hash by path and strips the path', async () => {
      const { annotateRecordingDataWithAssetHashes } = await import('./cli')

      const result = annotateRecordingDataWithAssetHashes(
        {
          events: [
            {
              type: 'videoCueStart',
              timeMs: 0,
              name: 'intro',
              translations: {
                en: { assetPath: './assets/clip.mp4', subtitle: 'Hi' },
              },
            },
          ],
        } as unknown as RecordingData,
        [
          {
            kind: 'clip',
            fileHash: HASH_C,
            path: './assets/clip.mp4',
            size: 5,
            assumedUploaded: true,
          },
        ]
      )

      const event = result.events[0] as {
        translations: Record<string, unknown>
      }
      expect(event.translations.en).toEqual({
        assetHash: HASH_C,
        subtitle: 'Hi',
      })
    })

    it('rewrites a custom cursor image path to { assetPath, fileHash } when annotating', async () => {
      const { annotateRecordingDataWithAssetHashes } = await import('./cli')

      const result = annotateRecordingDataWithAssetHashes(
        {
          events: [{ type: 'videoStart', timeMs: 0 }],
          renderOptions: {
            mouse: {
              size: 0.05,
              style: 'white',
              image: './assets/my-cursor.png',
            },
          },
        } as unknown as RecordingData,
        [
          {
            kind: 'cursor',
            fileHash: HASH_D,
            path: './assets/my-cursor.png',
            size: 12,
            assumedUploaded: true,
          },
        ]
      )

      expect(result.renderOptions.mouse).toEqual({
        size: 0.05,
        style: 'white',
        image: { assetPath: './assets/my-cursor.png', fileHash: HASH_D },
      })
    })

    it('leaves a cursor image untouched when no matching upload hash is found', async () => {
      const { annotateRecordingDataWithAssetHashes } = await import('./cli')

      const result = annotateRecordingDataWithAssetHashes(
        {
          events: [{ type: 'videoStart', timeMs: 0 }],
          renderOptions: {
            mouse: {
              size: 0.05,
              style: 'white',
              image: './assets/my-cursor.png',
            },
          },
        } as unknown as RecordingData,
        []
      )

      expect(result.renderOptions.mouse.image).toBe('./assets/my-cursor.png')
    })

    it('resolves missing assets against a previous upload and reports the rest', async () => {
      const { resolveMissingUploadAssets, secretCredential } =
        await import('./cli')
      const assets = [
        {
          kind: 'overlay' as const,
          fileHash: '',
          path: './assets/logo.png',
          name: 'logo',
          size: 0,
          needsResolve: true,
        },
        {
          kind: 'audio' as const,
          fileHash: '',
          path: './assets/music.mp3',
          size: 0,
          needsResolve: true,
        },
      ]

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          resolved: [
            {
              path: './assets/logo.png',
              name: 'logo',
              fileHash: HASH_D,
              size: 11,
              contentType: 'image/png',
            },
            {
              path: './assets/music.mp3',
              name: null,
              fileHash: null,
              size: null,
              contentType: null,
            },
          ],
        }),
        text: vi.fn().mockResolvedValue(''),
      })

      const unresolved = await resolveMissingUploadAssets(
        assets,
        'My Project',
        'My Video',
        'https://api.example.com',
        secretCredential('secret'),
        new AbortController().signal
      )

      expect(assets[0]).toEqual({
        kind: 'overlay',
        fileHash: HASH_D,
        path: './assets/logo.png',
        name: 'logo',
        size: 11,
        contentType: 'image/png',
        needsResolve: false,
        assumedUploaded: true,
      })
      expect(unresolved).toEqual([assets[1]])
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/cli/upload/resolve-assets',
        expect.objectContaining({ method: 'POST' })
      )
    })

    it('skips the resolve request when nothing is missing', async () => {
      const { resolveMissingUploadAssets, secretCredential } =
        await import('./cli')
      const unresolved = await resolveMissingUploadAssets(
        [
          {
            kind: 'overlay',
            fileHash: HASH_A,
            path: './assets/logo.png',
            name: 'logo',
            size: 10,
          },
        ],
        'My Project',
        'My Video',
        'https://api.example.com',
        secretCredential('secret'),
        new AbortController().signal
      )
      expect(unresolved).toEqual([])
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('formats an actionable message for unresolved assets', async () => {
      const { formatUnresolvedAssetMessage } = await import('./cli')
      const message = formatUnresolvedAssetMessage('My Video', [
        {
          kind: 'overlay',
          fileHash: '',
          path: './assets/logo.png',
          name: 'logo',
          size: 0,
        },
      ])
      expect(message).toContain('missing locally and no previously uploaded')
      expect(message).toContain('Overlay: ./assets/logo.png')
      expect(message).toContain('Record once with these files present')
    })
  })

  describe('withUploadRetry', () => {
    it('returns the result when the first attempt succeeds', async () => {
      const { withUploadRetry } = await import('./cli')
      const fn = vi.fn().mockResolvedValue('ok')
      const result = await withUploadRetry(fn, undefined)
      expect(result).toBe('ok')
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('retries on network error and returns result on second attempt', async () => {
      const { withUploadRetry } = await import('./cli')
      const networkErr = new TypeError('fetch failed')
      const fn = vi
        .fn()
        .mockRejectedValueOnce(networkErr)
        .mockResolvedValue('ok')
      const result = await withUploadRetry(fn, undefined)
      expect(result).toBe('ok')
      expect(fn).toHaveBeenCalledTimes(2)
    })

    it('exhausts all 3 attempts and throws the last network error', async () => {
      const { withUploadRetry } = await import('./cli')
      const networkErr = new TypeError('fetch failed')
      const fn = vi.fn().mockRejectedValue(networkErr)
      await expect(withUploadRetry(fn, undefined)).rejects.toThrow(
        'fetch failed'
      )
      expect(fn).toHaveBeenCalledTimes(3)
    })

    it('does not retry on AbortError', async () => {
      const { withUploadRetry } = await import('./cli')
      const abortErr = new DOMException(
        'The operation was aborted',
        'AbortError'
      )
      const fn = vi.fn().mockRejectedValue(abortErr)
      await expect(withUploadRetry(fn, undefined)).rejects.toThrow(
        'The operation was aborted'
      )
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('does not retry when the abort signal is already aborted', async () => {
      const { withUploadRetry } = await import('./cli')
      const controller = new AbortController()
      controller.abort()
      const abortErr = new DOMException('signal aborted', 'AbortError')
      const fn = vi.fn().mockRejectedValue(abortErr)
      await expect(withUploadRetry(fn, controller.signal)).rejects.toThrow()
      expect(fn).toHaveBeenCalledTimes(1)
    })
  })

  describe('stripTestTitleLanguageSuffix', () => {
    it('strips a trailing language suffix so titles match metadata.videoName', async () => {
      const { stripTestTitleLanguageSuffix } = await import('./cli')
      // Builder titles per-language tests `${videoName} [${lang}]`; the uploaded
      // recording is keyed by the unsuffixed videoName.
      expect(
        stripTestTitleLanguageSuffix('ScreenCI product pitch (code cut) [en]')
      ).toBe('ScreenCI product pitch (code cut)')
      expect(stripTestTitleLanguageSuffix('Tour [es]')).toBe('Tour')
      expect(stripTestTitleLanguageSuffix('Tour [pt-BR]')).toBe('Tour')
    })

    it('leaves an unsuffixed title and non-language brackets intact', async () => {
      const { stripTestTitleLanguageSuffix } = await import('./cli')
      expect(stripTestTitleLanguageSuffix('Tour')).toBe('Tour')
      // Only a trailing language-code-shaped bracket is stripped.
      expect(stripTestTitleLanguageSuffix('Dashboard [New]')).toBe(
        'Dashboard [New]'
      )
      expect(stripTestTitleLanguageSuffix('Report [v2]')).toBe('Report [v2]')
      // A video name that itself ends in `[en]` keeps that, dropping only the
      // builder-appended language suffix.
      expect(stripTestTitleLanguageSuffix('Dashboard [en] [en]')).toBe(
        'Dashboard [en]'
      )
    })
  })
})
