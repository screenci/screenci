import type { Command } from 'commander'
import pc from 'picocolors'
import {
  APP_PASSWORD_ENV,
  APP_USERNAME_ENV,
  fetchAiContext,
  fetchAppLogin,
  persistAppLogin,
  type AppLogin,
  type CliAiContext,
  type FetchAiContextResult,
  type FetchAppLoginResult,
  type PersistAppLoginOutcome,
} from './aiContext.js'

/**
 * `screenci context` and `screenci pull-login`: the two commands a coding
 * agent runs after `start` to re-read the organisation's AI context and to
 * refresh the person's site login in the island env file. Both read the
 * island's credentials (SCREENCI_SECRET, SCREENCI_EDIT_TOKEN) the way every
 * other account command does; the loader is injected so the commands are
 * unit-testable.
 */

export type IslandCredentials = {
  secret: string
  editToken: string | null
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
      editToken?: string | undefined
      projectName?: string | undefined
    },
    fetchFn: typeof fetch
  ) => Promise<FetchAiContextResult>
  fetchAppLogin: (
    params: { apiUrl: string; secret: string; editToken: string },
    fetchFn: typeof fetch
  ) => Promise<FetchAppLoginResult>
  persistAppLogin: (
    envFilePath: string,
    login: AppLogin | null,
    options: { overwrite: boolean }
  ) => Promise<PersistAppLoginOutcome>
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
  login: { saved: boolean }
}

/** Human summary of the context, followed by the JSON line agents parse. */
export function formatContextSummary(
  result: ContextCommandResult,
  envFilePath: string,
  appUrl: string
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
    `Site login: ${
      result.login.saved
        ? `saved; run \`screenci pull-login\` to write it into ${envFilePath} as ${APP_USERNAME_ENV} / ${APP_PASSWORD_ENV}`
        : `not saved; the person can add theirs at ${appUrl.replace(/\/+$/, '')}/ai-context#login`
    }`
  )
  if (context.guide !== null) {
    lines.push('', 'Notes from the team:', '', context.guide.trim())
  }
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
      ...(creds.editToken !== null ? { editToken: creds.editToken } : {}),
      projectName: creds.projectName,
    },
    deps.fetchFn
  )
  if (!fetched.ok) throw new AiContextCommandError(fetched.message)
  const result: ContextCommandResult = {
    context: fetched.context,
    projectName: fetched.projectName,
    sourceMode: fetched.sourceMode,
    login: fetched.login,
  }
  if (!options.json) {
    deps.logger.info(
      formatContextSummary(result, creds.envFilePath, creds.appUrl)
    )
  }
  deps.logger.info(
    JSON.stringify({
      ...result.context,
      projectName: result.projectName,
      sourceMode: result.sourceMode,
      login: result.login,
      envFile: creds.envFilePath,
    })
  )
  return result
}

export type PullLoginResult = {
  saved: boolean
  outcome: PersistAppLoginOutcome
  envFilePath: string
}

export async function runPullLoginCommand(
  options: { config?: string | undefined },
  deps: AiContextCommandDeps
): Promise<PullLoginResult> {
  const creds = await deps.loadCredentials(options.config)
  if (creds.editToken === null) {
    throw new AiContextCommandError(
      'No SCREENCI_EDIT_TOKEN in the env file: the site login is personal and needs the editor token that `screenci start` writes. Rerun the setup prompt, or add a personal editor token from the Secrets page.'
    )
  }
  const fetched = await deps.fetchAppLogin(
    { apiUrl: creds.apiUrl, secret: creds.secret, editToken: creds.editToken },
    deps.fetchFn
  )
  if (!fetched.ok) throw new AiContextCommandError(fetched.message)
  const outcome = await deps.persistAppLogin(creds.envFilePath, fetched.login, {
    overwrite: true,
  })
  const saved = fetched.login !== null
  deps.logger.info(
    saved
      ? `${pc.green('✔')} Wrote the site login into ${creds.envFilePath} (${APP_USERNAME_ENV}, ${APP_PASSWORD_ENV}).`
      : `No site login is saved for you. Add it at ${creds.appUrl.replace(/\/+$/, '')}/ai-context#login and rerun, or paste it into ${creds.envFilePath} (${APP_USERNAME_ENV}, ${APP_PASSWORD_ENV}).`
  )
  deps.logger.info(
    JSON.stringify({ login: { saved }, outcome, envFile: creds.envFilePath })
  )
  return { saved, outcome, envFilePath: creds.envFilePath }
}

export function registerAiContextCommands(
  program: Command,
  deps: AiContextCommandDeps
): void {
  program
    .command('context')
    .description(
      "Print the organisation's AI context for this project: repository, site, whether the agent may start the app, notes"
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

  program
    .command('pull-login')
    .description(
      `Write your saved site login into the env file as ${APP_USERNAME_ENV} / ${APP_PASSWORD_ENV}`
    )
    .option('-c, --config <path>', 'path to screenci.config.ts')
    .action(async (options: Record<string, unknown>) => {
      await runPullLoginCommand(
        { config: options['config'] as string | undefined },
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
    fetchAppLogin,
    persistAppLogin: (envFilePath, login, options) =>
      persistAppLogin(envFilePath, login, options),
    logger,
  }
}
