import type { CliCredential } from './anonSession.js'
import { SECRET_HEADER } from './anonSession.js'
import type { GitMetadata } from './git.js'
import {
  collectSourceBundle,
  parseSourceBundleFiles,
  type SourceBundleFile,
  type SourceBundleFs,
  type SourceBundleSkip,
} from './sourceBundle.js'

/**
 * Keeps the service's copy of a service-managed island's sources current.
 * `preview` and `export` call `ensureSourceBundleUploaded` before recording
 * and `notifyRunComplete` after a successful upload run; `screenci start`
 * calls `fetchLatestSourceBundle` to pull the sources onto a machine.
 *
 * Both uploads are best effort by contract: a failure warns and the run goes
 * on (the next run retries), and run-complete never surfaces at all. Only a
 * real secret can sync (the endpoints sit behind the secret gate), so an
 * anonymous preview skips silently.
 */

export interface SourceSyncLogger {
  info(message: string): void
  warn(message: string): void
}

export interface SourceSyncDeps {
  fetchFn: typeof fetch
  logger: SourceSyncLogger
  fs: SourceBundleFs
  gitMetadata: () => GitMetadata
}

/** Whether preview/export should sync sources for this config. */
export function shouldUploadSources(config: {
  projectId?: string
  uploadSources?: boolean
}): boolean {
  return config.uploadSources === true || typeof config.projectId === 'string'
}

export function formatSkippedSourceFiles(
  skipped: readonly SourceBundleSkip[]
): string {
  return skipped
    .map((skip) => {
      switch (skip.reason) {
        case 'binary':
          return `${skip.path} (binary media: uploaded separately with the recording)`
        case 'too-large':
          return `${skip.path} (larger than the per-file limit)`
        case 'total-cap':
          return `${skip.path} (bundle size limit reached)`
        default: {
          const exhaustive: never = skip.reason
          throw new Error(`Unhandled skip reason: ${String(exhaustive)}`)
        }
      }
    })
    .join(', ')
}

export interface EnsureSourceBundleParams {
  islandDir: string
  apiUrl: string
  credential: CliCredential
  projectName: string
  verbose: boolean
}

/**
 * Uploads the island sources unless the service already has this exact
 * bundle. Returns the server's bundle id to stamp on the run's uploads, or
 * null when nothing was synced (anonymous credential, or any failure).
 */
export async function ensureSourceBundleUploaded(
  params: EnsureSourceBundleParams,
  deps: SourceSyncDeps
): Promise<string | null> {
  if (params.credential.header !== SECRET_HEADER) {
    if (params.verbose) {
      deps.logger.info(
        'Skipping source upload: anonymous previews keep their sources local.'
      )
    }
    return null
  }
  const headers = {
    'Content-Type': 'application/json',
    [params.credential.header]: params.credential.value,
  }

  try {
    const { bundle, skipped } = await collectSourceBundle(
      params.islandDir,
      deps.fs
    )
    const notableSkips = skipped.filter((skip) => skip.reason !== 'binary')
    if (notableSkips.length > 0) {
      deps.logger.warn(
        `Some source files were left out of the upload: ${formatSkippedSourceFiles(notableSkips)}`
      )
    }
    if (params.verbose) {
      deps.logger.info(
        `Source bundle: ${bundle.fileCount} files, ${bundle.byteSize} bytes, hash ${bundle.hash.slice(0, 12)}`
      )
    }

    const checkResponse = await deps.fetchFn(
      `${params.apiUrl}/cli/sources/check`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          hash: bundle.hash,
          projectName: params.projectName,
        }),
      }
    )
    if (checkResponse.ok) {
      const check = (await checkResponse.json().catch(() => null)) as {
        exists?: boolean
        sourceBundleId?: string
      } | null
      if (check?.exists === true && typeof check.sourceBundleId === 'string') {
        if (params.verbose) {
          deps.logger.info('Source bundle already uploaded; reusing it.')
        }
        return check.sourceBundleId
      }
    } else {
      deps.logger.warn(
        `Could not check the uploaded sources (${checkResponse.status}); uploading anyway.`
      )
    }

    const git = deps.gitMetadata()
    const uploadResponse = await deps.fetchFn(`${params.apiUrl}/cli/sources`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        hash: bundle.hash,
        files: bundle.files,
        projectName: params.projectName,
        ...(git.commit !== undefined ? { commit: git.commit } : {}),
        ...(git.isDirty !== undefined ? { isDirty: git.isDirty } : {}),
      }),
    })
    if (!uploadResponse.ok) {
      const text = await uploadResponse.text().catch(() => '')
      deps.logger.warn(
        `Could not upload the island sources (${uploadResponse.status}${text ? `: ${text}` : ''}). The web app keeps the previous copy; the next run retries.`
      )
      return null
    }
    const uploaded = (await uploadResponse.json().catch(() => null)) as {
      sourceBundleId?: string
    } | null
    if (typeof uploaded?.sourceBundleId !== 'string') {
      deps.logger.warn('Source upload returned an unexpected response.')
      return null
    }
    if (params.verbose) {
      deps.logger.info(
        `Uploaded the island sources (${bundle.fileCount} files).`
      )
    }
    return uploaded.sourceBundleId
  } catch (err) {
    deps.logger.warn(
      `Could not upload the island sources: ${err instanceof Error ? err.message : String(err)}. The next run retries.`
    )
    return null
  }
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
      'Run `screenci start <code>` for this project, or remove the copied secret from the env file.',
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
      body: JSON.stringify({ recordId: params.recordId, kind: params.kind }),
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

export type FetchLatestSourceBundleResult =
  | { ok: true; files: SourceBundleFile[]; bundleId: string | null }
  | { ok: false; status: 'none' | 'error'; message: string }

/** Pulls the project's latest uploaded sources (for `screenci start`). */
export async function fetchLatestSourceBundle(
  params: { apiUrl: string; secret: string; projectName?: string },
  fetchFn: typeof fetch
): Promise<FetchLatestSourceBundleResult> {
  const url = new URL(`${params.apiUrl}/cli/sources/latest`)
  if (params.projectName !== undefined) {
    url.searchParams.set('projectName', params.projectName)
  }
  let response: Response
  try {
    response = await fetchFn(url.toString(), {
      headers: { [SECRET_HEADER]: params.secret },
    })
  } catch (err) {
    return {
      ok: false,
      status: 'error',
      message: `Could not reach the ScreenCI backend: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
  if (response.status === 404) {
    await response.text().catch(() => '')
    return {
      ok: false,
      status: 'none',
      message: 'No sources have been uploaded for this project yet.',
    }
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    return {
      ok: false,
      status: 'error',
      message: `Fetching the sources failed with status ${response.status}${text ? `: ${text}` : ''}`,
    }
  }
  let raw: unknown
  try {
    raw = await response.json()
  } catch {
    return {
      ok: false,
      status: 'error',
      message: 'Source bundle response is not JSON',
    }
  }
  try {
    return {
      ok: true,
      files: parseSourceBundleFiles(raw),
      bundleId: response.headers.get('X-ScreenCI-Source-Bundle-Id'),
    }
  } catch (err) {
    return {
      ok: false,
      status: 'error',
      message: err instanceof Error ? err.message : String(err),
    }
  }
}
