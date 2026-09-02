import type { Command } from 'commander'
import pc from 'picocolors'
import { SECRET_HEADER } from './anonSession.js'
import type { IslandCredentials } from './aiContextCommands.js'
import type { StartGit } from './repo.js'

/**
 * `screenci merge-complete`: the last step of the "Move to repository" flow.
 * `screenci start` (merge code) pulled the project's sources into the
 * repository and left `.screenci/pending-merge.json` in the workspace naming
 * the source bundle it pulled. Once the agent committed and pushed, this
 * command reports the commit (and pull request) so ScreenCI marks the bundle
 * as merged and flips the project to repository-managed.
 */

export const PENDING_MERGE_FILE = '.screenci/pending-merge.json'

export type PendingMerge = { sourceBundleId: string; gitUrl: string }

export function parsePendingMerge(raw: string): PendingMerge | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (
      typeof parsed.sourceBundleId === 'string' &&
      typeof parsed.gitUrl === 'string'
    ) {
      return { sourceBundleId: parsed.sourceBundleId, gitUrl: parsed.gitUrl }
    }
  } catch {
    // fall through
  }
  return null
}

export interface MergeCompleteDeps {
  fetchFn: typeof fetch
  loadCredentials: (
    configPath: string | undefined
  ) => Promise<IslandCredentials>
  /** Reads a file relative to the island directory; null when absent. */
  readIslandFile: (
    islandDir: string,
    relativePath: string
  ) => Promise<string | null>
  removeIslandFile: (islandDir: string, relativePath: string) => Promise<void>
  git: Pick<StartGit, 'remoteUrl' | 'headCommit' | 'currentBranch'>
  logger: { info(message: string): void; warn(message: string): void }
}

export class MergeCompleteError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MergeCompleteError'
  }
}

export type MergeCompleteOptions = {
  config?: string | undefined
  commit?: string | undefined
  pr?: string | undefined
  branch?: string | undefined
  bundle?: string | undefined
  gitUrl?: string | undefined
}

export type MergeCompleteResult = {
  projectId: string
  sourceBundleId: string
  commit: string
  gitUrl: string
  prUrl: string | null
  branch: string | null
}

export async function runMergeCompleteCommand(
  options: MergeCompleteOptions,
  deps: MergeCompleteDeps
): Promise<MergeCompleteResult> {
  const creds = await deps.loadCredentials(options.config)
  const islandDir = creds.islandDir
  const pendingRaw = await deps.readIslandFile(islandDir, PENDING_MERGE_FILE)
  const pending = pendingRaw !== null ? parsePendingMerge(pendingRaw) : null

  const sourceBundleId = options.bundle ?? pending?.sourceBundleId
  if (sourceBundleId === undefined) {
    throw new MergeCompleteError(
      `No pending merge found (${PENDING_MERGE_FILE} is missing). Run this from the workspace \`screenci start\` prepared with a "Move to repository" code, or pass --bundle <sourceBundleId>.`
    )
  }
  const gitUrl =
    options.gitUrl ?? pending?.gitUrl ?? (await deps.git.remoteUrl(islandDir))
  if (gitUrl === null || gitUrl === undefined) {
    throw new MergeCompleteError(
      'Could not determine the repository URL: pass --git-url <url>.'
    )
  }
  const commit = options.commit ?? (await deps.git.headCommit(islandDir))
  if (commit === null || commit === undefined) {
    throw new MergeCompleteError(
      'Could not read the current commit: commit the sources first, or pass --commit <sha>.'
    )
  }
  if (!/^[0-9a-f]{7,40}$/i.test(commit)) {
    throw new MergeCompleteError(`"${commit}" is not a commit hash.`)
  }
  const branch = options.branch ?? (await deps.git.currentBranch(islandDir))

  let response: Response
  try {
    response = await deps.fetchFn(`${creds.apiUrl}/cli/dev/merge-complete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [SECRET_HEADER]: creds.secret,
      },
      body: JSON.stringify({
        sourceBundleId,
        gitUrl,
        commit,
        ...(branch !== null && branch !== undefined ? { branch } : {}),
        ...(options.pr !== undefined ? { prUrl: options.pr } : {}),
      }),
    })
  } catch (err) {
    throw new MergeCompleteError(
      `Could not reach ScreenCI: ${err instanceof Error ? err.message : String(err)}`
    )
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new MergeCompleteError(
      `Reporting the merge failed with status ${response.status}${text ? `: ${text}` : ''}`
    )
  }
  const body = (await response.json().catch(() => ({}))) as {
    projectId?: unknown
  }
  const projectId = typeof body.projectId === 'string' ? body.projectId : ''
  await deps.removeIslandFile(islandDir, PENDING_MERGE_FILE)

  const result: MergeCompleteResult = {
    projectId,
    sourceBundleId,
    commit,
    gitUrl,
    prUrl: options.pr ?? null,
    branch: branch ?? null,
  }
  deps.logger.info(
    `${pc.green('✔')} ScreenCI now treats "${creds.projectName}" as repository-managed (${gitUrl} at ${commit.slice(0, 8)}). Versions recorded from these sources show "in repository".`
  )
  deps.logger.info(JSON.stringify({ status: 'merged', ...result }))
  return result
}

export function registerMergeCompleteCommand(
  program: Command,
  deps: MergeCompleteDeps
): Command {
  return program
    .command('merge-complete')
    .description(
      'Report that the sources pulled by a "Move to repository" code were committed to the repository'
    )
    .option('-c, --config <path>', 'path to screenci.config.ts')
    .option('--commit <sha>', 'the commit (default: the current HEAD)')
    .option('--pr <url>', 'the pull request URL')
    .option('--branch <name>', 'the branch (default: the current branch)')
    .option('--bundle <sourceBundleId>', 'the pulled source bundle id')
    .option('--git-url <url>', 'the repository URL (default: origin)')
    .action(async (options: Record<string, unknown>) => {
      await runMergeCompleteCommand(
        {
          config: options['config'] as string | undefined,
          commit: options['commit'] as string | undefined,
          pr: options['pr'] as string | undefined,
          branch: options['branch'] as string | undefined,
          bundle: options['bundle'] as string | undefined,
          gitUrl: options['gitUrl'] as string | undefined,
        },
        deps
      )
    })
}
