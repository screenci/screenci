import type { CliCredential } from './anonSession.js'
import { SECRET_HEADER } from './anonSession.js'
import {
  collectProjectFiles,
  toManifest,
  type LocalProjectFile,
  type LocalProjectFileSkip,
  type ProjectFilesFs,
  projectFileAbsolutePath,
} from './localProjectFiles.js'
import {
  checkSingleVideoScript,
  classifyProjectFile,
  isSha256Hex,
  projectFilePathProblem,
  selectProjectFiles,
  type ManifestEntry,
} from './projectFiles.js'

/**
 * Per-file source storage. After a `preview` / `export` run records, every
 * recorded video whose script follows the layout convention (one video per
 * `recordings/<slug>.screenci.ts`) has the files it needs stored: each file is
 * hashed, the service says which hashes it lacks, only those are uploaded,
 * and a commit makes them the video's current files. Each recording upload
 * carries its video's manifest (paths and hashes) so the web app knows which
 * files produced it.
 *
 * Best effort by contract: a failure warns and the recording still uploads.
 * Scripts that do not follow the convention are simply not stored (one
 * warning per run). Only a real secret can sync; an anonymous preview skips.
 */

export interface FileSyncLogger {
  info(message: string): void
  warn(message: string): void
}

export interface FileSyncDeps {
  fetchFn: typeof fetch
  logger: FileSyncLogger
  fs: ProjectFilesFs
}

/** One stored video: its slug, title and the files it needs. */
export interface VideoFileSelection {
  slug: string
  title: string
  /** Island-relative path of the script (`recordings/<slug>.screenci.ts`). */
  scriptPath: string
  files: LocalProjectFile[]
}

export interface RunFileSyncPlan {
  /** Keyed by the script's island-relative path (`metadata.sourceFilePath`). */
  videos: Map<string, VideoFileSelection>
  /** Scripts that are not stored, with why (for the one warning per run). */
  notStored: Array<{ path: string; reason: NotStoredReason }>
  skipped: LocalProjectFileSkip[]
}

export type NotStoredReason =
  'layout' | 'no-title' | 'several-titles' | 'unreadable'

export const NOT_STORED_HINT =
  'not stored: put one video per recordings/<name>.screenci.ts to edit it from the app or run it hosted'

export function formatNotStoredWarning(
  notStored: RunFileSyncPlan['notStored']
): string {
  const lines = notStored.map(({ path, reason }) => {
    switch (reason) {
      case 'layout':
        return `  ${path} (not at recordings/<name>.screenci.ts)`
      case 'no-title':
        return `  ${path} (no video title found)`
      case 'several-titles':
        return `  ${path} (declares several videos)`
      case 'unreadable':
        return `  ${path} (could not be read)`
      default: {
        const exhaustive: never = reason
        throw new Error(`Unhandled reason: ${String(exhaustive)}`)
      }
    }
  })
  return `Some video scripts are ${NOT_STORED_HINT}. Their recordings still upload.\n${lines.join('\n')}`
}

/**
 * Works out, from disk only, which recorded scripts are stored and the files
 * each one needs. Pure with respect to the network, so the manifests exist
 * even when the upload that follows fails.
 */
export async function planRunFileSync(
  params: { islandDir: string; sourceFilePaths: readonly string[] },
  fs: ProjectFilesFs
): Promise<RunFileSyncPlan> {
  const notStored: RunFileSyncPlan['notStored'] = []
  const scripts: Array<{ path: string; slug: string; title: string }> = []
  for (const path of [...new Set(params.sourceFilePaths)].sort()) {
    const fileClass = classifyProjectFile(path)
    if (fileClass === null || fileClass.kind !== 'script') {
      notStored.push({ path, reason: 'layout' })
      continue
    }
    let source: string
    try {
      source = (
        await fs.readFile(projectFileAbsolutePath(params.islandDir, path))
      ).toString('utf-8')
    } catch {
      notStored.push({ path, reason: 'unreadable' })
      continue
    }
    const check = checkSingleVideoScript(source)
    if (!check.ok) {
      notStored.push({
        path,
        reason: check.reason === 'none' ? 'no-title' : 'several-titles',
      })
      continue
    }
    scripts.push({ path, slug: fileClass.slug, title: check.title })
  }

  const videos = new Map<string, VideoFileSelection>()
  if (scripts.length === 0) return { videos, notStored, skipped: [] }
  const collected = await collectProjectFiles(
    params.islandDir,
    scripts.map((script) => script.slug),
    fs
  )
  for (const script of scripts) {
    videos.set(script.path, {
      slug: script.slug,
      title: script.title,
      scriptPath: script.path,
      files: selectProjectFiles(collected.files, [script.slug]),
    })
  }
  return { videos, notStored, skipped: collected.skipped }
}

/** The per-recording manifests a plan yields, keyed like `plan.videos`. */
export function manifestsOf(
  plan: RunFileSyncPlan
): Map<string, ManifestEntry[]> {
  const manifests = new Map<string, ManifestEntry[]>()
  for (const [path, video] of plan.videos) {
    manifests.set(path, toManifest(video.files))
  }
  return manifests
}

export interface SyncProjectFilesParams {
  apiUrl: string
  credential: CliCredential
  projectName: string
  verbose: boolean
}

export type SyncProjectFilesResult = {
  uploadedBlobs: number
  committedVideos: string[]
  failedVideos: string[]
}

const CHECK_BATCH_SIZE = 1000

type CommitEntry = { path: string; hash: string; byteSize: number }

export type CommitOutcome =
  | { kind: 'ok' }
  /** 403: the credential may not change these (root) files. */
  | { kind: 'developer-only'; paths: string[] }
  | { kind: 'failed'; message: string }

/** `POST /cli/files/commit` for one video; never throws on an HTTP error. */
async function commitVideoFiles(
  params: SyncProjectFilesParams,
  video: VideoFileSelection,
  entries: readonly CommitEntry[],
  deps: Pick<FileSyncDeps, 'fetchFn'>
): Promise<CommitOutcome> {
  const response = await deps.fetchFn(`${params.apiUrl}/cli/files/commit`, {
    method: 'POST',
    headers: {
      [params.credential.header]: params.credential.value,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      projectName: params.projectName,
      videoSlug: video.slug,
      videoTitle: video.title,
      entries,
    }),
  })
  if (response.ok) {
    await response.text().catch(() => '')
    return { kind: 'ok' }
  }
  const text = await response.text().catch(() => '')
  if (response.status === 403) {
    let body: { error?: unknown; paths?: unknown } | null = null
    try {
      body = JSON.parse(text) as { error?: unknown; paths?: unknown }
    } catch {
      body = null
    }
    if (body?.error === 'developer-only') {
      const paths = Array.isArray(body.paths)
        ? body.paths.filter((path): path is string => typeof path === 'string')
        : []
      return {
        kind: 'developer-only',
        // Without a list, every root file is suspect.
        paths:
          paths.length > 0
            ? paths
            : entries
                .filter(
                  (entry) => classifyProjectFile(entry.path)?.kind === 'root'
                )
                .map((entry) => entry.path),
      }
    }
  }
  return {
    kind: 'failed',
    message: `answered ${response.status}${text ? `: ${text.slice(0, 300)}` : ''}`,
  }
}

/**
 * The entries with each refused path replaced by ScreenCI's current entry
 * for it, or left out when ScreenCI has none.
 */
async function withServerRootEntries(
  params: SyncProjectFilesParams,
  slug: string,
  entries: readonly CommitEntry[],
  refusedPaths: readonly string[],
  fetchFn: typeof fetch
): Promise<CommitEntry[]> {
  const refused = new Set(refusedPaths)
  const remote = await fetchRemoteSelection(
    {
      apiUrl: params.apiUrl,
      secret: params.credential.value,
      projectName: params.projectName,
      slugs: [slug],
    },
    fetchFn
  )
  if (!remote.ok && remote.status === 'error') {
    throw new Error(remote.message)
  }
  const remoteByPath = new Map(
    (remote.ok ? remote.entries : []).map((entry) => [entry.path, entry])
  )
  return entries.flatMap((entry) => {
    if (!refused.has(entry.path)) return [entry]
    const current = remoteByPath.get(entry.path)
    return current === undefined
      ? []
      : [{ path: current.path, hash: current.hash, byteSize: current.byteSize }]
  })
}

async function readErrorText(response: Response): Promise<string> {
  const text = await response.text().catch(() => '')
  return text ? `: ${text.slice(0, 300)}` : ''
}

/**
 * Stores the planned files: `POST /cli/files/check`, `PUT
 * /cli/files/blob/:hash` for each missing hash, then one `POST
 * /cli/files/commit` per video. Never throws; failures warn.
 */
export async function syncProjectFiles(
  params: SyncProjectFilesParams,
  plan: RunFileSyncPlan,
  deps: Pick<FileSyncDeps, 'fetchFn' | 'logger'>
): Promise<SyncProjectFilesResult> {
  const result: SyncProjectFilesResult = {
    uploadedBlobs: 0,
    committedVideos: [],
    failedVideos: [],
  }
  if (params.credential.header !== SECRET_HEADER || plan.videos.size === 0) {
    return result
  }
  const headers = { [params.credential.header]: params.credential.value }
  const projectQuery = `projectName=${encodeURIComponent(params.projectName)}`

  const byHash = new Map<string, LocalProjectFile>()
  for (const video of plan.videos.values()) {
    for (const file of video.files) byHash.set(file.hash, file)
  }

  try {
    const hashes = [...byHash.keys()]
    const missing = new Set<string>()
    for (let i = 0; i < hashes.length; i += CHECK_BATCH_SIZE) {
      const response = await deps.fetchFn(`${params.apiUrl}/cli/files/check`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectName: params.projectName,
          hashes: hashes.slice(i, i + CHECK_BATCH_SIZE),
        }),
      })
      if (!response.ok) {
        throw new Error(
          `checking the stored files answered ${response.status}${await readErrorText(response)}`
        )
      }
      const body = (await response.json().catch(() => null)) as {
        missing?: unknown
      } | null
      if (!Array.isArray(body?.missing)) {
        throw new Error('checking the stored files returned no missing list')
      }
      for (const hash of body.missing) {
        if (typeof hash === 'string' && byHash.has(hash)) missing.add(hash)
      }
    }

    for (const hash of missing) {
      const file = byHash.get(hash)!
      const response = await deps.fetchFn(
        `${params.apiUrl}/cli/files/blob/${hash}?${projectQuery}`,
        {
          method: 'PUT',
          headers: {
            ...headers,
            'Content-Type': 'application/octet-stream',
            'Content-Length': String(file.byteSize),
          },
          body: new Uint8Array(file.bytes),
        }
      )
      if (!response.ok) {
        throw new Error(
          `uploading ${file.path} answered ${response.status}${await readErrorText(response)}`
        )
      }
      await response.text().catch(() => '')
      result.uploadedBlobs += 1
    }
  } catch (err) {
    deps.logger.warn(
      `Could not store the video files: ${err instanceof Error ? err.message : String(err)}. The recordings still upload; the next run retries.`
    )
    result.failedVideos = [...plan.videos.values()].map((video) => video.title)
    return result
  }

  const developerOnlyPaths = new Set<string>()
  for (const video of plan.videos.values()) {
    try {
      const entries = video.files.map((file) => ({
        path: file.path,
        hash: file.hash,
        byteSize: file.byteSize,
      }))
      let outcome = await commitVideoFiles(params, video, entries, deps)
      if (outcome.kind === 'developer-only') {
        // The credential may not change root files: keep ScreenCI's current
        // copies of the refused paths (or leave them out) and store the rest.
        for (const path of outcome.paths) developerOnlyPaths.add(path)
        const retryEntries = await withServerRootEntries(
          params,
          video.slug,
          entries,
          outcome.paths,
          deps.fetchFn
        )
        outcome = await commitVideoFiles(params, video, retryEntries, deps)
      }
      switch (outcome.kind) {
        case 'ok':
          result.committedVideos.push(video.title)
          break
        case 'developer-only':
          throw new Error('root files need a developer')
        case 'failed':
          throw new Error(outcome.message)
        default: {
          const exhaustive: never = outcome
          throw new Error(`Unhandled commit outcome: ${String(exhaustive)}`)
        }
      }
    } catch (err) {
      result.failedVideos.push(video.title)
      deps.logger.warn(
        `Could not store the files of "${video.title}" (${err instanceof Error ? err.message : String(err)}). The recording still uploads; the next run retries.`
      )
    }
  }
  if (developerOnlyPaths.size > 0) {
    deps.logger.warn(
      `Changes to ${[...developerOnlyPaths].sort().join(', ')} were not stored: root files can only be changed by an organisation developer or admin (use their key, or ask them to run this). ScreenCI keeps its current copies.`
    )
  }
  if (params.verbose) {
    deps.logger.info(
      `Stored the files of ${result.committedVideos.length} video(s) (${result.uploadedBlobs} new file(s) uploaded).`
    )
  }
  return result
}

/**
 * The whole post-record step: plan from disk, warn once about scripts that
 * are not stored, store the files (best effort), and return each recorded
 * script's manifest for its upload. Anonymous credentials get no manifests.
 */
export async function prepareRunSources(
  params: SyncProjectFilesParams & {
    islandDir: string
    sourceFilePaths: readonly string[]
    /**
     * False on a hosted run: its upload key can never write project files
     * (the server refuses it), so only the manifests are computed.
     */
    storeFiles?: boolean
  },
  deps: FileSyncDeps
): Promise<Map<string, ManifestEntry[]>> {
  if (params.credential.header !== SECRET_HEADER) {
    if (params.verbose) {
      deps.logger.info(
        'Skipping file storage: anonymous previews keep their files local.'
      )
    }
    return new Map()
  }
  let plan: RunFileSyncPlan
  try {
    plan = await planRunFileSync(
      {
        islandDir: params.islandDir,
        sourceFilePaths: params.sourceFilePaths,
      },
      deps.fs
    )
  } catch (err) {
    deps.logger.warn(
      `Could not read the video files: ${err instanceof Error ? err.message : String(err)}. The recordings still upload.`
    )
    return new Map()
  }
  if (plan.notStored.length > 0) {
    deps.logger.warn(formatNotStoredWarning(plan.notStored))
  }
  if (plan.skipped.length > 0) {
    deps.logger.warn(
      `Some files are larger than the per-file limit and were not stored: ${plan.skipped.map((skip) => skip.path).join(', ')}`
    )
  }
  const manifests = manifestsOf(plan)
  if (params.storeFiles === false) {
    if (params.verbose) {
      deps.logger.info(
        'Skipping file storage on the hosted runner: the files came from ScreenCI.'
      )
    }
    return manifests
  }
  await syncProjectFiles(params, plan, deps)
  return manifests
}

/** One head row the service holds (`GET /cli/files/select`). */
export interface RemoteProjectFile {
  path: string
  hash: string
  byteSize: number
  kind: string
}

export type FetchRemoteSelectionResult =
  | { ok: true; entries: RemoteProjectFile[] }
  | { ok: false; status: 'none' | 'error'; message: string }

function parseRemoteEntries(raw: unknown): RemoteProjectFile[] {
  const entries = (raw as { entries?: unknown } | null)?.entries
  if (!Array.isArray(entries)) {
    throw new Error('The stored files response is malformed')
  }
  return entries.map((entry: unknown) => {
    const e = entry as Record<string, unknown> | null
    if (
      e === null ||
      typeof e !== 'object' ||
      typeof e.path !== 'string' ||
      typeof e.hash !== 'string' ||
      !isSha256Hex(e.hash)
    ) {
      throw new Error('The stored files response is malformed')
    }
    const problem = projectFilePathProblem(e.path)
    if (problem !== null) {
      throw new Error(
        `The service listed an unsafe path "${e.path}": ${problem}`
      )
    }
    return {
      path: e.path,
      hash: e.hash,
      byteSize: typeof e.byteSize === 'number' ? e.byteSize : 0,
      kind: typeof e.kind === 'string' ? e.kind : 'unknown',
    }
  })
}

/**
 * The service's current files for the given videos (`GET
 * /cli/files/select?slugs=`). Without slugs, every current file of the
 * project.
 */
export async function fetchRemoteSelection(
  params: {
    apiUrl: string
    secret: string
    projectName?: string
    slugs?: readonly string[]
  },
  fetchFn: typeof fetch
): Promise<FetchRemoteSelectionResult> {
  const url = new URL(`${params.apiUrl}/cli/files/select`)
  if (params.projectName !== undefined) {
    url.searchParams.set('projectName', params.projectName)
  }
  if (params.slugs !== undefined) {
    url.searchParams.set('slugs', params.slugs.join(','))
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
      message: 'No files have been stored for this project yet.',
    }
  }
  if (!response.ok) {
    return {
      ok: false,
      status: 'error',
      message: `Fetching the stored files failed with status ${response.status}${await readErrorText(response)}`,
    }
  }
  try {
    const entries = parseRemoteEntries(await response.json())
    if (entries.length === 0) {
      return {
        ok: false,
        status: 'none',
        message: 'No files have been stored for this project yet.',
      }
    }
    return { ok: true, entries }
  } catch (err) {
    return {
      ok: false,
      status: 'error',
      message: err instanceof Error ? err.message : String(err),
    }
  }
}

/** Downloads one stored file (`GET /cli/files/blob/:hash`). Throws on failure. */
export async function fetchProjectFileBlob(
  params: { apiUrl: string; secret: string; projectName?: string },
  hash: string,
  fetchFn: typeof fetch
): Promise<Uint8Array> {
  if (!isSha256Hex(hash)) throw new Error(`Not a file hash: ${hash}`)
  const url = new URL(`${params.apiUrl}/cli/files/blob/${hash}`)
  if (params.projectName !== undefined) {
    url.searchParams.set('projectName', params.projectName)
  }
  const response = await fetchFn(url.toString(), {
    headers: { [SECRET_HEADER]: params.secret },
  })
  if (!response.ok) {
    throw new Error(
      `Fetching a stored file failed with status ${response.status}${await readErrorText(response)}`
    )
  }
  return new Uint8Array(await response.arrayBuffer())
}
