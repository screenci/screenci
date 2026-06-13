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
import { appendFile, readdir, readFile, stat, writeFile } from 'fs/promises'
import { delimiter, dirname, relative as pathRelative, resolve } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { Command, CommanderError } from 'commander'
import pc from 'picocolors'
import { logger } from './src/logger.js'
import {
  determinePackageManager,
  parsePackageManager,
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
} from './src/runtimeMode.js'
import { DEFAULT_RECORD_UPLOAD_POLICY } from './src/defaults.js'
import type { VoiceKey } from './src/voices.js'
import type { RecordUploadPolicy, ScreenCIConfig } from './src/types.js'
import {
  findDuplicateTitles,
  formatDuplicateTitlesMessage,
} from './src/titleValidation.js'

const SCREENCI_MOCK_RECORD_DOCS_URL =
  'https://screenci.com/docs/reference/cli/#--mock-record'
const SCREENCI_RECORD_DOCS_URL =
  'https://screenci.com/docs/reference/cli/#screenci-record'
const SCREENCI_ENVIRONMENT_VARIABLE = 'SCREENCI_ENVIRONMENT'
const SCREENCI_ENVIRONMENT_OPTION_VALUES = ['local', 'dev', 'prod'] as const
const SCREENCI_PRODUCTION_BACKEND_URL = 'https://api.screenci.com'
const SCREENCI_PRODUCTION_FRONTEND_URL = 'https://app.screenci.com'
const SCREENCI_DEVELOPMENT_BACKEND_URL = 'https://dev.api.screenci.com'
const SCREENCI_DEVELOPMENT_FRONTEND_URL = 'https://dev.app.screenci.com'
const SCREENCI_LINK_SESSION_FILE = 'link-session.json'
const SCREENCI_LINK_SESSION_POLL_INTERVAL_MS = 2_000
const require = createRequire(import.meta.url)

type ScreenCIEnvironment = (typeof SCREENCI_ENVIRONMENT_OPTION_VALUES)[number]

type ProjectInfoVideo = {
  name: string
  id: string
  isPublic: boolean
  videoURL?: string
  thumbnailURL?: string
  subtitlesURL?: string
}

type ProjectInfoResponse = {
  projectName: string
  videos: ProjectInfoVideo[]
}

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

type LinkSessionStatus =
  | 'pending'
  | 'completed'
  | 'consumed'
  | 'expired'
  | 'invalid'

type PersistedLinkSessionSpec = {
  token: string
  appUrl: string
  pollUrl: string
  createdAt: string
  expiresAt: string
  environment: ScreenCIEnvironment
  resolvedConfigPath?: string
  envFilePath: string
}

function parseScreenCIEnvironment(
  value: string | undefined
): ScreenCIEnvironment | undefined {
  if (value === undefined) return undefined

  if (
    SCREENCI_ENVIRONMENT_OPTION_VALUES.includes(value as ScreenCIEnvironment)
  ) {
    return value as ScreenCIEnvironment
  }

  throw new Error(
    `Invalid ${SCREENCI_ENVIRONMENT_VARIABLE} "${value}". Expected one of: ${SCREENCI_ENVIRONMENT_OPTION_VALUES.join(', ')}`
  )
}

function getScreenCIEnvironment(): ScreenCIEnvironment {
  const parsed = parseScreenCIEnvironment(
    process.env[SCREENCI_ENVIRONMENT_VARIABLE]
  )
  return parsed ?? 'prod'
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

function getSuggestedScreenciCommand(command: 'record' | 'test'): string {
  const pm = determinePackageManager()
  if (pm === 'pnpm') return `pnpm exec screenci ${command}`
  if (pm === 'yarn') return `yarn screenci ${command}`
  return `npx screenci ${command}`
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
    resolve(configDir, 'videos', filePath),
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
    svg: 'image/svg+xml',
  }
  return contentTypeMap[ext] ?? 'application/octet-stream'
}

type CustomVoiceRefLike = { assetHash: string; assetPath: string }

type PreparedUploadAsset = {
  fileHash: string
  path: string
  size: number
  name?: string
  fileBuffer?: Buffer
  contentType?: string
}

type UploadCandidate = {
  entry: string
  videoName: string
  data: RecordingData
  preparedUploadAssets: PreparedUploadAsset[]
}

export type StudioAppliedChange = {
  kind?: string
  label?: string
  cue?: string
  language?: string
  from?: string
  to?: string
}

export type UploadStudioInfo =
  | { held: true }
  | { appliedChanges: StudioAppliedChange[] }

export type StudioUploadNotice = {
  videoName: string
  videoId: string | null
  studio: UploadStudioInfo
}

/**
 * One-line summary of Studio overrides for CLI output, e.g.
 * `recording.size (1 → 0.8), narration "intro" (en)`.
 */
export function formatStudioChangeSummary(
  changes: StudioAppliedChange[]
): string {
  return changes
    .map((change) => {
      const label = change.label ?? 'selection'
      if (change.kind === 'narration') {
        return change.language !== undefined
          ? `${label} (${change.language})`
          : label
      }
      return change.from !== undefined && change.to !== undefined
        ? `${label} (${change.from} → ${change.to})`
        : label
    })
    .join(', ')
}

export function formatStudioUrl(
  appUrl: string,
  projectId: string,
  videoId: string
): string {
  return `${appUrl}/project/${projectId}/video/${videoId}/studio`
}

type UploadJobResult = {
  projectId: string | null
  videoId: string | null
  hadFailure: boolean
  videoName: string
  failureMessage?: string
  recordId: string
  studio?: UploadStudioInfo
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

  return {
    entry,
    videoName,
    data: annotateRecordingDataWithAssetHashes(data, preparedUploadAssets),
    preparedUploadAssets,
  }
}

async function uploadRecordingCandidate(
  candidate: UploadCandidate,
  screenciDir: string,
  projectName: string,
  apiUrl: string,
  secret: string,
  elevenLabsApiKey: string | undefined,
  verbose: boolean,
  uploadAbort: ReturnType<typeof createUploadAbortController>,
  progressReporter: {
    complete: (index: number, status: UploadProgressStatus) => void
    info: (message: string) => void
  },
  progressIndex: number,
  recordId: string
): Promise<UploadJobResult> {
  const { entry, videoName, data, preparedUploadAssets } = candidate
  let projectId: string | null = null
  let videoId: string | null = null

  try {
    uploadAbort.throwIfAborted()
    const recordingPath = resolve(screenciDir, entry, 'recording.mp4')
    if (!existsSync(recordingPath)) {
      progressReporter.complete(progressIndex, 'failure')
      return {
        projectId: null,
        videoId: null,
        hadFailure: true,
        videoName,
        failureMessage: `Missing recording.mp4 for "${videoName}"`,
        recordId,
      }
    }

    const recordingHash = await hashFile(recordingPath)
    const startResponse = await fetch(`${apiUrl}/cli/upload/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-ScreenCI-Secret': secret,
        ...(elevenLabsApiKey
          ? { 'X-ElevenLabs-Api-Key': elevenLabsApiKey }
          : {}),
      },
      body: JSON.stringify({
        projectName,
        videoName,
        data,
        recordingHash,
        recordId,
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
    })

    if (!startResponse.ok) {
      const text = await startResponse.text()
      progressReporter.complete(progressIndex, 'failure')
      return {
        projectId: null,
        videoId: null,
        hadFailure: true,
        videoName,
        failureMessage: formatUploadStartFailureMessage(
          videoName,
          startResponse.status,
          text,
          secret
        ),
        recordId,
      }
    }

    const startBody = (await startResponse.json()) as {
      recordingId: string
      projectId: string
      videoId?: string
      studio?: UploadStudioInfo
    }
    const { recordingId } = startBody
    projectId = startBody.projectId
    videoId = startBody.videoId ?? null
    const studio = startBody.studio

    if (verbose) {
      logger.info(`recordingId=${recordingId} projectId=${projectId}`)
      logger.info(
        `assets=${preparedUploadAssets.length} recordingHash=${recordingHash ?? 'none'}`
      )
    }

    await uploadAssets(
      preparedUploadAssets,
      apiUrl,
      secret,
      recordingId,
      uploadAbort.signal,
      uploadAbort.throwIfAborted,
      progressReporter
    )

    uploadAbort.throwIfAborted()
    const fileStat = await stat(recordingPath)
    if (verbose) {
      logger.info(
        `Uploading recording.mp4 size=${(fileStat.size / 1024 / 1024).toFixed(1)}MB`
      )
    }
    const stream = createReadStream(recordingPath)
    const abortStream = () => {
      stream.destroy(
        new UploadCancelledError(`Upload cancelled for "${videoName}"`)
      )
    }
    uploadAbort.signal.addEventListener('abort', abortStream, {
      once: true,
    })
    try {
      const recordingResponse = await fetch(
        `${apiUrl}/cli/upload/${recordingId}/recording`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'video/mp4',
            'Content-Length': String(fileStat.size),
            'X-ScreenCI-Secret': secret,
            ...(elevenLabsApiKey
              ? { 'X-ElevenLabs-Api-Key': elevenLabsApiKey }
              : {}),
          },
          body: stream as unknown as BodyInit,
          signal: uploadAbort.signal,
          // @ts-expect-error Node.js fetch supports duplex for streaming
          duplex: 'half',
        }
      )
      if (!recordingResponse.ok) {
        const text = await recordingResponse.text()
        progressReporter.complete(progressIndex, 'failure')
        return {
          projectId,
          videoId,
          hadFailure: true,
          videoName,
          failureMessage: `Failed to upload recording for "${videoName}": ${recordingResponse.status} ${text}${hint401(recordingResponse.status, secret)}`,
          recordId,
        }
      }
    } finally {
      uploadAbort.signal.removeEventListener('abort', abortStream)
    }

    progressReporter.complete(progressIndex, 'success')
    cleanupUploadedRecordingDir(screenciDir, entry)
    return {
      projectId,
      videoId,
      hadFailure: false,
      videoName,
      recordId,
      ...(studio !== undefined && { studio }),
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
        videoName,
        failureMessage: err instanceof Error ? err.message : String(err),
        recordId,
      }
    }

    progressReporter.complete(progressIndex, 'failure')
    return {
      projectId,
      videoId,
      hadFailure: true,
      videoName,
      failureMessage: `Network error uploading "${videoName}": ${err instanceof Error ? err.message : String(err)}`,
      recordId,
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

function resolvePlaywrightSpawnSpec(
  args: string[],
  searchFrom: string
): {
  command: string
  args: string[]
  shell?: boolean
  windowsVerbatimArguments?: boolean
} {
  const cliEntrypoint = require.resolve('@playwright/test/cli', {
    paths: [searchFrom],
  })

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

function clearRecordingDirectories(dir: string): void {
  mkdirSync(dir, { recursive: true })
  for (const entry of readdirSync(dir)) {
    if (entry === SCREENCI_LINK_SESSION_FILE) continue
    rmSync(resolve(dir, entry), { recursive: true, force: true })
  }
}

function findScreenCIConfig(customPath?: string): string | null {
  if (customPath) {
    const resolvedPath = resolve(process.cwd(), customPath)
    if (existsSync(resolvedPath)) {
      return resolvedPath
    }
    return null
  }

  // Walk up from the current directory so `screenci test`/`record` work both
  // inside the `screenci/` island and from the repo root (or any directory in
  // between). At each level we prefer a flat `screenci.config.ts`, then fall
  // back to the island layout `screenci/screenci.config.ts`.
  let current = process.cwd()
  while (true) {
    const flatConfig = resolve(current, 'screenci.config.ts')
    if (existsSync(flatConfig)) {
      return flatConfig
    }

    const islandConfig = resolve(current, 'screenci', 'screenci.config.ts')
    if (existsSync(islandConfig)) {
      return islandConfig
    }

    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }

  return null
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
      if (!existingHash) {
        throw new Error(
          `Custom voice file not found and no cached assetHash available: ${voicePath}`
        )
      }
      logger.warn(
        `Custom voice file not found locally, assuming previously uploaded recording asset is valid: ${voicePath}`
      )
      for (const ref of refs) {
        ref.assetHash = existingHash
      }
      preparedAssets.push({
        fileHash: existingHash,
        path: voicePath,
        size: 0,
        contentType: contentTypeForPath(voicePath),
      })
      continue
    }

    const { buffer: fileBuffer, resolvedPath } = resolvedFile
    const assetHash = createHash('sha256').update(fileBuffer).digest('hex')
    const contentType = contentTypeForPath(resolvedPath)
    for (const ref of refs) {
      ref.assetHash = assetHash
    }
    preparedAssets.push({
      fileHash: assetHash,
      path: voicePath,
      size: fileBuffer.byteLength,
      fileBuffer,
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
      if (assets.has(`name:${event.name}`)) continue
      const resolvedFile = await readRecordingFile(
        event.path,
        configDir,
        sourceFilePath
      )
      if (resolvedFile === null) {
        logger.warn(`Asset file not found, skipping upload: ${event.path}`)
        continue
      }
      const { buffer: fileBuffer, resolvedPath } = resolvedFile
      assets.set(`name:${event.name}`, {
        fileHash: createHash('sha256').update(fileBuffer).digest('hex'),
        path: event.path,
        name: event.name,
        size: fileBuffer.byteLength,
        fileBuffer,
        contentType: contentTypeForPath(resolvedPath),
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
          fileHash: event.assetHash,
          path: event.assetPath ?? event.assetHash,
          size: resolvedFile?.buffer.byteLength ?? 0,
          ...(resolvedFile !== null && {
            fileBuffer: resolvedFile.buffer,
            contentType: contentTypeForPath(resolvedFile.resolvedPath),
          }),
        })
      }

      // Multi-language: each translation carries its own hash
      if (event.translations) {
        for (const translation of Object.values(event.translations)) {
          if (
            typeof translation === 'object' &&
            translation !== null &&
            'assetHash' in translation &&
            typeof translation.assetHash === 'string' &&
            !assets.has(`hash:${translation.assetHash}`)
          ) {
            const resolvedFile =
              'assetPath' in translation &&
              typeof translation.assetPath === 'string'
                ? await readRecordingFile(
                    translation.assetPath,
                    configDir,
                    sourceFilePath
                  )
                : null
            assets.set(`hash:${translation.assetHash}`, {
              fileHash: translation.assetHash,
              path:
                (translation as { assetPath?: string }).assetPath ??
                translation.assetHash,
              size: resolvedFile?.buffer.byteLength ?? 0,
              ...(resolvedFile !== null && {
                fileBuffer: resolvedFile.buffer,
                contentType: contentTypeForPath(resolvedFile.resolvedPath),
              }),
            })
          }
        }
      }
    }
  }

  for (const asset of await prepareCustomVoiceAssets(data, configDir)) {
    assets.set(`path:${asset.path}`, asset)
  }

  return [...assets.values()]
}

export function stripVoicePath(
  voice: VoiceKey | RecordingCustomVoiceRef
): VoiceKey | RecordingCustomVoiceRef {
  if (typeof voice !== 'string') {
    return { assetHash: voice.assetHash }
  }
  return voice
}

export function annotateRecordingDataWithAssetHashes(
  data: RecordingData,
  assets: PreparedUploadAsset[]
): RecordingData {
  const byName = new Map<string, string>()
  for (const asset of assets) {
    if (typeof asset.name === 'string') byName.set(asset.name, asset.fileHash)
  }

  return {
    ...data,
    events: data.events.map((event) => {
      if (event.type === 'assetStart') {
        const fileHash = byName.get(event.name)
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
                voice: stripVoicePath(translation.voice),
              } as typeof translation,
            ]
          })
        )
        return { ...event, translations }
      }

      if (event.type !== 'videoCueStart') return event

      // Strip assetPath from translations — hash was already computed during recording
      if (event.translations) {
        const translations = Object.fromEntries(
          Object.entries(event.translations).map(([language, translation]) => {
            if ('assetHash' in translation) {
              const { assetPath: _removed, ...rest } =
                translation as VideoCueTranslationFile
              return [language, rest]
            }
            if ('voice' in translation) {
              return [
                language,
                {
                  ...translation,
                  ...(translation.voice !== undefined
                    ? { voice: stripVoicePath(translation.voice) }
                    : {}),
                },
              ]
            }
            return [language, translation]
          })
        )
        return { ...event, translations }
      }

      // Single-language: strip assetPath, keep assetHash
      if (typeof event.assetHash === 'string') {
        const { assetPath: _removed, ...rest } = event
        return rest
      }

      return event
    }),
  }
}

function hint401(status: number, secret: string): string {
  if (status !== 401 || !secret) return ''
  const frontendUrl = getDevFrontendUrl()
  return `\nThe secret may have been deleted or belongs to a different organisation. Check your secrets at ${frontendUrl}/secrets`
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
      "If you want to keep using the current tier, remove `voice.style` or `modelType: 'expressive'` from `createNarration()`.",
    ].join('\n')
  }

  return `${videoName}: ${message}`
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

async function uploadAssets(
  assets: PreparedUploadAsset[],
  apiUrl: string,
  secret: string,
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
    try {
      const checkRes = await fetch(
        `${apiUrl}/cli/upload/${recordingId}/asset/check`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-ScreenCI-Secret': secret,
          },
          body: JSON.stringify({
            fileHash: asset.fileHash,
            contentType: asset.contentType,
            size: asset.size,
            path: asset.path,
            ...(typeof asset.name === 'string' ? { name: asset.name } : {}),
          }),
          signal,
        }
      )

      if (!checkRes.ok) {
        const text = await checkRes.text()
        throw new UploadAssetError(
          `Failed to check asset ${asset.path}: ${checkRes.status} ${text}${hint401(checkRes.status, secret)}`
        )
      }

      const checkBody = (await checkRes.json()) as { exists: boolean }
      if (checkBody.exists) {
        logInfo(`${pc.green('✔')} Asset already exists: ${asset.path}`)
        continue
      }

      if (!asset.fileBuffer || !asset.contentType) {
        throw new UploadAssetError(
          `Asset bytes not available for upload and backend does not have it yet: ${asset.path}`
        )
      }

      throwIfAborted()

      const res = await fetch(`${apiUrl}/cli/upload/${recordingId}/asset`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-ScreenCI-Secret': secret,
        },
        body: JSON.stringify({
          fileHash: asset.fileHash,
          fileBase64: asset.fileBuffer.toString('base64'),
          contentType: asset.contentType,
          size: asset.size,
          path: asset.path,
          ...(typeof asset.name === 'string' ? { name: asset.name } : {}),
        }),
        signal,
      })
      if (!res.ok) {
        const text = await res.text()
        if (res.status === 409 && text.includes('already exists')) {
          logInfo(`${pc.green('✔')} Asset already exists: ${asset.path}`)
        } else {
          throw new UploadAssetError(
            `Failed to upload asset ${asset.path}: ${res.status} ${text}${hint401(res.status, secret)}`
          )
        }
      } else {
        logInfo(`Asset uploaded: ${asset.path}`)
      }
    } catch (err) {
      if (isUploadCancelledError(err)) {
        throw err
      }
      if (isUploadAssetError(err)) {
        throw err
      }
      throw new UploadAssetError(
        `Network error uploading asset ${asset.path}: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }
}

export async function uploadRecordings(
  screenciDir: string,
  projectName: string,
  apiUrl: string,
  secret: string,
  specificEntry?: string,
  verbose = false
): Promise<{
  projectId: string | null
  recordId: string | null
  hadFailures: boolean
  failedVideoNames: string[]
  failedVideoMessages: Array<{ videoName: string; message: string }>
  studioNotices: StudioUploadNotice[]
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
      failedVideoNames: [],
      failedVideoMessages: [],
      studioNotices: [],
    }
  }

  if (specificEntry !== undefined) {
    entries = entries.filter((e) => e === specificEntry)
  }

  let firstProjectId: string | null = null
  const elevenLabsApiKey = process.env.ELEVENLABS_API_KEY?.trim() || undefined

  try {
    const candidates = (
      await Promise.all(
        entries.map(async (entry) => {
          uploadAbort.throwIfAborted()
          return await loadUploadCandidate(screenciDir, entry, verbose)
        })
      )
    ).filter((candidate): candidate is UploadCandidate => candidate !== null)

    if (candidates.length === 0) {
      return {
        projectId: null,
        recordId: null,
        hadFailures: false,
        failedVideoNames: [],
        failedVideoMessages: [],
        studioNotices: [],
      }
    }

    const progressReporter = createUploadProgressReporter(
      candidates.map((candidate) => candidate.videoName),
      verbose
    )

    const results = await Promise.all(
      candidates.map(
        async (candidate, index) =>
          await uploadRecordingCandidate(
            candidate,
            screenciDir,
            projectName,
            apiUrl,
            secret,
            elevenLabsApiKey,
            verbose,
            uploadAbort,
            progressReporter,
            index,
            recordId
          )
      )
    )

    firstProjectId =
      results.find((result) => result.projectId !== null)?.projectId ?? null
    const hadFailures = results.some((result) => result.hadFailure)
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

    return {
      projectId: firstProjectId,
      recordId,
      hadFailures,
      failedVideoNames,
      failedVideoMessages,
      studioNotices,
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

export function getDevBackendUrl(): string {
  switch (getScreenCIEnvironment()) {
    case 'local': {
      const devBackendPort = process.env.DEV_BACKEND_PORT
      return devBackendPort
        ? `http://localhost:${devBackendPort}`
        : 'http://localhost:8787'
    }
    case 'dev':
      return SCREENCI_DEVELOPMENT_BACKEND_URL
    case 'prod':
      return SCREENCI_PRODUCTION_BACKEND_URL
  }
}

export function getDevFrontendUrl(): string {
  switch (getScreenCIEnvironment()) {
    case 'local': {
      const devFrontendPort = process.env.DEV_FRONTEND_PORT
      return devFrontendPort
        ? `http://localhost:${devFrontendPort}`
        : 'http://localhost:5173'
    }
    case 'dev':
      return SCREENCI_DEVELOPMENT_FRONTEND_URL
    case 'prod':
      return SCREENCI_PRODUCTION_FRONTEND_URL
  }
}

export function getCliLinkSessionApiUrl(): string {
  return getDevFrontendUrl()
}

function getScreenCISecretsUrl(): string {
  return `${getDevFrontendUrl()}/secrets`
}

async function writeGitHubProjectOutput(projectUrl: string): Promise<void> {
  const githubOutput = process.env.GITHUB_OUTPUT
  if (!githubOutput) return

  await appendFile(githubOutput, `screenci_project_url=${projectUrl}\n`)
}

async function loadScreenCIConfigAndEnv(configPath?: string): Promise<{
  resolvedConfigPath: string
  screenciConfig: ScreenCIConfig
}> {
  const resolvedConfigPath = findScreenCIConfig(configPath)
  if (!resolvedConfigPath) {
    const errorMsg = configPath
      ? `Error: Config file not found: ${configPath}`
      : 'Error: screenci.config.ts not found in current directory'
    logger.error(errorMsg)
    process.exit(1)
  }

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
    const screenciConfig = await tryReadConfigFromSource(resolvedConfigPath)
    loadEnvFile(
      screenciConfig.envFile
        ? resolve(dirname(resolvedConfigPath), screenciConfig.envFile)
        : resolve(dirname(resolvedConfigPath), '.env'),
      warnOnFailure
    )
  } catch {
    // Config import may require Playwright context or dynamic values. Continue with
    // the existing process env; Playwright will still load the config normally.
  }
}

async function resolveConfiguredEnvFilePath(
  resolvedConfigPath: string
): Promise<string | undefined> {
  try {
    const screenciConfig = await tryReadConfigFromSource(resolvedConfigPath)
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

async function requireScreenCISecret(configPath?: string): Promise<{
  resolvedConfigPath: string
  screenciConfig: ScreenCIConfig
  secret: string
  apiUrl: string
}> {
  const { resolvedConfigPath, screenciConfig } =
    await loadScreenCIConfigAndEnv(configPath)
  const secret =
    process.env.SCREENCI_SECRET ??
    (await ensureScreenciSecret(resolvedConfigPath))
  if (!secret) {
    const envFilePath = await resolveProjectEnvFilePath(resolvedConfigPath)
    logger.error(
      `No SCREENCI_SECRET configured. Rerun ${pc.cyan(getSuggestedScreenciCommand('record'))} or add SCREENCI_SECRET manually to ${envFilePath} by following the guide at ${pc.cyan(SCREENCI_RECORD_DOCS_URL)}.`
    )
    process.exit(1)
  }

  return {
    resolvedConfigPath,
    screenciConfig,
    secret,
    apiUrl: getDevBackendUrl(),
  }
}

async function fetchProjectInfo(
  configPath?: string
): Promise<ProjectInfoResponse> {
  const { screenciConfig, secret, apiUrl } =
    await requireScreenCISecret(configPath)
  const url = new URL(`${apiUrl}/cli/project-info`)
  url.searchParams.set('projectName', screenciConfig.projectName)

  const res = await fetch(url.toString(), {
    headers: {
      'X-ScreenCI-Secret': secret,
    },
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(
      `Failed to fetch project info: ${res.status} ${text}${hint401(res.status, secret)}`
    )
  }

  return (await res.json()) as ProjectInfoResponse
}

async function printProjectInfo(configPath?: string): Promise<void> {
  const info = await fetchProjectInfo(configPath)
  process.stdout.write(`${JSON.stringify(info, null, 2)}\n`)
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
      `Failed to ${isPublic ? 'make public' : 'make private'}: ${res.status} ${text}${hint401(res.status, secret)}`
    )
  }

  logger.info(`${isPublic ? 'Made public' : 'Made private'}: ${videoId}`)
}

async function persistScreenCISecret(
  envFilePath: string,
  secret: string
): Promise<void> {
  const nextLine = `SCREENCI_SECRET=${secret}`

  try {
    const existing = await readFile(envFilePath, 'utf-8')
    const lines = existing === '' ? [] : existing.split(/\r?\n/)
    const firstSecretIndex = lines.findIndex((line) =>
      line.startsWith('SCREENCI_SECRET=')
    )
    const linesWithoutSecret = lines.filter(
      (line) => !line.startsWith('SCREENCI_SECRET=')
    )
    const finalLines =
      firstSecretIndex >= 0
        ? [
            ...linesWithoutSecret.slice(0, firstSecretIndex),
            nextLine,
            ...linesWithoutSecret.slice(firstSecretIndex),
          ]
        : [...linesWithoutSecret, nextLine]
    let nextContent = finalLines.join('\n')
    if (!nextContent.endsWith('\n')) nextContent += '\n'
    await writeFile(envFilePath, nextContent)
    return
  } catch (err) {
    if (!isMissingFileError(err)) throw err
  }

  await writeFile(envFilePath, `${nextLine}\n`)
}

function getLinkSessionFilePath(projectDir: string): string {
  return resolve(projectDir, '.screenci', SCREENCI_LINK_SESSION_FILE)
}

async function readPersistedLinkSessionSpec(
  specPath: string
): Promise<PersistedLinkSessionSpec | null> {
  try {
    const raw = await readFile(specPath, 'utf-8')
    return JSON.parse(raw) as PersistedLinkSessionSpec
  } catch (error) {
    if (!isMissingFileError(error)) {
      logger.warn(`Ignoring invalid stored link session at ${specPath}.`)
      rmSync(specPath, { force: true })
    }
    return null
  }
}

async function writePersistedLinkSessionSpec(
  specPath: string,
  spec: PersistedLinkSessionSpec
): Promise<void> {
  mkdirSync(dirname(specPath), { recursive: true })
  await writeFile(specPath, `${JSON.stringify(spec, null, 2)}\n`)
}

function deletePersistedLinkSessionSpec(specPath: string): void {
  rmSync(specPath, { force: true })
}

function isStoredLinkSessionReusable(
  spec: PersistedLinkSessionSpec,
  options: {
    environment: ScreenCIEnvironment
    resolvedConfigPath?: string
    envFilePath: string
  }
): boolean {
  return (
    spec.environment === options.environment &&
    spec.envFilePath === options.envFilePath &&
    spec.resolvedConfigPath === options.resolvedConfigPath &&
    spec.expiresAt > new Date().toISOString()
  )
}

async function createLinkSessionSpec(options: {
  apiUrl: string
  appUrl: string
  environment: ScreenCIEnvironment
  resolvedConfigPath?: string
  envFilePath: string
}): Promise<PersistedLinkSessionSpec> {
  const response = await fetch(`${options.apiUrl}/cli-link/session`, {
    method: 'POST',
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Failed to create link session: ${response.status} ${text}`)
  }

  const body = (await response.json()) as {
    token: string
    createdAt: string
    expiresAt: string
  }

  return {
    token: body.token,
    appUrl: `${options.appUrl}/cli-auth?session=${encodeURIComponent(body.token)}`,
    pollUrl: `${options.apiUrl}/cli-link/session?token=${encodeURIComponent(body.token)}`,
    createdAt: body.createdAt,
    expiresAt: body.expiresAt,
    environment: options.environment,
    ...(options.resolvedConfigPath
      ? { resolvedConfigPath: options.resolvedConfigPath }
      : {}),
    envFilePath: options.envFilePath,
  }
}

async function pollLinkSession(
  spec: PersistedLinkSessionSpec
): Promise<{ status: LinkSessionStatus; secret?: string }> {
  for (;;) {
    const response = await fetch(spec.pollUrl)
    const body = (await response.json()) as {
      status?: LinkSessionStatus
      secret?: string
    }
    const status = body.status ?? 'invalid'

    if (status === 'completed' && body.secret) {
      return { status, secret: body.secret }
    }

    if (status === 'expired' || status === 'consumed' || status === 'invalid') {
      return { status }
    }

    if (new Date().toISOString() >= spec.expiresAt) {
      return { status: 'expired' }
    }

    await new Promise((resolveDelay) =>
      setTimeout(resolveDelay, SCREENCI_LINK_SESSION_POLL_INTERVAL_MS)
    )
  }
}

export async function ensureScreenciSecret(
  resolvedConfigPath?: string
): Promise<string | undefined> {
  const existingSecret = process.env.SCREENCI_SECRET
  if (existingSecret) return existingSecret

  try {
    const environment = getScreenCIEnvironment()
    const apiUrl = getCliLinkSessionApiUrl()
    const appUrl = getDevFrontendUrl()
    const envFilePath = resolvedConfigPath
      ? await resolveProjectEnvFilePath(resolvedConfigPath)
      : resolve(process.cwd(), '.env')
    const projectDir = resolvedConfigPath
      ? dirname(resolvedConfigPath)
      : process.cwd()
    const specPath = getLinkSessionFilePath(projectDir)
    const linkSessionContext = {
      environment,
      envFilePath,
      ...(resolvedConfigPath ? { resolvedConfigPath } : {}),
    }

    for (;;) {
      const storedSpec = await readPersistedLinkSessionSpec(specPath)
      const spec =
        storedSpec &&
        isStoredLinkSessionReusable(storedSpec, linkSessionContext)
          ? storedSpec
          : await createLinkSessionSpec({
              apiUrl,
              appUrl,
              ...linkSessionContext,
            })

      if (spec !== storedSpec) {
        await writePersistedLinkSessionSpec(specPath, spec)
      }

      logger.info(
        `Open this link to sign in and connect the CLI:\n${pc.cyan(spec.appUrl)}\n`
      )

      const result = await pollLinkSession(spec)
      if (result.status === 'completed' && result.secret) {
        process.env.SCREENCI_SECRET = result.secret
        await persistScreenCISecret(envFilePath, result.secret)
        deletePersistedLinkSessionSpec(specPath)
        logger.info(`Successfully saved SCREENCI_SECRET to ${envFilePath}`)
        return result.secret
      }

      deletePersistedLinkSessionSpec(specPath)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn(`Authentication failed: ${msg}`)
    logger.info(
      `You can add SCREENCI_SECRET manually to ${resolvedConfigPath ? await resolveProjectEnvFilePath(resolvedConfigPath) : '.env'} later. Get it from ${getScreenCISecretsUrl()}.`
    )
    logScreenCISecretGuide()
    return undefined
  }
}

export async function main() {
  if (process.argv.length <= 2) {
    logger.error('Error: No command provided')
    logger.error(
      'Available commands: record, test, info, make-public, make-private, init'
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
    .allowUnknownOption(true)
    .action(async () => {
      const parsed = parseRecordCliArgs(getSubcommandArgv('record'))
      let playwrightFailure: Error | null = null

      try {
        await run('record', parsed.otherArgs, parsed.configPath, parsed.verbose)
      } catch (error) {
        if (!(error instanceof Error)) throw error
        if (error.message.startsWith('Playwright exited with code ')) {
          playwrightFailure = new RecordFailureHintError(error)
        } else {
          throw new RecordFailureHintError(error)
        }
      }

      if (process.env.SCREENCI_RECORDING === 'true') return

      // After recording, upload results to API if configured
      const resolvedConfigPath = findScreenCIConfig(parsed.configPath)
      if (resolvedConfigPath) {
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
          const secret = process.env.SCREENCI_SECRET
          const uploadPolicy = resolveRecordUploadPolicy(screenciConfig)
          const configDir = dirname(resolvedConfigPath)
          const screenciDir = resolve(configDir, '.screenci')
          const completedRecordingCount =
            await countCompletedRecordings(screenciDir)
          if (playwrightFailure !== null && completedRecordingCount === 0) {
            logger.info('All recordings failed.')
          } else if (!secret) {
            logger.info(
              `No SCREENCI_SECRET configured for uploads. Rerun ${getSuggestedScreenciCommand('record')} or add it to the project env file.`
            )
          } else if (
            playwrightFailure !== null &&
            uploadPolicy === 'all-or-nothing'
          ) {
            logger.info(
              'Some recordings failed, skipping upload because record.upload is "all-or-nothing".'
            )
          } else {
            if (playwrightFailure !== null && uploadPolicy === 'passed-only') {
              logger.warn(
                'Some recordings failed, uploading successful videos only.'
              )
            }
            let uploadResult: {
              projectId: string | null
              recordId: string | null
              hadFailures: boolean
              failedVideoNames: string[]
              failedVideoMessages: Array<{ videoName: string; message: string }>
              studioNotices: StudioUploadNotice[]
            } = {
              projectId: null,
              recordId: null,
              hadFailures: false,
              failedVideoNames: [],
              failedVideoMessages: [],
              studioNotices: [],
            }
            try {
              uploadResult = await uploadRecordings(
                screenciDir,
                screenciConfig.projectName,
                apiUrl,
                secret
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
              failedVideoNames,
              failedVideoMessages,
              studioNotices,
            } = uploadResult
            if (recordId !== null && projectId !== null) {
              const recordUrl = `${appUrl}/record/${recordId}`
              await writeGitHubProjectOutput(recordUrl)
              logger.info('')
              logger.info(
                playwrightFailure !== null
                  ? 'Recording partially succeeded, rendering in progress. Results available at:'
                  : 'Recording finished, rendering in progress. Results available at:'
              )
              logger.info(pc.cyan(recordUrl))
            } else if (projectId !== null) {
              const projectUrl = `${appUrl}/project/${projectId}`
              await writeGitHubProjectOutput(projectUrl)
              logger.info('')
              logger.info(
                playwrightFailure !== null
                  ? 'Recording partially succeeded, rendering in progress. Results available at:'
                  : 'Recording finished, rendering in progress. Results available at:'
              )
              logger.info(pc.cyan(projectUrl))
            }
            for (const notice of studioNotices) {
              if ('held' in notice.studio) {
                logger.info('')
                logger.info(
                  `Rendering for "${notice.videoName}" is on hold — configure it in Studio:`
                )
                if (projectId !== null && notice.videoId !== null) {
                  logger.info(
                    pc.cyan(formatStudioUrl(appUrl, projectId, notice.videoId))
                  )
                }
              } else if (notice.studio.appliedChanges.length > 0) {
                logger.info('')
                logger.info(
                  `Selections were overridden in Studio for "${notice.videoName}": ${formatStudioChangeSummary(notice.studio.appliedChanges)}`
                )
              }
            }
            if (hadFailures) {
              for (const failedVideo of failedVideoMessages) {
                logger.warn(
                  formatFailedVideoMessage(
                    failedVideo.videoName,
                    failedVideo.message
                  )
                )
              }
              logger.warn(
                `Not all recordings succeeded to upload. Failed videos: ${failedVideoNames.join(', ') || 'unknown'}. Some videos may be missing from the project.`
              )
              if (playwrightFailure === null) {
                throw new PartialUploadError()
              }
            }
          }
        } catch (err) {
          if (isPartialUploadError(err)) {
            throw err
          }
          logger.warn('Failed to load config for upload:', err)
        }
      }

      if (playwrightFailure !== null) {
        throw playwrightFailure
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

      const resolvedConfigPath = findScreenCIConfig(parsed.configPath)
      if (resolvedConfigPath) {
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
    .description('Print remote project info as JSON')
    .option('-c, --config <path>', 'path to screenci.config.ts')
    .action(async (options: Record<string, unknown>) => {
      await printProjectInfo(options['config'] as string | undefined)
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

  // init command
  program
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
    .action(
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

function parseRecordCliArgs(args: string[]): {
  configPath: string | undefined
  verbose: boolean
  otherArgs: string[]
} {
  let configPath: string | undefined
  let verbose = false
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
    } else {
      otherArgs.push(arg)
    }
  }

  return {
    configPath,
    verbose,
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

async function run(
  command: 'record' | 'test',
  additionalArgs: string[],
  customConfigPath?: string,
  verbose = false,
  mockRecord = false
) {
  const configPath = findScreenCIConfig(customConfigPath)

  if (!configPath) {
    const errorMsg = customConfigPath
      ? `Error: Config file not found: ${customConfigPath}`
      : 'Error: screenci.config.ts not found in the current directory or any parent (looked for ./screenci.config.ts and ./screenci/screenci.config.ts)'
    logger.error(errorMsg)
    process.exit(1)
  }

  if (command === 'test' || process.env.SCREENCI_RECORDING !== 'true') {
    await loadEnvFileFromConfigSource(configPath, false)
  }

  // Only validate args for record command
  if (command === 'record') {
    if (!process.env.SCREENCI_SECRET) {
      await requireScreenCISecret(configPath)
    }
    validateArgs(additionalArgs)
    const screenciDir = resolve(dirname(configPath), '.screenci')
    clearRecordingDirectories(screenciDir)
  }

  const envForChild = { ...process.env }

  await validateUniqueDiscoveredTestTitles(configPath, additionalArgs, {
    ...envForChild,
    SCREENCI_CONFIG_DIR: dirname(configPath),
    ...(command === 'record' ? { SCREENCI_RECORDING: 'true' } : {}),
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
