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
  readIslandBaseUrl,
  readIslandEnvFile,
  readIslandProjectId,
  readIslandWebServerUrl,
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
import { nodeStartGit, type StartGit } from './repo.js'
import {
  configuredUrlIsLocal,
  configuredRecordingUrl,
  resolveRecordingTarget,
  type RecordingTarget,
} from './recordingTarget.js'
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
  planSourceBundleApply,
  type SourceBundleFs,
} from './sourceBundle.js'
import {
  fetchLatestSourceBundle,
  fetchSourceBundle,
  type FetchLatestSourceBundleResult,
} from './sourceSync.js'

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
  /**
   * The sources the chosen version was recorded from (edit, language, and
   * single-video record codes): what the workspace starts from.
   */
  sourceBundleId?: string
  /** The version the code was made from (or the newest one with sources). */
  sourceVersion?: SetupSourceVersion
  /** Island-relative path of the script that declares the video, when known. */
  videoSourcePath?: string
  appUrl: string | null
  /** The resolved AI context (org defaults plus project overrides). */
  aiContext: CliAiContext
  /** The resolved branding (org defaults plus project overrides). */
  branding: CliBranding
}

export type SetupSourceVersion = {
  versionNumber: number
  createdAt: string
  /** Where that version was recorded, when the recording said. */
  site?: { origin: string; kind: SiteKind }
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

/**
 * What `setup` found out about the product's repository: the command runs
 * inside it (the agent is invoked in the product's checkout) or in a folder
 * that is no repository at all. ScreenCI never clones anything.
 */
export type StartRepo =
  | { state: 'none' }
  /** The cwd's repository, taken as the product's; `gitUrl` is its origin. */
  | { state: 'inside'; dir: string; gitUrl: string | null }

/** What `setup` found out about the site to record. */
export type StartSite =
  | { state: 'none' }
  | { state: 'unchecked'; url: string; kind: SiteKind }
  | { state: 'checked'; url: string; kind: SiteKind; reachable: boolean }

/** The signed-in session found on this machine, if any. */
export type StartSession = AppSessionStatus

export type StartStopReason =
  | 'site-unreachable-local'
  | 'site-unreachable'
  /** The config names a dev server this machine cannot run; no deployed address is known. */
  | 'site-local-no-repo'

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
  /** `projectId` was written into an island config that only named the project. */
  pinnedConfig: boolean
  /** For an edit code: the script that declares the video, when found. */
  videoSourcePath: string | null
  /** How the script was found (`missing` when it was not). */
  videoSourceLocation: VideoSourceLocation
  /**
   * The version the workspace starts from and how the local files relate to
   * it (video codes only).
   */
  startingPoint: StartStartingPoint
  /** Which address to record against, and why. */
  recordingTarget: RecordingTarget
  appUrl: string
  repo: StartRepo
  site: StartSite
  session: StartSession
  /** Set when the agent must stop and report instead of recording. */
  stop: StartStop | null
  /** CI code: the providers found in the repository. */
  ci: StartCi | null
}

export type VideoSourceLocation =
  /** The path the service recorded with the version, present here. */
  | 'server'
  /** Found by its title in this workspace (the server path was absent or moved). */
  | 'title'
  /** Found by its title in another island of the repository. */
  | 'other-island'
  /** Not addressed by this code (project-level kinds). */
  | 'not-applicable'
  | 'missing'

export type StartStartingPoint =
  /** Project-level kinds, or no sources on the service. */
  | { kind: 'none' }
  /** The version's sources were pulled (absent workspace) or compared to the local files. */
  | {
      kind: 'version'
      version: SetupSourceVersion | null
      /** Local files replaced by the version's (outside a repository). */
      replaced: string[]
      /** Files in which the repository differs from the version (inside one). */
      differs: string[]
    }

/** An island found in the repository, with what its config says. */
export type RepoIsland = {
  dir: string
  projectId: string | undefined
  projectName: string | undefined
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
  | 'appUrl'
  | 'aiContext'
  | 'branding'
  | 'ciRecords'
  | 'sourceBundleId'
  | 'sourceVersion'
  | 'videoSourcePath'
> & {
  appUrl?: string | null
  aiContext?: unknown
  branding?: unknown
  ciRecords?: unknown
  sourceBundleId?: unknown
  sourceVersion?: unknown
  videoSourcePath?: unknown
}

function parseSourceVersion(raw: unknown): SetupSourceVersion | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const v = raw as Record<string, unknown>
  if (typeof v.versionNumber !== 'number' || typeof v.createdAt !== 'string') {
    return undefined
  }
  const site = v.site as Record<string, unknown> | undefined
  const kind: SiteKind | undefined =
    site?.kind === 'local' || site?.kind === 'deployed' ? site.kind : undefined
  const parsedSite =
    site !== undefined && typeof site.origin === 'string' && kind !== undefined
      ? { origin: site.origin, kind }
      : undefined
  return {
    versionNumber: v.versionNumber,
    createdAt: v.createdAt,
    ...(parsedSite !== undefined ? { site: parsedSite } : {}),
  }
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
  const {
    appUrl,
    aiContext,
    branding,
    ciRecords,
    sourceBundleId,
    sourceVersion,
    videoSourcePath,
    ...rest
  } = raw
  const parsedVersion = parseSourceVersion(sourceVersion)
  return {
    ...rest,
    ciRecords: ciRecords === true,
    ...(typeof sourceBundleId === 'string' && sourceBundleId.length > 0
      ? { sourceBundleId }
      : {}),
    ...(parsedVersion !== undefined ? { sourceVersion: parsedVersion } : {}),
    ...(typeof videoSourcePath === 'string' && videoSourcePath.length > 0
      ? { videoSourcePath }
      : {}),
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

/** The address `setup` probes and the brief names for the target. */
export function recordingTargetUrl(target: RecordingTarget): string | null {
  switch (target.mode) {
    case 'configured':
      return target.url
    case 'override':
      return target.url
    case 'stop':
      return null
    default: {
      const exhaustive: never = target
      throw new Error(`Unhandled recording target: ${String(exhaustive)}`)
    }
  }
}

/**
 * Finds the script that declares the video: the island-relative path the
 * service recorded with the version when it is here and still declares the
 * title, else a title search in this island, else in the repository's other
 * islands.
 */
export async function locateVideoSource(
  params: {
    islandDir: string
    videoName: string
    serverPath: string | undefined
    otherIslands: readonly RepoIsland[]
  },
  deps: Pick<StartDeps, 'fs'>
): Promise<{ path: string | null; location: VideoSourceLocation }> {
  const needles = [
    `'${params.videoName}'`,
    `"${params.videoName}"`,
    `\`${params.videoName}\``,
  ]
  if (params.serverPath !== undefined) {
    const candidate = resolve(params.islandDir, ...params.serverPath.split('/'))
    if (await deps.fs.exists(candidate)) {
      const text = (await deps.fs.readFile(candidate)).toString('utf-8')
      if (needles.some((needle) => text.includes(needle))) {
        return { path: candidate, location: 'server' }
      }
    }
  }
  const here = await findVideoSourceFile(
    params.islandDir,
    params.videoName,
    deps.fs
  )
  if (here !== null) return { path: here, location: 'title' }
  for (const island of params.otherIslands) {
    const found = await findVideoSourceFile(
      island.dir,
      params.videoName,
      deps.fs
    )
    if (found !== null) return { path: found, location: 'other-island' }
  }
  return { path: null, location: 'missing' }
}

/** Folder name `setup` proposes for a project when `./screenci` is taken. */
export function proposedIslandDirName(projectName: string): string {
  const slug = projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug.length > 0 ? `screenci-${slug}` : 'screenci-project'
}

const ISLAND_SEARCH_SKIP = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'exports',
  'coverage',
  'test-results',
])
const ISLAND_SEARCH_DEPTH = 4

/**
 * Every island in the repository (a folder holding a `screenci.config.ts`),
 * with the project its config names. Depth-limited and skipping dependency
 * and build folders, so a monorepo whose island sits under `apps/web/` is
 * found from the repository root or a sibling package instead of getting a
 * second island.
 */
export async function findIslandsInRepo(
  repoRoot: string,
  deps: Pick<StartDeps, 'fs' | 'readConfigSource'>
): Promise<RepoIsland[]> {
  const found: RepoIsland[] = []
  const walk = async (dir: string, depth: number): Promise<void> => {
    let entries
    try {
      entries = await deps.fs.readdir(dir)
    } catch {
      return
    }
    const sorted = [...entries].sort((a, b) => (a.name < b.name ? -1 : 1))
    if (sorted.some((e) => e.isFile() && e.name === 'screenci.config.ts')) {
      const source = await deps.readConfigSource(
        resolve(dir, 'screenci.config.ts')
      )
      if (source !== null) {
        found.push({
          dir,
          projectId: readIslandProjectId(source),
          projectName: extractConfigStringLiteral(source, 'projectName'),
        })
      }
      // An island holds no further islands.
      return
    }
    if (depth >= ISLAND_SEARCH_DEPTH) return
    for (const entry of sorted) {
      if (!entry.isDirectory()) continue
      if (ISLAND_SEARCH_SKIP.has(entry.name) || entry.name.startsWith('.')) {
        continue
      }
      await walk(resolve(dir, entry.name), depth + 1)
    }
  }
  await walk(repoRoot, 0)
  return found
}

function pathDepthFrom(from: string, to: string): number {
  const rel = relative(from, to)
  if (rel === '') return 0
  return rel.split(sep).length
}

/**
 * The island of the repository that belongs to the project: the one pinned
 * to its id, else an unpinned one carrying its name. Several candidates:
 * the one closest to the cwd wins.
 */
export function pickRepoIsland(
  islands: readonly RepoIsland[],
  project: { projectId: string; projectName: string },
  cwd: string
): RepoIsland | null {
  const byDistance = (list: RepoIsland[]): RepoIsland | null =>
    [...list].sort(
      (a, b) => pathDepthFrom(cwd, a.dir) - pathDepthFrom(cwd, b.dir)
    )[0] ?? null
  const pinned = islands.filter((i) => i.projectId === project.projectId)
  if (pinned.length > 0) return byDistance(pinned)
  const named = islands.filter(
    (i) => i.projectId === undefined && i.projectName === project.projectName
  )
  return byDistance(named)
}

/**
 * Writes `projectId` into an island config that only names the project (what
 * `screenci init` writes), so a rename in the web app cannot detach it later.
 * Returns the new source, or null when the config has no `projectName`
 * literal to anchor on.
 */
export function pinIslandConfigSource(
  source: string,
  projectId: string
): string | null {
  // A projectId in any form (a literal, an env lookup) means the island
  // already pins itself; adding another key would break the config.
  if (/(?<![\w$.])projectId\s*:/.test(source)) return null
  const match = /(projectName\s*:\s*(['"`])[^'"`\n]+\2)/.exec(source)
  if (!match) return null
  const quote = match[2] ?? "'"
  return source.replace(
    match[1]!,
    `${match[1]}, projectId: ${quote}${projectId}${quote}`
  )
}

/**
 * Locates the product's repository: the repository the command runs in, when
 * there is one (a `.git` directory up the tree or an `origin` remote). The
 * agent is invoked inside the product's checkout, so no URL is compared and
 * nothing is cloned; outside any repository the agent works from the site.
 */
export async function resolveRepository(
  params: { cwd: string },
  deps: Pick<StartDeps, 'git' | 'findRepoRoot' | 'existsSync'>
): Promise<StartRepo> {
  const repoRoot = deps.findRepoRoot(params.cwd)
  const remote = await deps.git.remoteUrl(repoRoot)
  if (remote === null && !deps.existsSync(resolve(repoRoot, '.git'))) {
    return { state: 'none' }
  }
  return { state: 'inside', dir: repoRoot, gitUrl: remote }
}

export function repoDirOf(repo: StartRepo): string | null {
  switch (repo.state) {
    case 'inside':
      return repo.dir
    case 'none':
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
 * the repository is at hand; a deployed site that is down is reported back
 * to the person.
 */
export function decideStart(input: {
  site: StartSite
  repo: StartRepo
  recordingTarget?: RecordingTarget
  runLocallyIfNeeded: boolean
  docsUrl: string
}): StartStop | null {
  const { site, repo, docsUrl } = input
  if (input.recordingTarget?.mode === 'stop') {
    const why =
      repoDirOf(repo) === null
        ? 'this command did not run inside that repository, so it cannot be started here'
        : 'starting the app from its repository is switched off for this organisation (AI context > "Let the agent start the app") and nothing answers there'
    const remedy =
      repoDirOf(repo) === null
        ? 'then point the video at it (video.use({ baseURL }) on its declaration, and no webServer block for this run) and rerun this command, or rerun it inside the repository'
        : 'then point the video at it (video.use({ baseURL }) on its declaration, and no webServer block for this run) and rerun this command, or ask them to start the app (or switch the setting on) and rerun'
    return {
      reason: 'site-local-no-repo',
      message: `The scripts record against ${input.recordingTarget.configuredUrl}, a dev server started from the product's repository, and ${why}. No deployed address is known either. Ask the person for the live site URL (AI context > site URL, or the app URL field of the dialog), ${remedy}. Docs: ${docsUrl}`,
      docsUrl,
    }
  }
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
  switch (site.kind) {
    case 'local': {
      if (input.runLocallyIfNeeded && repoDir !== null) return null
      const why =
        repoDir === null
          ? input.runLocallyIfNeeded
            ? 'Starting the app from its repository is allowed, but this command did not run inside the repository. Rerun it inside a checkout of the product.'
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
        reason: 'site-unreachable',
        message: `${site.url} did not answer within a few seconds. Ask the person to check the site URL in AI context (or that it is reachable from this machine), then rerun this command; pass --skip-site-check to record anyway. Docs: ${docsUrl}`,
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

  const repo = await resolveRepository({ cwd }, deps)

  // The island: an explicit --dir; else, inside a repository, the island the
  // repository already holds for this project (wherever it sits: a monorepo
  // keeps it under a package), else the repository's `screenci/` when that is
  // one; else ./screenci. A brand-new project never has one, so it always
  // gets ./screenci.
  let islandDir = resolve(cwd, options.dir ?? 'screenci')
  const repoDir = repoDirOf(repo)
  const repoIslands =
    repo.state === 'inside' && exchange.kind !== 'project'
      ? await findIslandsInRepo(repo.dir, deps)
      : []
  if (options.dir === undefined && repo.state === 'inside') {
    if (exchange.kind === 'project') {
      // Only ./screenci; a foreign island there is refused below.
    } else {
      const own = pickRepoIsland(
        repoIslands,
        { projectId: exchange.projectId, projectName: exchange.projectName },
        cwd
      )
      const rootCandidate = resolve(repo.dir, 'screenci')
      if (own !== null) {
        islandDir = own.dir
      } else if (
        deps.existsSync(resolve(rootCandidate, 'screenci.config.ts')) ||
        exchange.kind === 'ci'
      ) {
        islandDir = rootCandidate
      }
    }
  }
  let islandDisplayDir = toDisplayPath(cwd, islandDir)

  // Video codes start from the sources of the version the person chose (or
  // the newest with sources); project-level codes from the project's latest.
  const isVideoCode =
    (exchange.kind === 'edit' ||
      exchange.kind === 'language' ||
      exchange.kind === 'record') &&
    exchange.videoName !== undefined
  const versionBundleId = isVideoCode ? exchange.sourceBundleId : undefined
  const sourcesAvailable =
    exchange.sourcesAvailable || versionBundleId !== undefined
  const fetchStartingSources =
    async (): Promise<FetchLatestSourceBundleResult> =>
      versionBundleId !== undefined
        ? await fetchSourceBundle(
            {
              apiUrl: deps.apiUrl,
              secret: exchange.secret,
              sourceBundleId: versionBundleId,
            },
            deps.fetchFn
          )
        : await fetchLatestSourceBundle(
            { apiUrl: deps.apiUrl, secret: exchange.secret },
            deps.fetchFn
          )
  let startingPoint: StartStartingPoint = { kind: 'none' }

  // Skills go where the agent works (the cwd's repository).
  const repoRoot = deps.findRepoRoot(cwd)
  const skills = ['screenci', 'playwright-cli']
  let result: StartOutcome
  let overwritten: string[] = []

  const pullSources = async (force: boolean): Promise<void> => {
    const fetched = await fetchStartingSources()
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

  /**
   * An existing workspace and a code made from a version. Outside a
   * repository the version's sources are the starting point: files that
   * differ are replaced (every recording made here was uploaded, so nothing
   * else lives here). Inside a repository the repository wins and the brief
   * lists where the version's sources differ from it.
   */
  const useExistingWorkspaceForVersion =
    async (): Promise<StartStartingPoint> => {
      const fetched = await fetchStartingSources()
      if (!fetched.ok) {
        deps.logger.warn(
          `Could not fetch the version's sources (${fetched.message}); using the existing workspace ${islandDisplayDir} as is.`
        )
        return { kind: 'none' }
      }
      if (repo.state === 'none') {
        const applied = await applySourceBundle(
          islandDir,
          fetched.files,
          deps.fs,
          { force: true }
        )
        const replaced = applied.ok ? applied.overwritten : []
        deps.logger.info(
          replaced.length > 0
            ? `${pc.green('✔')} Using the existing workspace ${islandDisplayDir}, brought to the version's sources. Replaced (their previous contents are not kept; every uploaded recording keeps its own sources in ScreenCI): ${replaced.join(', ')}`
            : `${pc.green('✔')} Using the existing workspace ${islandDisplayDir}; it already holds the version's sources.`
        )
        return {
          kind: 'version',
          version: exchange.sourceVersion ?? null,
          replaced,
          differs: [],
        }
      }
      const localFiles = new Map<string, string | null>()
      for (const file of fetched.files) {
        const target = resolve(islandDir, ...file.path.split('/'))
        localFiles.set(
          file.path,
          (await deps.fs.exists(target))
            ? (await deps.fs.readFile(target)).toString('utf-8')
            : null
        )
      }
      const plan = planSourceBundleApply(fetched.files, localFiles)
      const differs = [...plan.write, ...plan.conflicts].sort()
      deps.logger.info(
        `${pc.green('✔')} Using the existing workspace ${islandDisplayDir}.`
      )
      return {
        kind: 'version',
        version: exchange.sourceVersion ?? null,
        replaced: [],
        differs,
      }
    }

  /** Pins an island that only names the project (a `screenci init` one). */
  let pinnedConfig = false
  const pinWorkspace = async (): Promise<void> => {
    const configPath = resolve(islandDir, 'screenci.config.ts')
    const source = await deps.readConfigSource(configPath)
    if (source === null) return
    const pinned = pinIslandConfigSource(source, exchange.projectId)
    if (pinned === null) return
    await deps.fs.writeFile(configPath, pinned)
    pinnedConfig = true
  }

  let ci: StartCi | null = null
  if (exchange.kind === 'ci') {
    // A CI code needs the repository: the pipeline records from it, and the
    // scripts are committed there together with the pipeline.
    if (repoDir === null) {
      throw new StartError(
        `Setting up CI needs the repository: run this command inside the repository of "${exchange.projectName}". Docs: ${docsUrl}`
      )
    }
    ci = detectCiProviders(repoDir, deps.existsSync)
  }

  const workspace = await resolveStartWorkspace(
    islandDir,
    exchange.projectId,
    deps
  )
  switch (workspace.state) {
    case 'absent': {
      if (exchange.kind === 'ci' && !sourcesAvailable) {
        throw new StartError(
          `No screenci/ workspace was found in the repository at ${toDisplayPath(cwd, repoDir ?? cwd)} and ScreenCI holds no sources for "${exchange.projectName}" yet. Record a video first (Add video in the web app), then set up CI.`
        )
      }
      if (!sourcesAvailable && exchange.videoName !== undefined) {
        // The code addresses one video whose script is nowhere on this
        // machine and not in ScreenCI: a fresh scaffold would only hold the
        // starter script, so the repository is the only place to work from.
        throw new StartError(
          `The script for "${exchange.videoName}" is not on this machine and ScreenCI holds no copy of the project's scripts. Run this command inside the repository${repoDir !== null ? ` (${toDisplayPath(cwd, repoDir)})` : ''}, or pass --dir <path to its screenci/ workspace>. Docs: ${docsUrl}`
        )
      }
      if (exchange.kind === 'project' || !sourcesAvailable) {
        await scaffold()
        result = 'scaffolded'
        break
      }
      await pullSources(true)
      if (isVideoCode) {
        startingPoint = {
          kind: 'version',
          version: exchange.sourceVersion ?? null,
          replaced: [],
          differs: [],
        }
      }
      await installDependencies()
      await installSkills()
      result = 'pulled'
      break
    }
    case 'same-project':
    case 'unpinned': {
      if (
        workspace.state === 'unpinned' &&
        workspace.projectName !== exchange.projectName
      ) {
        throw new StartError(
          `${islandDisplayDir} already exists and belongs to another project${
            workspace.projectName !== null
              ? ` ("${workspace.projectName}")`
              : ''
          }, not to "${exchange.projectName}". Rerun with --dir ${proposedIslandDirName(exchange.projectName)} to keep this project in its own folder.`
        )
      }
      if (options.force && sourcesAvailable) {
        if (repo.state === 'inside') {
          const dirty = await deps.git.isDirty(islandDir)
          if (dirty === true) {
            throw new StartError(
              `${islandDisplayDir} has uncommitted changes; --force would overwrite them with the version's sources. Commit or stash them first, then rerun.`
            )
          }
        }
        await pullSources(true)
        if (isVideoCode) {
          startingPoint = {
            kind: 'version',
            version: exchange.sourceVersion ?? null,
            replaced: overwritten,
            differs: [],
          }
        }
      } else if (isVideoCode && versionBundleId !== undefined) {
        startingPoint = await useExistingWorkspaceForVersion()
      } else {
        deps.logger.info(
          `${pc.green('✔')} Using the existing workspace ${islandDisplayDir}.`
        )
      }
      if (workspace.state === 'unpinned') await pinWorkspace()
      await installIfNeeded()
      await installSkills()
      result = 'existing'
      break
    }
    case 'other-project': {
      throw new StartError(
        `${islandDisplayDir} already exists and belongs to another project (${workspace.existingProjectId}). Rerun with --dir ${proposedIslandDirName(exchange.projectName)} to keep this project in its own folder.`
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

  const located = isVideoCode
    ? await locateVideoSource(
        {
          islandDir,
          videoName: exchange.videoName ?? '',
          serverPath: exchange.videoSourcePath,
          otherIslands: repoIslands.filter((i) => i.dir !== islandDir),
        },
        deps
      )
    : { path: null, location: 'not-applicable' as const }
  const videoSourcePath = located.path

  // Which address to record against: the config's, unless it names a dev
  // server this machine cannot run (no repository, or starting the app is
  // not allowed), in which case the deployed site takes over. A CI code
  // records nothing on this machine: the site is the pipeline's business, so
  // it is never probed and never stops the setup.
  const skipSiteCheck = options.skipSiteCheck === true || exchange.kind === 'ci'
  const configUrls = {
    configBaseUrl:
      configSource !== null ? readIslandBaseUrl(configSource) : undefined,
    configWebServerUrl:
      configSource !== null ? readIslandWebServerUrl(configSource) : undefined,
  }
  const configuredLocalUrl = configuredUrlIsLocal(configUrls)
    ? configuredRecordingUrl(configUrls)
    : undefined
  const configuredReachable =
    configuredLocalUrl !== undefined && !skipSiteCheck
      ? await deps.probeSite(configuredLocalUrl)
      : null
  const recordingTarget = resolveRecordingTarget({
    ...configUrls,
    taskAppUrl: exchange.task.appUrl,
    contextSiteUrl: exchange.aiContext.siteUrl,
    versionSite: exchange.sourceVersion?.site,
    repoAtHand: repo.state === 'inside',
    runLocallyIfNeeded: exchange.aiContext.runLocallyIfNeeded,
    configuredReachable,
  })
  const site = await resolveSite(
    {
      url: recordingTargetUrl(recordingTarget),
      skipSiteCheck,
    },
    deps
  )
  const stop = decideStart({
    site,
    repo,
    recordingTarget,
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
    pinnedConfig,
    videoSourcePath:
      videoSourcePath !== null ? toDisplayPath(cwd, videoSourcePath) : null,
    videoSourceLocation: located.location,
    startingPoint,
    recordingTarget,
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
          ? `Edit ${result.videoSourcePath}: it declares video("${exchange.videoName ?? ''}", ...) (or screenshot(...)).${describeVideoSourceLocation(result)} Keep the title unchanged so the edit lands on the same video.`
          : missingScriptLine(result, islandDisplayDir)
      )
      break
    case 'language': {
      const code = exchange.task.language ?? ''
      lines.push(
        result.videoSourcePath !== null
          ? `Edit ${result.videoSourcePath}: it declares video("${exchange.videoName ?? ''}", ...).${describeVideoSourceLocation(result)} Keep the title unchanged.`
          : missingScriptLine(result, islandDisplayDir),
        `Add "${code}" to video.languages([...]) (declare the array when the video has none yet: the existing language first, then "${code}") and add a "${code}" narration block next to the existing one, translating every cue and keeping its meaning, tone and length. Leave the flow, the selectors and the other languages untouched.`
      )
      break
    }
    case 'record':
      lines.push(
        exchange.videoName !== undefined
          ? result.videoSourcePath !== null
            ? `Record ${result.videoSourcePath} again as it is: it declares video("${exchange.videoName}", ...) (or screenshot(...)).${describeVideoSourceLocation(result)}`
            : missingScriptLine(result, islandDisplayDir)
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
  lines.push(...formatStartingPointSection(result))
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
  if (result.pinnedConfig) {
    lines.push('')
    lines.push(
      `${islandDisplayDir}/screenci.config.ts now carries projectId: "${exchange.projectId}" so the workspace stays linked to this project when it is renamed. Commit that line with your change.`
    )
  }
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

function describeVideoSourceLocation(result: StartResult): string {
  switch (result.videoSourceLocation) {
    case 'server':
    case 'not-applicable':
    case 'missing':
      return ''
    case 'title':
      return result.exchange.videoSourcePath !== undefined
        ? ` (The version was recorded from ${result.exchange.videoSourcePath}, which moved or changed; this file carries the title now.)`
        : ''
    case 'other-island':
      return ' (It sits in another ScreenCI workspace of this repository; work there, and run the commands below in that folder.)'
    default: {
      const exhaustive: never = result.videoSourceLocation
      throw new Error(`Unhandled location: ${String(exhaustive)}`)
    }
  }
}

function missingScriptLine(
  result: StartResult,
  islandDisplayDir: string
): string {
  const title = result.exchange.videoName ?? ''
  const recorded =
    result.exchange.videoSourcePath !== undefined
      ? ` The version was recorded from ${result.exchange.videoSourcePath}, which is not here.`
      : ''
  return `No script under ${islandDisplayDir}/recordings/ declares video("${title}", ...) (or screenshot(...)).${recorded} Search the workspace for the title once more; if it is truly gone, do not recreate the video from scratch: tell the person the script for "${title}" is missing here and ask where the scripts live (a repository, another folder), then rerun this command there.`
}

/**
 * Which sources the workspace starts from: the version the code was made
 * from, and how the local files relate to it.
 */
function formatStartingPointSection(result: StartResult): string[] {
  const { startingPoint } = result
  switch (startingPoint.kind) {
    case 'none':
      return []
    case 'version': {
      const version = startingPoint.version
      const label =
        version !== null
          ? `version ${version.versionNumber} (recorded ${version.createdAt}${version.site !== undefined ? ` against ${version.site.origin}` : ''})`
          : 'the newest version with sources'
      const lines = ['## Starting point', '']
      switch (result.outcome) {
        case 'pulled':
          lines.push(
            `The workspace holds the scripts ${label} was recorded from. Other versions of this video may have been recorded from other scripts; the person chose this one as the starting point.`
          )
          break
        case 'existing':
          if (startingPoint.replaced.length > 0) {
            lines.push(
              `The workspace was updated to the scripts ${label} was recorded from; these files were replaced: ${startingPoint.replaced.join(', ')}. Every recording made here was uploaded, so nothing was lost: earlier versions keep their own sources in ScreenCI.`
            )
          } else if (startingPoint.differs.length > 0) {
            lines.push(
              `This workspace lives in the repository, so the repository's scripts are the starting point. ${label[0]!.toUpperCase()}${label.slice(1)} was recorded from other scripts; they differ in: ${startingPoint.differs.join(', ')}. Work from the repository unless the person wants that version's look, in which case rerun this command with --force to replace those files with the version's.`
            )
          } else {
            lines.push(
              `The workspace already holds the scripts ${label} was recorded from.`
            )
          }
          break
        case 'scaffolded':
          break
        default: {
          const exhaustive: never = result.outcome
          throw new Error(`Unhandled outcome: ${String(exhaustive)}`)
        }
      }
      lines.push(
        'Every preview lands as a new version next to the existing ones. The person picks the version that serves; two people editing from different starting points is fine.',
        ''
      )
      return lines
    }
    default: {
      const exhaustive: never = startingPoint
      throw new Error(`Unhandled starting point: ${String(exhaustive)}`)
    }
  }
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
    case 'none':
      return [
        '## Repository',
        '',
        `This command did not run inside a repository, so the product's source code is not at hand. Work from the site alone: explore it with the playwright-cli skill before writing selectors. To read the product's routes and components instead, rerun this command inside its repository (the workspace is ${islandDisplayDir}/).`,
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
  if (result.recordingTarget.mode === 'override') {
    const { url, configuredUrl } = result.recordingTarget
    const reachable = site.state === 'checked' ? site.reachable : null
    const configPath = `${islandDisplayDir}/screenci.config.ts`
    return [
      '## Site',
      '',
      `The scripts are written for ${configuredUrl} (webServer / use.baseURL in ${configPath}), a dev server ${repo.state === 'inside' ? 'you may not start' : 'you cannot start here: this command did not run inside the repository'}. Record against the live site ${url} instead${reachable === false ? ' (it did not answer just now; check it before recording)' : reachable === true ? ' (it answers)' : ''}. Nothing does this for you; change the config by hand:`,
      '',
      `1. Give the video you work on its own address: chain .use({ baseURL: '${url}' }) onto its declaration (video.use({ baseURL: '${url}' })('<title>', ...), or screenshot.use(...)). This changes that one video only; the other scripts and ${configPath} stay as they are. Change use.baseURL in the config instead only when the task covers every video of the project (Record all).`,
      `2. Remove (or comment out) the webServer block in ${configPath} for this run, so nothing tries to start a server; put it back before committing when the workspace lives in a repository.`,
      `3. In that script, replace each page.goto('${configuredUrl}/...') with the same path relative to the base URL (page.goto('/...')), so it records against whichever address is in use.`,
      `4. Explore ${url} with the playwright-cli skill before touching selectors. A session saved for the dev server does not apply to the live site: when the flow needs a sign-in, run \`npx screenci login ${url}\` as described under Signing in. Run preview with ${SCREENCI_APP_LAUNCHED_BY_ENV}=existing.`,
      '',
      `The flow may rely on data a dev server seeds (a specific customer, an empty account, a feature flag). Check on ${url} that each step's state exists before recording. When it does not, do not rewrite the flow around it or invent data in the product: use fictitious data for anything the flow creates itself, and for anything it expects to find, report to the person which step needs what on the live site and stop there.`,
      '',
      `Mention the address change in your report. When the workspace lives in a repository, do not commit it: the engineers record against the dev server there. Outside a repository, the change uploads with the preview and becomes part of this version's sources, which is fine: the next engineer's Edit inside the repository keeps the repository's config.`,
      '',
    ]
  }
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
    videoSourceLocation: result.videoSourceLocation,
    startingPoint: result.startingPoint,
    recordingTarget: result.recordingTarget,
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
        },
        deps
      )
      if (result.stop !== null) process.exitCode = START_STOP_EXIT_CODE
    })
}
