import type { CliCredential } from './anonSession.js'
import { SECRET_HEADER } from './anonSession.js'
import type { RunnerKind } from './git.js'

/**
 * Run bookkeeping shared by `preview` and `export`: whether a run stores its
 * video files (see fileSync.ts), the island credential check, and the
 * run-complete report. Every network call here is best effort: a failure
 * never fails the run.
 */

export interface SourceSyncLogger {
  info(message: string): void
  warn(message: string): void
}

export interface SourceSyncDeps {
  fetchFn: typeof fetch
  logger: SourceSyncLogger
}

/**
 * Whether preview/export should store the recorded videos' files for this
 * config: always, unless the config opts out with `uploadSources: false`.
 * The stored files are what the web app shows on the video page, what
 * `screenci setup` pulls onto a machine without a workspace, and what a
 * hosted run records from.
 */
export function shouldUploadSources(config: {
  uploadSources?: boolean
}): boolean {
  return config.uploadSources !== false
}

export type IslandCredentialCheck =
  { ok: true } | { ok: false; message: string }

/**
 * Refuses a project-scoped secret that pins a different project than the
 * island's `projectId`: a `.env` copied between islands would otherwise send
 * this island's recordings (and sources) to the other project silently. An
 * org-wide secret, an anonymous credential, or an unreachable backend pass
 * (the upload itself authenticates again).
 */
export async function verifyIslandCredential(
  params: { apiUrl: string; credential: CliCredential; projectId: string },
  deps: Pick<SourceSyncDeps, 'fetchFn'>
): Promise<IslandCredentialCheck> {
  if (params.credential.header !== SECRET_HEADER) return { ok: true }
  type WhoAmI = { projectId?: unknown; projectName?: unknown }
  let body: WhoAmI | null = null
  try {
    const response = await deps.fetchFn(`${params.apiUrl}/cli/whoami`, {
      headers: { [params.credential.header]: params.credential.value },
    })
    if (!response.ok) return { ok: true }
    body = (await response.json()) as WhoAmI
  } catch {
    return { ok: true }
  }
  const pinnedProjectId = body?.projectId
  if (
    typeof pinnedProjectId !== 'string' ||
    pinnedProjectId === params.projectId
  ) {
    return { ok: true }
  }
  const pinnedProjectName = body?.projectName
  const pinnedName =
    typeof pinnedProjectName === 'string' ? ` ("${pinnedProjectName}")` : ''
  return {
    ok: false,
    message:
      `The SCREENCI_SECRET in this workspace belongs to another project${pinnedName}, not to this one (projectId ${params.projectId}). ` +
      'Run `screenci setup <code>` for this project, or remove the copied secret from the env file.',
  }
}

export type RunCompleteKind = 'preview' | 'export'

/**
 * Tells the service a run finished so the web dialog that produced a setup
 * prompt can open the result. Swallows every failure.
 */
export async function notifyRunComplete(
  params: {
    apiUrl: string
    credential: CliCredential
    recordId: string
    kind: RunCompleteKind
    /** Where this CLI runs; a CI setup code completes only on a CI run. */
    runner?: RunnerKind
    verbose: boolean
  },
  deps: Pick<SourceSyncDeps, 'fetchFn' | 'logger'>
): Promise<void> {
  if (params.credential.header !== SECRET_HEADER) return
  try {
    const response = await deps.fetchFn(`${params.apiUrl}/cli/run-complete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [params.credential.header]: params.credential.value,
      },
      body: JSON.stringify({
        recordId: params.recordId,
        kind: params.kind,
        ...(params.runner !== undefined ? { runner: params.runner } : {}),
      }),
    })
    if (params.verbose) {
      deps.logger.info(
        response.ok
          ? 'Reported the finished run to ScreenCI.'
          : `Run-complete report answered ${response.status}; ignoring.`
      )
    }
  } catch (err) {
    if (params.verbose) {
      deps.logger.info(
        `Run-complete report failed (${err instanceof Error ? err.message : String(err)}); ignoring.`
      )
    }
  }
}

/** Env var that fixes the run's `recordId` (set by `screenci ci` and the hosted runner). */
export const SCREENCI_RECORD_ID_ENV = 'SCREENCI_RECORD_ID'

export const RECORD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/

/**
 * The run's `recordId`: `SCREENCI_RECORD_ID` when it holds a plausible id
 * (so a caller that announced the run can link it to its uploads), otherwise
 * a fresh one.
 */
export function resolveRunRecordId(
  env: NodeJS.ProcessEnv,
  generate: () => string
): string {
  const fixed = env[SCREENCI_RECORD_ID_ENV]?.trim()
  if (fixed !== undefined && RECORD_ID_PATTERN.test(fixed)) return fixed
  return generate()
}
