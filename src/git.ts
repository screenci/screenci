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
 * a CI environment, 'local' on a developer machine, 'hosted' on ScreenCI's
 * own recording runner. The service combines it with the credential type to
 * decide whose live-preview slot an upload lands in (the shared CI slot or
 * the person's own); 'hosted' is treated like 'ci'. `SCREENCI_RUNNER=hosted`
 * wins over everything; `SCREENCI_CI=1` / `0` overrides the CI detection.
 */
export type RunnerKind = 'ci' | 'local' | 'hosted'

export function detectRunnerKind(
  env: NodeJS.ProcessEnv = process.env
): RunnerKind {
  if (env.SCREENCI_RUNNER === 'hosted') return 'hosted'
  const override = env.SCREENCI_CI
  if (override === '1' || override === 'true') return 'ci'
  if (override === '0' || override === 'false') return 'local'
  return isCI(env) ? 'ci' : 'local'
}

/**
 * CI and the hosted runner behave alike: unattended, a secret required, the
 * browser installed by the CLI, the shared CI preview slot.
 */
export function isUnattendedRunner(kind: RunnerKind): boolean {
  switch (kind) {
    case 'ci':
    case 'hosted':
      return true
    case 'local':
      return false
    default: {
      const exhaustive: never = kind
      return exhaustive
    }
  }
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
