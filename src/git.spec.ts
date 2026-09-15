import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockExecFileSync = vi.fn<(cmd: string, args: string[]) => string>()

vi.mock('node:child_process', () => ({
  execFileSync: (cmd: string, args: string[]) => mockExecFileSync(cmd, args),
}))

// Import after the mock is registered.
const { getGitMetadata, detectRunnerKind } = await import('./git.js')

const CI_VARS = [
  'CI',
  'CONTINUOUS_INTEGRATION',
  'GITHUB_ACTIONS',
  'GITLAB_CI',
  'BUILDKITE',
  'CIRCLECI',
  'SCREENCI_CI',
]

const savedEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  vi.resetAllMocks()
  for (const key of CI_VARS) {
    savedEnv[key] = process.env[key]
    delete process.env[key]
  }
})

afterEach(() => {
  for (const key of CI_VARS) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
})

describe('detectRunnerKind', () => {
  it('is local outside CI and ci under any known CI variable', () => {
    expect(detectRunnerKind({})).toBe('local')
    expect(detectRunnerKind({ GITHUB_ACTIONS: 'true' })).toBe('ci')
    expect(detectRunnerKind({ CI: '1' })).toBe('ci')
    expect(detectRunnerKind({ GITLAB_CI: 'true' })).toBe('ci')
  })

  it('lets SCREENCI_CI override the detection either way', () => {
    expect(detectRunnerKind({ SCREENCI_CI: '1' })).toBe('ci')
    expect(detectRunnerKind({ SCREENCI_CI: 'true' })).toBe('ci')
    expect(detectRunnerKind({ GITHUB_ACTIONS: 'true', SCREENCI_CI: '0' })).toBe(
      'local'
    )
    expect(
      detectRunnerKind({ GITHUB_ACTIONS: 'true', SCREENCI_CI: 'false' })
    ).toBe('local')
  })

  it('reads process.env by default', () => {
    process.env.SCREENCI_CI = '1'
    expect(detectRunnerKind()).toBe('ci')
  })
})

describe('getGitMetadata', () => {
  it('returns the 8-char commit and isDirty=true for a dirty repo', () => {
    mockExecFileSync.mockImplementation((_cmd, args) => {
      if (args[0] === 'rev-parse') return 'abcd1234ef567890\n'
      if (args[0] === 'status') return ' M src/foo.ts\n'
      return ''
    })

    expect(getGitMetadata()).toEqual({ commit: 'abcd1234', isDirty: true })
  })

  it('returns isDirty=false for a clean repo', () => {
    mockExecFileSync.mockImplementation((_cmd, args) => {
      if (args[0] === 'rev-parse') return 'abcd1234ef567890\n'
      if (args[0] === 'status') return ''
      return ''
    })

    expect(getGitMetadata()).toEqual({ commit: 'abcd1234', isDirty: false })
  })

  it('reports isDirty=false in CI even when the working tree is dirty', () => {
    process.env.CI = 'true'
    mockExecFileSync.mockImplementation((_cmd, args) => {
      if (args[0] === 'rev-parse') return 'abcd1234ef567890\n'
      if (args[0] === 'status') return ' M src/foo.ts\n'
      return ''
    })

    const result = getGitMetadata()
    expect(result).toEqual({ commit: 'abcd1234', isDirty: false })
    // status must not even be consulted in CI
    expect(
      mockExecFileSync.mock.calls.some((call) => call[1][0] === 'status')
    ).toBe(false)
  })

  it('returns an empty object when git is unavailable / not a repo', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('not a git repository')
    })

    expect(getGitMetadata()).toEqual({})
  })

  it('still returns the commit when the dirty check fails', () => {
    mockExecFileSync.mockImplementation((_cmd, args) => {
      if (args[0] === 'rev-parse') return 'abcd1234ef567890\n'
      throw new Error('status failed')
    })

    expect(getGitMetadata()).toEqual({ commit: 'abcd1234' })
  })
})
