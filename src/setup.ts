import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { basename, posix, relative, resolve, sep } from 'node:path'
import type { Command } from 'commander'
import pc from 'picocolors'
import {
  EMPTY_AI_CONTEXT,
  parseAiContext,
  type CliAiContext,
} from './aiContext.js'
import {
  readAppSessionStatus,
  resolveProfileName,
  type AppSessionStatus,
} from './appSession.js'
import {
  EMPTY_BRANDING,
  brandingAssetsSnippet,
  brandingRenderOptionsSnippet,
  defaultDownloadSampleDeps,
  downloadBrandingAssets,
  brandingAssetPaths as brandingAssetPathsOf,
  type CliBrandingAsset,
  downloadBrandingVoiceSample,
  formatBrandingLines,
  isEmptyBranding,
  parseBranding,
  type CliBranding,
  type DownloadBrandingSampleResult,
} from './branding.js'
import {
  extractConfigStringLiteral,
  readIslandEnvFile,
  readIslandProjectId,
} from './configLite.js'
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
 * `screenci setup <code>`: the entry point of the web-first flow. A person
 * clicks Add project / Add video / Edit in the web app, pastes the prompt it
 * produced into their coding agent, and the agent runs this command in the
 * app's repository (or an empty folder). It exchanges the one-time setup code
 * for a project-scoped secret, works out where the product's source code and
 * site are (the organisation's AI context), prepares the `./screenci` island
 * (an existing one is used as is; otherwise the snapshot ScreenCI holds is
 * pulled, or a new project is scaffolded), and prints a brief the agent
 * follows. When the site is unreachable and the agent may not start it, the
 * brief says STOP and the command exits with code 2.
 *
 * No credential for the person's own product is involved anywhere here. When
 * the site needs a sign-in, the brief has the agent run `screenci login`, and
 * the person signs in themselves in the browser that opens.
 *
 * Everything is dependency-injected (`StartDeps`) so the whole command is
 * unit-testable without a network, a disk, git, or a package manager.
 */

export type SetupCodeKind =
  'project' | 'video' | 'screenshot' | 'edit' | 'language' | 'record' | 'ci'

const SETUP_CODE_KINDS: readonly SetupCodeKind[] = [
  'project',
  'video',
  'screenshot',
  'edit',
  'language',
  'record',
  'ci',
]

export interface SetupExchange {
  kind: SetupCodeKind
  orgId: string
  projectId: string
  projectName: string
  videoId?: string
  videoName?: string
  secret: string
  task: { description: string; appUrl?: string; language?: string }
  /** ScreenCI holds a snapshot of the scripts (uploaded with a recording). */
  sourcesAvailable: boolean
  /** A pipeline already records this project; `false` from an older server. */
  ciRecords: boolean
  appUrl: string | null
  /** The resolved AI context (org defaults plus project overrides). */
  aiContext: CliAiContext
  /** The resolved branding (org defaults plus project overrides). */
  branding: CliBranding
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
  /** A config without `projectId` (what `screenci init` writes), named only. */
  | { state: 'unpinned'; projectName: string | null }
  | { state: 'other-project'; existingProjectId: string }

export type StartOutcome =
  /** A new project's workspace was created. */
  | 'scaffolded'
  /** The snapshot ScreenCI holds was pulled into an empty or absent folder. */
  | 'pulled'
  /** A workspace already existed and was used as is (`--force` pulls over it). */
  | 'existing'

/** CI providers `setup` recognises from files in the repository (kind ci). */
export type CiProvider =
  | 'github'
  | 'gitlab'
  | 'circleci'
  | 'buildkite'
  | 'bitbucket'
  | 'jenkins'
  | 'azure'

export const CI_PROVIDER_MARKERS: readonly {
  provider: CiProvider
  path: string
}[] = [
  { provider: 'github', path: '.github/workflows' },
  { provider: 'gitlab', path: '.gitlab-ci.yml' },
  { provider: 'circleci', path: '.circleci/config.yml' },
  { provider: 'buildkite', path: '.buildkite' },
  { provider: 'bitbucket', path: 'bitbucket-pipelines.yml' },
  { provider: 'jenkins', path: 'Jenkinsfile' },
  { provider: 'azure', path: 'azure-pipelines.yml' },
]

/** What `setup` found out about the repository's CI (kind ci only). */
export type StartCi = {
  providers: CiProvider[]
  /** `.github/workflows/screenci.yaml` already exists. */
  githubWorkflowExists: boolean
}

/** What `setup` found out about the product's repository. */
export type StartRepo =
  | { state: 'not-configured' }
  /**
   * The cwd's repository is the product's: its remote is the configured one,
   * or it holds the project's own `screenci/` workspace (then the remote may
   * be unknown).
   */
  | { state: 'inside'; dir: string; gitUrl: string | null }
  | { state: 'cloned'; dir: string; gitUrl: string; fresh: boolean }
  | { state: 'clone-skipped'; gitUrl: string }
  | { state: 'clone-failed'; gitUrl: string; message: string }

/** What `setup` found out about the site to record. */
export type StartSite =
  | { state: 'none' }
  | { state: 'unchecked'; url: string; kind: SiteKind }
  | { state: 'checked'; url: string; kind: SiteKind; reachable: boolean }

/** The signed-in session found on this machine, if any. */
export type StartSession = AppSessionStatus

export type StartStopReason =
  'site-unreachable-local' | 'site-unreachable' | 'repo-unavailable'

export type StartStop = {
  reason: StartStopReason
  message: string
  docsUrl: string
}

/** Where the branding voice sample ended up, when the branding uses one. */
export type StartBrandingSample =
  | { status: 'downloaded'; relativePath: string }
  | { status: 'failed'; message: string }
  | { status: 'none' }

export interface StartResult {
  exchange: SetupExchange
  brandingSample: StartBrandingSample
  /** Workspace-relative paths of the shared branding assets saved locally. */
  brandingAssetPaths: Record<string, string>
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
  session: StartSession
  /** Set when the agent must stop and report instead of recording. */
  stop: StartStop | null
  /** CI code: the providers found in the repository. */
  ci: StartCi | null
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
  /** Source text of a config file, or null when it cannot be read. */
  readConfigSource: (path: string) => Promise<string | null>
  git: StartGit
  probeSite: (url: string) => Promise<boolean>
  now: () => Date
  /** Reads the signed-in session `screenci login` saved, from disk only. */
  readAppSessionStatus: (params: {
    configDir: string
    profile: string
    now: Date
  }) => Promise<AppSessionStatus>
  /** Saves the branding voice sample into the island (see branding.ts). */
  downloadBrandingVoiceSample: (
    params: { apiUrl: string; secret: string; islandDir: string },
    fetchFn: typeof fetch
  ) => Promise<DownloadBrandingSampleResult>
  /**
   * Saves the shared branding assets into the island. The upload still sends
   * only their names; these local copies let the agent inspect them and let
   * `screenci dev` show them before the first export.
   */
  downloadBrandingAssets: (
    params: { apiUrl: string; secret: string; islandDir: string },
    assets: readonly CliBrandingAsset[],
    fetchFn: typeof fetch
  ) => Promise<Record<string, DownloadBrandingSampleResult>>
}

export function createDefaultSetupDeps(): StartDeps {
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
    readConfigSource: async (path) => {
      try {
        return await readFile(path, 'utf-8')
      } catch {
        return null
      }
    },
    git: nodeStartGit,
    probeSite: (url) => probeSite(url, fetch),
    now: () => new Date(),
    readAppSessionStatus: (params) => readAppSessionStatus(params),
    downloadBrandingVoiceSample: (params, fetchFn) =>
      downloadBrandingVoiceSample(params, {
        ...defaultDownloadSampleDeps,
        fetchFn,
      }),
    downloadBrandingAssets: (params, assets, fetchFn) =>
      downloadBrandingAssets(params, assets, {
        ...defaultDownloadSampleDeps,
        fetchFn,
      }),
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
  'appUrl' | 'aiContext' | 'branding' | 'ciRecords'
> & {
  appUrl?: string | null
  aiContext?: unknown
  branding?: unknown
  ciRecords?: unknown
}

function isSetupExchange(value: unknown): value is RawSetupExchange {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  const kindOk = (SETUP_CODE_KINDS as readonly unknown[]).includes(v.kind)
  const task = v.task as Record<string, unknown> | undefined
  return (
    kindOk &&
    typeof v.orgId === 'string' &&
    typeof v.projectId === 'string' &&
    typeof v.projectName === 'string' &&
    typeof v.secret === 'string' &&
    typeof task === 'object' &&
    task !== null &&
    typeof task.description === 'string' &&
    typeof v.sourcesAvailable === 'boolean'
  )
}

/** Fills the fields an older server omits. */
function toSetupExchange(raw: RawSetupExchange): SetupExchange {
  const { appUrl, aiContext, branding, ciRecords, ...rest } = raw
  return {
    ...rest,
    ciRecords: ciRecords === true,
    appUrl: typeof appUrl === 'string' ? appUrl : null,
    aiContext:
      aiContext === undefined ? EMPTY_AI_CONTEXT : parseAiContext(aiContext),
    branding: branding === undefined ? EMPTY_BRANDING : parseBranding(branding),
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
 * Where `setup` will put or find the island, and whether it may touch it. A
 * folder without a `screenci.config.ts` (an empty folder, or `--dir .`) is
 * usable like an absent one; a config without `projectId` is an unpinned
 * island, usable only for the project it names.
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
      state: 'unpinned',
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
 * `origin` is the configured one or when it already holds this project's
 * `screenci/` workspace named after the project (a fork, a mirror, or a
 * repository whose URL nobody told ScreenCI), else a shallow clone under
 * `.screenci/repo` (refreshed when it already exists), which the agent reads
 * for context and never edits.
 */
export async function resolveRepository(
  params: {
    cwd: string
    gitUrl: string | null
    clone: boolean
    projectId: string
    projectName: string
    /**
     * Treat the cwd's repository as the product's even without a configured
     * URL, as long as it has a remote (CI codes: their brief has the agent
     * run the prompt inside the repository).
     */
    assumeCwdRepository?: boolean
  },
  deps: Pick<
    StartDeps,
    'git' | 'findRepoRoot' | 'fs' | 'existsSync' | 'logger' | 'readConfigSource'
  >
): Promise<StartRepo> {
  const { gitUrl } = params
  const repoRoot = deps.findRepoRoot(params.cwd)
  const remote = await deps.git.remoteUrl(repoRoot)
  if (gitUrl !== null && remote !== null && sameRepository(remote, gitUrl)) {
    return { state: 'inside', dir: repoRoot, gitUrl }
  }
  const island = await resolveStartWorkspace(
    resolve(repoRoot, 'screenci'),
    params.projectId,
    deps
  )
  if (
    island.state === 'unpinned' &&
    island.projectName === params.projectName
  ) {
    return { state: 'inside', dir: repoRoot, gitUrl: remote ?? gitUrl }
  }
  if (gitUrl === null) {
    if (params.assumeCwdRepository === true && remote !== null) {
      return { state: 'inside', dir: repoRoot, gitUrl: remote }
    }
    return { state: 'not-configured' }
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

/** Which CI providers the repository already uses, from their config files. */
export function detectCiProviders(
  repoDir: string,
  existsSync: (path: string) => boolean
): StartCi {
  const providers = CI_PROVIDER_MARKERS.filter(({ path }) =>
    existsSync(resolve(repoDir, path))
  ).map(({ provider }) => provider)
  return {
    providers,
    githubWorkflowExists: existsSync(
      resolve(repoDir, '.github', 'workflows', 'screenci.yaml')
    ),
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

export async function runSetupCommand(
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
    {
      cwd,
      gitUrl: exchange.aiContext.gitUrl,
      clone: options.clone !== false,
      projectId: exchange.projectId,
      projectName: exchange.projectName,
      assumeCwdRepository: exchange.kind === 'ci',
    },
    deps
  )
  if (repo.state === 'clone-failed') deps.logger.warn(repo.message)

  // The island: an explicit --dir, else the `screenci/` island of the
  // repository the command runs in when one exists there, else ./screenci.
  // A clone under .screenci/repo is context only: its workspace is never
  // edited from here, so the scripts always land where the agent can commit.
  let islandDir = resolve(cwd, options.dir ?? 'screenci')
  const repoDir = repoDirOf(repo)
  // An existing project may already keep its workspace in the repository; a
  // brand-new project never does, so it always gets ./screenci.
  if (
    options.dir === undefined &&
    repo.state === 'inside' &&
    exchange.kind !== 'project'
  ) {
    const candidate = resolve(repo.dir, 'screenci')
    if (deps.existsSync(resolve(candidate, 'screenci.config.ts'))) {
      islandDir = candidate
    }
  }
  let islandDisplayDir = toDisplayPath(cwd, islandDir)

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
      // Add to CI is its own prompt; a workflow written here would record
      // from git before anyone asked for it.
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

  let ci: StartCi | null = null
  if (exchange.kind === 'ci') {
    // A CI code needs the repository: the pipeline records from it, and the
    // scripts are committed there together with the pipeline.
    if (repoDir === null) {
      throw new StartError(
        repo.state === 'clone-failed'
          ? `The repository could not be cloned (${repo.message}). Run this command inside the repository instead.`
          : repo.state === 'clone-skipped'
            ? `Setting up CI needs the repository: rerun without --no-clone, or inside the repository.`
            : `No repository URL is known for "${exchange.projectName}". Ask the person to add it under AI context, then create a new prompt, or run this command inside the repository. Docs: ${docsUrl}`
      )
    }
    islandDir = resolve(repoDir, 'screenci')
    islandDisplayDir = toDisplayPath(cwd, islandDir)
    ci = detectCiProviders(repoDir, deps.existsSync)
  }

  const workspace = await resolveStartWorkspace(
    islandDir,
    exchange.projectId,
    deps
  )
  switch (workspace.state) {
    case 'absent': {
      if (exchange.kind === 'ci' && !exchange.sourcesAvailable) {
        throw new StartError(
          `No screenci/ workspace was found in the repository at ${toDisplayPath(cwd, repoDir ?? cwd)} and ScreenCI holds no sources for "${exchange.projectName}" yet. Record a video first (Add video in the web app), then set up CI.`
        )
      }
      if (!exchange.sourcesAvailable && exchange.videoName !== undefined) {
        // The code addresses one video whose script is nowhere on this
        // machine and not in ScreenCI: a fresh scaffold would only hold the
        // starter script, so the repository is the only place to work from.
        throw new StartError(
          `The script for "${exchange.videoName}" is not on this machine and ScreenCI holds no copy of the project's scripts${
            repo.state === 'not-configured'
              ? '. Its repository URL is not set: ask the person to add it under AI context in the web app, or run this command inside the repository'
              : repo.state === 'clone-failed'
                ? `: the repository could not be cloned (${repo.message}). Run this command inside the repository`
                : `. Run this command inside the repository${repoDir !== null ? ` (${toDisplayPath(cwd, repoDir)})` : ''}`
          }, or pass --dir <path to its screenci/ workspace>. Docs: ${docsUrl}`
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
      // The local workspace is the source of truth; the snapshot ScreenCI
      // holds only replaces it on request.
      if (options.force && exchange.sourcesAvailable) {
        await pullSources(true)
      } else {
        deps.logger.info(
          `${pc.green('✔')} Using the existing workspace ${islandDisplayDir}.`
        )
      }
      await installIfNeeded()
      await installSkills()
      result = 'existing'
      break
    }
    case 'unpinned': {
      if (workspace.projectName !== exchange.projectName) {
        throw new StartError(
          `${islandDisplayDir} already exists and belongs to another project${
            workspace.projectName !== null
              ? ` ("${workspace.projectName}")`
              : ''
          }, not to "${exchange.projectName}". Run this command in a different folder, or pass --dir <path> to use another folder for this project.`
        )
      }
      if (options.force && exchange.sourcesAvailable) {
        await pullSources(true)
      } else {
        deps.logger.info(
          `${pc.green('✔')} Using the existing workspace ${islandDisplayDir}.`
        )
      }
      await installIfNeeded()
      await installSkills()
      result = 'existing'
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

  // Whether this machine already holds a signed-in session for the product.
  // Read from disk: nothing about the person's own product ever comes from,
  // or goes to, the service.
  const session = await deps.readAppSessionStatus({
    configDir: islandDir,
    profile: resolveProfileName(undefined, deps.env),
    now: deps.now(),
  })

  // A cloned branding voice needs its sample next to the scripts, so the
  // agent can point voices.elevenlabs({ path }) at it. Best-effort: the brief
  // says how to fetch it later when this fails.
  let brandingSample: StartBrandingSample = { status: 'none' }
  if (exchange.branding.voice?.kind === 'sample') {
    const download = await deps.downloadBrandingVoiceSample(
      { apiUrl: deps.apiUrl, secret: exchange.secret, islandDir },
      deps.fetchFn
    )
    switch (download.status) {
      case 'written':
      case 'kept':
        brandingSample = {
          status: 'downloaded',
          relativePath: download.relativePath,
        }
        break
      case 'none':
        break
      case 'error':
        deps.logger.warn(
          `Could not download the branding voice sample: ${download.message}`
        )
        brandingSample = { status: 'failed', message: download.message }
        break
      default: {
        const exhaustive: never = download
        throw new Error(`Unhandled download: ${JSON.stringify(exhaustive)}`)
      }
    }
  }

  // The shared assets the video code may reference by name. Best-effort: a
  // failure only costs the local preview copy, never the reference itself.
  let brandingAssetPaths: Record<string, string> = {}
  if (exchange.branding.assets.length > 0) {
    const results = await deps.downloadBrandingAssets(
      { apiUrl: deps.apiUrl, secret: exchange.secret, islandDir },
      exchange.branding.assets,
      deps.fetchFn
    )
    brandingAssetPaths = brandingAssetPathsOf(results)
    for (const [name, result] of Object.entries(results)) {
      if (result.status === 'error') {
        deps.logger.warn(
          `Could not download the branding asset "${name}": ${result.message}`
        )
      }
    }
  }

  const videoSourcePath =
    (exchange.kind === 'edit' ||
      exchange.kind === 'language' ||
      exchange.kind === 'record') &&
    exchange.videoName !== undefined
      ? await findVideoSourceFile(islandDir, exchange.videoName, deps.fs)
      : null

  // A CI code records nothing on this machine: the site is the pipeline's
  // business, so it is never probed and never stops the setup.
  const site = await resolveSite(
    {
      url: exchange.task.appUrl ?? exchange.aiContext.siteUrl,
      skipSiteCheck: options.skipSiteCheck === true || exchange.kind === 'ci',
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
      'SCREENCI_SECRET is exported in this shell and takes precedence over the credentials written to the workspace. Run `unset SCREENCI_SECRET` before `preview`, or uploads go to that key and the web app never opens the result.'
    )
  }

  const startResult: StartResult = {
    exchange,
    brandingSample,
    brandingAssetPaths,
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
    session,
    stop,
    ci,
  }
  deps.logger.info(formatStartBrief(startResult, cwd))
  deps.logger.info(JSON.stringify(formatStartJsonLine(startResult)))
  return startResult
}

/** The brief printed for the coding agent after a successful start. */
/**
 * Rules for working with the person who sent the prompt. They may not be a
 * developer, so every brief (and the skill) tells the agent how to report.
 */
export function personRules(run: string): readonly string[] {
  return [
    'The person who sent you the prompt is often a teammate who does not code and may not use a terminal. Do not ask them to run commands, open files, or read the script.',
    'Report in plain language: what the video shows, what you changed, and what needs their attention. No selectors, file paths, or command output unless they ask.',
    'If you need them, say exactly what to click (the sign-in card in the browser you opened, a new prompt in the ScreenCI app) and wait for them.',
    `Never ask for a password, a one-time code, or an API key; \`${run} login\` is the only sign-in path.`,
    'Finish your final message with the video link that `preview` printed (or the pipeline run link) on its own last line.',
    'Deliver the result the way the "What to do" section above says: a live preview you record yourself, a pipeline run you trigger, or a pull request you open. Do not switch to another path because the repository happens to have CI; only the codes that ask for a pipeline run complete on one.',
  ]
}

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
      case 'screenshot':
        return `Add a screenshot to the ScreenCI project "${exchange.projectName}".`
      case 'edit':
        return `Change the ScreenCI video "${exchange.videoName ?? ''}" in project "${exchange.projectName}".`
      case 'language':
        return `Add the language "${exchange.task.language ?? ''}" to the ScreenCI video "${exchange.videoName ?? ''}" in project "${exchange.projectName}".`
      case 'record':
        return exchange.videoName !== undefined
          ? `Re-record the ScreenCI video "${exchange.videoName}" in project "${exchange.projectName}".`
          : `Re-record every video of the ScreenCI project "${exchange.projectName}".`
      case 'ci':
        return `Record the ScreenCI project "${exchange.projectName}" from CI.`
      default: {
        const exhaustive: never = exchange.kind
        throw new Error(`Unhandled setup code kind: ${String(exhaustive)}`)
      }
    }
  })()
  lines.push('', pc.green('✔ Connected to ScreenCI.'), '', `# ${headline}`, '')
  if (exchange.kind === 'ci') {
    lines.push(...formatCiBrief(result, run, cwd))
    return lines.join('\n')
  }
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
      'WARNING: this shell exports a different SCREENCI_SECRET, which wins over the workspace credentials. Run `unset SCREENCI_SECRET` before the commands below, or the uploads go to that key and the person waiting never sees the result.'
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
    case 'screenshot':
      lines.push(
        `Add a new script ${islandDisplayDir}/recordings/<name>.screenci.ts (or a screenshot(...) call in a fitting existing file) declaring screenshot("<title>", async ({ page, crop }) => { ... }): a silent still, framed with crop(), no narration. Do not change the other videos or screenshots.`
      )
      break
    case 'edit':
      lines.push(
        result.videoSourcePath !== null
          ? `Edit ${result.videoSourcePath}: it declares video("${exchange.videoName ?? ''}", ...) (or screenshot(...)). Keep the title unchanged so the edit lands on the same video.`
          : `Find the script under ${islandDisplayDir}/recordings/ that declares video("${exchange.videoName ?? ''}", ...) (or screenshot(...)) and edit it. Keep the title unchanged.`
      )
      break
    case 'language': {
      const code = exchange.task.language ?? ''
      lines.push(
        result.videoSourcePath !== null
          ? `Edit ${result.videoSourcePath}: it declares video("${exchange.videoName ?? ''}", ...). Keep the title unchanged.`
          : `Find the script under ${islandDisplayDir}/recordings/ that declares video("${exchange.videoName ?? ''}", ...) and edit it. Keep the title unchanged.`,
        `Add "${code}" to video.languages([...]) (declare the array when the video has none yet: the existing language first, then "${code}") and add a "${code}" narration block next to the existing one, translating every cue and keeping its meaning, tone and length. Leave the flow, the selectors and the other languages untouched.`
      )
      break
    }
    case 'record':
      lines.push(
        exchange.videoName !== undefined
          ? result.videoSourcePath !== null
            ? `Record ${result.videoSourcePath} again as it is: it declares video("${exchange.videoName}", ...) (or screenshot(...)).`
            : `Record the script under ${islandDisplayDir}/recordings/ that declares video("${exchange.videoName}", ...) again as it is.`
          : `Record every script under ${islandDisplayDir}/recordings/ again as it is (preview without a title).`,
        'Do not change a script because it could be nicer. Change one only where the product changed underneath it (a moved page, a renamed button): the smallest fix that makes the flow pass again, and report exactly what you changed.',
        ...(exchange.ciRecords
          ? [
              '',
              `A CI pipeline already records this project. Trigger it instead of recording here, so the result lands in the shared CI preview like every other run: push to the recording branch, run \`gh workflow run screenci.yaml${exchange.videoName !== undefined ? ` -f grep='${videoTitleGrep(exchange.videoName)}'` : ''}\` (GitHub Actions; the grep is the exact title as an anchored, escaped pattern), or use the provider's run button, then watch the run; it completes this code. Record on this machine only when the pipeline cannot be triggered from here, and say so in your report.`,
            ]
          : [])
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
  lines.push(
    ...formatSessionSection(result, exchange.aiContext.siteRequiresLogin)
  )
  lines.push(...formatBrandingSection(result))
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
    '- Wrap setup (initial navigation, cookie banners, loading) in hide(); then move through the demo with visible clicks. Signing in is not setup you script: see the Signing in section.',
    '- Use plausible fictitious data in forms, never real people.',
    '- Explore the app with the installed playwright-cli skill, never a Playwright script of your own. A hand-rolled script starts signed out and behaves nothing like the recorder, so the selectors it finds are the wrong ones.',
    '- Give a new video the organisation branding from the Branding section (background, size, cursor, voice) unless the person asks for a different look.',
    '- The installed screenci skill has the full authoring guide.'
  )
  lines.push('')
  lines.push('## Working with the person')
  lines.push('')
  lines.push(...personRules(run).map((rule) => `- ${rule}`))
  lines.push('')
  lines.push('## Commands (run them yourself, in order)')
  lines.push('')
  lines.push('```bash')
  lines.push(`cd ${islandDisplayDir}`)
  lines.push(`${run} test               # repeat until green`)
  lines.push(
    exchange.kind === 'edit' ||
      exchange.kind === 'language' ||
      (exchange.kind === 'record' && exchange.videoName !== undefined)
      ? `${run} preview "${exchange.videoName ?? ''}"   # record the live preview; the person who sent you the code sees it land`
      : exchange.kind === 'record'
        ? `${run} preview                  # re-record every video; the person who sent you the code sees it land`
        : `${run} preview "<video title>"   # record the live preview; the person who sent you the code sees it land`
  )
  lines.push(
    `${run} export              # only if finished, downloadable videos were asked for`
  )
  lines.push('```')
  lines.push('')
  lines.push(formatWorkspaceTail(result.outcome))
  if (result.overwritten.length > 0) {
    lines.push('')
    lines.push(
      `Overwritten with the project's sources (--force): ${result.overwritten.join(', ')}`
    )
  }
  lines.push('')
  lines.push(
    `Docs: ${siteRootOf(result.appUrl)}/docs/make-videos, /docs/video-script-basics, /docs/reference/cli, /docs/guides/ai-context and /docs/guides/branding`
  )
  lines.push('')
  return lines.join('\n')
}

function formatWorkspaceTail(outcome: StartOutcome): string {
  switch (outcome) {
    case 'existing':
      return "This workspace already existed and was used as is. preview and export upload this folder's scripts to ScreenCI so the video can be edited from the web app later. If the workspace lives in a repository, commit your change on a branch and push it (open a pull request when the repository uses them) so the video source stays with the code. Report the link the command prints."
    case 'scaffolded':
    case 'pulled':
      return "preview and export upload this folder's scripts to ScreenCI so the video can be edited from the web app later. If the workspace lives in a repository, commit it on a branch and push it. Report the link the command prints."
    default: {
      const exhaustive: never = outcome
      throw new Error(`Unhandled outcome: ${String(exhaustive)}`)
    }
  }
}

/** A Playwright `--grep` that matches exactly one title (escaped, anchored). */
export function videoTitleGrep(title: string): string {
  return `^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`
}

function ciProviderLabel(provider: CiProvider): string {
  switch (provider) {
    case 'github':
      return 'GitHub Actions (.github/workflows/)'
    case 'gitlab':
      return 'GitLab CI (.gitlab-ci.yml)'
    case 'circleci':
      return 'CircleCI (.circleci/config.yml)'
    case 'buildkite':
      return 'Buildkite (.buildkite/)'
    case 'bitbucket':
      return 'Bitbucket Pipelines (bitbucket-pipelines.yml)'
    case 'jenkins':
      return 'Jenkins (Jenkinsfile)'
    case 'azure':
      return 'Azure Pipelines (azure-pipelines.yml)'
    default: {
      const exhaustive: never = provider
      throw new Error(`Unhandled CI provider: ${String(exhaustive)}`)
    }
  }
}

/**
 * The brief for a CI code: store the key, add the pipeline, push, trigger a
 * run. Provider-agnostic; GitHub Actions gets the generated workflow, the
 * others get the docs templates. The secret is read from the env file by a
 * command, never printed here.
 */
function formatCiBrief(
  result: StartResult,
  run: string,
  cwd?: string
): string[] {
  const { exchange, islandDisplayDir } = result
  const envPath = toRelativeEnv(result)
  const ci = result.ci ?? { providers: [], githubWorkflowExists: false }
  const docs = siteRootOf(result.appUrl)
  const readSecret = `"$(grep '^SCREENCI_SECRET=' ${envPath} | cut -d= -f2-)"`
  const repoDir = repoDirOf(result.repo)
  const repoDisplay =
    repoDir !== null && cwd !== undefined ? toDisplayPath(cwd, repoDir) : '.'
  const lines: string[] = []
  lines.push(
    `Workspace: ${islandDisplayDir}/ (${describeOutcome(result.outcome)}). A CI key for this project is in ${envPath} as SCREENCI_SECRET; never print or commit it.`,
    ''
  )
  lines.push('## What to do', '', exchange.task.description.trim(), '')
  let step = 1
  const heading = (text: string): string => `## ${step++}. ${text}`
  if (result.outcome === 'pulled') {
    lines.push(
      heading('Commit the sources first'),
      '',
      `The project's scripts were pulled from ScreenCI into ${islandDisplayDir}/ inside the repository. Do not change them. Commit ${islandDisplayDir}/ together with the pipeline below (its ${basename(result.envFilePath)} is gitignored and must stay out of git).`,
      ''
    )
  }
  lines.push(
    heading('Store the key in the CI provider'),
    '',
    `The pipeline needs the value of SCREENCI_SECRET from ${envPath} as a secret named SCREENCI_SECRET. Read it from the file inside the command; never paste it into the chat, a commit, or the pipeline file. Providers found in ${repoDisplay}/: ${
      ci.providers.length > 0
        ? ci.providers.map(ciProviderLabel).join(', ')
        : 'none (ask the person which CI the team uses before adding a pipeline)'
    }.`,
    '',
    `- GitHub Actions: \`gh secret set SCREENCI_SECRET --body ${readSecret}\` (run \`gh auth status\` first). Without gh, ask the person to add it under Settings > Secrets and variables > Actions; the key is listed as "CI: ${exchange.projectName}" at ${result.appUrl}/secrets.`,
    `- GitLab CI: \`glab variable set SCREENCI_SECRET --masked --value ${readSecret}\`, or Settings > CI/CD > Variables (masked).`,
    "- CircleCI: Project Settings > Environment Variables (or a context the job uses). Buildkite: the pipeline environment or your secrets plugin. Anything else: the provider's secret store; the job only needs SCREENCI_SECRET in its environment.",
    ''
  )
  lines.push(
    heading('Add the pipeline'),
    '',
    `Every pipeline does the same, from the repository root: check out, install Node.js 24, install ${islandDisplayDir}/ dependencies with a frozen lockfile, \`${run} playwright install --only-shell chromium\` there, build and start the product's app when the videos navigate to it (webServer in ${islandDisplayDir}/screenci.config.ts with a process.env.CI branch), then \`${run} preview\` in ${islandDisplayDir}/ with SCREENCI_SECRET in the environment (\`${run} export --no-wait --select\` when finished renders should be served from CI).`,
    ''
  )
  if (ci.githubWorkflowExists) {
    lines.push(
      '- GitHub Actions: .github/workflows/screenci.yaml already exists in the repository. Review it against the steps above and keep it; do not generate a second one.'
    )
  } else {
    lines.push(
      `- GitHub Actions: run \`${run} ci-workflow\` from the repository root. It writes .github/workflows/screenci.yaml (push to main plus manual dispatch with an optional title filter) keyed to the workspace's package manager and refuses to overwrite an existing file. Do not hand-write it.`
    )
  }
  lines.push(
    `- Other providers: start from ${docs}/docs/ci-setup#other-providers (GitLab CI, CircleCI, Buildkite, and a generic shell script), keep the steps above, and follow the repository's existing pipeline conventions.`,
    '',
    `Do not commit ${envPath} and do not write the secret into the pipeline file.`,
    ''
  )
  lines.push(
    heading('Push, trigger a run, and report'),
    '',
    `Run \`${run} test\` in ${islandDisplayDir}/ so the scripts are green, commit the pipeline on a branch (or the default branch when the repository allows direct pushes), push, and open a pull request when the repository uses them. Trigger one run right away (\`gh workflow run screenci.yaml\`, a push to the recording branch, or the provider's run button) and watch it: it uploads its recordings to ScreenCI as "CI preview" and the person's tab opens the first one. Report the pipeline link, the pull request link when there is one, and where the key was stored.`,
    '',
    `A local \`${run} preview\` is not a substitute: only a run made by the pipeline completes this setup. A run failing on a missing SCREENCI_SECRET means the secret store or the job's environment is wrong; fix that first.`,
    ''
  )
  lines.push('## Working with the person', '')
  lines.push(...personRules(run).map((rule) => `- ${rule}`))
  lines.push('')
  lines.push(...formatRepoSection(result, cwd))
  if (exchange.aiContext.guide !== null) {
    lines.push(
      '## Notes from the team',
      '',
      exchange.aiContext.guide.trim(),
      ''
    )
  }
  lines.push(
    `Docs: ${docs}/docs/repository-and-ci, /docs/ci-setup, /docs/reference/cli and /docs/guides/ai-context`,
    ''
  )
  return lines
}

function formatRepoSection(result: StartResult, cwd?: string): string[] {
  const { repo, islandDisplayDir } = result
  const display = (dir: string): string =>
    cwd !== undefined ? toDisplayPath(cwd, dir) : dir
  // The team's package manager applies to the PRODUCT repository (installing
  // its dependencies, starting its dev server). The screenci workspace keeps
  // the manager it was scaffolded with, which the commands below already use.
  const preferred = result.exchange.aiContext.packageManager
  const managerLine =
    preferred === null
      ? []
      : [
          `The team uses ${preferred} in this repository: install its dependencies and run its scripts with ${preferred}.`,
          '',
        ]
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
        `You are inside the product's repository${repo.gitUrl !== null ? ` (${repo.gitUrl})` : ''} at ${display(repo.dir)}/. Read its routes, components and README to learn the real URLs and selectors.`,
        '',
        ...managerLine,
      ]
    case 'cloned':
      return [
        '## Repository',
        '',
        `The product's repository (${repo.gitUrl}) is ${repo.fresh ? 'cloned' : 'already cloned and refreshed'} at ${display(repo.dir)}/. Use it as context: read its routes, components and README to learn the real URLs and selectors. Do not edit or commit there; the workspace is ${islandDisplayDir}/.`,
        '',
        ...managerLine,
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

/**
 * The organisation's branding and how to apply it in code.
 *
 * The VALUES only inform new videos: nothing is applied at record time, so the
 * agent writes them into the script (code wins, and may deviate on request).
 * The shared ASSETS are different: code references them by name and the export
 * resolves the name, so replacing the file on the Branding page updates every
 * video that uses it on its next export.
 */
function formatBrandingSection(result: StartResult): string[] {
  const { branding } = result.exchange
  const samplePath =
    result.brandingSample.status === 'downloaded'
      ? result.brandingSample.relativePath
      : null
  const assetPaths = result.brandingAssetPaths
  const lines = ['## Branding', '']
  if (isEmptyBranding(branding)) {
    lines.push(...formatBrandingLines(branding, samplePath, assetPaths), '')
    return lines
  }
  lines.push(
    'The organisation set these defaults for new videos. Apply them in the video code: pass them to video.recordOptions(...) and video.renderOptions(...) on the new video (reuse an existing shared options object when the project already has one that matches). Values in code are what render, so only deviate when the person asks.',
    '',
    ...formatBrandingLines(branding, samplePath, assetPaths)
  )
  if (result.brandingSample.status === 'failed') {
    lines.push(
      `- The voice sample could not be downloaded (${result.brandingSample.message}); run \`npx screenci context\` in ${result.islandDisplayDir}/ to retry, or leave narration.voice out.`
    )
  }
  const snippet = brandingRenderOptionsSnippet(branding, samplePath)
  if (snippet !== null) {
    lines.push('', '```ts', snippet, '```')
  }
  const assetsSnippet = brandingAssetsSnippet(branding)
  if (assetsSnippet !== null) {
    lines.push(
      '',
      'The shared assets above are referenced by name, not copied into the code. The export resolves each name to the file the Branding page holds then, so replacing it there updates every video on its next export. Use an asset instead of inventing a logo or an intro of your own; place and time it in code (an image needs a length, a video plays its own).',
      '',
      '```ts',
      assetsSnippet,
      '```'
    )
  }
  lines.push('')
  return lines
}

/**
 * How the agent gets the product signed in. Never a credential: the person
 * signs in themselves in the browser `screenci login` opens, and the session
 * it captures stays on their machine. A video that starts from a saved session
 * needs no sign-in steps at all, which is both faster and the only thing that
 * works when the account has two-factor, single sign-on, or a passkey.
 */
function formatSessionSection(
  result: StartResult,
  siteRequiresLogin: boolean
): string[] {
  const sessionFile = `${result.islandDisplayDir}/.screenci/auth/default.json`
  const lines = ['## Signing in', '']
  if (result.session.saved && !result.session.expired) {
    lines.push(
      `A signed-in session for the product is already saved on this machine (${sessionFile}). Recordings start signed in, so write the video WITHOUT any sign-in steps: no credentials, no login form, no hide() block that types a password.`,
      '',
      'Load it into the browser you explore with, or you will be reading a signed-out app and writing selectors that do not exist in the recording:',
      '',
      '```bash',
      'playwright-cli open',
      `playwright-cli state-load ${sessionFile}`,
      '```',
      '',
      'If a page still shows a signed-out state, the session expired: run `npx screenci login`, ask the person to sign in in the browser that opens, and then run `npx screenci login --wait`.'
    )
    return [...lines, '']
  }
  const expiredNote =
    result.session.saved && result.session.expired
      ? 'The saved session expired. '
      : ''
  const needNote = siteRequiresLogin
    ? 'The team says this site needs a sign-in. '
    : 'If the flow you are asked to record sits behind a sign-in: '
  lines.push(
    `${expiredNote}${needNote}Do this, in order:`,
    '',
    '1. Run `npx screenci login` (add the address if the config has no baseURL). It opens a browser and returns immediately.',
    '2. Tell the person to sign in in that browser the way they normally do, then click the button on the small ScreenCI card floating over the page. Two-factor codes, single sign-on, passkeys, and magic links all work. Nothing they type is sent to ScreenCI, and you must never ask them for a password or a code yourself.',
    '3. Run `npx screenci login --wait`, which blocks until they finish. Do NOT end your turn instead: clicking the card saves the session in the browser but tells you nothing, so if nothing is waiting the person clicks and sees no reply. If the wait reports it is still going, run it again. If they tell you they are done some other way, run `npx screenci login --done`.',
    '',
    `Then write the video WITHOUT any sign-in steps: the recording starts from that session. Load it into the browser you explore with too (\`playwright-cli state-load ${sessionFile}\`), or you will be reading a signed-out app. Never put a username, a password, or a one-time code in the video code or in the env file.`
  )
  return [...lines, '']
}

function describeOutcome(outcome: StartOutcome): string {
  switch (outcome) {
    case 'scaffolded':
      return 'new project scaffolded'
    case 'pulled':
      return "pulled the project's current sources"
    case 'existing':
      return 'existing workspace, used as is'
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
    status: result.stop !== null ? 'stopped' : 'ready',
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
    repo: result.repo,
    site: result.site,
    session: {
      saved: result.session.saved,
      expired: result.session.saved && result.session.expired,
    },
    siteRequiresLogin: exchange.aiContext.siteRequiresLogin,
    runLocallyIfNeeded: exchange.aiContext.runLocallyIfNeeded,
    branding: exchange.branding,
    ...(result.brandingSample.status === 'downloaded'
      ? { brandingSamplePath: result.brandingSample.relativePath }
      : {}),
    ...(Object.keys(result.brandingAssetPaths).length > 0
      ? { brandingAssetPaths: result.brandingAssetPaths }
      : {}),
    ...(exchange.aiContext.guide !== null
      ? { guide: exchange.aiContext.guide }
      : {}),
    ...(result.stop !== null ? { stop: result.stop } : {}),
    ...(result.ci !== null ? { ci: result.ci } : {}),
    ...(exchange.task.language !== undefined
      ? { language: exchange.task.language }
      : {}),
    ciRecords: exchange.ciRecords,
  }
}

/** Exit code when `setup` prepared the workspace but the agent must stop. */
export const START_STOP_EXIT_CODE = 2

export function registerSetupCommand(
  program: Command,
  deps: StartDeps,
  defaultPackageManager: PackageManager
): Command {
  return program
    .command('setup <code>')
    .description(
      'Set up this machine from a setup code created in the ScreenCI web app: ' +
        'uses the ./screenci workspace when one exists, else pulls or creates it, writes its credentials, and prints what to do next.'
    )
    .option(
      '--name <projectName>',
      'name for a new project (default: the current folder name)'
    )
    .option('--dir <path>', 'workspace folder (default: ./screenci)')
    .option(
      '--force',
      'replace an existing workspace with the sources ScreenCI holds'
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
      const result = await runSetupCommand(
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
