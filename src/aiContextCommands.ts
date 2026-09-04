import type { Command } from 'commander'
import pc from 'picocolors'
import {
  fetchAiContext,
  type CliAiContext,
  type FetchAiContextResult,
} from './aiContext.js'
import {
  describeAppSessionStatus,
  readAppSessionStatus,
  resolveProfileName,
  type AppSessionStatus,
} from './appSession.js'
import {
  defaultDownloadSampleDeps,
  brandingAssetPaths as brandingAssetPathsOf,
  downloadBrandingAssets,
  downloadBrandingVoiceSample,
  type CliBrandingAsset,
  fetchBranding,
  formatBrandingLines,
  type CliBranding,
  type DownloadBrandingSampleResult,
  type FetchBrandingResult,
} from './branding.js'

/**
 * `screenci context`: what a coding agent runs after `start` to re-read the
 * organisation's AI context and branding. It reads the island's credentials
 * (SCREENCI_SECRET) the way every other account command
 * does; the loader is injected so the command is unit-testable.
 *
 * It also reports whether a signed-in session for the product is saved on this
 * machine. That is read from disk, never from the service: `screenci login`
 * captures it locally and nothing uploads it.
 */

export type IslandCredentials = {
  secret: string
  apiUrl: string
  appUrl: string
  envFilePath: string
  /** The island directory (the config's folder). */
  islandDir: string
  projectName: string
}

export interface AiContextCommandDeps {
  fetchFn: typeof fetch
  /** Loads the island config and its env; exits the process when no secret. */
  loadCredentials: (
    configPath: string | undefined
  ) => Promise<IslandCredentials>
  fetchAiContext: (
    params: {
      apiUrl: string
      secret: string
      projectName?: string | undefined
    },
    fetchFn: typeof fetch
  ) => Promise<FetchAiContextResult>
  now: () => Date
  readAppSessionStatus: (params: {
    configDir: string
    profile: string
    now: Date
  }) => Promise<AppSessionStatus>
  fetchBranding: (
    params: {
      apiUrl: string
      secret: string
      projectName?: string | undefined
    },
    fetchFn: typeof fetch
  ) => Promise<FetchBrandingResult>
  downloadBrandingVoiceSample: (
    params: {
      apiUrl: string
      secret: string
      islandDir: string
      projectName?: string | undefined
    },
    fetchFn: typeof fetch
  ) => Promise<DownloadBrandingSampleResult>
  /** Saves the shared branding assets into the island (see branding.ts). */
  downloadBrandingAssets: (
    params: {
      apiUrl: string
      secret: string
      islandDir: string
      projectName?: string | undefined
    },
    assets: readonly CliBrandingAsset[],
    fetchFn: typeof fetch
  ) => Promise<Record<string, DownloadBrandingSampleResult>>
  logger: { info(message: string): void; warn(message: string): void }
}

export class AiContextCommandError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AiContextCommandError'
  }
}

export type ContextCommandResult = {
  context: CliAiContext
  projectName: string | null
  sourceMode: 'service' | 'local' | null
  /** The signed-in session on this machine, read from `.screenci/auth/`. */
  session: AppSessionStatus
  /** Null when the branding could not be fetched (a warning was logged). */
  branding: CliBranding | null
  /** Workspace-relative path of the downloaded voice sample, when any. */
  brandingSamplePath: string | null
  /** Workspace-relative paths of the shared branding assets saved locally. */
  brandingAssetPaths: Record<string, string>
}

/** Human summary of the context, followed by the JSON line agents parse. */
export function formatContextSummary(
  result: ContextCommandResult,
  now: Date
): string {
  const { context } = result
  const lines: string[] = []
  const show = (value: string | null): string => value ?? pc.dim('not set')
  lines.push(
    `Project: ${result.projectName ?? pc.dim('organisation defaults')}${
      result.sourceMode !== null
        ? ` (${result.sourceMode === 'service' ? 'sources in ScreenCI' : 'sources in the repository'})`
        : ''
    }`
  )
  lines.push(`Repository: ${show(context.gitUrl)}`)
  lines.push(`Site: ${show(context.siteUrl)}`)
  lines.push(
    `Agent may start the app from the repository: ${context.runLocallyIfNeeded ? 'yes' : 'no'}`
  )
  lines.push(
    `Site needs a sign-in: ${context.siteRequiresLogin ? 'yes' : 'not according to the team'}`
  )
  lines.push(
    `${describeAppSessionStatus(result.session, now)}${
      result.session.saved && !result.session.expired
        ? ' Recordings start signed in, so do not script a sign-in.'
        : ' Run `npx screenci login` and have the person sign in in the browser it opens.'
    }`
  )
  if (context.guide !== null) {
    lines.push('', 'Notes from the team:', '', context.guide.trim())
  }
  lines.push('', 'Branding (apply it in the video code; see the start brief):')
  lines.push(
    ...(result.branding !== null
      ? formatBrandingLines(
          result.branding,
          result.brandingSamplePath,
          result.brandingAssetPaths
        )
      : [pc.dim('could not be fetched')])
  )
  lines.push('')
  return lines.join('\n')
}

export async function runContextCommand(
  options: { config?: string | undefined; json: boolean },
  deps: AiContextCommandDeps
): Promise<ContextCommandResult> {
  const creds = await deps.loadCredentials(options.config)
  const fetched = await deps.fetchAiContext(
    {
      apiUrl: creds.apiUrl,
      secret: creds.secret,
      projectName: creds.projectName,
    },
    deps.fetchFn
  )
  if (!fetched.ok) throw new AiContextCommandError(fetched.message)
  // The branding is best-effort: an older server has none, and a transient
  // failure must not hide the context itself.
  const brandingFetch = await deps.fetchBranding(
    {
      apiUrl: creds.apiUrl,
      secret: creds.secret,
      projectName: creds.projectName,
    },
    deps.fetchFn
  )
  if (!brandingFetch.ok) deps.logger.warn(brandingFetch.message)
  const branding = brandingFetch.ok ? brandingFetch.branding : null
  let brandingSamplePath: string | null = null
  if (branding?.voice?.kind === 'sample') {
    const download = await deps.downloadBrandingVoiceSample(
      {
        apiUrl: creds.apiUrl,
        secret: creds.secret,
        islandDir: creds.islandDir,
        projectName: creds.projectName,
      },
      deps.fetchFn
    )
    if (download.status === 'error') {
      deps.logger.warn(
        `Could not download the branding voice sample: ${download.message}`
      )
    } else if (download.status !== 'none') {
      brandingSamplePath = download.relativePath
    }
  }
  // Local copies of the shared assets, so the agent can inspect them and a
  // local preview can show them. The reference in code stays the name.
  let brandingAssetPaths: Record<string, string> = {}
  if (branding !== null && branding.assets.length > 0) {
    const results = await deps.downloadBrandingAssets(
      {
        apiUrl: creds.apiUrl,
        secret: creds.secret,
        islandDir: creds.islandDir,
        projectName: creds.projectName,
      },
      branding.assets,
      deps.fetchFn
    )
    brandingAssetPaths = brandingAssetPathsOf(results)
    for (const [name, download] of Object.entries(results)) {
      if (download.status === 'error') {
        deps.logger.warn(
          `Could not download the branding asset "${name}": ${download.message}`
        )
      }
    }
  }
  const now = deps.now()
  const result: ContextCommandResult = {
    context: fetched.context,
    projectName: fetched.projectName,
    sourceMode: fetched.sourceMode,
    session: await deps.readAppSessionStatus({
      configDir: creds.islandDir,
      profile: resolveProfileName(undefined),
      now,
    }),
    branding,
    brandingSamplePath,
    brandingAssetPaths,
  }
  if (!options.json) {
    deps.logger.info(formatContextSummary(result, now))
  }
  deps.logger.info(
    JSON.stringify({
      ...result.context,
      projectName: result.projectName,
      sourceMode: result.sourceMode,
      session: {
        saved: result.session.saved,
        expired: result.session.saved && result.session.expired,
      },
      envFile: creds.envFilePath,
      branding: result.branding,
      ...(result.brandingSamplePath !== null
        ? { brandingSamplePath: result.brandingSamplePath }
        : {}),
      ...(Object.keys(result.brandingAssetPaths).length > 0
        ? { brandingAssetPaths: result.brandingAssetPaths }
        : {}),
    })
  )
  return result
}

export function registerAiContextCommands(
  program: Command,
  deps: AiContextCommandDeps
): void {
  program
    .command('context')
    .description(
      "Print the organisation's AI context and branding for this project: repository, site, whether the agent may start the app, notes, and the look and voice new videos start from"
    )
    .option('-c, --config <path>', 'path to screenci.config.ts')
    .option('--json', 'print only the JSON line')
    .action(async (options: Record<string, unknown>) => {
      await runContextCommand(
        {
          config: options['config'] as string | undefined,
          json: options['json'] === true,
        },
        deps
      )
    })
}

export function createDefaultAiContextCommandDeps(
  loadCredentials: AiContextCommandDeps['loadCredentials'],
  logger: AiContextCommandDeps['logger']
): AiContextCommandDeps {
  return {
    fetchFn: fetch,
    loadCredentials,
    fetchAiContext,
    now: () => new Date(),
    readAppSessionStatus: (params) => readAppSessionStatus(params),
    fetchBranding,
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
    logger,
  }
}
