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
function isCI(): boolean {
  const env = process.env
  return Boolean(
    env.CI ||
    env.CONTINUOUS_INTEGRATION ||
    env.GITHUB_ACTIONS ||
    env.GITLAB_CI ||
    env.BUILDKITE ||
    env.CIRCLECI
  )
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
