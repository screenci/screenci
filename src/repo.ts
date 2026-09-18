import * as childProcess from 'node:child_process'
import { promisify } from 'node:util'

/**
 * Repository helpers for `screenci setup`: normalizing git remotes and reading
 * the cwd's `origin`. Git itself is behind `StartGit` so the decision tree is
 * unit-testable without a shell.
 */

/**
 * Resolved per call, not at import: several CLI specs mock `child_process`
 * with only the functions they need, and this module must still load there.
 */
function execFileAsync(
  file: string,
  args: string[],
  options: { encoding: 'utf8'; env?: NodeJS.ProcessEnv }
): Promise<{ stdout: string; stderr: string }> {
  return promisify(childProcess.execFile)(file, args, options) as Promise<{
    stdout: string
    stderr: string
  }>
}

/**
 * `host/path` of a git remote, lowercase, without scheme, user, port, a
 * trailing `.git` or trailing slashes. `https://github.com/Acme/App.git`,
 * `git@github.com:acme/app` and `ssh://git@github.com/acme/app.git` all
 * normalize to `github.com/acme/app`. Returns null for unparsable input.
 */
export function normalizeGitUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const scp = /^(?:[^@\s/]+@)?([^:/\s]+):(?!\/\/)(.+)$/.exec(trimmed)
  let host: string
  let path: string
  if (scp && !/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    host = scp[1]!
    path = scp[2]!
  } else {
    let url: URL
    try {
      url = new URL(trimmed)
    } catch {
      return null
    }
    host = url.hostname
    path = url.pathname
  }
  path = path
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '')
  if (host === '' || path === '') return null
  return `${host}/${path}`.toLowerCase()
}

export function sameRepository(a: string, b: string): boolean {
  const na = normalizeGitUrl(a)
  const nb = normalizeGitUrl(b)
  return na !== null && nb !== null && na === nb
}

export interface StartGit {
  /** The `origin` remote of the repository containing `dir`, or null. */
  remoteUrl(dir: string): Promise<string | null>
  /**
   * Whether `dir` (a folder inside a repository) has uncommitted changes.
   * Null when git cannot tell (not a repository, git missing).
   */
  isDirty(dir: string): Promise<boolean | null>
}

export const nodeStartGit: StartGit = {
  remoteUrl: async (dir) => {
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['-C', dir, 'remote', 'get-url', 'origin'],
        { encoding: 'utf8' }
      )
      const url = stdout.trim()
      return url.length > 0 ? url : null
    } catch {
      return null
    }
  },
  isDirty: async (dir) => {
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['-C', dir, 'status', '--porcelain', '--', '.'],
        { encoding: 'utf8' }
      )
      return stdout.trim().length > 0
    } catch {
      return null
    }
  },
}
