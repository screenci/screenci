import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FFMPEG_MISSING_MESSAGE,
  FFMPEG_UNSUPPORTED_PLATFORM_MESSAGE,
  resetFfmpegInstallAttempts,
  resolveFfmpegPath,
  type FfmpegPathDeps,
} from './ffmpegPath.js'

const STATIC_PATH = join('/', 'pkg', 'node_modules', 'ffmpeg-static', 'ffmpeg')
const INSTALL_JS = join(
  '/',
  'pkg',
  'node_modules',
  'ffmpeg-static',
  'install.js'
)

function makeDeps(
  present: Set<string>,
  overrides: Partial<FfmpegPathDeps> = {}
): FfmpegPathDeps & { spawnSync: ReturnType<typeof vi.fn> } {
  const spawnSync = vi.fn(() => ({ status: 0 }))
  return {
    ffmpegStatic: STATIC_PATH,
    existsSync: (path: string) => present.has(path),
    removeFile: (path: string) => {
      present.delete(path)
    },
    spawnSync,
    env: {},
    log: vi.fn(),
    ...overrides,
  } as FfmpegPathDeps & { spawnSync: ReturnType<typeof vi.fn> }
}

describe('resolveFfmpegPath', () => {
  beforeEach(() => {
    resetFfmpegInstallAttempts()
  })

  it('prefers FFMPEG_BIN over everything else', () => {
    const deps = makeDeps(new Set(), {
      ffmpegStatic: null,
      env: { FFMPEG_BIN: '/usr/bin/ffmpeg' },
    })
    expect(resolveFfmpegPath(deps)).toBe('/usr/bin/ffmpeg')
    expect(deps.spawnSync).not.toHaveBeenCalled()
  })

  it('returns the static path without spawning when it exists', () => {
    const deps = makeDeps(new Set([STATIC_PATH, INSTALL_JS]))
    expect(resolveFfmpegPath(deps)).toBe(STATIC_PATH)
    expect(deps.spawnSync).not.toHaveBeenCalled()
    expect(deps.log).not.toHaveBeenCalled()
  })

  it('runs install.js once when the binary is missing and returns the path once it appears', () => {
    const present = new Set([INSTALL_JS])
    const deps = makeDeps(present)
    deps.spawnSync.mockImplementation(() => {
      present.add(STATIC_PATH)
      return { status: 0 }
    })

    expect(resolveFfmpegPath(deps)).toBe(STATIC_PATH)
    expect(deps.spawnSync).toHaveBeenCalledTimes(1)
    expect(deps.spawnSync).toHaveBeenCalledWith(
      process.execPath,
      [INSTALL_JS],
      { stdio: 'inherit' }
    )
    expect(deps.log).toHaveBeenCalledTimes(1)

    // A second call finds the binary and never re-runs the installer.
    expect(resolveFfmpegPath(deps)).toBe(STATIC_PATH)
    expect(deps.spawnSync).toHaveBeenCalledTimes(1)
  })

  it('throws the actionable message when the install leaves the binary missing, and does not retry', () => {
    const deps = makeDeps(new Set([INSTALL_JS]))
    deps.spawnSync.mockImplementation(() => ({
      status: 1,
      error: new Error('network down'),
    }))

    expect(() => resolveFfmpegPath(deps)).toThrow(FFMPEG_MISSING_MESSAGE)
    expect(deps.spawnSync).toHaveBeenCalledTimes(1)

    expect(() => resolveFfmpegPath(deps)).toThrow(FFMPEG_MISSING_MESSAGE)
    expect(deps.spawnSync).toHaveBeenCalledTimes(1)
  })

  it('removes a partial binary left by a failed install and throws', () => {
    const present = new Set([INSTALL_JS])
    const deps = makeDeps(present)
    deps.spawnSync.mockImplementation(() => {
      present.add(STATIC_PATH)
      return { status: 1 }
    })

    expect(() => resolveFfmpegPath(deps)).toThrow(FFMPEG_MISSING_MESSAGE)
    expect(present.has(STATIC_PATH)).toBe(false)
  })

  it('throws the actionable message without spawning when install.js is absent', () => {
    const deps = makeDeps(new Set())
    expect(() => resolveFfmpegPath(deps)).toThrow(FFMPEG_MISSING_MESSAGE)
    expect(deps.spawnSync).not.toHaveBeenCalled()
  })

  it('throws an unsupported-platform message when ffmpeg-static exports null', () => {
    const deps = makeDeps(new Set(), { ffmpegStatic: null })
    expect(() => resolveFfmpegPath(deps)).toThrow(
      FFMPEG_UNSUPPORTED_PLATFORM_MESSAGE
    )
    expect(deps.spawnSync).not.toHaveBeenCalled()
  })
})
