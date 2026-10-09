import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { detectIslandLockfile } from './ciWorkflow.js'
import { readIslandEnvFile } from './configLite.js'
import type { PackageManager } from './init.js'
import { environmentForBackendUrl } from './linkSession.js'
import {
  assertSafeRelativePath,
  assertStorableProjectPath,
  projectFileAbsolutePath,
  type ProjectFilesFs,
} from './localProjectFiles.js'
import { NETWORK_ENV_KEYS } from './networkEnv.js'

/**
 * Builds a runnable island from stored project files on a machine that has
 * nothing else: writes the files (re-validating every path, since the
 * service's data is untrusted), writes the env file the config names with
 * the run's secret, backend, project env vars and network settings, and
 * installs the dependencies (frozen when a lockfile came along). Used by the
 * hosted runner.
 */

/** A project's network settings: literal proxy server, env var references. */
export interface HostedNetwork {
  proxyServer?: string
  proxyUsernameEnv?: string
  proxyPasswordEnv?: string
  httpCredentialsUsernameEnv?: string
  httpCredentialsPasswordEnv?: string
  /**
   * The origin a developer approved for the HTTP credentials and extra
   * headers; they are sent to no other origin.
   */
  credentialOrigin?: string
  extraHeaders: Array<{ name: string; valueEnv: string }>
}

export interface IslandFileInput {
  path: string
  content: Uint8Array
}

export interface AssembleIslandInput {
  islandDir: string
  files: readonly IslandFileInput[]
  /** The project's env vars (names and plaintext values). */
  envVars: Readonly<Record<string, string>>
  network: HostedNetwork | null
  /** The upload secret the run authenticates with. */
  secret: string
  backendUrl: string
  /** The site the project records (the project's app URL), when known. */
  appUrl: string | null
}

export interface IslandInstallParams {
  islandDir: string
  packageManager: PackageManager
  /** A lockfile came with the files: install exactly what it pins. */
  frozen: boolean
}

export interface AssembleIslandDeps {
  fs: ProjectFilesFs
  install: (params: IslandInstallParams) => Promise<void>
  detectPackageManager: (islandDir: string) => PackageManager | null
  log: (message: string) => void
}

export interface AssembleIslandResult {
  /** Island-relative env file path that was written. */
  envFile: string
  /** Every variable the run needs, also passed to the run's process. */
  env: Record<string, string>
  packageManager: PackageManager
  frozen: boolean
  writtenFiles: string[]
}

/** Variables the assembly owns; a project env var cannot override them. */
export const RESERVED_ISLAND_ENV_NAMES: readonly string[] = [
  'SCREENCI_SECRET',
  'SCREENCI_API_URL',
  'SCREENCI_ENVIRONMENT',
  'SCREENCI_RUNNER',
  'SCREENCI_RECORD_ID',
  'SCREENCI_CI',
]

const ENV_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/

/**
 * One dotenv value, quoted so both Node's env-file parser and the CLI's own
 * fallback parser read it back unchanged: single quotes (no escapes, `#` and
 * `$` stay literal) unless the value holds a single quote or a line break;
 * then double quotes with `\n` escapes, which only works without `"` and
 * backslashes. Null when neither form round-trips; such a value reaches the
 * run through its process environment only.
 */
export function quoteDotenvValue(value: string): string | null {
  if (!value.includes("'") && !/[\r\n]/.test(value)) return `'${value}'`
  if (!value.includes('"') && !value.includes('\\') && !value.includes('\r')) {
    return `"${value.replace(/\n/g, '\\n')}"`
  }
  return null
}

/** The env file text, one `NAME='value'` line per representable variable. */
export function buildIslandEnvFile(
  entries: ReadonlyArray<readonly [string, string]>
): { text: string; unrepresentable: string[] } {
  const lines = ['# Written by the ScreenCI hosted runner for this run only.']
  const unrepresentable: string[] = []
  for (const [name, value] of entries) {
    const quoted = quoteDotenvValue(value)
    if (quoted === null) {
      unrepresentable.push(name)
      continue
    }
    lines.push(`${name}=${quoted}`)
  }
  return { text: `${lines.join('\n')}\n`, unrepresentable }
}

/**
 * The network env vars (see networkEnv.ts) from the project's network
 * settings, resolving each `*Env` reference against the project's env vars.
 */
export function resolveNetworkEnv(
  network: HostedNetwork | null,
  envVars: Readonly<Record<string, string>>,
  log: (message: string) => void
): Array<[string, string]> {
  if (network === null) return []
  const lookup = (name: string | undefined, what: string): string | null => {
    if (name === undefined || name === '') return null
    const value = envVars[name]
    if (value === undefined) {
      log(`The ${what} refers to env var ${name}, which is not set; skipping.`)
      return null
    }
    return value
  }
  const out: Array<[string, string]> = []
  const proxyServer = network.proxyServer?.trim()
  if (proxyServer !== undefined && proxyServer !== '') {
    out.push([NETWORK_ENV_KEYS.proxyServer, proxyServer])
    const username = lookup(network.proxyUsernameEnv, 'proxy username')
    if (username !== null) {
      out.push([NETWORK_ENV_KEYS.proxyUsername, username])
      const password = lookup(network.proxyPasswordEnv, 'proxy password')
      if (password !== null)
        out.push([NETWORK_ENV_KEYS.proxyPassword, password])
    }
  }
  const credentialsUsername = lookup(
    network.httpCredentialsUsernameEnv,
    'HTTP credentials username'
  )
  if (credentialsUsername !== null) {
    out.push([NETWORK_ENV_KEYS.httpCredentialsUsername, credentialsUsername])
    const password = lookup(
      network.httpCredentialsPasswordEnv,
      'HTTP credentials password'
    )
    if (password !== null) {
      out.push([NETWORK_ENV_KEYS.httpCredentialsPassword, password])
    }
  }
  const headers: Record<string, string> = {}
  for (const header of network.extraHeaders) {
    const value = lookup(header.valueEnv, `header ${header.name}`)
    if (value !== null && header.name.trim() !== '') {
      headers[header.name] = value
    }
  }
  if (Object.keys(headers).length > 0) {
    out.push([NETWORK_ENV_KEYS.extraHeadersJson, JSON.stringify(headers)])
  }
  const credentialOrigin = network.credentialOrigin?.trim()
  if (credentialOrigin !== undefined && credentialOrigin !== '') {
    out.push([NETWORK_ENV_KEYS.credentialOrigin, credentialOrigin])
  }
  return out
}

/** The env file the config names, refused when it would leave the island. */
export function resolveIslandEnvFileName(configSource: string | null): string {
  const envFile =
    configSource === null ? '.env' : readIslandEnvFile(configSource)
  const normalized = envFile.replace(/^\.\//, '')
  try {
    assertSafeRelativePath(normalized)
  } catch {
    throw new Error(
      `screenci.config.ts sets envFile to "${envFile}", outside the project folder; a hosted run can only write an env file inside it.`
    )
  }
  return normalized
}

export async function assembleIsland(
  input: AssembleIslandInput,
  deps: AssembleIslandDeps
): Promise<AssembleIslandResult> {
  // Validate everything before writing anything.
  for (const file of input.files) assertStorableProjectPath(file.path)
  const paths = new Set(input.files.map((file) => file.path))
  if (!paths.has('package.json')) {
    throw new Error(
      'The project has no stored package.json; nothing to install.'
    )
  }

  const configFile = input.files.find(
    (file) => file.path === 'screenci.config.ts'
  )
  const envFile = resolveIslandEnvFileName(
    configFile === undefined
      ? null
      : Buffer.from(configFile.content).toString('utf-8')
  )
  if (paths.has(envFile)) {
    throw new Error(
      `The env file "${envFile}" would overwrite a stored project file.`
    )
  }

  await deps.fs.mkdir(input.islandDir, { recursive: true })
  for (const file of input.files) {
    const target = projectFileAbsolutePath(input.islandDir, file.path)
    await deps.fs.mkdir(dirname(target), { recursive: true })
    await deps.fs.writeFile(target, file.content)
  }

  const entries: Array<[string, string]> = [
    ['SCREENCI_SECRET', input.secret],
    ['SCREENCI_API_URL', input.backendUrl],
  ]
  const environment = environmentForBackendUrl(input.backendUrl)
  if (environment !== null) entries.push(['SCREENCI_ENVIRONMENT', environment])
  if (input.appUrl !== null && input.appUrl !== '') {
    entries.push(['SCREENCI_APP_URL', input.appUrl])
  }
  const owned = new Set(entries.map(([name]) => name))
  const networkEntries = resolveNetworkEnv(
    input.network,
    input.envVars,
    deps.log
  )
  const networkNames = new Set(networkEntries.map(([name]) => name))
  for (const [name, value] of Object.entries(input.envVars).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0
  )) {
    if (!ENV_NAME_PATTERN.test(name)) {
      deps.log(`Skipping env var "${name}": not a valid name.`)
      continue
    }
    if (owned.has(name) || RESERVED_ISLAND_ENV_NAMES.includes(name)) {
      deps.log(`Skipping env var ${name}: the run sets it itself.`)
      continue
    }
    // The project's network settings win over a same-named variable.
    if (networkNames.has(name)) continue
    entries.push([name, value])
  }
  entries.push(...networkEntries)

  const { text, unrepresentable } = buildIslandEnvFile(entries)
  if (unrepresentable.length > 0) {
    deps.log(
      `Env vars ${unrepresentable.join(', ')} cannot be written to ${envFile} unchanged; they reach the run through its environment only.`
    )
  }
  const envTarget = projectFileAbsolutePath(input.islandDir, envFile)
  await deps.fs.mkdir(dirname(envTarget), { recursive: true })
  await deps.fs.writeFile(envTarget, text)

  const detected = deps.detectPackageManager(input.islandDir)
  const packageManager = detected ?? 'npm'
  const frozen = detected !== null
  deps.log(
    `Installing dependencies with ${packageManager}${frozen ? ' (frozen lockfile)' : ''}...`
  )
  await deps.install({ islandDir: input.islandDir, packageManager, frozen })

  return {
    envFile,
    env: Object.fromEntries(entries),
    packageManager,
    frozen,
    writtenFiles: [...paths].sort(),
  }
}

/** The install command for a package manager, frozen or not. */
export function islandInstallCommand(params: {
  packageManager: PackageManager
  frozen: boolean
}): { command: string; args: string[] } {
  switch (params.packageManager) {
    case 'npm':
      return params.frozen
        ? { command: 'npm', args: ['ci'] }
        : { command: 'npm', args: ['install'] }
    case 'pnpm':
      return {
        command: 'pnpm',
        args: params.frozen ? ['install', '--frozen-lockfile'] : ['install'],
      }
    case 'yarn':
      return {
        command: 'yarn',
        args: params.frozen ? ['install', '--frozen-lockfile'] : ['install'],
      }
    default: {
      const exhaustive: never = params.packageManager
      throw new Error(`Unhandled package manager: ${String(exhaustive)}`)
    }
  }
}

/** Runs the install in the island, output inherited, rejecting on failure. */
export async function spawnIslandInstall(
  params: IslandInstallParams
): Promise<void> {
  const { command, args } = islandInstallCommand(params)
  await new Promise<void>((resolvePromise, reject) => {
    // The project's install scripts are the project's code: none of the
    // runner's own variables.
    const env = { ...process.env }
    delete env.RUN_TOKEN
    delete env.RUN_ID
    delete env.BACKEND_URL
    const child = spawn(command, args, {
      cwd: params.islandDir,
      env,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0
        ? resolvePromise()
        : reject(new Error(`${command} ${args.join(' ')} exited with ${code}`))
    )
  })
}

export function defaultDetectIslandPackageManager(
  islandDir: string
): PackageManager | null {
  return detectIslandLockfile(islandDir, existsSync)
}
