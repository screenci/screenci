import { detectRunnerKind } from './git.js'

/**
 * Checks `preview` and `export` run before recording in CI, so a pipeline
 * only needs to install dependencies and call the command.
 */

/**
 * Returns an error message when the run is in CI without SCREENCI_SECRET,
 * otherwise null. Without the secret a CI run would fall back to an anonymous
 * trial session that nobody can see, and the job would pass while recording
 * into nothing.
 */
export function getMissingCiSecretError(
  env: NodeJS.ProcessEnv,
  secretsUrl: string
): string | null {
  if (detectRunnerKind(env) !== 'ci') return null
  if (env.SCREENCI_SECRET) return null
  return (
    `SCREENCI_SECRET is not set. Copy it from ${secretsUrl} or ./.env, ` +
    "add it to your CI provider's secrets (GitHub: Settings > Secrets and " +
    'variables > Actions > Repository secrets), pass it to this step as ' +
    'SCREENCI_SECRET, and rerun.'
  )
}

export interface BrowserInstallDeps {
  env: NodeJS.ProcessEnv
  /** Runs `playwright install <args>` and resolves with its exit code. */
  runPlaywrightInstall: (args: string[]) => Promise<number>
  log: (message: string) => void
}

export type BrowserInstallResult = 'skipped' | 'installed' | 'failed'

export const CHROMIUM_HEADLESS_SHELL_INSTALL_ARGS = [
  'install',
  '--only-shell',
  'chromium',
] as const

/**
 * In CI, installs the Playwright Chromium Headless Shell before recording.
 * `playwright install` is a quick no-op when the browser is already there, so
 * a pipeline that installs it itself loses nothing. Locally `screenci init`
 * has already installed it. Set SCREENCI_SKIP_BROWSER_INSTALL=1 to opt out.
 */
export async function ensureCiBrowserInstalled(
  deps: BrowserInstallDeps
): Promise<BrowserInstallResult> {
  if (detectRunnerKind(deps.env) !== 'ci') return 'skipped'
  const skip = deps.env.SCREENCI_SKIP_BROWSER_INSTALL
  if (skip === '1' || skip === 'true') return 'skipped'
  deps.log('Installing Playwright Chromium Headless Shell...')
  const code = await deps.runPlaywrightInstall([
    ...CHROMIUM_HEADLESS_SHELL_INSTALL_ARGS,
  ])
  return code === 0 ? 'installed' : 'failed'
}
