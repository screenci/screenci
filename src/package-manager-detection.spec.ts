import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  detectPackageManagerFromLockfile,
  detectPackageManagerFromPackageJson,
  detectPnpmWorkspace,
  determinePackageManager,
  parseYarnVersionSupport,
} from './init.js'

const mockExistsSync = vi.fn<(path: string) => boolean>()
const mockReadFileSync = vi.fn<(path: string, encoding: string) => string>()

vi.mock('fs', () => ({
  existsSync: (p: string) => mockExistsSync(p),
  readFileSync: (p: string, enc: string) => mockReadFileSync(p, enc),
  realpathSync: (p: string) => p,
  default: {
    existsSync: (p: string) => mockExistsSync(p),
    readFileSync: (p: string, enc: string) => mockReadFileSync(p, enc),
    realpathSync: (p: string) => p,
  },
}))

afterEach(() => {
  vi.resetAllMocks()
})

describe('detectPackageManagerFromLockfile', () => {
  beforeEach(() => {
    mockExistsSync.mockReturnValue(false)
  })

  it('returns pnpm when pnpm-lock.yaml exists', () => {
    mockExistsSync.mockImplementation((p) => p.endsWith('pnpm-lock.yaml'))
    expect(detectPackageManagerFromLockfile('/project')).toBe('pnpm')
  })

  it('returns yarn when yarn.lock exists', () => {
    mockExistsSync.mockImplementation((p) => p.endsWith('yarn.lock'))
    expect(detectPackageManagerFromLockfile('/project')).toBe('yarn')
  })

  it('returns null when no lockfile is found', () => {
    expect(detectPackageManagerFromLockfile('/project')).toBeNull()
  })

  it('prefers pnpm-lock.yaml over yarn.lock when both exist', () => {
    mockExistsSync.mockReturnValue(true)
    expect(detectPackageManagerFromLockfile('/project')).toBe('pnpm')
  })
})

describe('detectPackageManagerFromPackageJson', () => {
  beforeEach(() => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT')
    })
  })

  it('returns pnpm for packageManager field starting with pnpm', () => {
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ packageManager: 'pnpm@11.0.9' })
    )
    expect(detectPackageManagerFromPackageJson('/project')).toBe('pnpm')
  })

  it('returns yarn for packageManager field starting with yarn', () => {
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ packageManager: 'yarn@4.0.0' })
    )
    expect(detectPackageManagerFromPackageJson('/project')).toBe('yarn')
  })

  it('returns null when package.json is missing', () => {
    expect(detectPackageManagerFromPackageJson('/project')).toBeNull()
  })

  it('returns null when packageManager field is absent', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'my-app' }))
    expect(detectPackageManagerFromPackageJson('/project')).toBeNull()
  })
})

describe('detectPnpmWorkspace', () => {
  beforeEach(() => {
    mockExistsSync.mockReturnValue(false)
  })

  it('returns true when pnpm-workspace.yaml exists in cwd', () => {
    mockExistsSync.mockImplementation((p) => p.endsWith('pnpm-workspace.yaml'))
    expect(detectPnpmWorkspace('/project')).toBe(true)
  })

  it('returns false when pnpm-workspace.yaml is absent', () => {
    expect(detectPnpmWorkspace('/project')).toBe(false)
  })
})

describe('determinePackageManager', () => {
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    originalEnv = { ...process.env }
    delete process.env.npm_config_user_agent
    delete process.env['SCREENCI_INIT_CWD']
    mockExistsSync.mockReturnValue(false)
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT')
    })
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('returns pnpm when user agent contains pnpm', () => {
    process.env.npm_config_user_agent = 'pnpm/11.0.8 npm/? node/v24.0.0'
    expect(determinePackageManager('/project')).toBe('pnpm')
  })

  it('returns yarn when user agent contains yarn', () => {
    process.env.npm_config_user_agent = 'yarn/1.22.0 npm/? node/v24.0.0'
    expect(determinePackageManager('/project')).toBe('yarn')
  })

  it('returns pnpm via lockfile when cwd is provided and user agent is absent', () => {
    mockExistsSync.mockImplementation((p) => p.endsWith('pnpm-lock.yaml'))
    expect(determinePackageManager('/project')).toBe('pnpm')
  })

  it('returns yarn via lockfile when cwd is provided and user agent is absent', () => {
    mockExistsSync.mockImplementation((p) => p.endsWith('yarn.lock'))
    expect(determinePackageManager('/project')).toBe('yarn')
  })

  it('returns pnpm via packageManager field when cwd is provided and no lockfile exists', () => {
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ packageManager: 'pnpm@11.0.9' })
    )
    expect(determinePackageManager('/project')).toBe('pnpm')
  })

  it('returns npm as default when no signal is present and cwd is provided', () => {
    expect(determinePackageManager('/project')).toBe('npm')
  })

  it('returns npm as default when no signal is present and no cwd is provided', () => {
    expect(determinePackageManager()).toBe('npm')
  })

  it('npm user agent falls through to lockfile detection when cwd is provided', () => {
    process.env.npm_config_user_agent = 'npm/10.0.0 node/v24.0.0'
    mockExistsSync.mockImplementation((p) => p.endsWith('pnpm-lock.yaml'))
    expect(determinePackageManager('/project')).toBe('pnpm')
  })

  it('skips filesystem detection when no cwd is provided', () => {
    mockExistsSync.mockReturnValue(true) // pnpm-lock.yaml would exist everywhere
    expect(determinePackageManager()).toBe('npm') // but cwd not given → no lockfile check
  })

  it('pnpm user agent takes precedence over yarn lockfile', () => {
    process.env.npm_config_user_agent = 'pnpm/11.0.8 npm/? node/v24.0.0'
    mockExistsSync.mockImplementation((p) => p.endsWith('yarn.lock'))
    expect(determinePackageManager('/project')).toBe('pnpm')
  })
})

describe('parseYarnVersionSupport', () => {
  it('returns supported for yarn 2.x', () => {
    const result = parseYarnVersionSupport('2.0.0')
    expect(result.supported).toBe(true)
    expect(result.reason).toBe('supported')
    expect(result.detectedVersion).toBe('2.0.0')
  })

  it('returns supported for yarn 4.x', () => {
    const result = parseYarnVersionSupport('4.9.1')
    expect(result.supported).toBe(true)
    expect(result.detectedVersion).toBe('4.9.1')
  })

  it('returns version-too-old for yarn 1.x', () => {
    const result = parseYarnVersionSupport('1.22.22')
    expect(result.supported).toBe(false)
    expect(result.reason).toBe('version-too-old')
    expect(result.detectedVersion).toBe('1.22.22')
  })

  it('returns malformed-version for non-semver output', () => {
    const result = parseYarnVersionSupport('not-a-version')
    expect(result.supported).toBe(false)
    expect(result.reason).toBe('malformed-version')
  })

  it('trims whitespace from version output', () => {
    const result = parseYarnVersionSupport('  4.0.0\n')
    expect(result.supported).toBe(true)
    expect(result.detectedVersion).toBe('4.0.0')
  })
})
