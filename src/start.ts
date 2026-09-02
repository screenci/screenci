import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { basename, posix, relative, resolve, sep } from 'node:path'
import type { Command } from 'commander'
import pc from 'picocolors'
import { readIslandEnvFile, readIslandProjectId } from './configLite.js'
import {
  findRepositoryRoot,
  getIslandRunCommand,
  installAgentSkills,
  installIslandFromPackageJson,
  installPlaywrightShell,
  parsePackageManager,
  scaffoldScreenciIsland,
  type PackageManager,
  type ScaffoldIslandParams,
} from './init.js'
import {
  getDevBackendUrl,
  getDevFrontendUrl,
  persistScreenCIEditToken,
  persistScreenCISecret,
} from './linkSession.js'
import { logger } from './logger.js'
import {
  applySourceBundle,
  nodeSourceBundleFs,
  type SourceBundleFs,
} from './sourceBundle.js'
import { fetchLatestSourceBundle } from './sourceSync.js'

/**
 * `screenci start <code>`: the entry point of the web-first flow. A person
 * clicks Add project / Add video / Edit in the web app, pastes the prompt it
 * produced into their coding agent, and the agent runs this command in the
 * app's repository (or an empty folder). It exchanges the one-time setup code
 * for a project-scoped secret plus a personal editor token, creates or pulls
 * the `./screenci` island, and prints a brief the agent follows.
 *
 * Everything is dependency-injected (`StartDeps`) so the whole command is
 * unit-testable without a network, a disk, or a package manager.
 */

export type SetupCodeKind = 'project' | 'video' | 'edit'

export interface SetupExchange {
  kind: SetupCodeKind
  orgId: string
  projectId: string
  projectName: string
  videoId?: string
  videoName?: string
  secret: string
  editToken: string
  task: { description: string; appUrl?: string }
  sourcesAvailable: boolean
  appUrl: string | null
}

export type SetupExchangeFailureKind =
  'invalid' | 'expired' | 'used' | 'revoked' | 'unreachable' | 'malformed'

export class StartError extends Error {
  constructor(
    message: string,
    public readonly failure?: SetupExchangeFailureKind
  ) {
    super(message)
    this.name = 'StartError'
  }
}

export type StartWorkspace =
  | { state: 'absent' }
  | { state: 'same-project' }
  | { state: 'other-project'; existingProjectId: string | null }

export type StartOutcome = 'scaffolded' | 'pulled' | 'synced'

export interface StartResult {
  exchange: SetupExchange
  /** The shell exports a different SCREENCI_SECRET that will shadow .env. */
  shellSecretOverride: boolean
  islandDir: string
  /** Island path relative to the cwd, POSIX-style, for the printed commands. */
  islandDisplayDir: string
  packageManager: PackageManager
  outcome: StartOutcome
  envFilePath: string
  /** Files the sync overwrote because `--force` was given. */
  overwritten: string[]
  /** For an edit code: the script that declares the video, when found. */
  videoSourcePath: string | null
  appUrl: string
}

export interface StartOptions {
  code: string
  name?: string
  dir?: string
  force: boolean
  packageManager: PackageManager
  verbose: boolean
  agent?: string
}

export interface StartLogger {
  info(message: string): void
  warn(message: string): void
}

export interface StartDeps {
  fetchFn: typeof fetch
  fs: SourceBundleFs
  existsSync: (path: string) => boolean
  /** The process environment (a shell-exported SCREENCI_SECRET wins over .env). */
  env: NodeJS.ProcessEnv
  cwd: () => string
  hostname: () => string
  apiUrl: string
  appUrl: string
  logger: StartLogger
  scaffoldIsland: (params: ScaffoldIslandParams) => Promise<void>
  installIsland: (params: {
    islandDir: string
    packageManager: PackageManager
    verbose: boolean
  }) => Promise<void>
  installPlaywrightShell: (params: {
    islandDir: string
    packageManager: PackageManager
  }) => Promise<void>
  installAgentSkills: (params: {
    repoRoot: string
    packageManager: PackageManager
    skills: readonly string[]
    agent?: string
    verbose: boolean
  }) => Promise<void>
  findRepoRoot: (startDir: string) => string
  persistSecret: (envFilePath: string, secret: string) => Promise<void>
  persistEditToken: (envFilePath: string, token: string) => Promise<void>
  /** Source text of a config file, or null when it cannot be read. */
  readConfigSource: (path: string) => Promise<string | null>
}

export function createDefaultStartDeps(): StartDeps {
  return {
    fetchFn: fetch,
    fs: nodeSourceBundleFs,
    existsSync,
    env: process.env,
    cwd: () => process.cwd(),
    hostname,
    apiUrl: getDevBackendUrl(),
    appUrl: getDevFrontendUrl(),
    logger,
    scaffoldIsland: scaffoldScreenciIsland,
    installIsland: installIslandFromPackageJson,
    installPlaywrightShell,
    installAgentSkills,
    findRepoRoot: findRepositoryRoot,
    persistSecret: persistScreenCISecret,
    persistEditToken: persistScreenCIEditToken,
    readConfigSource: async (path) => {
      try {
        return await readFile(path, 'utf-8')
      } catch {
        return null
      }
    },
  }
}

const SETUP_CODE_PATTERN = /^SC-[A-Z2-9]{4}-[A-Z2-9]{4}$/

export function normalizeSetupCode(raw: string): string {
  return raw.trim().toUpperCase()
}

export type ExchangeSetupCodeOutcome =
  | { ok: true; exchange: SetupExchange }
  | { ok: false; kind: SetupExchangeFailureKind; message: string }

function mapExchangeErrorCode(code: unknown): SetupExchangeFailureKind | null {
  switch (code) {
    case 'setup_code_invalid':
      return 'invalid'
    case 'setup_code_expired':
      return 'expired'
    case 'setup_code_used':
      return 'used'
    case 'setup_code_revoked':
      return 'revoked'
    default:
      return null
  }
}

function isSetupExchange(value: unknown): value is Omit<
  SetupExchange,
  'appUrl'
> & {
  appUrl?: string | null
} {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  const kindOk = v.kind === 'project' || v.kind === 'video' || v.kind === 'edit'
  const task = v.task as Record<string, unknown> | undefined
  return (
    kindOk &&
    typeof v.orgId === 'string' &&
    typeof v.projectId === 'string' &&
    typeof v.projectName === 'string' &&
    typeof v.secret === 'string' &&
    typeof v.editToken === 'string' &&
    typeof task === 'object' &&
    task !== null &&
    typeof task.description === 'string' &&
    typeof v.sourcesAvailable === 'boolean'
  )
}

/** `POST /cli/setup/exchange` with every failure mapped to a typed outcome. */
export async function exchangeSetupCode(
  params: {
    apiUrl: string
    code: string
    machineName: string
    projectName?: string
    defaultProjectName: string
    packageManager: PackageManager
  },
  fetchFn: typeof fetch
): Promise<ExchangeSetupCodeOutcome> {
  const code = normalizeSetupCode(params.code)
  if (!SETUP_CODE_PATTERN.test(code)) {
    return {
      ok: false,
      kind: 'invalid',
      message: `"${params.code}" is not a setup code. Copy the whole code (SC-XXXX-XXXX) from the prompt.`,
    }
  }
  let response: Response
  try {
    response = await fetchFn(`${params.apiUrl}/cli/setup/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        machineName: params.machineName,
        ...(params.projectName !== undefined
          ? { projectName: params.projectName }
          : {}),
        defaultProjectName: params.defaultProjectName,
        packageManager: params.packageManager,
      }),
    })
  } catch (err) {
    return {
      ok: false,
      kind: 'unreachable',
      message: `Could not reach ScreenCI: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    body = null
  }
  if (!response.ok) {
    const typed = (body ?? {}) as { error?: unknown; code?: unknown }
    const kind = mapExchangeErrorCode(typed.code)
    const message =
      typeof typed.error === 'string'
        ? typed.error
        : `The setup code exchange failed with status ${response.status}`
    return { ok: false, kind: kind ?? 'malformed', message }
  }
  if (!isSetupExchange(body)) {
    return {
      ok: false,
      kind: 'malformed',
      message: 'The setup code exchange returned an unexpected response.',
    }
  }
  const { appUrl, ...rest } = body
  return {
    ok: true,
    exchange: { ...rest, appUrl: typeof appUrl === 'string' ? appUrl : null },
  }
}

/**
 * Where `start` will put or find the island, and whether it may touch it. A
 * folder without a `screenci.config.ts` (an empty folder, or `--dir .`) is
 * usable like an absent one; a config without `projectId` is a
 * repository-managed island and is never touched.
 */
export async function resolveStartWorkspace(
  islandDir: string,
  projectId: string,
  deps: Pick<StartDeps, 'existsSync' | 'readConfigSource'>
): Promise<StartWorkspace> {
  if (!deps.existsSync(islandDir)) return { state: 'absent' }
  const source = await deps.readConfigSource(
    resolve(islandDir, 'screenci.config.ts')
  )
  if (source === null) return { state: 'absent' }
  const existingProjectId = readIslandProjectId(source) ?? null
  if (existingProjectId === projectId) return { state: 'same-project' }
  return { state: 'other-project', existingProjectId }
}

/**
 * The refusal `start` can decide before spending the code: an island that
 * belongs to a repository-managed project (a config with no `projectId`).
 * Returns the error message, or null when the exchange may proceed.
 */
export async function precheckStartWorkspace(
  islandDir: string,
  islandDisplayDir: string,
  deps: Pick<StartDeps, 'existsSync' | 'readConfigSource'>
): Promise<string | null> {
  if (!deps.existsSync(islandDir)) return null
  const source = await deps.readConfigSource(
    resolve(islandDir, 'screenci.config.ts')
  )
  if (source === null) return null
  if (readIslandProjectId(source) !== undefined) return null
  return `${islandDisplayDir} already exists and belongs to a repository-managed project (no projectId in its screenci.config.ts). Run this command in a different folder, or pass --dir <path> to use another folder for this project.`
}

function toDisplayPath(from: string, to: string): string {
  const rel = relative(from, to)
  const display = rel === '' ? '.' : rel.split(sep).join(posix.sep)
  return display
}

/**
 * Finds the `recordings/**` script that declares `videoName`, by looking for
 * the title as a string literal. Over-matching is harmless: the agent reads
 * the file either way.
 */
export async function findVideoSourceFile(
  islandDir: string,
  videoName: string,
  fs: SourceBundleFs
): Promise<string | null> {
  const needles = [`'${videoName}'`, `"${videoName}"`, `\`${videoName}\``]
  const matches: string[] = []
  const walk = async (dir: string): Promise<void> => {
    let entries
    try {
      entries = await fs.readdir(dir)
    } catch {
      return
    }
    for (const entry of [...entries].sort((a, b) =>
      a.name < b.name ? -1 : 1
    )) {
      const full = resolve(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'assets') continue
        await walk(full)
        continue
      }
      if (!entry.isFile() || !/\.screenci\.[cm]?[jt]sx?$/.test(entry.name)) {
        continue
      }
      const text = (await fs.readFile(full)).toString('utf-8')
      if (needles.some((needle) => text.includes(needle))) matches.push(full)
    }
  }
  await walk(resolve(islandDir, 'recordings'))
  return matches[0] ?? null
}

export async function runStartCommand(
  options: StartOptions,
  deps: StartDeps
): Promise<StartResult> {
  const cwd = deps.cwd()
  const defaultProjectName = basename(cwd) || 'screenci-project'
  const islandDir = resolve(cwd, options.dir ?? 'screenci')
  const islandDisplayDir = toDisplayPath(cwd, islandDir)
  // Refuse what can be refused before the code is spent.
  const precheck = await precheckStartWorkspace(
    islandDir,
    islandDisplayDir,
    deps
  )
  if (precheck !== null) throw new StartError(precheck)

  const outcome = await exchangeSetupCode(
    {
      apiUrl: deps.apiUrl,
      code: options.code,
      machineName: deps.hostname(),
      ...(options.name !== undefined && options.name.trim().length > 0
        ? { projectName: options.name.trim() }
        : {}),
      defaultProjectName,
      packageManager: options.packageManager,
    },
    deps.fetchFn
  )
  if (!outcome.ok) throw new StartError(outcome.message, outcome.kind)
  const { exchange } = outcome
  const appUrl = exchange.appUrl ?? deps.appUrl

  const workspace = await resolveStartWorkspace(
    islandDir,
    exchange.projectId,
    deps
  )
  const repoRoot = deps.findRepoRoot(cwd)
  const skills = ['screenci', 'playwright-cli']
  let result: StartOutcome
  let overwritten: string[] = []

  const pullSources = async (force: boolean): Promise<void> => {
    const fetched = await fetchLatestSourceBundle(
      { apiUrl: deps.apiUrl, secret: exchange.secret },
      deps.fetchFn
    )
    if (!fetched.ok) throw new StartError(fetched.message)
    const applied = await applySourceBundle(islandDir, fetched.files, deps.fs, {
      force,
    })
    if (!applied.ok) {
      throw new StartError(
        `${islandDisplayDir} has local changes in files the project's latest sources also changed:\n` +
          applied.conflicts.map((path) => `  ${path}`).join('\n') +
          `\nCommit or discard them, or rerun with --force to overwrite them with the project's sources.`
      )
    }
    overwritten = applied.overwritten
    deps.logger.info(
      `${pc.green('✔')} Pulled the project's sources into ${islandDisplayDir} (${applied.written.length} new, ${applied.unchanged.length} unchanged, ${applied.overwritten.length} overwritten).`
    )
  }

  const scaffold = async (): Promise<void> => {
    await deps.scaffoldIsland({
      islandDir,
      repoRoot,
      islandWorkflowPath: toDisplayPath(repoRoot, islandDir),
      projectName: exchange.projectName,
      projectId: exchange.projectId,
      packageManager: options.packageManager,
      verbose: options.verbose,
      ...(options.agent !== undefined ? { agent: options.agent } : {}),
      addReactOverlays: true,
      installPlaywrightBrowsers: true,
      installPlaywrightOsDeps: false,
      installScreenCISkill: true,
      installPlaywrightCli: true,
      // Sources live in ScreenCI for this project; a CI workflow that records
      // from git would fight the web-first flow, so none is generated.
      writeGithubWorkflow: false,
    })
  }

  switch (workspace.state) {
    case 'absent': {
      if (exchange.kind === 'project' || !exchange.sourcesAvailable) {
        await scaffold()
        result = 'scaffolded'
        break
      }
      await pullSources(true)
      await deps.installIsland({
        islandDir,
        packageManager: options.packageManager,
        verbose: options.verbose,
      })
      await deps.installPlaywrightShell({
        islandDir,
        packageManager: options.packageManager,
      })
      await deps.installAgentSkills({
        repoRoot,
        packageManager: options.packageManager,
        skills,
        ...(options.agent !== undefined ? { agent: options.agent } : {}),
        verbose: options.verbose,
      })
      result = 'pulled'
      break
    }
    case 'same-project': {
      if (exchange.sourcesAvailable) {
        await pullSources(options.force)
      } else {
        deps.logger.info(
          `${islandDisplayDir} already belongs to this project and no sources have been uploaded yet; keeping it as is.`
        )
      }
      if (!deps.existsSync(resolve(islandDir, 'node_modules'))) {
        await deps.installIsland({
          islandDir,
          packageManager: options.packageManager,
          verbose: options.verbose,
        })
        await deps.installPlaywrightShell({
          islandDir,
          packageManager: options.packageManager,
        })
      }
      result = 'synced'
      break
    }
    case 'other-project': {
      const owner =
        workspace.existingProjectId === null
          ? 'a repository-managed project (no projectId in its screenci.config.ts)'
          : `another project (${workspace.existingProjectId})`
      throw new StartError(
        `${islandDisplayDir} already exists and belongs to ${owner}. Run this command in a different folder, or pass --dir <path> to use another folder for this project.`
      )
    }
    default: {
      const exhaustive: never = workspace
      throw new Error(`Unhandled workspace state: ${String(exhaustive)}`)
    }
  }

  const configSource = await deps.readConfigSource(
    resolve(islandDir, 'screenci.config.ts')
  )
  const envFileName =
    configSource !== null ? readIslandEnvFile(configSource) : '.env'
  const envFilePath = resolve(islandDir, envFileName)
  await deps.persistSecret(envFilePath, exchange.secret)
  await deps.persistEditToken(envFilePath, exchange.editToken)

  const videoSourcePath =
    exchange.kind === 'edit' && exchange.videoName !== undefined
      ? await findVideoSourceFile(islandDir, exchange.videoName, deps.fs)
      : null

  const shellSecret = deps.env.SCREENCI_SECRET
  const shellSecretOverride =
    typeof shellSecret === 'string' &&
    shellSecret.length > 0 &&
    shellSecret !== exchange.secret
  if (shellSecretOverride) {
    deps.logger.warn(
      'SCREENCI_SECRET is exported in this shell and takes precedence over the credentials written to the workspace. Run `unset SCREENCI_SECRET` (and SCREENCI_EDIT_TOKEN) before `preview`, or uploads go to that key and the web app never opens the result.'
    )
  }

  const startResult: StartResult = {
    exchange,
    shellSecretOverride,
    islandDir,
    islandDisplayDir,
    packageManager: options.packageManager,
    outcome: result,
    envFilePath,
    overwritten,
    videoSourcePath:
      videoSourcePath !== null ? toDisplayPath(cwd, videoSourcePath) : null,
    appUrl,
  }
  deps.logger.info(formatStartBrief(startResult))
  deps.logger.info(JSON.stringify(formatStartJsonLine(startResult)))
  return startResult
}

/** The brief printed for the coding agent after a successful start. */
export function formatStartBrief(result: StartResult): string {
  const { exchange, islandDisplayDir } = result
  const run = getIslandRunCommand(result.packageManager)
  const lines: string[] = []
  const headline = (() => {
    switch (exchange.kind) {
      case 'project':
        return `Create a video for the new ScreenCI project "${exchange.projectName}".`
      case 'video':
        return `Add a video to the ScreenCI project "${exchange.projectName}".`
      case 'edit':
        return `Change the ScreenCI video "${exchange.videoName ?? ''}" in project "${exchange.projectName}".`
      default: {
        const exhaustive: never = exchange.kind
        throw new Error(`Unhandled setup code kind: ${String(exhaustive)}`)
      }
    }
  })()
  lines.push('', pc.green('✔ Connected to ScreenCI.'), '', `# ${headline}`, '')
  lines.push(
    `Workspace: ${islandDisplayDir}/ (${describeOutcome(result.outcome)}). Credentials are in ${toRelativeEnv(result)}; never print or commit them.`
  )
  if (result.shellSecretOverride) {
    lines.push('')
    lines.push(
      'WARNING: this shell exports a different SCREENCI_SECRET, which wins over the workspace credentials. Run `unset SCREENCI_SECRET SCREENCI_EDIT_TOKEN` before the commands below, or the uploads go to that key and the person waiting never sees the result.'
    )
  }
  lines.push('')
  lines.push('## What to do')
  lines.push('')
  lines.push(exchange.task.description.trim())
  lines.push('')
  if (exchange.task.appUrl !== undefined) {
    lines.push(
      `The app to record is at ${exchange.task.appUrl}. Point the script at it (page.goto with that URL, or set use.baseURL in ${islandDisplayDir}/screenci.config.ts). Explore it with the playwright-cli skill before writing selectors.`
    )
  } else {
    lines.push(
      `No app URL was given. Find how to reach the app (a deployed URL, or start its dev server from this repository and configure webServer/use.baseURL in ${islandDisplayDir}/screenci.config.ts) before recording.`
    )
  }
  lines.push('')
  switch (exchange.kind) {
    case 'project':
      lines.push(
        `Author the video as ${islandDisplayDir}/recordings/<flow>.screenci.ts and delete the starter recordings/example.screenci.ts. The project was named "${exchange.projectName}" (from --name or the folder); it can be renamed in the web app.`
      )
      break
    case 'video':
      lines.push(
        `Add a new script ${islandDisplayDir}/recordings/<flow>.screenci.ts next to the existing ones. Do not change the other videos.`
      )
      break
    case 'edit':
      lines.push(
        result.videoSourcePath !== null
          ? `Edit ${result.videoSourcePath}: it declares video("${exchange.videoName ?? ''}", ...). Keep the video title unchanged so the edit lands on the same video.`
          : `Find the script under ${islandDisplayDir}/recordings/ that declares video("${exchange.videoName ?? ''}", ...) and edit it. Keep the title unchanged.`
      )
      break
    default: {
      const exhaustive: never = exchange.kind
      throw new Error(`Unhandled setup code kind: ${String(exhaustive)}`)
    }
  }
  lines.push('')
  lines.push('## Rules')
  lines.push('')
  lines.push(
    '- Every video needs video.narration({...}) and opens by stating its purpose; narrate the flow, not the clicks.',
    '- Wrap setup (login, initial navigation, cookie banners, loading) in hide(); then move through the demo with visible clicks.',
    '- Use plausible fictitious data in forms, never real people.',
    '- The installed screenci skill has the full authoring guide.'
  )
  lines.push('')
  lines.push('## Commands (run them yourself, in order)')
  lines.push('')
  lines.push('```bash')
  lines.push(`cd ${islandDisplayDir}`)
  lines.push(`${run} test               # repeat until green`)
  lines.push(
    exchange.kind === 'edit'
      ? `${run} preview "${exchange.videoName ?? ''}"   # record the live preview; the person who sent you the code sees it land`
      : `${run} preview "<video title>"   # record the live preview; the person who sent you the code sees it land`
  )
  lines.push(
    `${run} export              # only if finished, downloadable videos were asked for`
  )
  lines.push('```')
  lines.push('')
  lines.push(
    "preview and export upload this folder's scripts to ScreenCI so the video can be edited from the web app later. Report the link the command prints."
  )
  if (result.overwritten.length > 0) {
    lines.push('')
    lines.push(
      `Overwritten with the project's sources (--force): ${result.overwritten.join(', ')}`
    )
  }
  lines.push('')
  lines.push(
    `Docs: ${result.appUrl.replace(/^https?:\/\/app\./, 'https://')}/docs/video-script-basics and /docs/reference/cli`
  )
  lines.push('')
  return lines.join('\n')
}

function describeOutcome(outcome: StartOutcome): string {
  switch (outcome) {
    case 'scaffolded':
      return 'new project scaffolded'
    case 'pulled':
      return "pulled the project's current sources"
    case 'synced':
      return 'existing workspace, sources synced'
    default: {
      const exhaustive: never = outcome
      throw new Error(`Unhandled outcome: ${String(exhaustive)}`)
    }
  }
}

function toRelativeEnv(result: StartResult): string {
  return `${result.islandDisplayDir}/${basename(result.envFilePath)}`
}

/** One machine-readable line for agents that parse output. */
export function formatStartJsonLine(
  result: StartResult
): Record<string, unknown> {
  const { exchange } = result
  return {
    status: 'started',
    kind: exchange.kind,
    projectId: exchange.projectId,
    projectName: exchange.projectName,
    ...(exchange.videoId !== undefined ? { videoId: exchange.videoId } : {}),
    ...(exchange.videoName !== undefined
      ? { videoName: exchange.videoName }
      : {}),
    ...(result.videoSourcePath !== null
      ? { videoSourcePath: result.videoSourcePath }
      : {}),
    workspace: result.islandDir,
    outcome: result.outcome,
    appUrl: result.appUrl,
    ...(result.shellSecretOverride ? { shellSecretOverride: true } : {}),
    ...(exchange.task.appUrl !== undefined
      ? { taskAppUrl: exchange.task.appUrl }
      : {}),
    description: exchange.task.description,
  }
}

export function registerStartCommand(
  program: Command,
  deps: StartDeps,
  defaultPackageManager: PackageManager
): Command {
  return program
    .command('start <code>')
    .description(
      'Set up this machine from a setup code created in the ScreenCI web app: ' +
        'creates or pulls the ./screenci workspace, writes its credentials, and prints what to do next.'
    )
    .option(
      '--name <projectName>',
      'name for a new project (default: the current folder name)'
    )
    .option('--dir <path>', 'workspace folder (default: ./screenci)')
    .option(
      '--force',
      'overwrite local files that differ from the project sources'
    )
    .option(
      '--package-manager <manager>',
      `package manager to use: npm, pnpm, or yarn (default: ${defaultPackageManager})`
    )
    .option(
      '--agent <name>',
      'target agent for the skills install, e.g. opencode'
    )
    .option('-v, --verbose', 'verbose output')
    .action(async (code: string, options: Record<string, unknown>) => {
      const name = options['name'] as string | undefined
      const dir = options['dir'] as string | undefined
      const agent = options['agent'] as string | undefined
      await runStartCommand(
        {
          code,
          ...(name !== undefined ? { name } : {}),
          ...(dir !== undefined ? { dir } : {}),
          force: options['force'] === true,
          packageManager: parsePackageManager(
            options['packageManager'] as string | undefined,
            deps.cwd()
          ),
          verbose: options['verbose'] === true,
          ...(agent !== undefined ? { agent } : {}),
        },
        deps
      )
    })
}
