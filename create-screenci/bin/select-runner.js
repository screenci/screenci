// Pure selection of the command that runs `screenci init`. Node builtins only:
// this file ships inside `create-screenci`, which has no dependencies, so it
// must not import anything from the `screenci` package.

import { existsSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'

/**
 * Picks the package runner matching the package manager that invoked
 * `create-screenci` (from `npm_config_user_agent`) and pins the `screenci`
 * version to this wrapper's own version so both always match.
 *
 * On Windows, runner shims are `.cmd` batch files, so the call is routed
 * through `cmd.exe /d /s /c` with every argument batch-quoted.
 *
 * @param {{
 *   userAgent: string | undefined,
 *   version: string,
 *   args: string[],
 *   platform: NodeJS.Platform,
 *   env?: Record<string, string | undefined>,
 *   resolveWindowsShim?: (name: string, env: Record<string, string | undefined>) => string,
 * }} input
 * @returns {{ command: string, args: string[], windowsVerbatimArguments?: boolean }}
 */
export function selectRunner({
  userAgent,
  version,
  args,
  platform,
  env,
  resolveWindowsShim = defaultResolveWindowsShim,
}) {
  const packageManager = detectPackageManager(userAgent)
  // CI smoke tests point this at a locally packed tarball so the launcher
  // exercises the build under test instead of the published registry version.
  const override = env?.CREATE_SCREENCI_SCREENCI_SPEC?.trim()
  const spec =
    override !== undefined && override.length > 0
      ? override
      : `screenci@${version}`
  const initArgs = ['init', ...args]

  /** @type {{ command: string, args: string[] }} */
  let invocation
  switch (packageManager) {
    case 'pnpm':
      invocation = {
        command: 'pnpm',
        args: ['dlx', `--package=${spec}`, 'screenci', ...initArgs],
      }
      break
    case 'yarn':
      invocation = {
        command: 'yarn',
        args: ['dlx', '-p', spec, 'screenci', ...initArgs],
      }
      break
    case 'npm':
      // `--package=<spec>` + the bin name works for registry specs and for
      // tarball/file specs alike (a bare file spec is run as a command).
      invocation = {
        command: 'npx',
        args: ['--yes', `--package=${spec}`, 'screenci', ...initArgs],
      }
      break
    default: {
      /** @type {never} */
      const exhaustive = packageManager
      throw new Error(`Unhandled package manager: ${String(exhaustive)}`)
    }
  }

  if (platform !== 'win32') {
    return invocation
  }

  return {
    command: env?.comspec ?? 'cmd.exe',
    args: [
      '/d',
      '/s',
      '/c',
      // Absolute shim path: a `.cmd` shim invoked by bare name through
      // `cmd /s /c "..."` can resolve its own %~dp0 to the working folder and
      // look for npm there.
      `"${[resolveWindowsShim(invocation.command, env ?? {}), ...invocation.args].map(quoteWindowsBatchArg).join(' ')}"`,
    ],
    windowsVerbatimArguments: true,
  }
}

/**
 * @param {string | undefined} userAgent
 * @returns {'pnpm' | 'yarn' | 'npm'}
 */
export function detectPackageManager(userAgent) {
  const [name, version] = (userAgent ?? '').split(' ')[0]?.split('/') ?? []
  if (name === 'pnpm') return 'pnpm'
  // Yarn classic (1.x) has no `dlx`: fall back to npx, which ships with Node.
  if (name === 'yarn') return version?.startsWith('1.') ? 'npm' : 'yarn'
  return 'npm'
}

/**
 * Quotes one argument for a `cmd.exe /s /c "..."` batch command line.
 * @param {string} arg
 */
export function quoteWindowsBatchArg(arg) {
  if (arg.length === 0) {
    return '""'
  }
  return `"${arg
    .replace(/(\\*)"/g, '$1$1\\"')
    .replace(/(\\+)$/g, '$1$1')
    .replace(/%/g, '%%')}"`
}

/**
 * Finds `<name>.cmd` on PATH (then next to the running node, where npm and
 * npx ship), falling back to the bare `<name>.cmd`.
 * @param {string} name
 * @param {Record<string, string | undefined>} env
 * @returns {string}
 */
export function defaultResolveWindowsShim(name, env) {
  const file = `${name}.cmd`
  const pathValue = env.PATH ?? env.Path ?? ''
  const dirs = [
    ...pathValue.split(delimiter).filter((dir) => dir.length > 0),
    dirname(process.execPath),
  ]
  for (const dir of dirs) {
    const candidate = join(dir, file)
    if (existsSync(candidate)) return candidate
  }
  return file
}
