import { spawn } from 'child_process'
import type { ChildProcess } from 'child_process'
import { createReadStream } from 'fs'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
} from 'fs'
import { createHash, randomUUID } from 'crypto'
import { createRequire } from 'module'
import {
  appendFile,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'fs/promises'
import {
  delimiter,
  dirname,
  isAbsolute,
  relative as pathRelative,
  resolve,
} from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { Command, CommanderError } from 'commander'
import { confirm } from '@inquirer/prompts'
import pc from 'picocolors'
import { logger } from './src/logger.js'
import {
  determinePackageManager,
  initToggleOptionsFromCommander,
  parsePackageManager,
  registerInitToggleOptions,
  runInit,
} from './src/init.js'
import type {
  RecordingCustomVoiceRef,
  RecordingData,
  VideoCueTranslationFile,
} from './src/events.js'
import {
  SCREENCI_DISABLE_RECORDING_TIMINGS_ENV,
  SCREENCI_MOCK_RECORD_ENV,
  SCREENCI_LANGUAGES_ENV,
  SCREENCI_VALUES_OVERRIDES_ENV,
  SCREENCI_RECORD_OPTIONS_ENV,
  isUploadExistingEnabled,
} from './src/runtimeMode.js'
import { DEFAULT_RECORD_UPLOAD_POLICY } from './src/defaults.js'
import type { VoiceKey } from './src/voices.js'
import type { RecordUploadPolicy, ScreenCIConfig } from './src/types.js'
import {
  findDuplicateTitles,
  formatDuplicateTitlesMessage,
} from './src/titleValidation.js'
import {
  getCliLinkSessionApiUrl,
  getDevBackendUrl,
  getDevFrontendUrl,
  getScreenCISecretsUrl,
  persistScreenCISecret,
} from './src/linkSession.js'
import { OVERLAY_CACHE_DIR_NAME } from './src/htmlRasterizer.js'
import { maybeExtractVoiceSampleAudio } from './src/voiceSampleAudio.js'
import {
  type CliCredential,
  ANON_MAX_VIDEOS_PER_RECORDING,
  ANON_SESSION_FILE,
  ANON_TOKEN_HEADER,
  anonCredential,
  checkAnonSessionStatus,
  deleteAnonSessionFile,
  evaluateAnonRecordingGate,
  formatAnonPostRecordNotice,
  formatAnonTermsNotice,
  getOrCreateAnonToken,
  readAnonSessionRecordUrl,
  saveAnonSessionRecordUrl,
  secretCredential,
} from './src/anonSession.js'

// Re-export the environment-aware URL helpers so existing importers (and tests)
// can keep importing them from the CLI entrypoint.
export { getCliLinkSessionApiUrl, getDevBackendUrl, getDevFrontendUrl }
// Re-exported so test files that mock fs/fs/promises can obtain these via the
// same dynamic `await import('./cli')` they already use, rather than a static
// top-level import — a static import of `./src/anonSession.js` (which imports
// fs) would resolve before the test file's own mock variables initialize.
export { secretCredential, anonCredential } from './src/anonSession.js'

const SCREENCI_MOCK_RECORD_DOCS_URL =
  'https://screenci.com/docs/reference/cli/#--mock-record'
const SCREENCI_RECORD_DOCS_URL =
  'https://screenci.com/docs/reference/cli/#screenci-record'
// Records the recordId of the most recent `screenci record` upload so
// `screenci info` can report exactly the run that was just made.
const SCREENCI_LAST_RECORD_FILE = 'last-record.json'
const SCREENCI_RECORD_LOCK_FILE = '.record.lock'
const SCREENCI_RECORD_LOCK_MAX_AGE_MS = 6 * 60 * 60 * 1000
const require = createRequire(import.meta.url)

type PlaywrightListReportSuite = {
  title?: string
  specs?: Array<{ title: string }>
  suites?: PlaywrightListReportSuite[]
}

type PlaywrightListReport = {
  suites?: PlaywrightListReportSuite[]
  errors?: Array<{
    message?: string
    snippet?: string
  }>
}

type RecordRunLock = {
  pid: number
  startedAt: string
  projectName: string
}

type RecordRunLockFs = {
  mkdir: typeof mkdir
  readFile: typeof readFile
  writeFile: typeof writeFile
  rm: typeof rm
}

type AcquireRecordRunLockDeps = {
  fs: RecordRunLockFs
  clock: () => Date
  isPidAlive: (pid: number) => boolean
  pid: number
  addSignalListener: typeof process.on
  removeSignalListener: typeof process.off
  removeLockSync: (lockPath: string) => void
  maxAgeMs: number
}

/**
 * Reports whether the current session can complete an interactive browser
 * sign-in. A session is interactive only when both stdin and stdout are
 * attached to a terminal and no signal marks the run as automated. This is the
 * proxy for "a human is present to open the sign-in link" — it does not attempt
 * to identify any particular caller (CI, a piped shell, or an automated tool).
 *
 * Dependency-injected so tests can force a value without a real terminal.
 */
export function detectInteractiveSession(
  env: NodeJS.ProcessEnv = process.env,
  stdout: { isTTY?: boolean } = process.stdout,
  stdin: { isTTY?: boolean } = process.stdin
): boolean {
  if (env.SCREENCI_NONINTERACTIVE === '1') return false
  if (env.CI === 'true') return false
  return Boolean(stdout.isTTY) && Boolean(stdin.isTTY)
}

export function collectPlaywrightListTitles(
  suites: readonly PlaywrightListReportSuite[]
): string[] {
  const titles: string[] = []

  const visitSuite = (suite: PlaywrightListReportSuite) => {
    for (const spec of suite.specs ?? []) {
      titles.push(spec.title)
    }
    for (const child of suite.suites ?? []) {
      visitSuite(child)
    }
  }

  for (const suite of suites) {
    visitSuite(suite)
  }

  return titles
}

function parsePlaywrightListReport(stdout: string): PlaywrightListReport {
  return JSON.parse(stdout) as PlaywrightListReport
}

function extractPlaywrightDiscoveryError(output: string): string | null {
  try {
    const report = parsePlaywrightListReport(output)
    const firstError = report.errors?.find(
      (entry) =>
        typeof entry.message === 'string' && entry.message.trim() !== ''
    )

    if (!firstError?.message) {
      return null
    }

    const message = firstError.message.trim()
    const snippet = firstError.snippet?.trim()

    return snippet ? `${message}\n\n${snippet}` : message
  } catch {
    return null
  }
}

function logScreenCISecretGuide(): void {
  logger.info(`Guide: ${pc.cyan(SCREENCI_RECORD_DOCS_URL)}`)
}

function getSuggestedScreenciCommand(
  command: 'record' | 'test',
  flags = ''
): string {
  const suffix = flags ? ` ${flags}` : ''
  const pm = determinePackageManager()
  if (pm === 'pnpm') return `pnpm exec screenci ${command}${suffix}`
  if (pm === 'yarn') return `yarn screenci ${command}${suffix}`
  return `npx screenci ${command}${suffix}`
}

async function collectDiscoveredTestTitles(
  configPath: string,
  additionalArgs: string[],
  env: NodeJS.ProcessEnv
): Promise<string[]> {
  const listArgs = [
    'test',
    '--config',
    configPath,
    ...additionalArgs,
    '--list',
    '--reporter=json',
  ]
  const spawnSpec = resolvePlaywrightSpawnSpec(listArgs, dirname(configPath))

  return await new Promise<string[]>((resolve, reject) => {
    const child = spawn(spawnSpec.command, spawnSpec.args, {
      stdio: ['inherit', 'pipe', 'pipe'],
      ...(spawnSpec.shell !== undefined ? { shell: spawnSpec.shell } : {}),
      ...(spawnSpec.windowsVerbatimArguments !== undefined
        ? {
            windowsVerbatimArguments: spawnSpec.windowsVerbatimArguments,
          }
        : {}),
      env,
    })
    const childSignals = forwardChildSignals(
      child,
      'screenci title validation',
      {
        killTree: process.platform !== 'win32',
        exitParentOnForward: true,
      }
    )

    let stdout = ''
    let stderr = ''
    child.stdout?.setEncoding?.('utf8')
    child.stderr?.setEncoding?.('utf8')
    child.stdout?.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr?.on('data', (chunk) => {
      stderr += chunk
    })

    child.on('close', (code, signal) => {
      const forwardedSignal = childSignals.getForwardedSignal()
      childSignals.cleanup()

      if (forwardedSignal) {
        process.kill(process.pid, forwardedSignal)
        return
      }
      if (signal) {
        process.kill(process.pid, signal)
        return
      }
      if (code !== 0) {
        if (stderr.trim() === '' && stdout.trim() === '') {
          resolve([])
          return
        }
        const parsedDiscoveryError =
          stderr.trim() === '' ? extractPlaywrightDiscoveryError(stdout) : null
        reject(
          new Error(
            stderr.trim() ||
              parsedDiscoveryError ||
              stdout.trim() ||
              'Playwright test discovery failed'
          )
        )
        return
      }

      try {
        if (stdout.trim() === '') {
          resolve([])
          return
        }
        const report = parsePlaywrightListReport(stdout)
        resolve(collectPlaywrightListTitles(report.suites ?? []))
      } catch (error) {
        reject(error)
      }
    })

    child.on('error', (err) => {
      childSignals.cleanup()
      reject(err)
    })
  })
}

async function validateUniqueDiscoveredTestTitles(
  configPath: string,
  additionalArgs: string[],
  env: NodeJS.ProcessEnv
): Promise<void> {
  const titles = await collectDiscoveredTestTitles(
    configPath,
    additionalArgs,
    env
  )
  const duplicates = findDuplicateTitles(titles)

  if (duplicates.length > 0) {
    throw new Error(formatDuplicateTitlesMessage(duplicates))
  }
}

function resolveRecordingFileCandidates(
  filePath: string,
  configDir: string,
  sourceFilePath?: string
): string[] {
  const sourceFileCandidate =
    typeof sourceFilePath === 'string'
      ? resolve(configDir, dirname(sourceFilePath), filePath)
      : null

  return [
    filePath,
    ...(sourceFileCandidate ? [sourceFileCandidate] : []),
    resolve(configDir, 'recordings', filePath),
    resolve(configDir, pathRelative('/app', filePath)),
  ]
}

async function readRecordingFile(
  filePath: string,
  configDir: string,
  sourceFilePath?: string
): Promise<{ buffer: Buffer; resolvedPath: string } | null> {
  for (const candidate of resolveRecordingFileCandidates(
    filePath,
    configDir,
    sourceFilePath
  )) {
    try {
      return { buffer: await readFile(candidate), resolvedPath: candidate }
    } catch {
      // try next candidate
    }
  }
  return null
}

function contentTypeForPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? 'bin'
  const contentTypeMap: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    m4a: 'audio/mp4',
    aac: 'audio/aac',
    svg: 'image/svg+xml',
  }
  return contentTypeMap[ext] ?? 'application/octet-stream'
}

type CustomVoiceRefLike = {
  assetHash?: string
  assetPath: string
  // SHA-256 of the original sample file. The backend keys the clone cache on
  // this so re-encoded uploads (audio extracted from a video) do not re-clone.
  sampleHash?: string
}

/** What an uploaded file actually is, used to label it in the upload log. */
type UploadAssetKind = 'overlay' | 'audio' | 'clip' | 'voice' | 'cursor'

/** Human label per upload kind, shown as `<label> uploaded: <path>`. */
const UPLOAD_ASSET_LABEL: Record<UploadAssetKind, string> = {
  overlay: 'Overlay',
  audio: 'Audio',
  // A `videoCueStart` asset: a media file placed on the narration timeline
  // (e.g. via `narration({ en: { intro: { media } } })`).
  clip: 'Narration',
  voice: 'Voice',
  // A custom cursor image set via `renderOptions.mouse.image`.
  cursor: 'Cursor',
}

type PreparedUploadAsset = {
  kind: UploadAssetKind
  fileHash: string
  path: string
  size: number
  name?: string
  fileBuffer?: Buffer
  contentType?: string
  // Skip the existence check and always push to the server.
  // Used for per-recording ephemeral captures (screen audio) that are never
  // shared across recordings and must not be silently skipped.
  alwaysUpload?: boolean
  // The local file was absent when assets were collected, so its bytes (and, for
  // overlays, its content hash) are not available. The asset's identity must be
  // recovered from a previous upload of this video (matched by path/name) before
  // the recording is started. Once recovered, fileHash/size/contentType are
  // filled in and `assumedUploaded` is set. See resolveMissingUploadAssets.
  needsResolve?: boolean
  // Set once a missing local file has been matched to a previously uploaded
  // asset. The asset is referenced by its known hash with no local bytes; the
  // backend existence check confirms it is still stored.
  assumedUploaded?: boolean
}

type UploadCandidate = {
  entry: string
  videoName: string
  displayVideoName: string
  data: RecordingData
  preparedUploadAssets: PreparedUploadAsset[]
}

export type UploadStudioInfo = { held: true } | { applied: true }

export type StudioUploadNotice = {
  videoName: string
  videoId: string | null
  studio: UploadStudioInfo
}

export function formatStudioUrl(
  appUrl: string,
  projectId: string,
  videoId: string
): string {
  // The video hub resolves `?editor` to the right language page and scrolls it
  // to Editor, so we never need to guess the language in the printed link.
  return `${appUrl}/project/${projectId}/video/${videoId}?editor`
}

type OrgPlan = 'free' | 'starter' | 'business'

type UploadJobResult = {
  projectId: string | null
  videoId: string | null
  hadFailure: boolean
  videoName: string
  failureMessage?: string
  recordId: string
  studio?: UploadStudioInfo
  plan?: OrgPlan
  /** The video needs an ElevenLabs/custom voice but the org has no key stored. */
  elevenLabsKeyMissing?: boolean
  /** Informational, non-error messages from the backend, printed in cyan. */
  notices?: string[]
}

type UploadProgressStatus = 'success' | 'failure' | 'cancelled'

class UploadAssetError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UploadAssetError'
  }
}

class UploadCancelledError extends Error {
  constructor(message = 'Upload cancelled') {
    super(message)
    this.name = 'UploadCancelledError'
  }
}

class PartialUploadError extends Error {
  constructor(message = 'Not all recordings succeeded to upload.') {
    super(message)
    this.name = 'PartialUploadError'
  }
}

class RecordFailureHintError extends Error {
  readonly cause: Error

  constructor(cause: Error) {
    super(cause.message)
    this.name = cause.name
    this.cause = cause
  }
}

function isUploadCancelledError(err: unknown): boolean {
  return (
    err instanceof UploadCancelledError ||
    (err instanceof Error &&
      (err.name === 'AbortError' || err.name === 'UploadCancelledError'))
  )
}

function isPartialUploadError(err: unknown): boolean {
  return err instanceof PartialUploadError
}

function isRecordFailureHintError(err: unknown): err is RecordFailureHintError {
  return err instanceof RecordFailureHintError
}

function isUploadAssetError(err: unknown): boolean {
  return err instanceof UploadAssetError
}

export async function withUploadRetry<T>(
  fn: () => Promise<T>,
  signal: AbortSignal | undefined,
  maxAttempts = 3
): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (isUploadCancelledError(err)) throw err
      lastErr = err
    }
  }
  throw lastErr
}

function formatUploadProgressLine(
  videoName: string,
  status?: UploadProgressStatus
): string {
  switch (status) {
    case undefined:
      return `${pc.cyan('...')} Uploading "${videoName}"`
    case 'success':
      return `${pc.green('✔')} Uploaded "${videoName}"`
    case 'failure':
      return `${pc.red('✖')} Failed to upload "${videoName}"`
    case 'cancelled':
      return `${pc.yellow('!')} Cancelled "${videoName}"`
    default: {
      const exhaustiveCheck: never = status
      return exhaustiveCheck
    }
  }
}

function createUploadProgressReporter(
  videoNames: readonly string[],
  _verbose: boolean
): {
  complete: (index: number, status: UploadProgressStatus) => void
  info: (message: string) => void
} {
  return {
    complete(index, status) {
      logger.info(
        formatUploadProgressLine(videoNames[index] ?? 'unknown', status)
      )
    },
    info(message) {
      logger.info(message)
    },
  }
}

function shouldKeepRecordedArtifacts(): boolean {
  return process.env.DEBUG === 'true'
}

function cleanupUploadedRecordingDir(screenciDir: string, entry: string): void {
  if (shouldKeepRecordedArtifacts()) return

  try {
    rmSync(resolve(screenciDir, entry), { recursive: true, force: true })
  } catch (error) {
    logger.warn(
      `Uploaded recording cleanup failed for "${entry}": ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

async function loadUploadCandidate(
  screenciDir: string,
  entry: string,
  verbose: boolean
): Promise<UploadCandidate | null> {
  const dataJsonPath = resolve(screenciDir, entry, 'data.json')
  if (!existsSync(dataJsonPath)) {
    if (verbose) logger.info(`Skipping "${entry}": no data.json found`)
    return null
  }

  let data: RecordingData
  try {
    const raw = await readFile(dataJsonPath, 'utf-8')
    data = JSON.parse(raw) as RecordingData
  } catch {
    logger.warn(`Failed to read ${dataJsonPath}, skipping`)
    return null
  }

  const videoName = data.metadata?.videoName ?? entry
  const preparedUploadAssets = await collectUploadAssets(
    data,
    resolve(screenciDir, '..')
  )

  // The recording data is annotated with asset hashes later, in
  // uploadRecordingCandidate, after any locally missing assets have been
  // resolved against a previous upload. Annotating here would strip the asset
  // paths the resolve step needs to match on.
  return {
    entry,
    videoName,
    displayVideoName: videoName,
    data,
    preparedUploadAssets,
  }
}

function disambiguateUploadCandidateDisplayNames(
  candidates: UploadCandidate[]
): UploadCandidate[] {
  const counts = new Map<string, number>()
  for (const candidate of candidates) {
    counts.set(candidate.videoName, (counts.get(candidate.videoName) ?? 0) + 1)
  }

  return candidates.map((candidate) => {
    if ((counts.get(candidate.videoName) ?? 0) <= 1) return candidate

    const languages = candidate.data.metadata?.languages
    if (Array.isArray(languages) && languages.length === 1) {
      const [language] = languages
      if (typeof language === 'string' && language.length > 0) {
        return {
          ...candidate,
          displayVideoName: `${candidate.videoName} [${language}]`,
        }
      }
    }

    if (candidate.entry !== candidate.videoName) {
      return { ...candidate, displayVideoName: candidate.entry }
    }

    return candidate
  })
}

async function uploadRecordingCandidate(
  candidate: UploadCandidate,
  screenciDir: string,
  projectName: string,
  apiUrl: string,
  credential: CliCredential,
  verbose: boolean,
  uploadAbort: ReturnType<typeof createUploadAbortController>,
  progressReporter: {
    complete: (index: number, status: UploadProgressStatus) => void
    info: (message: string) => void
  },
  progressIndex: number,
  recordId: string,
  expectedScreenshotCount: number
): Promise<UploadJobResult> {
  const {
    entry,
    videoName,
    displayVideoName,
    data: rawData,
    preparedUploadAssets,
  } = candidate
  let projectId: string | null = null
  let videoId: string | null = null
  let plan: OrgPlan | null = null

  try {
    uploadAbort.throwIfAborted()
    // A screenshot recording uploads its raw page capture (always a PNG) through
    // the same recording endpoint a video uses; the renderer reads those bytes as
    // the capture. Videos upload recording.mp4. Output kind defaults to 'video'.
    const isScreenshot = rawData.output === 'screenshot'
    const recordingFileName = isScreenshot
      ? (rawData.screenshot?.path ?? 'screenshot.png')
      : 'recording.mp4'
    const recordingContentType = isScreenshot ? 'image/png' : 'video/mp4'
    const recordingPath = resolve(screenciDir, entry, recordingFileName)
    if (!existsSync(recordingPath)) {
      progressReporter.complete(progressIndex, 'failure')
      return {
        projectId: null,
        videoId: null,
        hadFailure: true,
        videoName: displayVideoName,
        failureMessage: `Missing ${recordingFileName} for "${displayVideoName}"`,
        recordId,
      }
    }

    // Locally missing assets (e.g. gitignored media on CI) carry no bytes and,
    // for overlays, no hash. Recover their identity from a previous upload of
    // this video before starting, so the recording data references them by hash
    // and the backend existence check confirms they are still stored.
    const unresolved = await resolveMissingUploadAssets(
      preparedUploadAssets,
      projectName,
      videoName,
      apiUrl,
      credential,
      uploadAbort.signal,
      progressReporter
    )
    if (unresolved.length > 0) {
      progressReporter.complete(progressIndex, 'failure')
      return {
        projectId: null,
        videoId: null,
        hadFailure: true,
        videoName: displayVideoName,
        failureMessage: formatUnresolvedAssetMessage(
          displayVideoName,
          unresolved
        ),
        recordId,
      }
    }

    const data = annotateRecordingDataWithAssetHashes(
      rawData,
      preparedUploadAssets
    )

    const recordingHash = await hashFile(recordingPath)
    const startResponse = await withUploadRetry(
      () =>
        fetch(`${apiUrl}/cli/upload/start`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            [credential.header]: credential.value,
          },
          body: JSON.stringify({
            projectName,
            videoName,
            data,
            recordingHash,
            recordId,
            ...(isScreenshot ? { expectedScreenshotCount } : {}),
            expectedAssets: preparedUploadAssets.map((asset) => ({
              fileHash: asset.fileHash,
              size: asset.size,
              path: asset.path,
              ...(typeof asset.contentType === 'string'
                ? { contentType: asset.contentType }
                : {}),
              ...(typeof asset.name === 'string' ? { name: asset.name } : {}),
            })),
          }),
          signal: uploadAbort.signal,
        }),
      uploadAbort.signal
    )

    if (!startResponse.ok) {
      const text = await startResponse.text()
      progressReporter.complete(progressIndex, 'failure')
      // A missing ElevenLabs key fails the render server-side and is reported
      // once in the final summary (see uploadRecordings) as a dedicated error
      // with the Secrets link, so it carries the flag instead of a generic
      // upload-failure message that would duplicate it.
      if (responseFlagsElevenLabsKeyMissing(text)) {
        return {
          projectId: null,
          videoId: null,
          hadFailure: true,
          elevenLabsKeyMissing: true,
          videoName: displayVideoName,
          recordId,
        }
      }
      return {
        projectId: null,
        videoId: null,
        hadFailure: true,
        videoName: displayVideoName,
        failureMessage: formatUploadStartFailureMessage(
          displayVideoName,
          startResponse.status,
          text,
          credential.value
        ),
        recordId,
      }
    }

    const startBody = (await startResponse.json()) as {
      recordingId: string
      projectId: string
      videoId?: string
      studio?: UploadStudioInfo
      plan?: OrgPlan
      dependencyErrors?: Array<{
        targetName: string
        reason: string
        detail: string
      }>
      notices?: string[]
    }
    const { recordingId } = startBody
    projectId = startBody.projectId
    videoId = startBody.videoId ?? null
    plan = startBody.plan ?? null
    const studio = startBody.studio

    // Render-dependency validation failures are reported on the upload response
    // so the author sees them at record time. These are enforced server-side:
    // the render for this video fails with the dependency error until fixed.
    if (startBody.dependencyErrors && startBody.dependencyErrors.length > 0) {
      for (const depError of startBody.dependencyErrors) {
        logger.error(
          `Render dependency error in "${displayVideoName}": ${depError.detail}. This render will fail until it is fixed.`
        )
      }
    }

    // A missing ElevenLabs key is a hard failure returned as an error response
    // (handled in the !startResponse.ok branch above), surfaced once in the
    // final summary where it is not overwritten by the upload spinner.

    if (verbose) {
      logger.info(`recordingId=${recordingId} projectId=${projectId}`)
      logger.info(
        `assets=${preparedUploadAssets.length} recordingHash=${recordingHash ?? 'none'}`
      )
    }

    await uploadAssets(
      preparedUploadAssets,
      apiUrl,
      credential,
      recordingId,
      uploadAbort.signal,
      uploadAbort.throwIfAborted,
      progressReporter
    )

    uploadAbort.throwIfAborted()
    const fileStat = await stat(recordingPath)
    if (verbose) {
      logger.info(
        `Uploading ${recordingFileName} size=${(fileStat.size / 1024 / 1024).toFixed(1)}MB`
      )
    }
    const recordingResponse = await withUploadRetry(async () => {
      const stream = createReadStream(recordingPath)
      const abortStream = () => {
        stream.destroy(
          new UploadCancelledError(`Upload cancelled for "${videoName}"`)
        )
      }
      uploadAbort.signal.addEventListener('abort', abortStream, { once: true })
      try {
        return await fetch(`${apiUrl}/cli/upload/${recordingId}/recording`, {
          method: 'PUT',
          headers: {
            'Content-Type': recordingContentType,
            'Content-Length': String(fileStat.size),
            [credential.header]: credential.value,
          },
          body: stream as unknown as BodyInit,
          signal: uploadAbort.signal,
          // @ts-expect-error Node.js fetch supports duplex for streaming
          duplex: 'half',
        })
      } finally {
        uploadAbort.signal.removeEventListener('abort', abortStream)
      }
    }, uploadAbort.signal)
    if (!recordingResponse.ok) {
      const text = await recordingResponse.text()
      progressReporter.complete(progressIndex, 'failure')
      return {
        projectId,
        videoId,
        hadFailure: true,
        videoName: displayVideoName,
        failureMessage: `Failed to upload recording for "${displayVideoName}": ${recordingResponse.status} ${extractBackendError(text)}${hint401(recordingResponse.status, credential.value)}`,
        recordId,
        ...(plan !== null && { plan }),
      }
    }

    progressReporter.complete(progressIndex, 'success')
    cleanupUploadedRecordingDir(screenciDir, entry)
    return {
      projectId,
      videoId,
      hadFailure: false,
      videoName: displayVideoName,
      recordId,
      ...(studio !== undefined && { studio }),
      ...(plan !== null && { plan }),
      ...(Array.isArray(startBody.notices) &&
        startBody.notices.length > 0 && {
          notices: startBody.notices.filter(
            (notice): notice is string => typeof notice === 'string'
          ),
        }),
    }
  } catch (err) {
    if (isUploadCancelledError(err)) {
      progressReporter.complete(progressIndex, 'cancelled')
      throw err
    }

    if (isUploadAssetError(err)) {
      progressReporter.complete(progressIndex, 'failure')
      return {
        projectId,
        videoId,
        hadFailure: true,
        videoName: displayVideoName,
        failureMessage: err instanceof Error ? err.message : String(err),
        recordId,
        ...(plan !== null && { plan }),
      }
    }

    progressReporter.complete(progressIndex, 'failure')
    return {
      projectId,
      videoId,
      hadFailure: true,
      videoName: displayVideoName,
      failureMessage: `Network error uploading "${displayVideoName}": ${err instanceof Error ? err.message : String(err)}`,
      recordId,
      ...(plan !== null && { plan }),
    }
  }
}

export function attachUploadAbortStdinListener(
  input: Pick<NodeJS.ReadStream, 'on' | 'off' | 'pause'>,
  onAbort: (signal: NodeJS.Signals) => void
): () => void {
  const handleStdinData = (chunk: Buffer | string) => {
    const bytes =
      typeof chunk === 'string'
        ? Buffer.from(chunk, 'utf8')
        : Buffer.from(chunk)
    if (bytes.includes(0x03)) {
      onAbort('SIGINT')
    }
  }

  input.on('data', handleStdinData)

  return () => {
    input.off('data', handleStdinData)
    input.pause()
  }
}

function createUploadAbortController(activityLabel: string): {
  signal: AbortSignal
  throwIfAborted: () => void
  cleanup: () => void
} {
  const controller = new AbortController()
  let cleanedUp = false
  const cleanupStdinListener = attachUploadAbortStdinListener(
    process.stdin,
    (signal) => abortUpload(signal)
  )

  const cleanup = () => {
    if (cleanedUp) return
    cleanedUp = true
    process.off('SIGINT', handleSigint)
    process.off('SIGTERM', handleSigterm)
    cleanupStdinListener()
  }

  function abortUpload(signal: NodeJS.Signals) {
    if (controller.signal.aborted) return
    logger.info(`Received ${signal}, stopping ${activityLabel}...`)
    cleanup()
    controller.abort(new UploadCancelledError(`${activityLabel} cancelled`))
    process.kill(process.pid, signal)
  }

  const handleSigint = () => abortUpload('SIGINT')
  const handleSigterm = () => abortUpload('SIGTERM')

  process.on('SIGINT', handleSigint)
  process.on('SIGTERM', handleSigterm)

  return {
    signal: controller.signal,
    throwIfAborted: () => {
      if (controller.signal.aborted) {
        throw controller.signal.reason instanceof Error
          ? controller.signal.reason
          : new UploadCancelledError(`${activityLabel} cancelled`)
      }
    },
    cleanup,
  }
}

function resolveSpawnSpec(
  cmd: string,
  args: string[]
): {
  command: string
  args: string[]
  shell?: boolean
  windowsVerbatimArguments?: boolean
} {
  if (process.platform !== 'win32') {
    return { command: cmd, args }
  }

  const windowsCmdShims = new Set(['npm', 'npx', 'playwright', 'pnpm'])
  if (!windowsCmdShims.has(cmd)) {
    return { command: cmd, args }
  }

  return {
    command: process.env.comspec ?? 'cmd.exe',
    args: ['/d', '/s', '/c', `"${buildWindowsBatchCommandLine(cmd, args)}"`],
    windowsVerbatimArguments: true,
  }
}

function quoteWindowsBatchArg(arg: string): string {
  if (arg.length === 0) {
    return '""'
  }

  return `"${arg
    .replace(/(\\*)"/g, '$1$1\\"')
    .replace(/(\\+)$/g, '$1$1')
    .replace(/%/g, '%%')}"`
}

function buildWindowsBatchCommandLine(cmd: string, args: string[]): string {
  return [resolveWindowsCmdShim(cmd), ...args]
    .map(quoteWindowsBatchArg)
    .join(' ')
}

function resolveWindowsCmdShim(cmd: string): string {
  const shimName = `${cmd}.cmd`
  const pathEntries = process.env.PATH?.split(delimiter) ?? []
  for (const entry of pathEntries) {
    if (!entry) continue
    const shimPath = resolve(entry, shimName)
    if (existsSync(shimPath)) {
      return shimPath
    }
  }

  const bundledShimCommands = new Set(['npm', 'npx'])
  if (bundledShimCommands.has(cmd)) {
    const bundledShimPath = resolve(dirname(process.execPath), shimName)
    if (existsSync(bundledShimPath)) {
      return bundledShimPath
    }
  }

  return shimName
}

function isModuleNotFoundError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND'
  )
}

function resolvePlaywrightCliEntrypoint(searchFrom: string): string {
  // Prefer the @playwright/test installed alongside the user's config, since it
  // is declared as a peer dependency of the project being recorded.
  try {
    return require.resolve('@playwright/test/cli', { paths: [searchFrom] })
  } catch (error) {
    if (!isModuleNotFoundError(error)) throw error
  }

  // Fall back to the copy resolvable from the screenci CLI's own install. This
  // keeps discovery working when Playwright is hoisted to a parent install or
  // bundled with the CLI rather than next to the config file.
  return require.resolve('@playwright/test/cli')
}

function resolvePlaywrightSpawnSpec(
  args: string[],
  searchFrom: string
): {
  command: string
  args: string[]
  shell?: boolean
  windowsVerbatimArguments?: boolean
} {
  const cliEntrypoint = resolvePlaywrightCliEntrypoint(searchFrom)

  return {
    command: process.execPath,
    args: [cliEntrypoint, ...args],
  }
}

function forwardChildSignals(
  child: ChildProcess,
  activityLabel: string,
  options: { killTree?: boolean; exitParentOnForward?: boolean } = {}
): { cleanup: () => void; getForwardedSignal: () => NodeJS.Signals | null } {
  let forwardedSignal: NodeJS.Signals | null = null
  let forceKillTimer: NodeJS.Timeout | null = null
  const killTree = options.killTree ?? false
  const exitParentOnForward = options.exitParentOnForward ?? false

  const killChild = (signal: NodeJS.Signals): void => {
    if (child.pid === undefined) return

    if (killTree && process.platform !== 'win32') {
      try {
        process.kill(-child.pid, signal)
        return
      } catch {
        // Fall back to direct child kill below.
      }
    }

    if (!child.killed) {
      child.kill(signal)
    }
  }

  const forwardSignal = (signal: NodeJS.Signals) => {
    if (forwardedSignal !== null) return
    forwardedSignal = signal
    if (process.env.SCREENCI_SIGNAL_LOGGING !== 'silent') {
      logger.info(`Received ${signal}, stopping ${activityLabel}...`)
    }
    killChild(signal)
    if (exitParentOnForward) {
      cleanup()
      process.exit(signal === 'SIGINT' ? 130 : 143)
    }
    forceKillTimer = setTimeout(() => {
      if (child.exitCode === null) {
        if (process.env.SCREENCI_SIGNAL_LOGGING !== 'silent') {
          logger.info(`Forcing ${activityLabel} to stop after timeout...`)
        }
        killChild('SIGKILL')
        process.exit(signal === 'SIGINT' ? 130 : 143)
      }
    }, 3000)
    forceKillTimer.unref()
  }

  const handleSigint = () => forwardSignal('SIGINT')
  const handleSigterm = () => forwardSignal('SIGTERM')
  const cleanupStdinListener = attachUploadAbortStdinListener(
    process.stdin,
    (signal) => {
      if (process.env.SCREENCI_SIGNAL_LOGGING !== 'silent') {
        logger.info(`Received ${signal}, stopping ${activityLabel}...`)
      }
      forwardSignal(signal)
    }
  )

  const cleanup = () => {
    if (forceKillTimer !== null) {
      clearTimeout(forceKillTimer)
    }
    process.off('SIGINT', handleSigint)
    process.off('SIGTERM', handleSigterm)
    cleanupStdinListener()
  }

  process.on('SIGINT', handleSigint)
  process.on('SIGTERM', handleSigterm)

  return {
    cleanup,
    getForwardedSignal: () => forwardedSignal,
  }
}

export function clearRecordingDirectories(dir: string): void {
  mkdirSync(dir, { recursive: true })
  for (const entry of readdirSync(dir)) {
    // Preserve the cross-run overlay cache: it lives as a sibling of the
    // per-recording directories so unchanged overlays are served byte for byte
    // from a previous run. Wiping it would re-render and re-encode every overlay
    // each run, changing their content hashes and forcing a re-upload.
    if (entry === OVERLAY_CACHE_DIR_NAME) continue
    // Preserve the anon trial token: it identifies one continuous trial across
    // runs. Wiping it would mint a fresh trial every record, so the one-record
    // cap, the claim, and the auto-graduate to a real secret would all break.
    if (entry === ANON_SESSION_FILE) continue
    rmSync(resolve(dir, entry), { recursive: true, force: true })
  }
}

type ScreenCIConfigResolution =
  | { kind: 'found'; path: string }
  | { kind: 'island-not-entered'; islandConfigPath: string }
  | { kind: 'not-found' }

function findScreenCIConfig(customPath?: string): ScreenCIConfigResolution {
  if (customPath) {
    const resolvedPath = resolve(process.cwd(), customPath)
    return existsSync(resolvedPath)
      ? { kind: 'found', path: resolvedPath }
      : { kind: 'not-found' }
  }

  // Walk up from the current directory looking for a flat `screenci.config.ts`,
  // which is what's present when the command runs from inside the `screenci/`
  // island. We deliberately do NOT auto-use a nested
  // `screenci/screenci.config.ts`: running the CLI from outside the island
  // resolves the `screenci` binary from the registry (npx download) rather than
  // the version-pinned island install, so it would silently run a different
  // version. Instead we detect the island and ask the user to `cd` into it.
  let current = process.cwd()
  let islandConfigPath: string | undefined
  while (true) {
    const flatConfig = resolve(current, 'screenci.config.ts')
    if (existsSync(flatConfig)) {
      return { kind: 'found', path: flatConfig }
    }

    if (islandConfigPath === undefined) {
      const islandConfig = resolve(current, 'screenci', 'screenci.config.ts')
      if (existsSync(islandConfig)) {
        islandConfigPath = islandConfig
      }
    }

    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }

  if (islandConfigPath !== undefined) {
    return { kind: 'island-not-entered', islandConfigPath }
  }
  return { kind: 'not-found' }
}

// Resolve the config path, or log a helpful message and exit. Centralizes the
// `cd screenci` guidance so every command (test/record/info/...) behaves the
// same when invoked from outside the island.
function resolveScreenCIConfigPathOrExit(customPath?: string): string {
  const resolution = findScreenCIConfig(customPath)
  switch (resolution.kind) {
    case 'found':
      return resolution.path
    case 'island-not-entered': {
      const islandDir = dirname(resolution.islandConfigPath)
      const relDir = pathRelative(process.cwd(), islandDir) || '.'
      logger.error(
        `Error: no screenci.config.ts found here, but found ${pc.cyan(
          `${relDir}/screenci.config.ts`
        )}. Run ${pc.cyan(`cd ${relDir}`)} and rerun the command from there.`
      )
      return process.exit(1)
    }
    case 'not-found': {
      logger.error(
        customPath
          ? `Error: Config file not found: ${customPath}`
          : 'Error: screenci.config.ts not found in the current directory or any parent.'
      )
      return process.exit(1)
    }
  }
}

async function hashFile(filePath: string): Promise<string> {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)

    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolveHash(hash.digest('hex')))
  })
}

async function prepareCustomVoiceAssets(
  data: RecordingData,
  configDir: string
): Promise<PreparedUploadAsset[]> {
  const sourceFilePath = data.metadata?.sourceFilePath
  const customVoiceRefsByPath = new Map<string, CustomVoiceRefLike[]>()

  for (const event of data.events) {
    if (event.type === 'cueStart' && event.translations) {
      for (const translation of Object.values(event.translations)) {
        if (
          typeof translation.voice === 'object' &&
          translation.voice !== null &&
          'assetPath' in translation.voice &&
          typeof translation.voice.assetPath === 'string'
        ) {
          const voiceRef = translation.voice as CustomVoiceRefLike
          const refs = customVoiceRefsByPath.get(voiceRef.assetPath) ?? []
          refs.push(voiceRef)
          customVoiceRefsByPath.set(voiceRef.assetPath, refs)
        }
      }
    }

    if (event.type === 'videoCueStart' && event.translations) {
      for (const translation of Object.values(event.translations)) {
        if (
          'text' in translation &&
          typeof translation.voice === 'object' &&
          translation.voice !== null &&
          'assetPath' in translation.voice &&
          typeof translation.voice.assetPath === 'string'
        ) {
          const voiceRef = translation.voice as CustomVoiceRefLike
          const refs = customVoiceRefsByPath.get(voiceRef.assetPath) ?? []
          refs.push(voiceRef)
          customVoiceRefsByPath.set(voiceRef.assetPath, refs)
        }
      }
    }
  }

  const preparedAssets: PreparedUploadAsset[] = []

  for (const [voicePath, refs] of customVoiceRefsByPath) {
    const resolvedFile = await readRecordingFile(
      voicePath,
      configDir,
      sourceFilePath
    )
    if (resolvedFile === null) {
      const existingHash = refs.find(
        (ref) => typeof ref.assetHash === 'string'
      )?.assetHash
      if (existingHash) {
        // The recording already carries this voice's content hash, so reference
        // it by that hash. The backend check confirms it is still stored.
        for (const ref of refs) {
          ref.assetHash = existingHash
        }
        preparedAssets.push({
          kind: 'voice',
          fileHash: existingHash,
          path: voicePath,
          size: 0,
          contentType: contentTypeForPath(voicePath),
          assumedUploaded: true,
        })
        continue
      }
      // No cached hash either. Recover the voice's identity from a previous
      // upload of this video, matched by path. resolveMissingUploadAssets fills
      // in the hash and writes it back onto the cue refs.
      preparedAssets.push({
        kind: 'voice',
        fileHash: '',
        path: voicePath,
        size: 0,
        contentType: contentTypeForPath(voicePath),
        needsResolve: true,
      })
      continue
    }

    const { buffer: fileBuffer, resolvedPath } = resolvedFile
    // Identify the voice by the ORIGINAL file, so the clone cache survives any
    // re-encode of the uploaded bytes (see backend resolveCustomVoice).
    const sampleHash = createHash('sha256').update(fileBuffer).digest('hex')
    // A voice clone only needs audio, and the clone service caps samples at
    // ~11 MB. For video containers (or any oversized file) strip to a small MP3
    // before upload; otherwise upload the audio unchanged.
    const extracted = await maybeExtractVoiceSampleAudio(
      resolvedPath,
      fileBuffer.byteLength
    )
    const uploadBuffer = extracted?.buffer ?? fileBuffer
    const contentType =
      extracted?.contentType ?? contentTypeForPath(resolvedPath)
    const assetHash = createHash('sha256').update(uploadBuffer).digest('hex')
    for (const ref of refs) {
      ref.assetHash = assetHash
      ref.sampleHash = sampleHash
    }
    preparedAssets.push({
      kind: 'voice',
      fileHash: assetHash,
      path: voicePath,
      size: uploadBuffer.byteLength,
      fileBuffer: uploadBuffer,
      contentType,
    })
  }

  return preparedAssets
}

export async function collectUploadAssets(
  data: RecordingData,
  configDir: string
): Promise<PreparedUploadAsset[]> {
  const sourceFilePath = data.metadata?.sourceFilePath
  const assets = new Map<string, PreparedUploadAsset>()

  for (const event of data.events) {
    if (event.type === 'assetStart') {
      // Studio assets have no local file — they are uploaded from the Studio
      // page and merged into the recording by the backend.
      if ('studio' in event && event.studio === true) continue
      // Render dependencies (selected(...)) have no local file: the backend
      // resolves the target render's output and injects it at dispatch time.
      if ('dependency' in event) continue
      if (assets.has(`name:${event.name}`)) continue
      const resolvedFile = await readRecordingFile(
        event.path,
        configDir,
        sourceFilePath
      )
      if (resolvedFile === null) {
        // The local file is gone (e.g. gitignored media on CI). Reference it so
        // its identity can be recovered from a previous upload of this video.
        assets.set(`name:${event.name}`, {
          kind: 'overlay',
          fileHash: '',
          path: event.path,
          name: event.name,
          size: 0,
          needsResolve: true,
        })
        continue
      }
      const { buffer: fileBuffer, resolvedPath } = resolvedFile
      assets.set(`name:${event.name}`, {
        kind: 'overlay',
        fileHash: createHash('sha256').update(fileBuffer).digest('hex'),
        path: event.path,
        name: event.name,
        size: fileBuffer.byteLength,
        fileBuffer,
        contentType: contentTypeForPath(resolvedPath),
      })
      continue
    }

    if (event.type === 'audioStart') {
      // Studio audio tracks have no local file.
      if ('studio' in event && event.studio === true) continue
      // Prefer the record-time content hash as the dedup key; a missing local
      // file may have been emitted without one, so fall back to the path.
      const dedupKey = event.fileHash
        ? `hash:${event.fileHash}`
        : `path:${event.path}`
      if (assets.has(dedupKey)) continue
      const resolvedFile = await readRecordingFile(
        event.path,
        configDir,
        sourceFilePath
      )
      if (resolvedFile === null) {
        // The local file is gone. If the recording still carries its content
        // hash, reference it by that hash (the backend check confirms it is
        // stored). Otherwise recover its identity from a previous upload by path.
        // Captured screen audio (`__screen`) is per-recording and can never be
        // recovered from a prior upload, so it is simply skipped when missing.
        if (event.fileHash) {
          assets.set(dedupKey, {
            kind: 'audio',
            fileHash: event.fileHash,
            path: event.path,
            size: 0,
            assumedUploaded: true,
            ...(event.name === '__screen' && { alwaysUpload: true }),
          })
        } else if (event.name !== '__screen') {
          assets.set(dedupKey, {
            kind: 'audio',
            fileHash: '',
            path: event.path,
            size: 0,
            needsResolve: true,
          })
        }
        continue
      }
      assets.set(dedupKey, {
        kind: 'audio',
        fileHash:
          event.fileHash ??
          createHash('sha256').update(resolvedFile.buffer).digest('hex'),
        path: event.path,
        size: resolvedFile.buffer.byteLength,
        fileBuffer: resolvedFile.buffer,
        contentType: contentTypeForPath(resolvedFile.resolvedPath),
        ...(event.name === '__screen' && { alwaysUpload: true }),
      })
      continue
    }

    if (event.type === 'videoCueStart') {
      // Single-language: hash already computed during recording, use assetPath to read file
      if (
        typeof event.assetHash === 'string' &&
        !assets.has(`hash:${event.assetHash}`)
      ) {
        const resolvedFile =
          typeof event.assetPath === 'string'
            ? await readRecordingFile(
                event.assetPath,
                configDir,
                sourceFilePath
              )
            : null
        assets.set(`hash:${event.assetHash}`, {
          kind: 'clip',
          fileHash: event.assetHash,
          path: event.assetPath ?? event.assetHash,
          size: resolvedFile?.buffer.byteLength ?? 0,
          ...(resolvedFile !== null
            ? {
                fileBuffer: resolvedFile.buffer,
                contentType: contentTypeForPath(resolvedFile.resolvedPath),
              }
            : { assumedUploaded: true }),
        })
      } else if (
        typeof event.assetHash !== 'string' &&
        typeof event.assetPath === 'string' &&
        !assets.has(`path:${event.assetPath}`)
      ) {
        // The media file was gone at record time, so it carries no hash. Recover
        // its identity from a previous upload of this video, matched by path.
        const resolvedFile = await readRecordingFile(
          event.assetPath,
          configDir,
          sourceFilePath
        )
        if (resolvedFile === null) {
          assets.set(`path:${event.assetPath}`, {
            kind: 'clip',
            fileHash: '',
            path: event.assetPath,
            size: 0,
            needsResolve: true,
          })
        }
      }

      // Multi-language: each translation carries its own hash
      if (event.translations) {
        for (const translation of Object.values(event.translations)) {
          if (typeof translation !== 'object' || translation === null) continue
          const assetHash =
            'assetHash' in translation &&
            typeof translation.assetHash === 'string'
              ? translation.assetHash
              : undefined
          const assetPath =
            'assetPath' in translation &&
            typeof translation.assetPath === 'string'
              ? translation.assetPath
              : undefined
          if (assetHash !== undefined) {
            if (assets.has(`hash:${assetHash}`)) continue
            const resolvedFile =
              assetPath !== undefined
                ? await readRecordingFile(assetPath, configDir, sourceFilePath)
                : null
            assets.set(`hash:${assetHash}`, {
              kind: 'clip',
              fileHash: assetHash,
              path: assetPath ?? assetHash,
              size: resolvedFile?.buffer.byteLength ?? 0,
              ...(resolvedFile !== null
                ? {
                    fileBuffer: resolvedFile.buffer,
                    contentType: contentTypeForPath(resolvedFile.resolvedPath),
                  }
                : { assumedUploaded: true }),
            })
          } else if (
            assetPath !== undefined &&
            !assets.has(`path:${assetPath}`)
          ) {
            const resolvedFile = await readRecordingFile(
              assetPath,
              configDir,
              sourceFilePath
            )
            if (resolvedFile === null) {
              assets.set(`path:${assetPath}`, {
                kind: 'clip',
                fileHash: '',
                path: assetPath,
                size: 0,
                needsResolve: true,
              })
            }
          }
        }
      }
    }
  }

  for (const asset of await prepareCustomVoiceAssets(data, configDir)) {
    assets.set(`path:${asset.path}`, asset)
  }

  // Custom cursor image (`renderOptions.mouse.image`). Unlike overlays it is not
  // referenced by a timeline event, so it is collected here. It is a local path
  // only before upload; a `{ assetPath, fileHash }` value has already been
  // uploaded (e.g. re-running the CLI on annotated data) and needs no work.
  const cursorImage = data.renderOptions?.mouse?.image
  if (typeof cursorImage === 'string' && !assets.has(`path:${cursorImage}`)) {
    const resolvedFile = await readRecordingFile(
      cursorImage,
      configDir,
      sourceFilePath
    )
    if (resolvedFile === null) {
      // The local file is gone (e.g. gitignored on CI). Reference it by path so
      // its identity can be recovered from a previous upload of this video.
      assets.set(`path:${cursorImage}`, {
        kind: 'cursor',
        fileHash: '',
        path: cursorImage,
        size: 0,
        needsResolve: true,
      })
    } else {
      assets.set(`path:${cursorImage}`, {
        kind: 'cursor',
        fileHash: createHash('sha256')
          .update(resolvedFile.buffer)
          .digest('hex'),
        path: cursorImage,
        size: resolvedFile.buffer.byteLength,
        fileBuffer: resolvedFile.buffer,
        contentType: contentTypeForPath(resolvedFile.resolvedPath),
      })
    }
  }

  return [...assets.values()]
}

export function stripVoicePath(
  voice: VoiceKey | RecordingCustomVoiceRef,
  byPath?: Map<string, string>
): VoiceKey | RecordingCustomVoiceRef {
  if (typeof voice !== 'string') {
    // A voice recovered from a previous upload has no record-time assetHash; fill
    // it in from the resolved-by-path map before the path is dropped.
    const assetHash =
      voice.assetHash ??
      (byPath !== undefined && typeof voice.assetPath === 'string'
        ? byPath.get(voice.assetPath)
        : undefined)
    return { assetHash: assetHash as string }
  }
  return voice
}

export function annotateRecordingDataWithAssetHashes(
  data: RecordingData,
  assets: PreparedUploadAsset[]
): RecordingData {
  // Overlays are matched to their hash by name; every other asset kind (audio,
  // narration clip, custom voice) is matched by its file path. Skip placeholder
  // hashes that were never resolved so a missing entry stays untouched.
  const byName = new Map<string, string>()
  const byPath = new Map<string, string>()
  for (const asset of assets) {
    if (asset.fileHash.length === 0) continue
    if (typeof asset.name === 'string') byName.set(asset.name, asset.fileHash)
    byPath.set(asset.path, asset.fileHash)
  }

  // Rewrite a custom cursor image (`renderOptions.mouse.image`) from its local
  // path to `{ assetPath, fileHash }` so the renderer can resolve it by content
  // hash. Leave it untouched when it is already an object or has no known hash.
  const renderOptions = ((): RecordingData['renderOptions'] => {
    const ro = data.renderOptions
    const mouse = ro?.mouse
    const image = mouse?.image
    if (mouse === undefined || typeof image !== 'string') return ro
    const fileHash = byPath.get(image)
    if (fileHash === undefined) return ro
    return {
      ...ro,
      mouse: { ...mouse, image: { assetPath: image, fileHash } },
    }
  })()

  return {
    ...data,
    renderOptions,
    events: data.events.map((event) => {
      if (event.type === 'assetStart') {
        if ('studio' in event || 'dependency' in event) return event
        const fileHash = byName.get(event.name) ?? event.fileHash
        return fileHash ? { ...event, fileHash } : event
      }

      if (event.type === 'audioStart') {
        // Studio audio tracks carry no local path; leave them untouched.
        if (!('path' in event)) return event
        if (event.fileHash) return event
        const fileHash = byPath.get(event.path)
        return fileHash ? { ...event, fileHash } : event
      }

      if (event.type === 'cueStart' && event.translations) {
        const translations = Object.fromEntries(
          Object.entries(event.translations).map(([language, translation]) => {
            if (translation.voice === undefined) {
              return [language, translation]
            }
            return [
              language,
              {
                ...translation,
                voice: stripVoicePath(translation.voice, byPath),
              } as typeof translation,
            ]
          })
        )
        return { ...event, translations }
      }

      if (event.type !== 'videoCueStart') return event

      // Strip assetPath from translations. The hash was either computed during
      // recording or recovered from a previous upload (matched by that path).
      if (event.translations) {
        const translations = Object.fromEntries(
          Object.entries(event.translations).map(([language, translation]) => {
            if ('assetHash' in translation || 'assetPath' in translation) {
              const file = translation as VideoCueTranslationFile
              const assetHash =
                file.assetHash ??
                (file.assetPath !== undefined
                  ? byPath.get(file.assetPath)
                  : undefined)
              const { assetPath: _removed, ...rest } = file
              return [
                language,
                assetHash !== undefined ? { ...rest, assetHash } : rest,
              ]
            }
            if ('voice' in translation) {
              return [
                language,
                {
                  ...translation,
                  ...(translation.voice !== undefined
                    ? { voice: stripVoicePath(translation.voice, byPath) }
                    : {}),
                },
              ]
            }
            return [language, translation]
          })
        )
        return { ...event, translations }
      }

      // Single-language: keep the assetHash (recovering it by path if needed) and
      // drop the now-redundant assetPath.
      const assetHash =
        event.assetHash ??
        (typeof event.assetPath === 'string'
          ? byPath.get(event.assetPath)
          : undefined)
      if (typeof assetHash === 'string') {
        const { assetPath: _removed, ...rest } = event
        return { ...rest, assetHash }
      }

      return event
    }),
  }
}

function hint401(status: number, secret: string): string {
  if (status !== 401 || !secret) return ''
  const frontendUrl = getDevFrontendUrl()
  return `\nThe secret may have been deleted. Check your secrets at ${frontendUrl}/secrets`
}

/**
 * Reduces a backend error response to its human-readable message. Backend
 * failures reply with a JSON body like `{"error":"..."}`; this returns just the
 * `error` string so failures print the message, not the raw JSON. Non-JSON or
 * shapeless bodies fall back to the original text unchanged.
 */
export function extractBackendError(responseText: string): string {
  if (responseText.trim().length === 0) return responseText
  try {
    const parsed = JSON.parse(responseText) as { error?: unknown }
    if (typeof parsed.error === 'string' && parsed.error.trim().length > 0) {
      return parsed.error
    }
  } catch {
    // Not JSON: fall back to the raw response text.
  }
  return responseText
}

/**
 * Whether an upload-start error body flags a missing ElevenLabs key. The backend
 * fails the render immediately and replies with `{ elevenLabsKeyMissing: true }`
 * so the CLI can surface the dedicated Secrets-link error instead of a generic
 * upload failure. Non-JSON or shapeless bodies are treated as not flagged.
 */
export function responseFlagsElevenLabsKeyMissing(
  responseText: string
): boolean {
  if (responseText.trim().length === 0) return false
  try {
    const parsed = JSON.parse(responseText) as {
      elevenLabsKeyMissing?: unknown
    }
    return parsed.elevenLabsKeyMissing === true
  } catch {
    return false
  }
}

export function formatUploadStartFailureMessage(
  videoName: string,
  status: number,
  responseText: string,
  secret: string
): string {
  if (responseText.trim().length > 0) {
    try {
      const parsed = JSON.parse(responseText) as { error?: unknown }
      if (typeof parsed.error === 'string' && parsed.error.trim().length > 0) {
        return `${parsed.error}${hint401(status, secret)}`
      }
    } catch {
      // fall back to raw response text
    }

    return responseText
  }

  return `Failed to start upload for "${videoName}": ${status}${hint401(status, secret)}`
}

const EXPRESSIVE_TIER_ERROR_PREFIX =
  'Expressive narration and style prompts require the Business tier.'

export function formatFailedVideoMessage(
  videoName: string,
  message: string
): string {
  if (message.startsWith(EXPRESSIVE_TIER_ERROR_PREFIX)) {
    return [
      `${videoName}: ${message}`,
      "If you want to keep using the current tier, remove `voice.style` or `modelType: 'expressive'` from the localize `voice`.",
    ].join('\n')
  }

  return `${videoName}: ${message}`
}

function quoteFailedVideoName(videoName: string): string {
  return `'${videoName.replaceAll("'", "\\'")}'`
}

export function formatFailedVideoNamesSummary(videoNames: string[]): string {
  if (videoNames.length === 0) return 'unknown'
  return videoNames
    .map((videoName) => quoteFailedVideoName(videoName))
    .join(', ')
}

export function collapseFailedVideoWarnings(
  failures: Array<{ videoName: string; message: string }>
): string[] {
  const byMessage = new Map<string, string[]>()

  for (const failure of failures) {
    const names = byMessage.get(failure.message)
    if (names) names.push(failure.videoName)
    else byMessage.set(failure.message, [failure.videoName])
  }

  return [...byMessage.entries()].map(([message, videoNames]) => {
    if (videoNames.length === 1) {
      return formatFailedVideoMessage(videoNames[0] ?? 'unknown', message)
    }

    return message
  })
}

export function printUploadStartFailureMessage(
  videoName: string,
  status: number,
  responseText: string,
  secret: string
): void {
  const message = formatUploadStartFailureMessage(
    videoName,
    status,
    responseText,
    secret
  )

  if (responseText.trim().length > 0) {
    process.stderr.write(`${message}\n`)
    return
  }

  logger.warn(message)
}

export function displayAssetPath(assetPath: string): string {
  if (!isAbsolute(assetPath)) {
    return assetPath
  }
  const rel = pathRelative(process.cwd(), assetPath)
  return rel.length > 0 ? rel : assetPath
}

type ResolveAssetRef = { path: string; name?: string | null; kind: string }

type ResolveAssetResult = {
  path: string
  name?: string | null
  fileHash: string | null
  size: number | null
  contentType: string | null
}

/**
 * The backend's response to a resolve-assets request. Each entry is aligned to
 * the request's `assets` array; a null `fileHash` means no previously uploaded
 * version of that asset was found for this video.
 */
export type ResolveAssetsResponse = { resolved: ResolveAssetResult[] }

/**
 * Recovers the identity of assets whose local file was absent during collection
 * (no bytes, and for overlays no hash) by matching them, by path or name,
 * against a previous upload of the same video. Each resolved asset is mutated in
 * place: its `fileHash`, `size`, and `contentType` are filled in and it is
 * flagged `assumedUploaded` so the later existence check confirms the bytes are
 * still stored rather than trying to upload absent bytes.
 *
 * Returns the assets that could not be resolved (no previous version), so the
 * caller can fail the recording with actionable guidance.
 */
export async function resolveMissingUploadAssets(
  assets: PreparedUploadAsset[],
  projectName: string,
  videoName: string,
  apiUrl: string,
  credential: CliCredential,
  signal: AbortSignal,
  progressReporter?: { info: (message: string) => void }
): Promise<PreparedUploadAsset[]> {
  const pending = assets.filter((asset) => asset.needsResolve === true)
  if (pending.length === 0) return []

  const refs: ResolveAssetRef[] = pending.map((asset) => ({
    path: asset.path,
    ...(typeof asset.name === 'string' ? { name: asset.name } : {}),
    kind: asset.kind,
  }))

  const res = await withUploadRetry(
    () =>
      fetch(`${apiUrl}/cli/upload/resolve-assets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [credential.header]: credential.value,
        },
        body: JSON.stringify({ projectName, videoName, assets: refs }),
        signal,
      }),
    signal
  )

  if (!res.ok) {
    const text = await res.text()
    throw new UploadAssetError(
      `Failed to resolve previously uploaded assets for "${videoName}": ${res.status} ${extractBackendError(text)}${hint401(res.status, credential.value)}`
    )
  }

  const body = (await res.json()) as ResolveAssetsResponse
  const resolved = Array.isArray(body.resolved) ? body.resolved : []
  const logInfo = (message: string) => {
    if (progressReporter) progressReporter.info(message)
    else logger.info(message)
  }

  const unresolved: PreparedUploadAsset[] = []
  pending.forEach((asset, index) => {
    const match = resolved[index]
    if (match && typeof match.fileHash === 'string') {
      asset.fileHash = match.fileHash
      asset.size = match.size ?? 0
      if (typeof match.contentType === 'string') {
        asset.contentType = match.contentType
      }
      asset.needsResolve = false
      asset.assumedUploaded = true
      logInfo(
        `${pc.green('✔')} Locally missing ${UPLOAD_ASSET_LABEL[asset.kind].toLowerCase()}, reusing the previously uploaded version: ${displayAssetPath(asset.path)}`
      )
    } else {
      unresolved.push(asset)
    }
  })

  return unresolved
}

/**
 * Builds the failure message shown when locally missing assets have no
 * previously uploaded version to reuse.
 */
export function formatUnresolvedAssetMessage(
  videoName: string,
  unresolved: PreparedUploadAsset[]
): string {
  const list = unresolved
    .map((asset) => `  - ${UPLOAD_ASSET_LABEL[asset.kind]}: ${asset.path}`)
    .join('\n')
  return [
    `Some asset files are missing locally and no previously uploaded version was found for "${videoName}":`,
    list,
    'Record once with these files present so they are uploaded, or commit them so they are available here.',
  ].join('\n')
}

async function uploadAssets(
  assets: PreparedUploadAsset[],
  apiUrl: string,
  credential: CliCredential,
  recordingId: string,
  signal: AbortSignal,
  throwIfAborted: () => void,
  progressReporter?: { info: (message: string) => void }
): Promise<void> {
  const logInfo = (message: string) => {
    if (progressReporter) {
      progressReporter.info(message)
    } else {
      logger.info(message)
    }
  }

  for (const asset of assets) {
    throwIfAborted()
    const label = UPLOAD_ASSET_LABEL[asset.kind]
    try {
      if (!asset.alwaysUpload) {
        const checkRes = await withUploadRetry(
          () =>
            fetch(`${apiUrl}/cli/upload/${recordingId}/asset/check`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                [credential.header]: credential.value,
              },
              body: JSON.stringify({
                fileHash: asset.fileHash,
                contentType: asset.contentType,
                size: asset.size,
                path: asset.path,
                ...(typeof asset.name === 'string' ? { name: asset.name } : {}),
              }),
              signal,
            }),
          signal
        )

        if (!checkRes.ok) {
          const text = await checkRes.text()
          throw new UploadAssetError(
            `Failed to check asset ${displayAssetPath(asset.path)}: ${checkRes.status} ${extractBackendError(text)}${hint401(checkRes.status, credential.value)}`
          )
        }

        const checkBody = (await checkRes.json()) as { exists: boolean }
        if (checkBody.exists) {
          logInfo(
            asset.assumedUploaded
              ? `${pc.green('✔')} Locally missing ${label.toLowerCase()}, already uploaded: ${displayAssetPath(asset.path)}`
              : `${pc.green('✔')} ${label} already exists: ${displayAssetPath(asset.path)}`
          )
          continue
        }
      }

      if (!asset.fileBuffer || !asset.contentType) {
        // A locally missing asset matched a previous upload by path/name, but its
        // bytes are not in this environment's storage. There is nothing to push.
        if (asset.assumedUploaded) {
          throw new UploadAssetError(
            `${label} is missing locally and its previously uploaded bytes are no longer stored: ${displayAssetPath(asset.path)}. Record once with the file present so it is uploaded again, or commit the file.`
          )
        }
        throw new UploadAssetError(
          `Asset bytes not available for upload and backend does not have it yet: ${displayAssetPath(asset.path)}`
        )
      }

      const fileBuffer = asset.fileBuffer
      const contentType = asset.contentType
      throwIfAborted()

      const res = await withUploadRetry(
        () =>
          // Send the raw bytes, not base64-in-JSON: base64 builds a string that
          // exceeds Node's max string length (~536MB) for large assets. Metadata
          // travels in headers (URI-encoded so non-ASCII paths stay header-safe).
          fetch(`${apiUrl}/cli/upload/${recordingId}/asset/stream`, {
            method: 'PUT',
            headers: {
              'Content-Type': contentType,
              'Content-Length': String(fileBuffer.byteLength),
              [credential.header]: credential.value,
              'X-ScreenCI-File-Hash': asset.fileHash,
              'X-ScreenCI-Asset-Size': String(asset.size),
              'X-ScreenCI-Asset-Path': encodeURIComponent(asset.path),
            },
            body: fileBuffer as unknown as BodyInit,
            signal,
          }),
        signal
      )
      if (!res.ok) {
        const text = await res.text()
        if (res.status === 409 && text.includes('already exists')) {
          logInfo(
            `${pc.green('✔')} ${label} already exists: ${displayAssetPath(asset.path)}`
          )
        } else {
          throw new UploadAssetError(
            `Failed to upload asset ${displayAssetPath(asset.path)}: ${res.status} ${extractBackendError(text)}${hint401(res.status, credential.value)}`
          )
        }
      } else {
        logInfo(
          `${pc.green('✔')} ${label} uploaded: ${displayAssetPath(asset.path)}`
        )
      }
    } catch (err) {
      if (isUploadCancelledError(err)) {
        throw err
      }
      if (isUploadAssetError(err)) {
        throw err
      }
      throw new UploadAssetError(
        `Network error uploading asset ${displayAssetPath(asset.path)}: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }
}

export async function uploadRecordings(
  screenciDir: string,
  projectName: string,
  apiUrl: string,
  credential: CliCredential,
  specificEntry?: string,
  verbose = false,
  allowedVideoNames?: readonly string[]
): Promise<{
  projectId: string | null
  recordId: string | null
  hadFailures: boolean
  uploadedVideoNames: string[]
  failedVideoNames: string[]
  failedVideoMessages: Array<{ videoName: string; message: string }>
  studioNotices: StudioUploadNotice[]
  elevenLabsKeyMissingVideos: string[]
  notices: string[]
  plan: OrgPlan | null
}> {
  const uploadAbort = createUploadAbortController('upload')
  const recordId = randomUUID()
  let entries: string[]
  try {
    entries = await readdir(screenciDir)
  } catch {
    logger.warn('No .screenci directory found, skipping upload')
    return {
      projectId: null,
      recordId: null,
      hadFailures: false,
      uploadedVideoNames: [],
      failedVideoNames: [],
      failedVideoMessages: [],
      studioNotices: [],
      elevenLabsKeyMissingVideos: [],
      notices: [],
      plan: null,
    }
  }

  if (specificEntry !== undefined) {
    entries = entries.filter((e) => e === specificEntry)
  }

  let firstProjectId: string | null = null

  try {
    const candidates = disambiguateUploadCandidateDisplayNames(
      (
        await Promise.all(
          entries.map(async (entry) => {
            uploadAbort.throwIfAborted()
            return await loadUploadCandidate(screenciDir, entry, verbose)
          })
        )
      ).filter((candidate): candidate is UploadCandidate => candidate !== null)
    )
    const requestedVideoNames =
      allowedVideoNames !== undefined ? new Set(allowedVideoNames) : null
    const filteredCandidates =
      requestedVideoNames === null
        ? candidates
        : candidates.filter((candidate) =>
            requestedVideoNames.has(candidate.videoName)
          )

    if (filteredCandidates.length === 0) {
      const missingRequestedVideoNames =
        requestedVideoNames === null
          ? []
          : [...requestedVideoNames].filter(
              (videoName) =>
                !candidates.some(
                  (candidate) => candidate.videoName === videoName
                )
            )
      return {
        projectId: null,
        recordId: null,
        hadFailures: missingRequestedVideoNames.length > 0,
        uploadedVideoNames: [],
        failedVideoNames: missingRequestedVideoNames,
        failedVideoMessages: missingRequestedVideoNames.map((videoName) => ({
          videoName,
          message: `No recorded output found for "${videoName}"`,
        })),
        studioNotices: [],
        elevenLabsKeyMissingVideos: [],
        notices: [],
        plan: null,
      }
    }

    if (
      credential.header === ANON_TOKEN_HEADER &&
      filteredCandidates.length > ANON_MAX_VIDEOS_PER_RECORDING
    ) {
      const failureMessage = `Anonymous trials are capped at ${ANON_MAX_VIDEOS_PER_RECORDING} videos/screenshots per recording. Split this into smaller runs or sign up to record more in one run.`
      return {
        projectId: null,
        recordId: null,
        hadFailures: true,
        uploadedVideoNames: [],
        failedVideoNames: filteredCandidates.map(
          (candidate) => candidate.displayVideoName
        ),
        failedVideoMessages: filteredCandidates.map((candidate) => ({
          videoName: candidate.displayVideoName,
          message: failureMessage,
        })),
        studioNotices: [],
        elevenLabsKeyMissingVideos: [],
        notices: [],
        plan: null,
      }
    }

    const progressReporter = createUploadProgressReporter(
      filteredCandidates.map((candidate) => candidate.displayVideoName),
      verbose
    )

    // Screenshots from this run render together on one machine; the backend
    // waits for all of them to land before dispatching the batch, so it needs
    // to know how many to expect.
    const screenshotCount = filteredCandidates.filter(
      (candidate) => candidate.data.output === 'screenshot'
    ).length

    const results = await Promise.all(
      filteredCandidates.map(
        async (candidate, index) =>
          await uploadRecordingCandidate(
            candidate,
            screenciDir,
            projectName,
            apiUrl,
            credential,
            verbose,
            uploadAbort,
            progressReporter,
            index,
            recordId,
            screenshotCount
          )
      )
    )

    firstProjectId =
      results.find((result) => result.projectId !== null)?.projectId ?? null
    const resolvedPlan =
      results.find((result) => result.plan !== undefined)?.plan ?? null
    const hadFailures = results.some((result) => result.hadFailure)
    const uploadedVideoNames = results
      .filter((result) => !result.hadFailure)
      .map((result) => result.videoName)
    const failedVideoNames = results
      .filter((result) => result.hadFailure)
      .map((result) => result.videoName)
    const failedVideoMessages = results.flatMap((result) =>
      result.hadFailure && typeof result.failureMessage === 'string'
        ? [{ videoName: result.videoName, message: result.failureMessage }]
        : []
    )

    const studioNotices = results.flatMap((result) =>
      !result.hadFailure && result.studio !== undefined
        ? [
            {
              videoName: result.videoName,
              videoId: result.videoId,
              studio: result.studio,
            },
          ]
        : []
    )

    const elevenLabsKeyMissingVideos = results.flatMap((result) =>
      result.elevenLabsKeyMissing === true ? [result.videoName] : []
    )

    const notices = results.flatMap((result) =>
      !result.hadFailure && result.notices !== undefined ? result.notices : []
    )

    return {
      projectId: firstProjectId,
      recordId,
      hadFailures,
      uploadedVideoNames,
      failedVideoNames,
      failedVideoMessages,
      studioNotices,
      elevenLabsKeyMissingVideos,
      notices,
      plan: resolvedPlan,
    }
  } finally {
    uploadAbort.cleanup()
  }
}

async function countCompletedRecordings(screenciDir: string): Promise<number> {
  let entries: string[]
  try {
    entries = await readdir(screenciDir)
  } catch {
    return 0
  }

  return entries.filter((entry) =>
    existsSync(resolve(screenciDir, entry, 'data.json'))
  ).length
}

async function writeGitHubProjectOutput(projectUrl: string): Promise<void> {
  const githubOutput = process.env.GITHUB_OUTPUT
  if (!githubOutput) return

  await appendFile(githubOutput, `screenci_project_url=${projectUrl}\n`)
}

/**
 * The builder titles each per-language Playwright test `${videoName} [${lang}]`
 * (src/builder.ts) so every language pass has a unique test title, while the
 * shared grouping key it writes to `metadata.videoName` carries NO language
 * suffix. `screenci record` discovers the videos to expect by their test titles,
 * but the uploader matches those against each recording's `metadata.videoName`.
 * Strip the trailing ` [<lang>]` so the requested name matches the recorded one;
 * otherwise a language-decorated title never matches and every upload reports
 * "No recorded output found". Only a language-code-shaped bracket is stripped, so
 * an unrelated trailing bracket in a video name is left intact.
 */
export function stripTestTitleLanguageSuffix(title: string): string {
  // Language codes are lowercase (ISO 639: en, es, zh, ...), with an optional
  // region subtag (pt-BR). Requiring lowercase avoids stripping unrelated
  // capitalized brackets like ` [New]`.
  return title.replace(/ \[[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?\]$/, '')
}

async function collectRequestedRecordVideoNames(
  configPath: string,
  additionalArgs: string[],
  languages: string | undefined
): Promise<string[]> {
  const envForDiscovery = {
    ...process.env,
    SCREENCI_CONFIG_DIR: dirname(configPath),
    SCREENCI_RECORDING: 'true',
    ...(languages ? { [SCREENCI_LANGUAGES_ENV]: languages } : {}),
  }

  const titles = await collectDiscoveredTestTitles(
    configPath,
    additionalArgs,
    envForDiscovery
  )
  // Requested names are matched against `metadata.videoName` (no language
  // suffix), so recover the videoName from each per-language test title.
  return [...new Set(titles.map(stripTestTitleLanguageSuffix))]
}

async function loadScreenCIConfigAndEnv(configPath?: string): Promise<{
  resolvedConfigPath: string
  screenciConfig: ScreenCIConfig
}> {
  const resolvedConfigPath = resolveScreenCIConfigPathOrExit(configPath)

  let screenciConfig: ScreenCIConfig
  try {
    screenciConfig =
      await loadRecordConfigWithoutPlaywrightCollision(resolvedConfigPath)
  } catch (err) {
    logger.error('Failed to load config:', err)
    process.exit(1)
  }

  if (screenciConfig.envFile) {
    loadEnvFile(
      resolve(dirname(resolvedConfigPath), screenciConfig.envFile),
      true
    )
  } else {
    loadEnvFile(resolve(dirname(resolvedConfigPath), '.env'), false)
  }

  return { resolvedConfigPath, screenciConfig }
}

function loadEnvFile(envFilePath: string, warnOnFailure: boolean): void {
  try {
    const loadEnvFileCompat = (
      process as NodeJS.Process & {
        loadEnvFile?: (path: string | URL) => void
      }
    ).loadEnvFile

    if (typeof loadEnvFileCompat === 'function') {
      loadEnvFileCompat(envFilePath)
      return
    }

    loadEnvFileFallback(envFilePath)
  } catch (err) {
    if (warnOnFailure && !isMissingFileError(err)) {
      logger.warn(`Failed to load env file ${envFilePath}:`, err)
    }
  }
}

function loadEnvFileFallback(envFilePath: string): void {
  const envSource = readFileSync(envFilePath, 'utf8')

  for (const [key, value] of parseEnvFile(envSource)) {
    if (process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}

function parseEnvFile(envSource: string): Map<string, string> {
  const parsed = new Map<string, string>()
  const lines = envSource.replace(/^\uFEFF/, '').split(/\r?\n/)

  for (const rawLine of lines) {
    const line = rawLine.trim()

    if (line === '' || line.startsWith('#')) continue

    const normalizedLine = line.startsWith('export ')
      ? line.slice('export '.length).trimStart()
      : line
    const separatorIndex = normalizedLine.indexOf('=')

    if (separatorIndex === -1) continue

    const key = normalizedLine.slice(0, separatorIndex).trim()

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue

    const rawValue = normalizedLine.slice(separatorIndex + 1).trim()
    parsed.set(key, parseEnvValue(rawValue))
  }

  return parsed
}

function parseEnvValue(rawValue: string): string {
  if (rawValue === '') return ''

  if (
    (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
    (rawValue.startsWith("'") && rawValue.endsWith("'"))
  ) {
    const quote = rawValue[0]
    const quotedValue = rawValue.slice(1, -1)

    if (quote === '"') {
      return quotedValue
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\')
    }

    return quotedValue
  }

  const inlineCommentIndex = rawValue.search(/\s#/)
  if (inlineCommentIndex >= 0) {
    return rawValue.slice(0, inlineCommentIndex).trimEnd()
  }

  return rawValue
}

function isMissingFileError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    err.code === 'ENOENT'
  )
}

async function loadEnvFileFromConfigSource(
  resolvedConfigPath: string,
  warnOnFailure: boolean
): Promise<void> {
  try {
    const envFilePath =
      (await resolveConfiguredEnvFilePath(resolvedConfigPath)) ??
      resolve(dirname(resolvedConfigPath), '.env')
    loadEnvFile(envFilePath, warnOnFailure)
  } catch {
    // Config import may require Playwright context or dynamic values. Continue with
    // the existing process env; Playwright will still load the config normally.
  }
}

// Resolve `envFile` the way Playwright resolves a config value: by evaluating
// the config module, not by scraping its source text. A dynamic
// `envFile: isLocal ? '.env.local' : '.env'` only has a real value once the
// module runs, so evaluating it lets local and prod setups pick the right file
// (scraping the source can only see a plain string literal, and silently falls
// back to `.env`). The environment the expression depends on (e.g.
// SCREENCI_ENVIRONMENT, set by the `screenci:*:local` scripts) is already in
// place before this runs, so the CLI resolves the same file Playwright will
// when it later evaluates the same config. `loadRecordConfigWithoutPlaywright
// Collision` only falls back to static source parsing if the module cannot be
// imported.
export async function resolveConfiguredEnvFilePath(
  resolvedConfigPath: string
): Promise<string | undefined> {
  try {
    const screenciConfig =
      await loadRecordConfigWithoutPlaywrightCollision(resolvedConfigPath)
    if (!screenciConfig.envFile) return undefined

    return resolve(dirname(resolvedConfigPath), screenciConfig.envFile)
  } catch {
    return undefined
  }
}

async function resolveProjectEnvFilePath(
  resolvedConfigPath: string
): Promise<string> {
  return (
    (await resolveConfiguredEnvFilePath(resolvedConfigPath)) ??
    resolve(dirname(resolvedConfigPath), '.env')
  )
}

export function extractConfigStringLiteral(
  configSource: string,
  property: 'projectName' | 'envFile'
): string | undefined {
  const singleQuoteMatch = configSource.match(
    new RegExp(property + "\\s*:\\s*'([^'\\n]+)'")
  )
  if (singleQuoteMatch) return singleQuoteMatch[1]

  const doubleQuoteMatch = configSource.match(
    new RegExp(property + '\\s*:\\s*"([^"\\n]+)"')
  )
  if (doubleQuoteMatch) return doubleQuoteMatch[1]

  const templateLiteralMatch = configSource.match(
    new RegExp(property + '\\s*:\\s*`([^`\\n]+)`')
  )
  return templateLiteralMatch?.[1]
}

export function extractRecordUploadPolicyLiteral(
  configSource: string
): RecordUploadPolicy | undefined {
  const singleQuoteMatch = configSource.match(
    /record\s*:\s*\{[\s\S]*?upload\s*:\s*'(passed-only|all-or-nothing)'/
  )
  if (singleQuoteMatch) {
    return singleQuoteMatch[1] as RecordUploadPolicy
  }

  const doubleQuoteMatch = configSource.match(
    /record\s*:\s*\{[\s\S]*?upload\s*:\s*"(passed-only|all-or-nothing)"/
  )
  if (doubleQuoteMatch) {
    return doubleQuoteMatch[1] as RecordUploadPolicy
  }

  const templateLiteralMatch = configSource.match(
    /record\s*:\s*\{[\s\S]*?upload\s*:\s*`(passed-only|all-or-nothing)`/
  )
  return templateLiteralMatch?.[1] as RecordUploadPolicy | undefined
}

export function extractMockRecordLiteral(
  configSource: string
): boolean | undefined {
  const match = configSource.match(
    /test\s*:\s*\{[\s\S]*?mockRecord\s*:\s*(true|false)/
  )

  if (!match) return undefined

  return match[1] === 'true'
}

function resolveRecordUploadPolicy(config: ScreenCIConfig): RecordUploadPolicy {
  return config.record?.upload ?? DEFAULT_RECORD_UPLOAD_POLICY
}

async function tryReadConfigFromSource(resolvedConfigPath: string): Promise<
  Pick<ScreenCIConfig, 'projectName'> & {
    envFile?: string
    record?: { upload?: RecordUploadPolicy }
    test?: { mockRecord?: boolean }
  }
> {
  const configSource = await readFile(resolvedConfigPath, 'utf-8')
  const projectName = extractConfigStringLiteral(configSource, 'projectName')

  if (!projectName) {
    throw new Error(
      'Could not determine projectName from screenci.config.ts without importing it.'
    )
  }

  const envFile = extractConfigStringLiteral(configSource, 'envFile')
  const recordUpload = extractRecordUploadPolicyLiteral(configSource)
  const mockRecord = extractMockRecordLiteral(configSource)

  return {
    projectName,
    ...(envFile !== undefined ? { envFile } : {}),
    ...(recordUpload !== undefined ? { record: { upload: recordUpload } } : {}),
    ...(mockRecord !== undefined ? { test: { mockRecord } } : {}),
  }
}

export function getConfigModuleSpecifier(resolvedConfigPath: string): string {
  if (
    process.platform === 'win32' &&
    /^[A-Za-z]:[\\/]/.test(resolvedConfigPath)
  ) {
    return encodeURI(`file:///${resolvedConfigPath.replace(/\\/g, '/')}`)
  }

  return pathToFileURL(resolvedConfigPath).href
}

async function loadRecordConfigWithoutPlaywrightCollision(
  resolvedConfigPath: string
): Promise<ScreenCIConfig> {
  try {
    const configModule = await import(
      getConfigModuleSpecifier(resolvedConfigPath)
    )
    return configModule.default as ScreenCIConfig
  } catch (err) {
    const hasPlaywrightCollision =
      err instanceof Error &&
      err.message.includes('Requiring @playwright/test second time')

    if (hasPlaywrightCollision) {
      logger.warn(
        'Playwright was loaded from multiple module paths. Falling back to static config parsing for upload metadata.'
      )
    }

    try {
      return (await tryReadConfigFromSource(
        resolvedConfigPath
      )) as ScreenCIConfig
    } catch {
      // Preserve the original import error when static parsing cannot recover.
    }

    throw err
  }
}

export async function requireScreenCISecret(configPath?: string): Promise<{
  resolvedConfigPath: string
  screenciConfig: ScreenCIConfig
  secret: string
  apiUrl: string
}> {
  const { resolvedConfigPath, screenciConfig } =
    await loadScreenCIConfigAndEnv(configPath)
  const secret = process.env.SCREENCI_SECRET
  if (!secret) {
    // These commands need a real account (unlike `record`, which can upload
    // anonymously): guide the user to copy their secret and exit non-zero.
    const envFilePath = await resolveProjectEnvFilePath(resolvedConfigPath)
    logger.error(
      `No SCREENCI_SECRET configured. Copy your secret from ${pc.cyan(getScreenCISecretsUrl())} into ${envFilePath}.`
    )
    logScreenCISecretGuide()
    process.exit(1)
  }

  return {
    resolvedConfigPath,
    screenciConfig,
    secret,
    apiUrl: getDevBackendUrl(),
  }
}

async function updateVideoVisibility(
  videoId: string,
  isPublic: boolean,
  configPath?: string
): Promise<void> {
  const { secret, apiUrl } = await requireScreenCISecret(configPath)
  const method = isPublic ? 'PUT' : 'DELETE'
  const res = await fetch(`${apiUrl}/cli/public-video/${videoId}`, {
    method,
    headers: {
      'X-ScreenCI-Secret': secret,
    },
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(
      `Failed to ${isPublic ? 'make public' : 'make private'}: ${res.status} ${extractBackendError(text)}${hint401(res.status, secret)}`
    )
  }

  logger.info(`${isPublic ? 'Made public' : 'Made private'}: ${videoId}`)
}

// Deletes a video by the same id used for make-public/make-private (from
// `screenci info`). Resolves the video's name first so the confirmation prompt
// can show it; `skipConfirm` (from `-y/--yes`) bypasses the prompt for CI.
async function deleteVideoCommand(
  videoId: string,
  skipConfirm: boolean,
  configPath?: string
): Promise<void> {
  const { secret, apiUrl } = await requireScreenCISecret(configPath)
  const headers = { 'X-ScreenCI-Secret': secret }

  const summaryRes = await fetch(`${apiUrl}/cli/video/${videoId}`, {
    method: 'GET',
    headers,
  })

  if (summaryRes.status === 404) {
    throw new Error(`Video not found: ${videoId}`)
  }
  if (!summaryRes.ok) {
    const text = await summaryRes.text()
    throw new Error(
      `Failed to look up video: ${summaryRes.status} ${extractBackendError(text)}${hint401(summaryRes.status, secret)}`
    )
  }

  const { name } = (await summaryRes.json()) as { name: string }

  if (!skipConfirm) {
    const confirmed = await confirm({
      message: `Delete video "${name}" (${videoId})? This cannot be undone.`,
      default: false,
    })
    if (!confirmed) {
      logger.info('Aborted.')
      return
    }
  }

  const res = await fetch(`${apiUrl}/cli/video/${videoId}`, {
    method: 'DELETE',
    headers,
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(
      `Failed to delete: ${res.status} ${extractBackendError(text)}${hint401(res.status, secret)}`
    )
  }

  logger.info(`Deleted: ${name} (${videoId})`)
}

// Extract a `--grep <value>` / `--grep=<value>` from the pass-through args so a
// remote trigger can forward it as a filter (records only matching videos).
export function extractGrep(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === undefined) continue
    if (arg === '--grep' || arg === '-g') {
      return args[i + 1]
    }
    if (arg.startsWith('--grep=')) {
      return arg.slice('--grep='.length)
    }
  }
  return undefined
}

// `screenci record --remote` triggers the project's GitHub Actions recording
// workflow instead of recording locally. The project is resolved from the
// existing SCREENCI_SECRET + config `projectName`, exactly like the other
// authenticated commands; the backend dispatches the workflow using the GitHub
// token stored for the project. An optional `--grep` records only matching
// videos/screenshots.
async function triggerRemoteRun(
  configPath?: string,
  grep?: string,
  languages?: string
): Promise<void> {
  const { screenciConfig, secret, apiUrl } =
    await requireScreenCISecret(configPath)

  const res = await fetch(`${apiUrl}/cli/trigger-run`, {
    method: 'POST',
    headers: {
      'X-ScreenCI-Secret': secret,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      projectName: screenciConfig.projectName,
      ...(grep ? { grep } : {}),
      ...(languages ? { languages } : {}),
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(
      `Failed to trigger remote run: ${res.status} ${extractBackendError(text)}${hint401(res.status, secret)}`
    )
  }

  const filters = [
    ...(grep ? [`filter: ${grep}`] : []),
    ...(languages ? [`languages: ${languages}`] : []),
  ]
  logger.info(
    filters.length > 0
      ? `Triggered the remote recording workflow for "${screenciConfig.projectName}" (${filters.join(', ')}).`
      : `Triggered the remote recording workflow for "${screenciConfig.projectName}".`
  )
}

function getRecordRunLockPath(screenciDir: string): string {
  return resolve(screenciDir, SCREENCI_RECORD_LOCK_FILE)
}

function defaultIsPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false

  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') {
      return false
    }
    return true
  }
}

function parseRecordRunLock(raw: string): RecordRunLock | null {
  try {
    const parsed = JSON.parse(raw) as {
      pid?: unknown
      startedAt?: unknown
      projectName?: unknown
    }
    return typeof parsed.pid === 'number' &&
      Number.isInteger(parsed.pid) &&
      parsed.pid > 0 &&
      typeof parsed.startedAt === 'string' &&
      parsed.startedAt.length > 0 &&
      typeof parsed.projectName === 'string' &&
      parsed.projectName.length > 0
      ? {
          pid: parsed.pid,
          startedAt: parsed.startedAt,
          projectName: parsed.projectName,
        }
      : null
  } catch {
    return null
  }
}

function isRecordRunLockStale(
  lock: RecordRunLock,
  now: Date,
  isPidAlive: (pid: number) => boolean,
  maxAgeMs: number
): boolean {
  const startedAtMs = Date.parse(lock.startedAt)
  if (Number.isNaN(startedAtMs)) return true
  if (now.getTime() - startedAtMs > maxAgeMs) return true
  return !isPidAlive(lock.pid)
}

function formatRecordRunLockError(lock: RecordRunLock): string {
  return `Another 'screenci record' is in progress (pid ${lock.pid}, started ${lock.startedAt}, project "${lock.projectName}"). Wait for it or remove .screenci/.record.lock.`
}

export async function acquireRecordRunLock(
  screenciDir: string,
  projectName: string,
  deps: Partial<AcquireRecordRunLockDeps> = {}
): Promise<{ release: () => Promise<void> }> {
  const resolvedDeps: AcquireRecordRunLockDeps = {
    fs: deps.fs ?? { mkdir, readFile, writeFile, rm },
    clock: deps.clock ?? (() => new Date()),
    isPidAlive: deps.isPidAlive ?? defaultIsPidAlive,
    pid: deps.pid ?? process.pid,
    addSignalListener: deps.addSignalListener ?? process.on.bind(process),
    removeSignalListener:
      deps.removeSignalListener ?? process.off.bind(process),
    removeLockSync:
      deps.removeLockSync ??
      ((lockPath) => {
        rmSync(lockPath, { force: true })
      }),
    maxAgeMs: deps.maxAgeMs ?? SCREENCI_RECORD_LOCK_MAX_AGE_MS,
  }
  const lockPath = getRecordRunLockPath(screenciDir)
  const lock: RecordRunLock = {
    pid: resolvedDeps.pid,
    startedAt: resolvedDeps.clock().toISOString(),
    projectName,
  }

  await resolvedDeps.fs.mkdir(screenciDir, { recursive: true })

  for (;;) {
    try {
      await resolvedDeps.fs.writeFile(
        lockPath,
        `${JSON.stringify(lock, null, 2)}\n`,
        { flag: 'wx' }
      )
      break
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !('code' in error) ||
        error.code !== 'EEXIST'
      ) {
        throw error
      }

      let existingLock: RecordRunLock | null = null
      try {
        existingLock = parseRecordRunLock(
          await resolvedDeps.fs.readFile(lockPath, 'utf-8')
        )
      } catch {
        existingLock = null
      }

      if (
        existingLock !== null &&
        !isRecordRunLockStale(
          existingLock,
          resolvedDeps.clock(),
          resolvedDeps.isPidAlive,
          resolvedDeps.maxAgeMs
        )
      ) {
        throw new Error(formatRecordRunLockError(existingLock))
      }

      await resolvedDeps.fs.rm(lockPath, { force: true })
    }
  }

  let released = false

  const removeLockSync = () => {
    if (released) return
    released = true
    resolvedDeps.removeSignalListener('SIGINT', handleSigint)
    resolvedDeps.removeSignalListener('SIGTERM', handleSigterm)
    try {
      resolvedDeps.removeLockSync(lockPath)
    } catch {
      // best-effort during signal shutdown
    }
  }

  const release = async () => {
    if (released) return
    released = true
    resolvedDeps.removeSignalListener('SIGINT', handleSigint)
    resolvedDeps.removeSignalListener('SIGTERM', handleSigterm)
    try {
      await resolvedDeps.fs.rm(lockPath, { force: true })
    } catch {
      // best-effort cleanup
    }
  }

  const handleSigint = () => removeLockSync()
  const handleSigterm = () => removeLockSync()

  resolvedDeps.addSignalListener('SIGINT', handleSigint)
  resolvedDeps.addSignalListener('SIGTERM', handleSigterm)

  return { release }
}

function getLastRecordFilePath(screenciDir: string): string {
  return resolve(screenciDir, SCREENCI_LAST_RECORD_FILE)
}

/**
 * Persists the recordId of the just-completed `screenci record` upload so a
 * later `screenci info` can report exactly that run. Best-effort: a
 * failure to write must not fail the record command.
 */
async function saveLastRecordId(
  screenciDir: string,
  recordId: string
): Promise<void> {
  try {
    mkdirSync(screenciDir, { recursive: true })
    await writeFile(
      getLastRecordFilePath(screenciDir),
      `${JSON.stringify({ recordId, savedAt: new Date().toISOString() }, null, 2)}\n`
    )
  } catch (err) {
    logger.warn(
      `Failed to record run id for info: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}

async function readLastRecordId(screenciDir: string): Promise<string | null> {
  try {
    const raw = await readFile(getLastRecordFilePath(screenciDir), 'utf-8')
    const parsed = JSON.parse(raw) as { recordId?: unknown }
    return typeof parsed.recordId === 'string' ? parsed.recordId : null
  } catch (err) {
    if (!isMissingFileError(err)) {
      logger.warn(
        `Ignoring invalid stored record at ${getLastRecordFilePath(screenciDir)}.`
      )
    }
    return null
  }
}

// `screenci info` prints every project video and its public URLs as JSON. When
// this machine has recorded a run (a recordId is stored in
// .screenci/last-record.json), the backend also attaches, to the videos from
// that run, a per-language `latestRecord` with render status and record-pinned
// URLs. Without a local run, only the project-wide listing with `static` URLs is
// returned. The server does the merge; the CLI just passes the recordId.
async function printInfo(configPath?: string): Promise<void> {
  const { resolvedConfigPath, screenciConfig, secret, apiUrl } =
    await requireScreenCISecret(configPath)

  const screenciDir = resolve(dirname(resolvedConfigPath), '.screenci')
  const recordId = await readLastRecordId(screenciDir)

  const url = new URL(`${apiUrl}/cli/info`)
  url.searchParams.set('projectName', screenciConfig.projectName)
  if (recordId) url.searchParams.set('record', recordId)

  const res = await fetch(url.toString(), {
    headers: { 'X-ScreenCI-Secret': secret },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(
      `Failed to fetch info: ${res.status} ${extractBackendError(text)}${hint401(res.status, secret)}`
    )
  }

  const data = await res.json()
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`)
}

/**
 * Resolves the credential `record`'s upload should authenticate with. A real
 * SCREENCI_SECRET wins outright. Otherwise, checks the locally stored anon
 * trial token: `claimed` self-upgrades by writing the real secret into `.env`
 * and deleting the local anon state (no manual step required); every other
 * status proceeds with the anon token. Whether an anonymous recording is
 * allowed to start at all is decided before recording (see
 * `ensureAnonRecordingAllowedOrExit`), so this function does not re-gate or
 * silently mint a new trial here; the server-side one-call cap remains the
 * final backstop.
 */
export async function resolveUploadCredential(
  screenciDir: string,
  apiUrl: string,
  envFilePath: string,
  secretFromEnv: string | undefined
): Promise<{ credential: CliCredential; usedAnonCredential: boolean }> {
  if (secretFromEnv) {
    return {
      credential: secretCredential(secretFromEnv),
      usedAnonCredential: false,
    }
  }

  const token = await getOrCreateAnonToken(screenciDir)
  const status = await checkAnonSessionStatus(token, { backendUrl: apiUrl })

  if (status.status === 'claimed') {
    await persistScreenCISecret(envFilePath, status.secret)
    await deleteAnonSessionFile(screenciDir)
    logger.info(
      `Your SCREENCI_SECRET was added to ${pathRelative(process.cwd(), envFilePath)}`
    )
    return {
      credential: secretCredential(status.secret),
      usedAnonCredential: false,
    }
  }

  return { credential: anonCredential(token), usedAnonCredential: true }
}

/**
 * Pre-recording gate for anonymous trials. Runs before Playwright so a spent
 * or expired trial never wastes a full recording only to be refused at upload.
 * With a real SCREENCI_SECRET present this is a no-op. Otherwise it checks the
 * local anon token's server status and, when the one free trial is already
 * used or the session has expired, prints a sign-up message and exits without
 * recording. A first-run, pending-unused, or claimed session proceeds (the
 * upload path handles the claimed self-upgrade).
 */
export async function ensureAnonRecordingAllowedOrExit(
  screenciDir: string,
  apiUrl: string,
  appUrl: string,
  secretFromEnv: string | undefined
): Promise<void> {
  if (secretFromEnv) return

  const token = await getOrCreateAnonToken(screenciDir)
  const status = await checkAnonSessionStatus(token, { backendUrl: apiUrl })
  const gate = evaluateAnonRecordingGate(status)
  if (gate.allowed) {
    // Surface the Terms up front, before Playwright records and before any
    // upload. Skip a `claimed` session: that user already accepted the
    // versioned Terms when they signed up (the upload path self-upgrades).
    if (status.status !== 'claimed') {
      logger.info(formatAnonTermsNotice())
    }
    return
  }

  const intro =
    gate.reason === 'expired'
      ? 'Your free ScreenCI trial has expired.'
      : "You've used all your free ScreenCI trial recordings."
  const previousRecordUrl =
    gate.reason === 'used' ? await readAnonSessionRecordUrl(screenciDir) : null
  logger.error(
    `${intro}\n` +
      (previousRecordUrl
        ? `Previous recording: ${pc.cyan(previousRecordUrl)}\n`
        : '') +
      `Sign up to keep recording (no watermark, no limits): ${pc.cyan(appUrl)}\n` +
      'After signing up, re-run this command in the same folder and it links automatically.'
  )
  process.exit(1)
}

// Uploads the recordings already written under `.screenci` for the resolved
// config. Shared by `record` (after a Playwright run) and `retry` (which
// re-sends the existing recordings without re-running Playwright). A non-null
// `playwrightFailure` means the preceding record run had failures, which tunes
// the messaging and the upload policy; `retry` always passes null.
async function uploadRecordedVideosForConfig(
  configPath: string | undefined,
  playwrightFailure: Error | null,
  verbose: boolean,
  requestedVideoNames?: readonly string[]
): Promise<void> {
  // After recording, upload results to API if configured. `run` already
  // resolved the config (or exited), so this best-effort lookup only acts
  // when a flat config is present in/under the current directory.
  const resolution = findScreenCIConfig(configPath)
  if (resolution.kind !== 'found') return

  const resolvedConfigPath = resolution.path
  try {
    const screenciConfig =
      await loadRecordConfigWithoutPlaywrightCollision(resolvedConfigPath)
    loadEnvFile(
      screenciConfig.envFile
        ? resolve(dirname(resolvedConfigPath), screenciConfig.envFile)
        : resolve(dirname(resolvedConfigPath), '.env'),
      true
    )
    const apiUrl = getDevBackendUrl()
    const appUrl = getDevFrontendUrl()
    const uploadPolicy = resolveRecordUploadPolicy(screenciConfig)
    const configDir = dirname(resolvedConfigPath)
    const screenciDir = resolve(configDir, '.screenci')
    const envFilePath = screenciConfig.envFile
      ? resolve(configDir, screenciConfig.envFile)
      : resolve(configDir, '.env')
    const completedRecordingCount = await countCompletedRecordings(screenciDir)

    const { credential, usedAnonCredential } = await resolveUploadCredential(
      screenciDir,
      apiUrl,
      envFilePath,
      process.env.SCREENCI_SECRET
    )

    if (playwrightFailure !== null && completedRecordingCount === 0) {
      logger.info('All recordings failed.')
    } else if (
      playwrightFailure !== null &&
      uploadPolicy === 'all-or-nothing'
    ) {
      logger.info(
        'Some recordings failed, skipping upload because record.upload is "all-or-nothing".'
      )
    } else {
      if (playwrightFailure !== null && uploadPolicy === 'passed-only') {
        logger.warn('Some recordings failed, uploading successful videos only.')
      }
      let uploadResult: {
        projectId: string | null
        recordId: string | null
        hadFailures: boolean
        uploadedVideoNames: string[]
        failedVideoNames: string[]
        failedVideoMessages: Array<{ videoName: string; message: string }>
        studioNotices: StudioUploadNotice[]
        elevenLabsKeyMissingVideos: string[]
        notices: string[]
        plan: OrgPlan | null
      } = {
        projectId: null,
        recordId: null,
        hadFailures: false,
        uploadedVideoNames: [],
        failedVideoNames: [],
        failedVideoMessages: [],
        studioNotices: [],
        elevenLabsKeyMissingVideos: [],
        notices: [],
        plan: null,
      }
      try {
        uploadResult = await uploadRecordings(
          screenciDir,
          screenciConfig.projectName,
          apiUrl,
          credential,
          undefined,
          verbose,
          requestedVideoNames
        )
      } catch (err) {
        if (isUploadCancelledError(err)) {
          process.exit(130)
        }
        throw err
      }
      const {
        projectId,
        recordId,
        hadFailures,
        uploadedVideoNames,
        failedVideoNames,
        failedVideoMessages,
        studioNotices,
        elevenLabsKeyMissingVideos,
        notices,
        plan,
      } = uploadResult
      const requestedUploadSucceeded =
        !hadFailures &&
        (requestedVideoNames === undefined ||
          requestedVideoNames.every((videoName) =>
            uploadedVideoNames.includes(videoName)
          ))
      // Remember this run so `screenci info` can report exactly it.
      if (recordId !== null && requestedUploadSucceeded) {
        await saveLastRecordId(screenciDir, recordId)
      }
      // Emit upload-failure warnings (stderr) before the results block.
      // logger.info writes to stdout, logger.warn to stderr; in non-TTY CI
      // logs stdout is block-buffered while stderr flushes immediately, so
      // warnings printed after the "Results available at:" line would split
      // it from its URL. Reporting failures first keeps the URL directly
      // under its message.
      if (hadFailures) {
        for (const warning of collapseFailedVideoWarnings(
          failedVideoMessages
        )) {
          logger.warn(warning)
        }
        logger.warn(
          `Not all recordings succeeded to upload. Failed videos: ${formatFailedVideoNamesSummary(failedVideoNames)}. Some videos may be missing from the project.`
        )
      }
      let resultUrl: string | null = null
      if (requestedUploadSucceeded && recordId !== null && projectId !== null) {
        const recordUrl = `${appUrl}/record/${recordId}`
        resultUrl = recordUrl
        await writeGitHubProjectOutput(recordUrl)
        logger.info('')
        logger.info(
          playwrightFailure !== null
            ? 'Recording partially succeeded, rendering in progress. Results available at:'
            : 'Recording finished, rendering in progress. Results available at:'
        )
        logger.info(pc.cyan(recordUrl))
      } else if (requestedUploadSucceeded && projectId !== null) {
        const projectUrl = `${appUrl}/project/${projectId}`
        resultUrl = projectUrl
        await writeGitHubProjectOutput(projectUrl)
        logger.info('')
        logger.info(
          playwrightFailure !== null
            ? 'Recording partially succeeded, rendering in progress. Results available at:'
            : 'Recording finished, rendering in progress. Results available at:'
        )
        logger.info(pc.cyan(projectUrl))
      }
      if (usedAnonCredential && resultUrl !== null) {
        try {
          await saveAnonSessionRecordUrl(
            screenciDir,
            credential.value,
            resultUrl
          )
        } catch (err) {
          logger.warn(
            `Failed to remember anonymous recording URL: ${err instanceof Error ? err.message : String(err)}`
          )
        }
        // Report how many trial recordings remain after this run. Best-effort:
        // checkAnonSessionStatus never throws (it falls back on failure), so a
        // transient outage just shows the optimistic remaining count.
        const postStatus = await checkAnonSessionStatus(credential.value, {
          backendUrl: apiUrl,
        })
        if (postStatus.status === 'pending') {
          logger.info(formatAnonPostRecordNotice(postStatus.remaining))
        } else {
          logger.info(`Recorded without an account. Sign up to keep it.`)
        }
      }
      if (notices.length > 0) {
        logger.info('')
        for (const notice of notices) {
          logger.notice(notice)
        }
      }
      if (projectId !== null && plan === 'starter') {
        logger.info('')
        logger.info(
          'Upgrade for more renders, more active videos, and expressive narration:'
        )
        logger.info(pc.cyan(`${appUrl}/select-plan`))
      }
      for (const notice of studioNotices) {
        if ('held' in notice.studio) {
          logger.info('')
          logger.info(
            `Rendering for "${notice.videoName}" is on hold. Configure it in Studio:`
          )
          if (projectId !== null && notice.videoId !== null) {
            logger.info(
              pc.cyan(formatStudioUrl(appUrl, projectId, notice.videoId))
            )
          }
        } else if (notice.studio.applied) {
          logger.info('')
          logger.info(`Studio configuration applied for "${notice.videoName}".`)
        }
      }
      if (elevenLabsKeyMissingVideos.length > 0) {
        const names = elevenLabsKeyMissingVideos
          .map((name) => `"${name}"`)
          .join(', ')
        logger.info('')
        logger.error(
          `${names} ${elevenLabsKeyMissingVideos.length === 1 ? 'uses' : 'use'} an ElevenLabs or custom voice, but your organization has no ElevenLabs API key, so ${elevenLabsKeyMissingVideos.length === 1 ? 'its render' : 'those renders'} will fail. Add your key on the Secrets page:`
        )
        logger.info(pc.cyan(getScreenCISecretsUrl()))
      }
      if (hadFailures && playwrightFailure === null) {
        throw new PartialUploadError()
      }
    }
  } catch (err) {
    if (isPartialUploadError(err)) {
      throw err
    }
    logger.warn('Failed to load config for upload:', err)
  }
}

export async function main() {
  if (process.argv.length <= 2) {
    logger.error('Error: No command provided')
    logger.error(
      'Available commands: record, test, info, make-public, make-private, delete, init'
    )
    process.exit(1)
  }

  const program = new Command()
  const defaultPackageManager = determinePackageManager()
  program.name('screenci')
  program.exitOverride()

  // record command — playwright args pass through as-is
  program
    .command('record [playwrightArgs...]')
    .description('Record videos using Playwright')
    .option('-v, --verbose', 'verbose output')
    .option(
      '--remote',
      'trigger the GitHub Actions recording workflow for this project remotely instead of recording locally'
    )
    .option(
      '--languages <langs>',
      'record/render only these languages (comma-separated, e.g. fi,en)'
    )
    .allowUnknownOption(true)
    .action(async () => {
      const parsed = parseRecordCliArgs(getSubcommandArgv('record'))

      // `--remote` is a pure dispatch: it fires the project's GitHub Actions
      // recording workflow and exits, so there is no local Playwright run. A
      // pass-through `--grep` becomes the remote recording filter, and
      // `--languages` limits which language versions are recorded.
      if (parsed.remote) {
        await triggerRemoteRun(
          parsed.configPath,
          extractGrep(parsed.otherArgs),
          parsed.languages
        )
        return
      }

      validateArgs(parsed.otherArgs)

      const resolvedConfigPath = resolveScreenCIConfigPathOrExit(
        parsed.configPath
      )
      await loadEnvFileFromConfigSource(resolvedConfigPath, false)
      const screenciConfig =
        await loadRecordConfigWithoutPlaywrightCollision(resolvedConfigPath)
      const screenciDir = resolve(dirname(resolvedConfigPath), '.screenci')
      const requestedVideoNames =
        parsed.otherArgs.length > 0 || parsed.languages !== undefined
          ? await collectRequestedRecordVideoNames(
              resolvedConfigPath,
              parsed.otherArgs,
              parsed.languages
            )
          : undefined
      const recordRunLock = await acquireRecordRunLock(
        screenciDir,
        screenciConfig.projectName
      )

      try {
        let playwrightFailure: Error | null = null

        // UPLOAD_EXISTING re-sends the recordings already on disk under `.screenci`
        // without re-running Playwright (resend the last local run when only the
        // upload failed). We skip the recording run and fall straight through to
        // the upload below, treating the on-disk recordings as the complete set.
        const uploadExisting = isUploadExistingEnabled()

        if (!uploadExisting) {
          try {
            await run(
              'record',
              parsed.otherArgs,
              parsed.configPath,
              parsed.verbose,
              false,
              parsed.languages
            )
          } catch (error) {
            if (!(error instanceof Error)) throw error
            if (error.message.startsWith('Playwright exited with code ')) {
              playwrightFailure = new RecordFailureHintError(error)
            } else {
              throw new RecordFailureHintError(error)
            }
          }
        } else {
          logger.info(
            'UPLOAD_EXISTING set: skipping Playwright recording and re-uploading existing .screenci recordings.'
          )
        }

        if (process.env.SCREENCI_RECORDING === 'true') return

        await uploadRecordedVideosForConfig(
          parsed.configPath,
          playwrightFailure,
          parsed.verbose,
          requestedVideoNames
        )

        if (playwrightFailure !== null) {
          throw playwrightFailure
        }
      } finally {
        await recordRunLock.release()
      }
    })

  program
    .command('test [playwrightArgs...]')
    .description('Run Playwright test with screenci.config.ts')
    .option(
      '--mock-record',
      'keep recording-style cursor animation and sleeps during screenci test'
    )
    .option('-v, --verbose', 'verbose output')
    .allowUnknownOption(true)
    .action(async () => {
      const parsed = parseConfigCliArgs(getSubcommandArgv('test'))
      let configMockRecord = false

      // Best-effort env preload before handing off to `run`, which performs the
      // authoritative resolution (and emits the `cd screenci` guidance on miss).
      const resolution = findScreenCIConfig(parsed.configPath)
      if (resolution.kind === 'found') {
        const resolvedConfigPath = resolution.path
        try {
          const screenciConfig =
            await loadRecordConfigWithoutPlaywrightCollision(resolvedConfigPath)
          configMockRecord = screenciConfig.test?.mockRecord ?? false
          if (screenciConfig.envFile) {
            const envFilePath = resolve(
              dirname(resolvedConfigPath),
              screenciConfig.envFile
            )
            loadEnvFile(envFilePath, true)
          }
        } catch (err) {
          logger.warn('Failed to load config for test env:', err)
        }
      }

      await run(
        'test',
        parsed.otherArgs,
        parsed.configPath,
        parsed.verbose,
        parsed.mockRecord || configMockRecord
      )

      if (process.env.SCREENCI_RECORDING === 'true') return

      const recordCommand = getSuggestedScreenciCommand('record')
      logger.info(
        `Tests passed. Run ${pc.cyan(recordCommand)} to render the videos.`
      )
    })

  program
    .command('info')
    .description(
      "Print the latest record run's video URLs and render status as JSON"
    )
    .option('-c, --config <path>', 'path to screenci.config.ts')
    .action(async (options: Record<string, unknown>) => {
      await printInfo(options['config'] as string | undefined)
    })

  program
    .command('make-public <id>')
    .description(
      'Enable public URLs for a video; get the id from screenci info'
    )
    .option('-c, --config <path>', 'path to screenci.config.ts')
    .action(async (id: string, options: Record<string, unknown>) => {
      await updateVideoVisibility(
        id,
        true,
        options['config'] as string | undefined
      )
    })

  program
    .command('make-private <id>')
    .description(
      'Disable public URLs for a video; get the id from screenci info'
    )
    .option('-c, --config <path>', 'path to screenci.config.ts')
    .action(async (id: string, options: Record<string, unknown>) => {
      await updateVideoVisibility(
        id,
        false,
        options['config'] as string | undefined
      )
    })

  program
    .command('delete <id>')
    .description(
      'Delete a video and its renders; get the id from screenci info'
    )
    .option('-c, --config <path>', 'path to screenci.config.ts')
    .option('-y, --yes', 'skip the confirmation prompt')
    .action(async (id: string, options: Record<string, unknown>) => {
      await deleteVideoCommand(
        id,
        (options['yes'] as boolean | undefined) ?? false,
        options['config'] as string | undefined
      )
    })

  // init command
  const initCommand = program
    .command('init [name]')
    .description('Initialize a new screenci project')
    .option(
      '--agent <name>',
      'target agent for skills install, e.g. opencode. Supported agents: https://github.com/vercel-labs/skills#supported-agents'
    )
    .option(
      '--package-manager <manager>',
      `package manager to use: npm, pnpm, or yarn 2+ (default: ${defaultPackageManager})`
    )
    .option('-y, --yes', 'accept init defaults')
    .option('-v, --verbose', 'verbose output')
  registerInitToggleOptions(initCommand)
  initCommand.action(
    async (name: string | undefined, options: Record<string, unknown>) => {
      const agent = options['agent'] as string | undefined
      await runInit(name, {
        verbose: (options['verbose'] as boolean | undefined) ?? false,
        yes: (options['yes'] as boolean | undefined) ?? false,
        packageManager: parsePackageManager(
          options['packageManager'] as string | undefined,
          process.env['SCREENCI_INIT_CWD'] ?? process.cwd()
        ),
        ...(agent !== undefined ? { agent } : {}),
        ...initToggleOptionsFromCommander(options),
      })
    }
  )

  try {
    await program.parseAsync(process.argv)
  } catch (err) {
    if (err instanceof CommanderError) {
      if (err.code === 'commander.unknownCommand') {
        const unknownCmd = process.argv[2] ?? ''
        logger.error(`Unknown command: ${unknownCmd}`)
        process.exit(1)
      }
      if (err.code === 'commander.optionMissingArgument') {
        if (
          err.message.includes('--config') ||
          err.message.includes('-c, --config') ||
          err.message.includes("'-c'")
        ) {
          logger.error('Error: --config requires a path argument')
          process.exit(1)
        }
        logger.error(`Error: ${err.message}`)
        process.exit(1)
      }
      if (
        err.code === 'commander.help' ||
        err.code === 'commander.helpDisplayed'
      ) {
        return
      }
      logger.error(`Error: ${err.message}`)
      process.exit(1)
      return
    }
    throw err
  }
}

function getSubcommandArgv(command: string): string[] {
  const argv = process.argv.slice(2)
  const commandIndex = argv.indexOf(command)
  return commandIndex === -1 ? [] : argv.slice(commandIndex + 1)
}

export function parseRecordCliArgs(args: string[]): {
  configPath: string | undefined
  verbose: boolean
  remote: boolean
  languages: string | undefined
  otherArgs: string[]
} {
  let configPath: string | undefined
  let verbose = false
  let remote = false
  let languages: string | undefined
  const otherArgs: string[] = []

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === undefined) continue
    if (arg === '--config' || arg === '-c') {
      const nextArg = args[i + 1]
      if (nextArg === undefined) {
        logger.error('Error: --config requires a path argument')
        process.exit(1)
      }
      configPath = nextArg
      i++
    } else if (arg === '--languages' || arg === '--language') {
      // screenci-only flag: parsed out so it is not forwarded to Playwright.
      const nextArg = args[i + 1]
      if (nextArg === undefined) {
        logger.error('Error: --languages requires a comma-separated value')
        process.exit(1)
      }
      languages = nextArg
      i++
    } else if (
      arg.startsWith('--languages=') ||
      arg.startsWith('--language=')
    ) {
      languages = arg.slice(arg.indexOf('=') + 1)
    } else if (arg === '--verbose' || arg === '-v') {
      verbose = true
    } else if (arg === '--remote') {
      remote = true
    } else {
      otherArgs.push(arg)
    }
  }

  return {
    configPath,
    verbose,
    remote,
    languages,
    otherArgs,
  }
}

function parseConfigCliArgs(args: string[]): {
  configPath: string | undefined
  verbose: boolean
  mockRecord: boolean
  otherArgs: string[]
} {
  let configPath: string | undefined
  let verbose = false
  let mockRecord = false
  const otherArgs: string[] = []

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === undefined) continue
    if (arg === '--config' || arg === '-c') {
      const nextArg = args[i + 1]
      if (nextArg === undefined) {
        logger.error('Error: --config requires a path argument')
        process.exit(1)
      }
      configPath = nextArg
      i++
    } else if (arg === '--verbose' || arg === '-v') {
      verbose = true
    } else if (arg === '--mock-record') {
      mockRecord = true
    } else {
      otherArgs.push(arg)
    }
  }

  return { configPath, verbose, mockRecord, otherArgs }
}

function validateArgs(args: string[]): void {
  const disallowedFlags = ['--retries']

  for (const arg of args) {
    if (arg === undefined) continue

    // Check if it's a disallowed flag
    if (disallowedFlags.includes(arg)) {
      throw new Error(
        `Flag "${arg}" is not supported by screenci. ` +
          'screenci forces retries to 0 for proper video recording.'
      )
    }

    // Check if it's a --retries=N format
    if (arg.startsWith('--retries=')) {
      throw new Error(
        `Flag "${arg}" is not supported by screenci. ` +
          'screenci forces retries to 0 for proper video recording.'
      )
    }
  }
}

/**
 * Fetch the project's current Studio text-field overrides so they can be
 * injected as SCREENCI_VALUES_OVERRIDES before a recording. On-screen `values`
 * fields render during the recording (they cannot be patched at render time),
 * so any Studio edits must be present here; code-declared seeds are the
 * fallback. Best-effort: any failure returns an empty env so the SDK uses the
 * code seeds, and a recording is never blocked by this fetch.
 */
async function fetchTextOverridesEnv(
  configPath: string,
  languages: string | undefined,
  verbose: boolean
): Promise<Record<string, string>> {
  // Studio config only exists for a real (non-anonymous) org, and record must
  // still work without an account, so skip the fetch entirely rather than
  // calling requireScreenCISecret, which would hard-exit without a secret.
  if (!process.env.SCREENCI_SECRET) return {}
  try {
    const { screenciConfig, secret, apiUrl } =
      await requireScreenCISecret(configPath)
    const params = new URLSearchParams({
      projectName: screenciConfig.projectName,
    })
    if (languages) params.set('languages', languages)

    const res = await fetch(
      `${apiUrl}/cli/text-overrides?${params.toString()}`,
      { headers: { 'X-ScreenCI-Secret': secret } }
    )
    if (!res.ok) {
      if (verbose) {
        logger.warn(
          `Could not fetch Studio text overrides (${res.status}); using code-declared values.`
        )
      }
      return {}
    }

    const body = (await res.json()) as { overrides?: unknown }
    const overrides = body.overrides
    if (
      overrides === undefined ||
      overrides === null ||
      typeof overrides !== 'object' ||
      Object.keys(overrides as Record<string, unknown>).length === 0
    ) {
      return {}
    }
    return { [SCREENCI_VALUES_OVERRIDES_ENV]: JSON.stringify(overrides) }
  } catch (error) {
    if (verbose) {
      logger.warn(
        `Could not fetch Studio text overrides; using code-declared values.${
          error instanceof Error ? ` (${error.message})` : ''
        }`
      )
    }
    return {}
  }
}

/**
 * Fetch the project's current Studio record-option overrides so they can be
 * injected as SCREENCI_RECORD_OPTIONS before a recording. Record options (aspect
 * ratio, quality, fps) change the captured viewport/encode, so any Studio edits
 * must be present here; code-declared values are the fallback. Best-effort: any
 * failure returns an empty env so the SDK uses the code values, and a recording
 * is never blocked by this fetch.
 */
async function fetchRecordOptionsEnv(
  configPath: string,
  verbose: boolean
): Promise<Record<string, string>> {
  // Studio config only exists for a real (non-anonymous) org, and record must
  // still work without an account, so skip the fetch entirely rather than
  // calling requireScreenCISecret, which would hard-exit without a secret.
  if (!process.env.SCREENCI_SECRET) return {}
  try {
    const { screenciConfig, secret, apiUrl } =
      await requireScreenCISecret(configPath)
    const params = new URLSearchParams({
      projectName: screenciConfig.projectName,
    })

    const res = await fetch(
      `${apiUrl}/cli/record-options?${params.toString()}`,
      { headers: { 'X-ScreenCI-Secret': secret } }
    )
    if (!res.ok) {
      if (verbose) {
        logger.warn(
          `Could not fetch Studio record options (${res.status}); using code-declared values.`
        )
      }
      return {}
    }

    const body = (await res.json()) as { recordOptions?: unknown }
    const recordOptions = body.recordOptions
    if (
      recordOptions === undefined ||
      recordOptions === null ||
      typeof recordOptions !== 'object' ||
      Object.keys(recordOptions as Record<string, unknown>).length === 0
    ) {
      return {}
    }
    return { [SCREENCI_RECORD_OPTIONS_ENV]: JSON.stringify(recordOptions) }
  } catch (error) {
    if (verbose) {
      logger.warn(
        `Could not fetch Studio record options; using code-declared values.${
          error instanceof Error ? ` (${error.message})` : ''
        }`
      )
    }
    return {}
  }
}

async function run(
  command: 'record' | 'test',
  additionalArgs: string[],
  customConfigPath?: string,
  verbose = false,
  mockRecord = false,
  languages?: string
) {
  const configPath = resolveScreenCIConfigPathOrExit(customConfigPath)

  if (command === 'test' || process.env.SCREENCI_RECORDING !== 'true') {
    await loadEnvFileFromConfigSource(configPath, false)
  }

  // Only validate args for record command. No secret is required here: record
  // can upload anonymously (see resolveUploadCredential), so this must not
  // hard-exit the way requireScreenCISecret does for account-only commands.
  if (command === 'record') {
    validateArgs(additionalArgs)
    const screenciDir = resolve(dirname(configPath), '.screenci')
    clearRecordingDirectories(screenciDir)
    // Refuse a second anonymous trial recording before Playwright runs, so a
    // spent or expired trial never wastes a full render only to be rejected at
    // upload. No-op when a real SCREENCI_SECRET is set (env is loaded above).
    await ensureAnonRecordingAllowedOrExit(
      screenciDir,
      getDevBackendUrl(),
      getDevFrontendUrl(),
      process.env.SCREENCI_SECRET
    )
  }

  // Studio text-field overrides are injected for the record command only: they
  // resolve in the SDK's `text` fixture before the recording runs. `test` (the
  // preview run) keeps code-declared values.
  const textOverridesEnv =
    command === 'record'
      ? await fetchTextOverridesEnv(configPath, languages, verbose)
      : {}

  // Studio record-option overrides are likewise injected for record only: they
  // resolve in the SDK's `recordOptions` fixture before the capture runs.
  const recordOptionsEnv =
    command === 'record' ? await fetchRecordOptionsEnv(configPath, verbose) : {}

  const envForChild = { ...process.env }

  await validateUniqueDiscoveredTestTitles(configPath, additionalArgs, {
    ...envForChild,
    SCREENCI_CONFIG_DIR: dirname(configPath),
    ...(command === 'record' ? { SCREENCI_RECORDING: 'true' } : {}),
    ...(command === 'record' && languages
      ? { [SCREENCI_LANGUAGES_ENV]: languages }
      : {}),
    ...textOverridesEnv,
    ...recordOptionsEnv,
    ...(command === 'test' && !mockRecord
      ? { [SCREENCI_DISABLE_RECORDING_TIMINGS_ENV]: 'true' }
      : {}),
    ...(command === 'test' && mockRecord
      ? { [SCREENCI_MOCK_RECORD_ENV]: 'true' }
      : {}),
  })

  if (verbose && process.env.SCREENCI_RECORDING !== 'true') {
    logger.info(`Using config: ${configPath}`)
  }

  const playwrightArgs = ['test', '--config', configPath, ...additionalArgs]

  const spawnSpec = resolvePlaywrightSpawnSpec(
    playwrightArgs,
    dirname(configPath)
  )
  const child = spawn(spawnSpec.command, spawnSpec.args, {
    stdio: 'inherit',
    ...(process.platform !== 'win32' ? { detached: true } : {}),
    ...(spawnSpec.shell !== undefined ? { shell: spawnSpec.shell } : {}),
    ...(spawnSpec.windowsVerbatimArguments !== undefined
      ? {
          windowsVerbatimArguments: spawnSpec.windowsVerbatimArguments,
        }
      : {}),
    env: {
      ...envForChild,
      SCREENCI_CONFIG_DIR: dirname(configPath),
      // Enable recording only for record command
      ...(command === 'record' ? { SCREENCI_RECORDING: 'true' } : {}),
      // Per-language filter: the builder records only these languages.
      ...(command === 'record' && languages
        ? { [SCREENCI_LANGUAGES_ENV]: languages }
        : {}),
      // Studio text-field overrides resolved from the backend (record only).
      ...textOverridesEnv,
      // Studio record-option overrides resolved from the backend (record only).
      ...recordOptionsEnv,
      ...(command === 'test' && !mockRecord
        ? { [SCREENCI_DISABLE_RECORDING_TIMINGS_ENV]: 'true' }
        : {}),
      ...(command === 'test' && mockRecord
        ? { [SCREENCI_MOCK_RECORD_ENV]: 'true' }
        : {}),
    },
  })
  const childSignals = forwardChildSignals(child, `screenci ${command}`, {
    killTree: process.platform !== 'win32',
    exitParentOnForward: true,
  })

  return new Promise<void>((resolve, reject) => {
    child.on('close', (code, signal) => {
      void (async () => {
        const forwardedSignal = childSignals.getForwardedSignal()
        childSignals.cleanup()

        if (forwardedSignal) {
          process.kill(process.pid, forwardedSignal)
          return
        }
        if (signal) {
          process.kill(process.pid, signal)
          return
        }
        if (code === 0) {
          resolve()
        } else {
          reject(new Error(`Playwright exited with code ${code}`))
        }
      })().catch(reject)
    })

    child.on('error', (err) => {
      childSignals.cleanup()
      reject(err)
    })
  })
}

function logRecordFailureHint(): void {
  logger.info('')
  logger.info(
    `If ${pc.cyan('screenci test')} works but ${pc.cyan(
      'screenci record'
    )} fails, try ${pc.cyan('screenci test --mock-record')}.`
  )
  logger.info(`More info: ${pc.cyan(SCREENCI_MOCK_RECORD_DOCS_URL)}`)
}

export function logCliError(error: unknown): void {
  if (isPartialUploadError(error)) {
    return
  }

  const errorToLog = isRecordFailureHintError(error) ? error.cause : error
  const message =
    errorToLog instanceof Error ? errorToLog.message : String(errorToLog)

  logger.error(message)

  if (isRecordFailureHintError(error)) {
    logRecordFailureHint()
  }
}

// Only run if this file is being executed directly
// Check if this module is the main module (handles symlinks properly)
const currentFile = fileURLToPath(import.meta.url)
const mainFile = process.argv[1] ? realpathSync(process.argv[1]) : null
const currentRealFile = realpathSync(currentFile)

if (
  mainFile &&
  (currentFile === mainFile ||
    currentRealFile === mainFile ||
    currentFile === realpathSync(mainFile))
) {
  main().catch((error) => {
    logCliError(error)
    process.exit(1)
  })
}
