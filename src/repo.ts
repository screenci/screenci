import * as childProcess from 'node:child_process'
import { promisify } from 'node:util'

/**
 * Repository helpers for `screenci start`: comparing the configured
 * repository URL with the cwd's git remote, and cloning or refreshing the
 * product's repository next to the workspace. Git itself is behind `StartGit`
 * so the decision tree is unit-testable without a shell.
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

/** Where `start` clones the product's repository, relative to the cwd. */
export const REPO_CLONE_DIR = '.screenci/repo'

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

export type GitCommandResult = { ok: true } | { ok: false; message: string }

export interface StartGit {
  /** The `origin` remote of the repository containing `dir`, or null. */
  remoteUrl(dir: string): Promise<string | null>
  clone(url: string, dir: string): Promise<GitCommandResult>
  /** Fast-forwards an existing clone; failures are non-fatal. */
  update(dir: string): Promise<GitCommandResult>
  /** The full HEAD commit hash of the repository containing `dir`, or null. */
  headCommit(dir: string): Promise<string | null>
  /** The current branch name, or null when detached or unavailable. */
  currentBranch(dir: string): Promise<string | null>
}

function describeGitError(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'stderr' in err) {
    const stderr = String((err as { stderr: unknown }).stderr).trim()
    if (stderr.length > 0) return stderr.split('\n').slice(-3).join(' ')
  }
  return err instanceof Error ? err.message : String(err)
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
  clone: async (url, dir) => {
    try {
      await execFileAsync('git', ['clone', '--depth', '1', url, dir], {
        encoding: 'utf8',
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      })
      return { ok: true }
    } catch (err) {
      return { ok: false, message: describeGitError(err) }
    }
  },
  update: async (dir) => {
    try {
      await execFileAsync('git', ['-C', dir, 'pull', '--ff-only'], {
        encoding: 'utf8',
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      })
      return { ok: true }
    } catch (err) {
      return { ok: false, message: describeGitError(err) }
    }
  },
  headCommit: async (dir) => {
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['-C', dir, 'rev-parse', 'HEAD'],
        { encoding: 'utf8' }
      )
      const commit = stdout.trim()
      return commit.length > 0 ? commit : null
    } catch {
      return null
    }
  },
  currentBranch: async (dir) => {
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'],
        { encoding: 'utf8' }
      )
      const branch = stdout.trim()
      return branch === '' || branch === 'HEAD' ? null : branch
    } catch {
      return null
    }
  },
}
