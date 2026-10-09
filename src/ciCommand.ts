import type { Command } from 'commander'
import pc from 'picocolors'
import { SECRET_HEADER } from './anonSession.js'
import { fetchRemoteSelection } from './fileSync.js'
import {
  collectProjectFiles,
  toManifest,
  type ProjectFilesFs,
} from './localProjectFiles.js'
import { diffManifests, type ManifestDiff } from './projectFiles.js'

/**
 * `screenci ci`: what a CI pipeline runs. It asks ScreenCI which videos are
 * flagged for recording, records exactly those from the repository checkout
 * (the same in-process record pass `screenci preview` uses), reports each
 * video's outcome so the results page fills in, and prints that page's URL.
 *
 * It never downloads code from ScreenCI: the checkout is the only code that
 * runs. When the files ScreenCI holds for a flagged video differ from the
 * checkout (someone edited the video in the app), it warns and points at the
 * app's hand-off, which pulls those changes into the repository.
 */

export interface CiLogger {
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

export interface CiIsland {
  islandDir: string
  projectName: string
  secret: string | undefined
  apiUrl: string
}

export interface CiRecordOutcome {
  /** Videos whose recording uploaded. */
  uploadedVideoNames: string[]
  failedVideoMessages: Array<{ videoName: string; message: string }>
  /** Set when the video script itself failed (Playwright error). */
  scriptFailure: string | null
}

export interface CiCommandDeps {
  fetchFn: typeof fetch
  logger: CiLogger
  fs: ProjectFilesFs
  loadIsland: (configPath: string | undefined) => Promise<CiIsland>
  /** Titles of the videos the checkout declares. */
  listLocalVideoNames: (configPath: string | undefined) => Promise<string[]>
  /**
   * Records and uploads the given titles (every video when null) with the
   * run's recordId, reusing the preview record pass.
   */
  recordVideos: (params: {
    configPath: string | undefined
    titles: readonly string[] | null
    recordId: string
    verbose: boolean
  }) => Promise<CiRecordOutcome>
  generateRecordId: () => string
  now: () => number
}

export interface CiCommandOptions {
  config?: string
  verbose: boolean
}

export interface HostedConfig {
  projectId: string
  projectName: string
  hostedRecordingEnabled: boolean
  flaggedVideos: Array<{ videoId: string; name: string; slug: string | null }>
  appBaseUrl: string | null
}

export type FetchHostedConfigResult =
  | { kind: 'ok'; config: HostedConfig }
  /** The service has no run tracking (an older deployment). */
  | { kind: 'unsupported' }
  | { kind: 'error'; message: string }

function headersFor(secret: string): Record<string, string> {
  return { [SECRET_HEADER]: secret }
}

export function parseHostedConfig(raw: unknown): HostedConfig | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (typeof r.projectId !== 'string' || typeof r.projectName !== 'string') {
    return null
  }
  const flagged = Array.isArray(r.flaggedVideos) ? r.flaggedVideos : []
  return {
    projectId: r.projectId,
    projectName: r.projectName,
    hostedRecordingEnabled: r.hostedRecordingEnabled === true,
    flaggedVideos: flagged.flatMap((video: unknown) => {
      const v = video as Record<string, unknown> | null
      if (
        v === null ||
        typeof v !== 'object' ||
        typeof v.name !== 'string' ||
        typeof v.videoId !== 'string'
      ) {
        return []
      }
      return [
        {
          videoId: v.videoId,
          name: v.name,
          slug: typeof v.slug === 'string' ? v.slug : null,
        },
      ]
    }),
    appBaseUrl: typeof r.appBaseUrl === 'string' ? r.appBaseUrl : null,
  }
}

export async function fetchHostedConfig(
  params: { apiUrl: string; secret: string; projectName: string },
  fetchFn: typeof fetch
): Promise<FetchHostedConfigResult> {
  const url = new URL(`${params.apiUrl}/cli/hosted/config`)
  url.searchParams.set('projectName', params.projectName)
  let response: Response
  try {
    response = await fetchFn(url.toString(), {
      headers: headersFor(params.secret),
    })
  } catch (err) {
    return {
      kind: 'error',
      message: `Could not reach ScreenCI: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
  if (response.status === 404) {
    await response.text().catch(() => '')
    return { kind: 'unsupported' }
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    return {
      kind: 'error',
      message: `Reading the project's recording settings failed with status ${response.status}${text ? `: ${text.slice(0, 300)}` : ''}`,
    }
  }
  const config = parseHostedConfig(await response.json().catch(() => null))
  return config === null
    ? {
        kind: 'error',
        message: 'The recording settings response is malformed.',
      }
    : { kind: 'ok', config }
}

export function formatDriftWarning(diff: ManifestDiff): string | null {
  const total =
    diff.changed.length + diff.onlyRemote.length + diff.onlyLocal.length
  if (total === 0) return null
  const lines = [
    'The files ScreenCI holds for the flagged videos differ from this checkout (the checkout is what records):',
    ...diff.changed.map((path) => `  changed:        ${path}`),
    ...diff.onlyRemote.map((path) => `  only in app:    ${path}`),
    ...diff.onlyLocal.map((path) => `  only in repo:   ${path}`),
    'To bring edits made in the app into the repository, use the video\'s "Add to CI" hand-off in the app and commit what it pulls.',
  ]
  return lines.join('\n')
}

/** Drift of the flagged videos' files between ScreenCI and the checkout. */
export async function checkDrift(
  params: {
    apiUrl: string
    secret: string
    projectName: string
    islandDir: string
    slugs: readonly string[]
  },
  deps: Pick<CiCommandDeps, 'fetchFn' | 'fs' | 'logger'>
): Promise<ManifestDiff | null> {
  if (params.slugs.length === 0) return null
  const remote = await fetchRemoteSelection(
    {
      apiUrl: params.apiUrl,
      secret: params.secret,
      projectName: params.projectName,
      slugs: params.slugs,
    },
    deps.fetchFn
  )
  if (!remote.ok) {
    if (remote.status === 'error') {
      deps.logger.warn(`Skipping the drift check: ${remote.message}`)
    }
    return null
  }
  const local = await collectProjectFiles(
    params.islandDir,
    params.slugs,
    deps.fs
  )
  return diffManifests(
    toManifest(local.files),
    remote.entries.map(({ path, hash }) => ({ path, hash }))
  )
}

type CiBatch = {
  batchId: string
  runs: Array<{ runId: string; videoName: string }>
  resultsUrl: string | null
}

async function createCiBatch(
  params: {
    apiUrl: string
    secret: string
    projectName: string
    videos: ReadonlyArray<{ name: string; slug: string | null }>
  },
  deps: Pick<CiCommandDeps, 'fetchFn' | 'logger'>
): Promise<CiBatch | null> {
  try {
    const response = await deps.fetchFn(
      `${params.apiUrl}/cli/hosted/ci-batch`,
      {
        method: 'POST',
        headers: {
          ...headersFor(params.secret),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          projectName: params.projectName,
          videos: params.videos.map(({ name, slug }) => ({ name, slug })),
        }),
      }
    )
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      deps.logger.warn(
        `Could not register this run with ScreenCI (${response.status}${text ? `: ${text.slice(0, 300)}` : ''}); recording anyway.`
      )
      return null
    }
    const body = (await response.json()) as Record<string, unknown>
    if (typeof body.batchId !== 'string' || !Array.isArray(body.runs)) {
      deps.logger.warn(
        'ScreenCI answered the run registration unexpectedly; recording anyway.'
      )
      return null
    }
    return {
      batchId: body.batchId,
      runs: body.runs.flatMap((run: unknown) => {
        const r = run as Record<string, unknown> | null
        return r !== null &&
          typeof r === 'object' &&
          typeof r.runId === 'string' &&
          typeof r.videoName === 'string'
          ? [{ runId: r.runId, videoName: r.videoName }]
          : []
      }),
      resultsUrl: typeof body.resultsUrl === 'string' ? body.resultsUrl : null,
    }
  } catch (err) {
    deps.logger.warn(
      `Could not register this run with ScreenCI (${err instanceof Error ? err.message : String(err)}); recording anyway.`
    )
    return null
  }
}

export type CiVideoResult =
  | { runId: string; status: 'finished' }
  | { runId: string; status: 'failed'; error: string }

/** Each registered run's outcome from what uploaded. */
export function deriveCiResults(params: {
  runs: ReadonlyArray<{ runId: string; videoName: string }>
  missingLocally: ReadonlySet<string>
  outcome: CiRecordOutcome | null
  recordError: string | null
}): CiVideoResult[] {
  const uploaded = new Set(params.outcome?.uploadedVideoNames ?? [])
  return params.runs.map((run): CiVideoResult => {
    if (uploaded.has(run.videoName)) {
      return { runId: run.runId, status: 'finished' }
    }
    if (params.missingLocally.has(run.videoName)) {
      return {
        runId: run.runId,
        status: 'failed',
        error: `No video titled "${run.videoName}" in this checkout.`,
      }
    }
    const message =
      params.outcome?.failedVideoMessages.find(
        (failure) =>
          failure.videoName === run.videoName ||
          failure.videoName.startsWith(`${run.videoName} [`)
      )?.message ??
      params.outcome?.scriptFailure ??
      params.recordError ??
      'The video was not recorded.'
    return { runId: run.runId, status: 'failed', error: message.slice(0, 2000) }
  })
}

async function reportCiBatch(
  params: {
    apiUrl: string
    secret: string
    batchId: string
    recordId: string | null
    wallClockMs: number
    results: CiVideoResult[]
  },
  deps: Pick<CiCommandDeps, 'fetchFn' | 'logger'>
): Promise<void> {
  try {
    const response = await deps.fetchFn(
      `${params.apiUrl}/cli/hosted/ci-report`,
      {
        method: 'POST',
        headers: {
          ...headersFor(params.secret),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          batchId: params.batchId,
          recordId: params.recordId,
          wallClockMs: params.wallClockMs,
          results: params.results,
        }),
      }
    )
    if (!response.ok) {
      deps.logger.warn(
        `Could not report the results to ScreenCI (${response.status}).`
      )
    }
  } catch (err) {
    deps.logger.warn(
      `Could not report the results to ScreenCI (${err instanceof Error ? err.message : String(err)}).`
    )
  }
}

/** Runs `screenci ci`; resolves with the process exit code. */
export async function runCiCommand(
  options: CiCommandOptions,
  deps: CiCommandDeps
): Promise<number> {
  const island = await deps.loadIsland(options.config)
  if (island.secret === undefined || island.secret === '') {
    deps.logger.error(
      "SCREENCI_SECRET is not set. Add it to your CI provider's secrets and pass it to this step as SCREENCI_SECRET."
    )
    return 1
  }
  const secret = island.secret
  const config = await fetchHostedConfig(
    { apiUrl: island.apiUrl, secret, projectName: island.projectName },
    deps.fetchFn
  )
  const recordEverything = async (reason: string): Promise<number> => {
    deps.logger.info(
      `${reason} Recording every video, like \`screenci preview\`.`
    )
    let outcome: CiRecordOutcome
    try {
      outcome = await deps.recordVideos({
        configPath: options.config,
        titles: null,
        recordId: deps.generateRecordId(),
        verbose: options.verbose,
      })
    } catch (err) {
      deps.logger.error(
        `Recording failed: ${err instanceof Error ? err.message : String(err)}`
      )
      return 1
    }
    return outcome.scriptFailure === null &&
      outcome.failedVideoMessages.length === 0
      ? 0
      : 1
  }
  switch (config.kind) {
    case 'error':
      deps.logger.error(config.message)
      return 1
    case 'unsupported':
      return await recordEverything(
        'This ScreenCI deployment does not track recording runs.'
      )
    case 'ok':
      break
    default: {
      const exhaustive: never = config
      throw new Error(`Unhandled config: ${String(exhaustive)}`)
    }
  }
  const hosted = config.config
  if (!hosted.hostedRecordingEnabled) {
    return await recordEverything(
      'Recording runs are not enabled for this organisation.'
    )
  }
  if (hosted.flaggedVideos.length === 0) {
    deps.logger.info(
      `No videos of "${hosted.projectName}" are flagged for recording, so there is nothing to record. Flag videos in the app (the video's recording settings) to have this pipeline record them.`
    )
    return 0
  }

  const slugs = hosted.flaggedVideos.flatMap((video) =>
    video.slug !== null ? [video.slug] : []
  )
  try {
    const diff = await checkDrift(
      {
        apiUrl: island.apiUrl,
        secret,
        projectName: island.projectName,
        islandDir: island.islandDir,
        slugs,
      },
      deps
    )
    const warning = diff === null ? null : formatDriftWarning(diff)
    if (warning !== null) deps.logger.warn(warning)
  } catch (err) {
    deps.logger.warn(
      `Skipping the drift check: ${err instanceof Error ? err.message : String(err)}`
    )
  }

  const localNames = new Set(await deps.listLocalVideoNames(options.config))
  const missingLocally = new Set(
    hosted.flaggedVideos
      .map((video) => video.name)
      .filter((name) => !localNames.has(name))
  )
  for (const name of missingLocally) {
    deps.logger.warn(
      `"${name}" is flagged for recording but no script in this checkout declares it.`
    )
  }
  const titles = hosted.flaggedVideos
    .map((video) => video.name)
    .filter((name) => !missingLocally.has(name))

  const batch = await createCiBatch(
    {
      apiUrl: island.apiUrl,
      secret,
      projectName: island.projectName,
      videos: hosted.flaggedVideos,
    },
    deps
  )
  if (batch?.resultsUrl != null) {
    deps.logger.info(`Results: ${pc.cyan(batch.resultsUrl)}`)
  }

  const recordId = deps.generateRecordId()
  const startedAt = deps.now()
  let outcome: CiRecordOutcome | null = null
  let recordError: string | null = null
  if (titles.length > 0) {
    deps.logger.info(
      `Recording ${titles.length} flagged video${titles.length === 1 ? '' : 's'}: ${titles.map((title) => `"${title}"`).join(', ')}`
    )
    try {
      outcome = await deps.recordVideos({
        configPath: options.config,
        titles,
        recordId,
        verbose: options.verbose,
      })
    } catch (err) {
      recordError = err instanceof Error ? err.message : String(err)
      deps.logger.error(`Recording failed: ${recordError}`)
    }
  }
  const wallClockMs = Math.max(0, deps.now() - startedAt)

  const uploaded = new Set(outcome?.uploadedVideoNames ?? [])
  const failedNames = hosted.flaggedVideos
    .map((video) => video.name)
    .filter((name) => !uploaded.has(name))
  if (batch !== null) {
    await reportCiBatch(
      {
        apiUrl: island.apiUrl,
        secret,
        batchId: batch.batchId,
        recordId: outcome !== null ? recordId : null,
        wallClockMs,
        results: deriveCiResults({
          runs: batch.runs,
          missingLocally,
          outcome,
          recordError,
        }),
      },
      deps
    )
  }
  deps.logger.info('')
  if (failedNames.length === 0) {
    deps.logger.info(
      `${pc.green('✔')} Recorded ${uploaded.size} flagged video${uploaded.size === 1 ? '' : 's'}.`
    )
  } else {
    deps.logger.error(
      `Not recorded: ${failedNames.map((name) => `"${name}"`).join(', ')}`
    )
  }
  if (batch?.resultsUrl != null) {
    deps.logger.info(`Results: ${pc.cyan(batch.resultsUrl)}`)
  }
  return failedNames.length === 0 ? 0 : 1
}

export function registerCiCommand(
  program: Command,
  createDeps: () => CiCommandDeps
): Command {
  return program
    .command('ci')
    .description(
      'Record the videos flagged for recording in ScreenCI from this checkout, report each result, and print the results page (for CI pipelines)'
    )
    .option('-c, --config <path>', 'path to screenci.config.ts')
    .option('-v, --verbose', 'verbose output')
    .action(async (options: Record<string, unknown>) => {
      const config = options['config'] as string | undefined
      const code = await runCiCommand(
        {
          ...(config !== undefined ? { config } : {}),
          verbose: options['verbose'] === true,
        },
        createDeps()
      )
      process.exitCode = code
    })
}
