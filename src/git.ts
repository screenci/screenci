import { execFileSync } from 'node:child_process'

export type GitMetadata = {
  /** First 8 characters of the current commit hash, when in a git repo. */
  commit?: string
  /**
   * True when the working tree has uncommitted changes. Always false in CI
   * (CI checkouts are treated as clean). Omitted when it cannot be determined.
   */
  isDirty?: boolean
}

/** Treat common CI environments as always-clean. */
export function isCI(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(
    env.CI ||
    env.CONTINUOUS_INTEGRATION ||
    env.GITHUB_ACTIONS ||
    env.GITLAB_CI ||
    env.BUILDKITE ||
    env.CIRCLECI
  )
}

/**
 * Where the CLI runs, as reported to the service with every upload: 'ci' in
 * a CI environment, 'local' on a developer machine. The service combines it
 * with the credential type to decide whose live-preview slot an upload lands
 * in (the shared CI slot or the person's own). `SCREENCI_CI=1` / `0`
 * overrides the detection.
 */
export type RunnerKind = 'ci' | 'local'

export function detectRunnerKind(
  env: NodeJS.ProcessEnv = process.env
): RunnerKind {
  const override = env.SCREENCI_CI
  if (override === '1' || override === 'true') return 'ci'
  if (override === '0' || override === 'false') return 'local'
  return isCI(env) ? 'ci' : 'local'
}

function runGit(args: string[]): string {
  return execFileSync('git', args, {
    stdio: ['ignore', 'pipe', 'ignore'],
    encoding: 'utf8',
  }).trim()
}

/**
 * Best-effort git metadata for the recording. Never throws — returns an empty
 * object when git is unavailable or the directory is not a repository.
 */
export function getGitMetadata(): GitMetadata {
  try {
    const commit = runGit(['rev-parse', 'HEAD']).slice(0, 8)
    if (commit.length === 0) return {}

    // In CI the checkout is considered clean regardless of working tree state.
    if (isCI()) return { commit, isDirty: false }

    try {
      const status = runGit(['status', '--porcelain'])
      return { commit, isDirty: status.length > 0 }
    } catch {
      // Could not determine dirtiness; still report the commit.
      return { commit }
    }
  } catch {
    return {}
  }
}
