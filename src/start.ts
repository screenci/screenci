import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { basename, posix, relative, resolve, sep } from 'node:path'
import type { Command } from 'commander'
import pc from 'picocolors'
import {
  APP_PASSWORD_ENV,
  APP_USERNAME_ENV,
  EMPTY_AI_CONTEXT,
  fetchAppLogin,
  parseAiContext,
  persistAppLogin,
  type AppLogin,
  type CliAiContext,
  type FetchAppLoginResult,
  type PersistAppLoginOutcome,
} from './aiContext.js'
import {
  extractConfigStringLiteral,
  readIslandEnvFile,
  readIslandProjectId,
  stripIslandProjectId,
} from './configLite.js'
import { PENDING_MERGE_FILE, type PendingMerge } from './mergeComplete.js'
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
  nodeStartGit,
  REPO_CLONE_DIR,
  sameRepository,
  type StartGit,
} from './repo.js'
import { probeSite } from './siteProbe.js'
import {
  classifySiteOrigin,
  SCREENCI_APP_LAUNCHED_BY_ENV,
  toSiteOrigin,
  type SiteKind,
} from './siteOrigin.js'
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
 * for a project-scoped secret plus a personal editor token, works out where
 * the product's source code and site are (the organisation's AI context),
 * creates or pulls the `./screenci` island, writes the person's site login
 * into its env file, and prints a brief the agent follows. When the site is
 * unreachable and the agent may not start it, the brief says STOP and the
 * command exits with code 2.
 *
 * Everything is dependency-injected (`StartDeps`) so the whole command is
 * unit-testable without a network, a disk, git, or a package manager.
 */

export type SetupCodeKind = 'project' | 'video' | 'edit' | 'merge'

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
  /** Where the project's scripts live; `service` when the server is older. */
  sourceMode: 'service' | 'local'
  /** The resolved AI context (org defaults plus project overrides). */
  aiContext: CliAiContext
  /** Whether the person who created the code saved a personal site login. */
  login: { saved: boolean }
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
  /** A config without `projectId`: scripts committed in a repository. */
  | { state: 'repository-island'; projectName: string | null }
  | { state: 'other-project'; existingProjectId: string }

export type StartOutcome =
  | 'scaffolded'
  | 'pulled'
  | 'synced'
  | 'repository'
  /** Merge code: sources pulled into the repository, projectId removed. */
  | 'merge-prepared'

/** What `start` found out about the product's repository. */
export type StartRepo =
  | { state: 'not-configured' }
  | { state: 'inside'; dir: string; gitUrl: string }
  | { state: 'cloned'; dir: string; gitUrl: string; fresh: boolean }
  | { state: 'clone-skipped'; gitUrl: string }
  | { state: 'clone-failed'; gitUrl: string; message: string }

/** What `start` found out about the site to record. */
export type StartSite =
  | { state: 'none' }
  | { state: 'unchecked'; url: string; kind: SiteKind }
  | { state: 'checked'; url: string; kind: SiteKind; reachable: boolean }

export type StartLogin = {
  /** A login was fetched and is in the env file (or was already there). */
  saved: boolean
  envOutcome: PersistAppLoginOutcome
}

export type StartStopReason =
  'site-unreachable-local' | 'site-unreachable' | 'repo-unavailable'

export type StartStop = {
  reason: StartStopReason
  message: string
  docsUrl: string
}

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
  repo: StartRepo
  site: StartSite
  login: StartLogin
  /** Set when the agent must stop and report instead of recording. */
  stop: StartStop | null
  /** Merge code: what `screenci merge-complete` reports afterwards. */
  pendingMerge: PendingMerge | null
}

export interface StartOptions {
  code: string
  name?: string
  dir?: string
  force: boolean
  packageManager: PackageManager
  verbose: boolean
  agent?: string
  /** Do not probe the site; record regardless. */
  skipSiteCheck?: boolean
  /** Do not clone the repository when outside it (default: clone). */
  clone?: boolean
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
  git: StartGit
  probeSite: (url: string) => Promise<boolean>
  fetchAppLogin: (
    params: { apiUrl: string; secret: string; editToken: string },
    fetchFn: typeof fetch
  ) => Promise<FetchAppLoginResult>
  persistAppLogin: (
    envFilePath: string,
    login: AppLogin | null,
    options: { overwrite: boolean }
  ) => Promise<PersistAppLoginOutcome>
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
    git: nodeStartGit,
    probeSite: (url) => probeSite(url, fetch),
    fetchAppLogin,
    persistAppLogin: (envFilePath, login, options) =>
      persistAppLogin(envFilePath, login, options),
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

type RawSetupExchange = Omit<
  SetupExchange,
  'appUrl' | 'sourceMode' | 'aiContext' | 'login'
> & {
  appUrl?: string | null
  sourceMode?: unknown
  aiContext?: unknown
  login?: unknown
}

function isSetupExchange(value: unknown): value is RawSetupExchange {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  const kindOk =
    v.kind === 'project' ||
    v.kind === 'video' ||
    v.kind === 'edit' ||
    v.kind === 'merge'
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

/** Fills the fields an older server omits. */
function toSetupExchange(raw: RawSetupExchange): SetupExchange {
  const { appUrl, sourceMode, aiContext, login, ...rest } = raw
  const loginRow = (login ?? {}) as Record<string, unknown>
  return {
    ...rest,
    appUrl: typeof appUrl === 'string' ? appUrl : null,
    sourceMode: sourceMode === 'local' ? 'local' : 'service',
    aiContext:
      aiContext === undefined ? EMPTY_AI_CONTEXT : parseAiContext(aiContext),
    login: { saved: loginRow.saved === true },
  }
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
  return { ok: true, exchange: toSetupExchange(body) }
}

/**
 * Where `start` will put or find the island, and whether it may touch it. A
 * folder without a `screenci.config.ts` (an empty folder, or `--dir .`) is
 * usable like an absent one; a config without `projectId` is a
 * repository-managed island, usable only for the project it names.
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
  const existingProjectId = readIslandProjectId(source)
  if (existingProjectId === undefined) {
    return {
      state: 'repository-island',
      projectName: extractConfigStringLiteral(source, 'projectName') ?? null,
    }
  }
  if (existingProjectId === projectId) return { state: 'same-project' }
  return { state: 'other-project', existingProjectId }
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

/**
 * Locates the product's repository: the cwd's own repository when its
 * `origin` is the configured one, else a shallow clone under
 * `.screenci/repo` (refreshed when it already exists).
 */
export async function resolveRepository(
  params: { cwd: string; gitUrl: string | null; clone: boolean },
  deps: Pick<StartDeps, 'git' | 'findRepoRoot' | 'fs' | 'existsSync' | 'logger'>
): Promise<StartRepo> {
  const { gitUrl } = params
  if (gitUrl === null) return { state: 'not-configured' }
  const repoRoot = deps.findRepoRoot(params.cwd)
  const remote = await deps.git.remoteUrl(repoRoot)
  if (remote !== null && sameRepository(remote, gitUrl)) {
    return { state: 'inside', dir: repoRoot, gitUrl }
  }
  if (!params.clone) return { state: 'clone-skipped', gitUrl }

  const cloneDir = resolve(params.cwd, REPO_CLONE_DIR)
  if (deps.existsSync(cloneDir)) {
    const existingRemote = await deps.git.remoteUrl(cloneDir)
    if (existingRemote === null || !sameRepository(existingRemote, gitUrl)) {
      return {
        state: 'clone-failed',
        gitUrl,
        message: `${REPO_CLONE_DIR} already exists but is not a clone of ${gitUrl}. Remove it and rerun.`,
      }
    }
    const updated = await deps.git.update(cloneDir)
    if (!updated.ok) {
      deps.logger.warn(
        `Could not refresh the clone in ${REPO_CLONE_DIR} (${updated.message}); using it as is.`
      )
    }
    return { state: 'cloned', dir: cloneDir, gitUrl, fresh: false }
  }

  const holder = resolve(params.cwd, '.screenci')
  await deps.fs.mkdir(holder, { recursive: true })
  // The clone never belongs in the cwd's own repository.
  await deps.fs.writeFile(resolve(holder, '.gitignore'), '*\n')
  const cloned = await deps.git.clone(gitUrl, cloneDir)
  if (!cloned.ok) {
    return {
      state: 'clone-failed',
      gitUrl,
      message: `git clone ${gitUrl} failed: ${cloned.message}. Make sure git on this machine can access the repository (SSH key or credential helper), then rerun.`,
    }
  }
  return { state: 'cloned', dir: cloneDir, gitUrl, fresh: true }
}

export function repoDirOf(repo: StartRepo): string | null {
  switch (repo.state) {
    case 'inside':
    case 'cloned':
      return repo.dir
    case 'not-configured':
    case 'clone-skipped':
    case 'clone-failed':
      return null
    default: {
      const exhaustive: never = repo
      throw new Error(`Unhandled repo state: ${String(exhaustive)}`)
    }
  }
}

/** Probes the site the task or the AI context names, unless told not to. */
export async function resolveSite(
  params: { url: string | null; skipSiteCheck: boolean },
  deps: Pick<StartDeps, 'probeSite'>
): Promise<StartSite> {
  if (params.url === null) return { state: 'none' }
  const kind = classifySiteOrigin(toSiteOrigin(params.url) ?? params.url)
  if (params.skipSiteCheck) return { state: 'unchecked', url: params.url, kind }
  const reachable = await deps.probeSite(params.url)
  return { state: 'checked', url: params.url, kind, reachable }
}

/**
 * Whether the agent must stop instead of recording. A local site that is
 * down may only be started by the agent when the organisation allows it and
 * the repository is at hand; a deployed site that is down, or a clone that
 * failed while the site is down, is reported back to the person.
 */
export function decideStart(input: {
  site: StartSite
  repo: StartRepo
  runLocallyIfNeeded: boolean
  docsUrl: string
}): StartStop | null {
  const { site, repo, docsUrl } = input
  switch (site.state) {
    case 'none':
    case 'unchecked':
      return null
    case 'checked':
      break
    default: {
      const exhaustive: never = site
      throw new Error(`Unhandled site state: ${String(exhaustive)}`)
    }
  }
  if (site.reachable) return null
  const repoDir = repoDirOf(repo)
  const cloneNote =
    repo.state === 'clone-failed'
      ? ` The repository could not be cloned either (${repo.message}).`
      : ''
  switch (site.kind) {
    case 'local': {
      if (input.runLocallyIfNeeded && repoDir !== null) return null
      const why =
        repoDir === null
          ? input.runLocallyIfNeeded
            ? `Starting the app from its repository is allowed, but the repository is not available here.${cloneNote}`
            : 'Starting the app from its repository is switched off for this organisation (AI context > "Let the agent start the app").'
          : 'Starting the app from its repository is switched off for this organisation (AI context > "Let the agent start the app").'
      return {
        reason: 'site-unreachable-local',
        message: `${site.url} is a local address and nothing answers there. ${why} Ask the person to start the app (or to switch the setting on), then rerun this command. Docs: ${docsUrl}`,
        docsUrl,
      }
    }
    case 'deployed':
      return {
        reason:
          repo.state === 'clone-failed'
            ? 'repo-unavailable'
            : 'site-unreachable',
        message: `${site.url} did not answer within a few seconds.${cloneNote} Ask the person to check the site URL in AI context (or that it is reachable from this machine), then rerun this command; pass --skip-site-check to record anyway. Docs: ${docsUrl}`,
        docsUrl,
      }
    default: {
      const exhaustive: never = site.kind
      throw new Error(`Unhandled site kind: ${String(exhaustive)}`)
    }
  }
}

/**
 * The marketing/docs site for an app URL: `app.screenci.com` and
 * `dev.app.screenci.com` map to their `screenci.com` twins; anything else
 * (a local dev server) falls back to the production docs.
 */
export function siteRootOf(appUrl: string): string {
  const match = /^https?:\/\/(dev\.)?app\.([^/]+)/.exec(appUrl)
  if (match) return `https://${match[1] ?? ''}${match[2]}`
  return 'https://screenci.com'
}

export function aiContextDocsUrl(appUrl: string): string {
  return `${siteRootOf(appUrl)}/docs/guides/ai-context`
}

export async function runStartCommand(
  options: StartOptions,
  deps: StartDeps
): Promise<StartResult> {
  const cwd = deps.cwd()
  const defaultProjectName = basename(cwd) || 'screenci-project'

  // The exchange runs first: which workspace is acceptable depends on the
  // project it names. A refusal below therefore spends the code, but the same
  // machine can rerun it (the server re-issues an unexpired code with no run
  // landed yet), so a retry with --dir still works.
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
  const docsUrl = aiContextDocsUrl(appUrl)

  const repo = await resolveRepository(
    { cwd, gitUrl: exchange.aiContext.gitUrl, clone: options.clone !== false },
    deps
  )
  if (repo.state === 'clone-failed') deps.logger.warn(repo.message)

  // The island: an explicit --dir, else a `screenci/` island inside the
  // repository when one exists there, else ./screenci.
  let islandDir = resolve(cwd, options.dir ?? 'screenci')
  const repoDir = repoDirOf(repo)
  // An existing project may already keep its workspace in the repository; a
  // brand-new project never does, so it always gets ./screenci.
  if (
    options.dir === undefined &&
    repoDir !== null &&
    exchange.kind !== 'project'
  ) {
    const candidate = resolve(repoDir, 'screenci')
    if (deps.existsSync(resolve(candidate, 'screenci.config.ts'))) {
      islandDir = candidate
    }
  }
  let islandDisplayDir = toDisplayPath(cwd, islandDir)

  const workspace = await resolveStartWorkspace(
    islandDir,
    exchange.projectId,
    deps
  )
  // Skills go where the agent works (the cwd's repository), never into the
  // gitignored clone under .screenci/repo.
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

  const installDependencies = async (): Promise<void> => {
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
  const installIfNeeded = async (): Promise<void> => {
    if (deps.existsSync(resolve(islandDir, 'node_modules'))) return
    await installDependencies()
  }
  const installSkills = async (): Promise<void> => {
    await deps.installAgentSkills({
      repoRoot,
      packageManager: options.packageManager,
      skills,
      ...(options.agent !== undefined ? { agent: options.agent } : {}),
      verbose: options.verbose,
    })
  }

  let pendingMerge: PendingMerge | null = null
  if (exchange.kind === 'merge') {
    if (repoDir === null) {
      throw new StartError(
        repo.state === 'clone-failed'
          ? `The repository could not be cloned (${repo.message}). Run this command inside the repository instead.`
          : repo.state === 'clone-skipped'
            ? 'Moving sources into the repository needs the repository: rerun without --no-clone, or inside the repository.'
            : `No repository URL is known for "${exchange.projectName}". Ask the person to add it under AI context, then create a new prompt. Docs: ${docsUrl}`
      )
    }
    islandDir = resolve(repoDir, 'screenci')
    const mergeDisplayDir = toDisplayPath(cwd, islandDir)
    const existing = await resolveStartWorkspace(
      islandDir,
      exchange.projectId,
      deps
    )
    if (existing.state === 'other-project') {
      throw new StartError(
        `${mergeDisplayDir} already exists in the repository and belongs to another project (${existing.existingProjectId}).`
      )
    }
    if (existing.state === 'repository-island') {
      throw new StartError(
        `${mergeDisplayDir} already exists in the repository as a repository-managed workspace${
          existing.projectName !== null ? ` ("${existing.projectName}")` : ''
        }. The sources are already there; nothing to move.`
      )
    }
    const fetched = await fetchLatestSourceBundle(
      { apiUrl: deps.apiUrl, secret: exchange.secret },
      deps.fetchFn
    )
    if (!fetched.ok) throw new StartError(fetched.message)
    if (fetched.bundleId === null) {
      throw new StartError(
        'ScreenCI did not name the source bundle it served; update screenci and rerun.'
      )
    }
    const applied = await applySourceBundle(islandDir, fetched.files, deps.fs, {
      force: options.force,
    })
    if (!applied.ok) {
      throw new StartError(
        `${mergeDisplayDir} has local changes in files the project's sources also changed:\n` +
          applied.conflicts.map((path) => `  ${path}`).join('\n') +
          `\nCommit or discard them, or rerun with --force to overwrite them.`
      )
    }
    overwritten = applied.overwritten
    // The repository is the source of truth from here on: without projectId
    // the island is repository-managed and preview stops uploading sources.
    const configPath = resolve(islandDir, 'screenci.config.ts')
    const mergeConfig = await deps.readConfigSource(configPath)
    if (mergeConfig !== null) {
      await deps.fs.writeFile(configPath, stripIslandProjectId(mergeConfig))
    }
    const mergeGitUrl =
      repo.state === 'inside' || repo.state === 'cloned' ? repo.gitUrl : null
    if (mergeGitUrl === null) {
      throw new Error('Unreachable: a merge needs a located repository')
    }
    pendingMerge = { sourceBundleId: fetched.bundleId, gitUrl: mergeGitUrl }
    await deps.fs.mkdir(resolve(islandDir, '.screenci'), { recursive: true })
    await deps.fs.writeFile(
      resolve(islandDir, PENDING_MERGE_FILE),
      JSON.stringify(pendingMerge, null, 2) + '\n'
    )
    await installDependencies()
    await installSkills()
    deps.logger.info(
      `${pc.green('✔')} Pulled the project's sources into ${mergeDisplayDir} (${applied.written.length} new, ${applied.unchanged.length} unchanged, ${applied.overwritten.length} overwritten) and removed projectId from its config.`
    )
    result = 'merge-prepared'
  } else
    switch (workspace.state) {
      case 'absent': {
        if (exchange.sourceMode === 'local' && !exchange.sourcesAvailable) {
          throw new StartError(
            `The project "${exchange.projectName}" keeps its scripts in a repository, and no screenci/ workspace was found${
              repo.state === 'not-configured'
                ? '. Its repository URL is not set: ask the person to add it under AI context in the web app, or run this command inside the repository'
                : repo.state === 'clone-failed'
                  ? `: the repository could not be cloned (${repo.message})`
                  : ` in ${repoDir !== null ? toDisplayPath(cwd, repoDir) : 'the repository'}`
            }. If the workspace lives elsewhere in the repository, run this command inside it with --dir <path to the workspace>. Docs: ${docsUrl}`
          )
        }
        if (exchange.kind === 'project' || !exchange.sourcesAvailable) {
          await scaffold()
          result = 'scaffolded'
          break
        }
        await pullSources(true)
        await installDependencies()
        await installSkills()
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
        await installIfNeeded()
        result = 'synced'
        break
      }
      case 'repository-island': {
        if (workspace.projectName !== exchange.projectName) {
          throw new StartError(
            `${islandDisplayDir} already exists and belongs to a repository-managed project${
              workspace.projectName !== null
                ? ` ("${workspace.projectName}")`
                : ''
            }, not to "${exchange.projectName}". Run this command in a different folder, or pass --dir <path> to use another folder for this project.`
          )
        }
        await installIfNeeded()
        await installSkills()
        deps.logger.info(
          `${pc.green('✔')} Using the repository's workspace ${islandDisplayDir}.`
        )
        result = 'repository'
        break
      }
      case 'other-project': {
        throw new StartError(
          `${islandDisplayDir} already exists and belongs to another project (${workspace.existingProjectId}). Run this command in a different folder, or pass --dir <path> to use another folder for this project.`
        )
      }
      default: {
        const exhaustive: never = workspace
        throw new Error(`Unhandled workspace state: ${String(exhaustive)}`)
      }
    }

  islandDisplayDir = toDisplayPath(cwd, islandDir)
  const configSource = await deps.readConfigSource(
    resolve(islandDir, 'screenci.config.ts')
  )
  const envFileName =
    configSource !== null ? readIslandEnvFile(configSource) : '.env'
  const envFilePath = resolve(islandDir, envFileName)
  await deps.persistSecret(envFilePath, exchange.secret)
  await deps.persistEditToken(envFilePath, exchange.editToken)

  // The person's site login (theirs alone) goes into the env file the
  // scripts read; placeholders when none is saved. Never printed.
  const loginFetch = await deps.fetchAppLogin(
    {
      apiUrl: deps.apiUrl,
      secret: exchange.secret,
      editToken: exchange.editToken,
    },
    deps.fetchFn
  )
  if (!loginFetch.ok) {
    deps.logger.warn(`Could not fetch the site login: ${loginFetch.message}`)
  }
  const fetchedLogin = loginFetch.ok ? loginFetch.login : null
  const envOutcome = await deps.persistAppLogin(envFilePath, fetchedLogin, {
    overwrite: false,
  })
  const login: StartLogin = {
    saved: fetchedLogin !== null || envOutcome === 'kept',
    envOutcome,
  }

  const videoSourcePath =
    exchange.kind === 'edit' && exchange.videoName !== undefined
      ? await findVideoSourceFile(islandDir, exchange.videoName, deps.fs)
      : null

  const site = await resolveSite(
    {
      url: exchange.task.appUrl ?? exchange.aiContext.siteUrl,
      skipSiteCheck: options.skipSiteCheck === true,
    },
    deps
  )
  const stop = decideStart({
    site,
    repo,
    runLocallyIfNeeded: exchange.aiContext.runLocallyIfNeeded,
    docsUrl,
  })

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
    repo,
    site,
    login,
    stop,
    pendingMerge,
  }
  deps.logger.info(formatStartBrief(startResult, cwd))
  deps.logger.info(JSON.stringify(formatStartJsonLine(startResult)))
  return startResult
}

/** The brief printed for the coding agent after a successful start. */
export function formatStartBrief(result: StartResult, cwd?: string): string {
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
      case 'merge':
        return `Move the ScreenCI project "${exchange.projectName}" into its repository.`
      default: {
        const exhaustive: never = exchange.kind
        throw new Error(`Unhandled setup code kind: ${String(exhaustive)}`)
      }
    }
  })()
  lines.push('', pc.green('✔ Connected to ScreenCI.'), '', `# ${headline}`, '')
  if (result.stop !== null) {
    lines.push(
      `## STOP: do not record yet (${result.stop.reason})`,
      '',
      result.stop.message,
      '',
      'Report this to the person who sent you the prompt, quoting the reason and the docs link. The workspace below is ready; rerunning this same command on this machine continues once the site is up.',
      ''
    )
  }
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
    case 'merge':
      lines.push(
        `The project's sources are now in ${islandDisplayDir}/ inside the repository, with projectId removed from screenci.config.ts. Do not change the scripts. Steps:`,
        '',
        `1. Create a branch (for example screenci/add-video-sources), add ${islandDisplayDir}/ (its ${basename(result.envFilePath)} is gitignored and must stay out of git), commit, and push.`,
        '2. Open a pull request when the repository uses them (gh pr create when available).',
        `3. From ${islandDisplayDir}/ run \`${run} test\` and one \`${run} preview\` so the person sees the repository copy records the same videos.`,
        `4. Run \`${run} merge-complete --pr <url>\` from ${islandDisplayDir}/ (the commit and repository come from git). ScreenCI then treats the project as repository-managed.`,
        '5. Report the pull request link and the preview link.'
      )
      break
    default: {
      const exhaustive: never = exchange.kind
      throw new Error(`Unhandled setup code kind: ${String(exhaustive)}`)
    }
  }
  lines.push('')
  lines.push(...formatRepoSection(result, cwd))
  lines.push(...formatSiteSection(result, islandDisplayDir))
  lines.push(...formatLoginSection(result))
  if (exchange.aiContext.guide !== null) {
    lines.push(
      '## Notes from the team',
      '',
      exchange.aiContext.guide.trim(),
      ''
    )
  }
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
    result.outcome === 'repository' || result.outcome === 'merge-prepared'
      ? 'This workspace lives in the repository: commit your change on a branch and push it (open a pull request when the repository uses them) so the video source stays with the code. Report the link the command prints.'
      : "preview and export upload this folder's scripts to ScreenCI so the video can be edited from the web app later. Report the link the command prints."
  )
  if (result.overwritten.length > 0) {
    lines.push('')
    lines.push(
      `Overwritten with the project's sources (--force): ${result.overwritten.join(', ')}`
    )
  }
  lines.push('')
  lines.push(
    `Docs: ${siteRootOf(result.appUrl)}/docs/video-script-basics, /docs/reference/cli and /docs/guides/ai-context`
  )
  lines.push('')
  return lines.join('\n')
}

function formatRepoSection(result: StartResult, cwd?: string): string[] {
  const { repo } = result
  const display = (dir: string): string =>
    cwd !== undefined ? toDisplayPath(cwd, dir) : dir
  switch (repo.state) {
    case 'not-configured':
      return [
        '## Repository',
        '',
        'No repository is configured for this product (AI context in the web app). Work from the site alone; explore it with the playwright-cli skill before writing selectors.',
        '',
      ]
    case 'inside':
      return [
        '## Repository',
        '',
        `You are inside the product's repository (${repo.gitUrl}) at ${display(repo.dir)}/. Read its routes, components and README to learn the real URLs and selectors.`,
        '',
      ]
    case 'cloned':
      return [
        '## Repository',
        '',
        `The product's repository (${repo.gitUrl}) is ${repo.fresh ? 'cloned' : 'already cloned and refreshed'} at ${display(repo.dir)}/. Use it as context: read its routes, components and README to learn the real URLs and selectors. Do not commit there unless the workspace lives in it.`,
        '',
      ]
    case 'clone-skipped':
      return [
        '## Repository',
        '',
        `The product's repository is ${repo.gitUrl}, not cloned (--no-clone).`,
        '',
      ]
    case 'clone-failed':
      return [
        '## Repository',
        '',
        `The product's repository (${repo.gitUrl}) could not be cloned: ${repo.message} Mention this to the person; continue from the site.`,
        '',
      ]
    default: {
      const exhaustive: never = repo
      throw new Error(`Unhandled repo state: ${String(exhaustive)}`)
    }
  }
}

function formatSiteSection(
  result: StartResult,
  islandDisplayDir: string
): string[] {
  const { site, repo, exchange } = result
  const configHint = `Point the script at it (page.goto with that URL, or set use.baseURL in ${islandDisplayDir}/screenci.config.ts).`
  switch (site.state) {
    case 'none':
      return [
        '## Site',
        '',
        `No site URL was given. Find how to reach the app (a deployed URL, or start its dev server from the repository and configure webServer/use.baseURL in ${islandDisplayDir}/screenci.config.ts) before recording. Ask the person to set the site URL under AI context so this is not needed next time.`,
        '',
      ]
    case 'unchecked':
      return [
        '## Site',
        '',
        `The app to record is at ${site.url} (not checked, --skip-site-check). ${configHint}`,
        '',
      ]
    case 'checked': {
      if (site.reachable) {
        return [
          '## Site',
          '',
          `The app to record is at ${site.url} and answers. ${configHint} Explore it with the playwright-cli skill before writing selectors. Run preview with ${SCREENCI_APP_LAUNCHED_BY_ENV}=existing so the version records that the app was already running.`,
          '',
        ]
      }
      if (result.stop !== null) {
        return [
          '## Site',
          '',
          `The app to record is at ${site.url}, but nothing answers there. See STOP above.`,
          '',
        ]
      }
      // Local, unreachable, and the agent may start it from the repository.
      const repoDir = repoDirOf(repo)
      return [
        '## Site',
        '',
        `The app to record is at ${site.url} (a local address) and is not running. The organisation allows you to start it from the repository${repoDir !== null ? ` at ${repoDir}` : ''}: read its README and package.json, install dependencies, start the dev server so it listens on that address, and wait until it answers. ${configHint}`,
        `Prefer configuring it as webServer in ${islandDisplayDir}/screenci.config.ts (command, url, reuseExistingServer) so later runs and CI start it the same way. If you started it by hand instead, run preview with ${SCREENCI_APP_LAUNCHED_BY_ENV}=agent so the version records that.`,
        ...(exchange.aiContext.guide !== null
          ? []
          : [
              'Ask the person to add start-up notes under AI context if anything was unclear.',
            ]),
        '',
      ]
    }
    default: {
      const exhaustive: never = site
      throw new Error(`Unhandled site state: ${String(exhaustive)}`)
    }
  }
}

function formatLoginSection(result: StartResult): string[] {
  const env = toRelativeEnv(result)
  const loginUrl = `${result.appUrl.replace(/\/+$/, '')}/ai-context#login`
  if (result.login.saved) {
    return [
      '## Login',
      '',
      `The person's login for the site is in ${env} as ${APP_USERNAME_ENV} and ${APP_PASSWORD_ENV}. Read them with process.env inside hide() when the flow needs to sign in. Never print, log, or commit them.`,
      '',
    ]
  }
  return [
    '## Login',
    '',
    `No site login is saved for the person. ${env} has empty ${APP_USERNAME_ENV} and ${APP_PASSWORD_ENV} placeholders. If the flow needs to sign in, read them with process.env inside hide(), and ask the person to save their login at ${loginUrl} (it is personal and encrypted) and then run \`npx screenci pull-login\` in the workspace, or to paste the values into ${env} themselves. Never print, log, or commit them.`,
    '',
  ]
}

function describeOutcome(outcome: StartOutcome): string {
  switch (outcome) {
    case 'scaffolded':
      return 'new project scaffolded'
    case 'pulled':
      return "pulled the project's current sources"
    case 'synced':
      return 'existing workspace, sources synced'
    case 'repository':
      return "the repository's own workspace"
    case 'merge-prepared':
      return "the project's sources, pulled into the repository"
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
    status: result.stop !== null ? 'stopped' : 'started',
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
    sourceMode: exchange.sourceMode,
    appUrl: result.appUrl,
    ...(result.shellSecretOverride ? { shellSecretOverride: true } : {}),
    ...(exchange.task.appUrl !== undefined
      ? { taskAppUrl: exchange.task.appUrl }
      : {}),
    description: exchange.task.description,
    repo: result.repo,
    site: result.site,
    login: { saved: result.login.saved, envFile: result.envFilePath },
    runLocallyIfNeeded: exchange.aiContext.runLocallyIfNeeded,
    ...(exchange.aiContext.guide !== null
      ? { guide: exchange.aiContext.guide }
      : {}),
    ...(result.stop !== null ? { stop: result.stop } : {}),
    ...(result.pendingMerge !== null
      ? { pendingMerge: result.pendingMerge }
      : {}),
  }
}

/** Exit code when `start` prepared the workspace but the agent must stop. */
export const START_STOP_EXIT_CODE = 2

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
    .option('--skip-site-check', 'do not check that the site answers')
    .option(
      '--no-clone',
      "do not clone the product's repository when running outside it"
    )
    .option('-v, --verbose', 'verbose output')
    .action(async (code: string, options: Record<string, unknown>) => {
      const name = options['name'] as string | undefined
      const dir = options['dir'] as string | undefined
      const agent = options['agent'] as string | undefined
      const result = await runStartCommand(
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
          skipSiteCheck: options['skipSiteCheck'] === true,
          clone: options['clone'] !== false,
        },
        deps
      )
      if (result.stop !== null) process.exitCode = START_STOP_EXIT_CODE
    })
}
