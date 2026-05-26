import { spawn } from 'child_process'
import type { ChildProcess } from 'child_process'
import { createReadStream } from 'fs'
import { existsSync, mkdirSync, readdirSync, realpathSync, rmSync } from 'fs'
import { createHash } from 'crypto'
import { createServer } from 'http'
import type { AddressInfo } from 'net'
import {
  appendFile,
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
} from 'fs/promises'
import { basename, dirname, relative as pathRelative, resolve } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { Command, CommanderError } from 'commander'
import { input } from '@inquirer/prompts'
import ora from 'ora'
import pc from 'picocolors'
import { logger } from './src/logger.js'
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
const PLAYWRIGHT_TEST_VERSION = '^1.59.0'
const PLAYWRIGHT_CLI_VERSION = 'latest'
const NODE_TYPES_VERSION = '^25.9.1'

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
  const spawnSpec = resolveSpawnSpec('playwright', listArgs)

  return await new Promise<string[]>((resolve, reject) => {
    const child = spawn(spawnSpec.command, spawnSpec.args, {
      stdio: ['inherit', 'pipe', 'pipe'],
      ...(spawnSpec.shell !== undefined ? { shell: spawnSpec.shell } : {}),
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
        reject(
          new Error(
            stderr.trim() || stdout.trim() || 'Playwright test discovery failed'
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
  configDir: string
): string[] {
  return [
    filePath,
    resolve(configDir, 'videos', filePath),
    resolve(configDir, pathRelative('/app', filePath)),
  ]
}

async function readRecordingFile(
  filePath: string,
  configDir: string
): Promise<{ buffer: Buffer; resolvedPath: string } | null> {
  for (const candidate of resolveRecordingFileCandidates(filePath, configDir)) {
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

type UploadJobResult = {
  projectId: string | null
  hadFailure: boolean
  videoName: string
  failureMessage?: string
}

type UploadProgressStatus = 'success' | 'failure' | 'cancelled'

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

function supportsInPlaceUploadUpdates(verbose: boolean): boolean {
  return !verbose && process.stdout.isTTY === true && !process.env.CI
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
  verbose: boolean
): {
  complete: (index: number, status: UploadProgressStatus) => void
  info: (message: string) => void
} {
  const useInPlaceUpdates = supportsInPlaceUploadUpdates(verbose)

  if (!useInPlaceUpdates) {
    if (videoNames.length > 1) {
      logger.info(`Uploading ${videoNames.length} recordings in parallel...`)
    }

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

  const statuses = new Array<UploadProgressStatus | undefined>(
    videoNames.length
  )
  let hasRendered = false

  const render = () => {
    const renderedLines = videoNames.map((videoName, index) =>
      formatUploadProgressLine(videoName, statuses[index])
    )
    process.stdout.write(
      `${hasRendered && videoNames.length > 0 ? `\u001B[${videoNames.length}A` : ''}${renderedLines.map((line) => `\r\u001B[2K${line}`).join('\n')}\n`
    )
    hasRendered = true
  }

  const clear = () => {
    if (!hasRendered || videoNames.length === 0) return
    process.stdout.write(
      `\u001B[${videoNames.length}A${Array.from({ length: videoNames.length }, () => '\r\u001B[2K').join('\n')}\n`
    )
    hasRendered = false
  }

  render()

  return {
    complete(index, status) {
      statuses[index] = status
      render()
    },
    info(message) {
      clear()
      logger.info(message)
      render()
    },
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
  verbose: boolean,
  uploadAbort: ReturnType<typeof createUploadAbortController>,
  progressReporter: {
    complete: (index: number, status: UploadProgressStatus) => void
    info: (message: string) => void
  },
  progressIndex: number
): Promise<UploadJobResult> {
  const { entry, videoName, data, preparedUploadAssets } = candidate

  try {
    uploadAbort.throwIfAborted()
    const recordingPath = resolve(screenciDir, entry, 'recording.mp4')
    const recordingHash = existsSync(recordingPath)
      ? await hashFile(recordingPath)
      : undefined
    const startResponse = await fetch(`${apiUrl}/cli/upload/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-ScreenCI-Secret': secret,
      },
      body: JSON.stringify({
        projectName,
        videoName,
        data,
        ...(recordingHash !== undefined ? { recordingHash } : {}),
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
        hadFailure: true,
        videoName,
        failureMessage: formatUploadStartFailureMessage(
          videoName,
          startResponse.status,
          text,
          secret
        ),
      }
    }

    const { recordingId, projectId } = (await startResponse.json()) as {
      recordingId: string
      projectId: string
    }

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

    if (existsSync(recordingPath)) {
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
            hadFailure: true,
            videoName,
            failureMessage: `Failed to upload recording for "${videoName}": ${recordingResponse.status} ${text}${hint401(recordingResponse.status, secret)}`,
          }
        }
      } finally {
        uploadAbort.signal.removeEventListener('abort', abortStream)
      }
    }

    progressReporter.complete(progressIndex, 'success')
    return { projectId, hadFailure: false, videoName }
  } catch (err) {
    if (isUploadCancelledError(err)) {
      progressReporter.complete(progressIndex, 'cancelled')
      throw err
    }

    progressReporter.complete(progressIndex, 'failure')
    return {
      projectId: null,
      hadFailure: true,
      videoName,
      failureMessage: `Network error uploading "${videoName}": ${err instanceof Error ? err.message : String(err)}`,
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

function quoteWindowsCommandArg(arg: string): string {
  if (arg.length === 0) return '""'
  if (/^[A-Za-z0-9_./:\\=-]+$/.test(arg)) return arg
  return `"${arg.replace(/"/g, '""')}"`
}

function resolveSpawnSpec(
  cmd: string,
  args: string[]
): {
  command: string
  args: string[]
  shell?: boolean
} {
  if (process.platform !== 'win32') {
    return { command: cmd, args }
  }

  const windowsCmdsNeedingShell = new Set(['npm', 'npx', 'playwright', 'pnpm'])
  if (!windowsCmdsNeedingShell.has(cmd)) {
    return { command: cmd, args }
  }

  const commandLine = [cmd, ...args].map(quoteWindowsCommandArg).join(' ')
  return {
    command: 'cmd',
    args: ['/d', '/c', commandLine],
  }
}

function spawnSilent(cmd: string, args: string[], cwd?: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const spawnSpec = resolveSpawnSpec(cmd, args)
    const child = spawn(spawnSpec.command, spawnSpec.args, {
      stdio: 'pipe',
      ...(spawnSpec.shell !== undefined ? { shell: spawnSpec.shell } : {}),
      ...(cwd ? { cwd } : {}),
    })
    const childSignals = forwardChildSignals(child, cmd)
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
      } else if (code === 0) {
        resolve()
      } else {
        reject(new Error(`${cmd} exited with code ${code}`))
      }
    })
    child.on('error', (err) => {
      childSignals.cleanup()
      reject(err)
    })
  })
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

function clearDirectory(dir: string): void {
  mkdirSync(dir, { recursive: true })
  for (const entry of readdirSync(dir)) {
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

  const cwd = process.cwd()
  const configPath = resolve(cwd, 'screenci.config.ts')

  if (existsSync(configPath)) {
    return configPath
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
    const resolvedFile = await readRecordingFile(voicePath, configDir)
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

async function collectUploadAssets(
  data: RecordingData,
  configDir: string
): Promise<PreparedUploadAsset[]> {
  const assets = new Map<string, PreparedUploadAsset>()

  for (const event of data.events) {
    if (event.type === 'assetStart') {
      if (assets.has(`name:${event.name}`)) continue
      const resolvedFile = await readRecordingFile(event.path, configDir)
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
            ? await readRecordingFile(event.assetPath, configDir)
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
                ? await readRecordingFile(translation.assetPath, configDir)
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
        logger.warn(
          `Failed to check asset ${asset.path}: ${checkRes.status} ${text}${hint401(checkRes.status, secret)}`
        )
        continue
      }

      const checkBody = (await checkRes.json()) as { exists: boolean }
      if (checkBody.exists) {
        logInfo(`Asset already exists: ${asset.path}`)
        continue
      }

      if (!asset.fileBuffer || !asset.contentType) {
        logger.warn(
          `Asset bytes not available for upload and backend does not have it yet: ${asset.path}`
        )
        continue
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
          logInfo(`Asset already exists: ${asset.path}`)
        } else {
          logger.warn(
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
      logger.warn(`Network error uploading asset ${asset.path}:`, err)
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
  hadFailures: boolean
  failedVideoNames: string[]
  failedVideoMessages: Array<{ videoName: string; message: string }>
}> {
  const uploadAbort = createUploadAbortController('upload')
  let entries: string[]
  try {
    entries = await readdir(screenciDir)
  } catch {
    logger.warn('No .screenci directory found, skipping upload')
    return {
      projectId: null,
      hadFailures: false,
      failedVideoNames: [],
      failedVideoMessages: [],
    }
  }

  if (specificEntry !== undefined) {
    entries = entries.filter((e) => e === specificEntry)
  }

  let firstProjectId: string | null = null

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
        hadFailures: false,
        failedVideoNames: [],
        failedVideoMessages: [],
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
            verbose,
            uploadAbort,
            progressReporter,
            index
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

    return {
      projectId: firstProjectId,
      hadFailures,
      failedVideoNames,
      failedVideoMessages,
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
  const devBackendPort = process.env.DEV_BACKEND_PORT
  return devBackendPort
    ? `http://localhost:${devBackendPort}`
    : 'https://api.screenci.com'
}

export function getDevFrontendUrl(): string {
  const devFrontendPort = process.env.DEV_FRONTEND_PORT
  return devFrontendPort
    ? `http://localhost:${devFrontendPort}`
    : 'https://app.screenci.com'
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
    const envFilePath = resolve(
      dirname(resolvedConfigPath),
      screenciConfig.envFile
    )
    loadEnvFile(envFilePath, true)
  }

  return { resolvedConfigPath, screenciConfig }
}

function loadEnvFile(envFilePath: string, warnOnFailure: boolean): void {
  try {
    process.loadEnvFile(envFilePath)
  } catch (err) {
    if (warnOnFailure && !isMissingFileError(err)) {
      logger.warn(`Failed to load env file ${envFilePath}:`, err)
    }
  }
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
    if (screenciConfig.envFile) {
      const envFilePath = resolve(
        dirname(resolvedConfigPath),
        screenciConfig.envFile
      )
      loadEnvFile(envFilePath, warnOnFailure)
    }
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
  const secret = process.env.SCREENCI_SECRET
  if (!secret) {
    logger.error(
      'No secret configured. Set SCREENCI_SECRET in your .env file (get it from the API Key page in the dashboard).'
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

function generateConfig(projectName: string): string {
  return `import { defineConfig } from 'screenci'

export default defineConfig({
  projectName: ${JSON.stringify(projectName)},
  envFile: '.env',
  videoDir: './videos',
  /* Run videos in files in parallel */
  fullyParallel: true,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  use: {
    recordOptions: {
      aspectRatio: '16:9',
      quality: '1080p',
      fps: 60,
    },
  },
  projects: [
    {
      name: 'chromium',
    },
  ],
})
`
}

function generateEmptyPackageJson(): string {
  return '{}\n'
}

async function readCurrentScreenciVersion(): Promise<string> {
  const currentFileDir = dirname(fileURLToPath(import.meta.url))
  const packageJsonPaths = [
    resolve(currentFileDir, 'package.json'),
    resolve(currentFileDir, '../package.json'),
  ]

  for (const packageJsonPath of packageJsonPaths) {
    try {
      const packageJson = JSON.parse(
        await readFile(packageJsonPath, 'utf-8')
      ) as {
        version?: unknown
      }
      if (typeof packageJson.version === 'string') {
        return packageJson.version
      }
    } catch {
      // Try the next candidate path.
    }
  }

  return 'latest'
}

type PackageManager = 'npm' | 'pnpm'

function parsePackageManager(value: string | undefined): PackageManager {
  if (value === undefined || value === 'npm' || value === 'pnpm') {
    return value ?? 'npm'
  }

  throw new Error('Expected package manager to be one of: npm, pnpm')
}

function getPackageManagerCommand(packageManager: PackageManager): {
  screenciRun: string
  playwrightRun: string
  installCommand: string
  installArgs: (pkg: string) => string[]
  cacheName: PackageManager
  lockfileName: string
} {
  if (packageManager === 'pnpm') {
    return {
      screenciRun: 'pnpm exec screenci',
      playwrightRun: 'pnpm exec playwright',
      installCommand: 'pnpm',
      installArgs: (pkg) => ['add', '--save-dev', pkg],
      cacheName: 'pnpm',
      lockfileName: 'pnpm-lock.yaml',
    }
  }

  return {
    screenciRun: 'npx screenci',
    playwrightRun: 'npx playwright',
    installCommand: 'npm',
    installArgs: (pkg) => ['install', '--save-dev', pkg],
    cacheName: 'npm',
    lockfileName: 'package-lock.json',
  }
}

function generateReadmeForPackageManager(
  projectName: string,
  packageManager: PackageManager
): string {
  const commands = getPackageManagerCommand(packageManager)
  return `# ${projectName}

This project uses ScreenCI + Playwright to create and upload polished product videos.

## How video recording works

Write video scripts in \`videos/*.video.ts\` and use \`video(...)\` calls to create product videos. These are very similar to Playwright \`.test.ts\` and \`test(...)\` calls.

Learn more: https://screenci.com/docs

## Quick start

1. Create your own videos in \`videos/*.video.ts\`, either manually or with an AI agent using your source code or a URL.

2. Run videos locally to test the script working:

   \`${commands.screenciRun} test\` or with UI mode: \`${commands.screenciRun} test --ui\`

3. Record videos:

   \`${commands.screenciRun} record\`

4. View results on screenci.com and optionally enable a public URL to embed the video on your site.
`
}

function generateGitignore(): string {
  return `# ScreenCI
.screenci
.playwright-cli/
.env

# Playwright
node_modules/
/test-results/
/playwright-report/
/blob-report/
/playwright/.cache/
/playwright/.auth/
`
}

async function writeInitGitignore(projectDir: string): Promise<void> {
  const gitignorePath = resolve(projectDir, '.gitignore')

  if (!existsSync(gitignorePath)) {
    await writeFile(gitignorePath, generateGitignore())
    return
  }

  const existing = await readFile(gitignorePath, 'utf-8')
  const separator =
    existing.length === 0
      ? ''
      : existing.endsWith('\n\n')
        ? ''
        : existing.endsWith('\n')
          ? '\n'
          : '\n\n'
  await appendFile(gitignorePath, `${separator}${generateGitignore()}`)
}

async function installInitDependencies(
  projectDir: string,
  verbose: boolean,
  screenciDependency: string,
  includePlaywrightCli: boolean,
  packageManager: PackageManager
): Promise<void> {
  const commands = getPackageManagerCommand(packageManager)
  const installSteps: Array<{ message: string; args: string[] }> = [
    {
      message: 'Installing Playwright Test...',
      args: commands.installArgs(`@playwright/test@${PLAYWRIGHT_TEST_VERSION}`),
    },
    {
      message: 'Installing ScreenCI...',
      args: commands.installArgs(`screenci@${screenciDependency}`),
    },
    {
      message: 'Installing Node.js types...',
      args: commands.installArgs(`@types/node@${NODE_TYPES_VERSION}`),
    },
  ]

  if (includePlaywrightCli) {
    installSteps.push({
      message: 'Installing playwright-cli...',
      args: commands.installArgs(`@playwright/cli@${PLAYWRIGHT_CLI_VERSION}`),
    })
  }
  for (const step of installSteps) {
    if (verbose) {
      logger.info(
        `Running '${commands.installCommand} ${step.args.join(' ')}'...`
      )
      await spawnInherited(
        commands.installCommand,
        step.args,
        projectDir,
        'screenci init'
      )
    } else {
      const spinner = ora(step.message).start()
      try {
        await spawnSilent(commands.installCommand, step.args, projectDir)
        spinner.succeed(step.message.replace(/\.\.\.$/, ' complete'))
      } catch (err) {
        spinner.fail(step.message.replace(/\.\.\.$/, ' failed'))
        throw err
      }
    }
  }
}

function printInitNextSteps(
  projectDir: string,
  packageManager: PackageManager
): void {
  const resolvedProjectDir = realpathSync(projectDir)
  const commands = getPackageManagerCommand(packageManager)

  logger.info(
    `${pc.green('✔ Success!')} Created a ScreenCI project at ${resolvedProjectDir}`
  )
  logger.info('')
  logger.info('Inside that directory, you can run several commands:')
  logger.info('')
  logger.info(`  ${pc.cyan(`${commands.screenciRun} test`)}`)
  logger.info('    Runs your video scripts in Playwright.')
  logger.info('')
  logger.info(`  ${pc.cyan(`${commands.screenciRun} test --ui`)}`)
  logger.info('    Starts the interactive UI mode.')
  logger.info('')
  logger.info(
    `  ${pc.cyan(`${commands.screenciRun} test videos/example.video.ts`)}`
  )
  logger.info('    Runs the example video script.')
  logger.info('')
  logger.info(`  ${pc.cyan(`${commands.screenciRun} record`)}`)
  logger.info('    Records and uploads videos.')
  logger.info('')
  logger.info('We suggest that you begin by typing:')
  logger.info('')
  logger.info(`    ${pc.cyan(`${commands.screenciRun} test`)}`)
  logger.info('')
  logger.info('And check out the following files:')
  logger.info('  - ./videos/example.video.ts - Example video script')
  logger.info('  - ./screenci.config.ts - ScreenCI configuration')
  logger.info('')
  logger.info(
    `Visit ${pc.cyan('https://screenci.com/docs')} for more information.`
  )
  logger.info('')
  logger.info('Happy hacking! 🎥')
}

function generateGithubAction(packageManager: PackageManager): string {
  const commands = getPackageManagerCommand(packageManager)
  return `name: ScreenCI

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  record:
    runs-on: ubuntu-latest
    environment:
      name: screenci
      url: \${{ steps.record.outputs.screenci_project_url }}
    steps:
      - name: Check SCREENCI_SECRET
        env:
          SCREENCI_SECRET: \${{ secrets.SCREENCI_SECRET }}
        run: |
          if [ -z "$SCREENCI_SECRET" ]; then
            echo "::error::SCREENCI_SECRET is not set. Copy it from https://app.screenci.com/secrets or ./.env, add it under Settings → Secrets and variables → Actions → Repository secrets, and then rerun this action."
            exit 1
          fi

      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: ${commands.cacheName}
          cache-dependency-path: ${commands.lockfileName}

      - name: Install dependencies
        working-directory: .
        run: ${packageManager === 'pnpm' ? 'pnpm install --frozen-lockfile' : 'npm ci'}

      - name: Cache Playwright Chromium
        uses: actions/cache@v5
        id: pw-cache
        with:
          path: ~/.cache/ms-playwright
          key: playwright-\${{ runner.os }}-\${{ hashFiles('${commands.lockfileName}') }}

      - name: Install Chromium
        if: steps.pw-cache.outputs.cache-hit != 'true'
        working-directory: .
        run: ${commands.playwrightRun} install chromium

      - id: record
        name: Record
        working-directory: .
        env:
          SCREENCI_SECRET: \${{ secrets.SCREENCI_SECRET }}
        run: ${commands.screenciRun} record
`
}

function openBrowser(url: string): void {
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], {
        detached: true,
        stdio: 'ignore',
        shell: true,
      }).unref()
      return
    }

    const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open'
    spawn(cmd, [url], { detached: true, stdio: 'ignore' }).unref()
  } catch (err) {
    logger.warn('Failed to open browser automatically:', err)
  }
}

async function performBrowserLogin(appUrl: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      try {
        const reqUrl = new URL(req.url ?? '/', 'http://localhost')
        const secret = reqUrl.searchParams.get('secret')

        if (secret) {
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end(
            '<html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><p style="font-size:1.2rem">Setup complete! You can close this tab.</p></body></html>'
          )
          server.close()
          resolve(secret)
        } else {
          res.writeHead(400, { 'Content-Type': 'text/html' })
          res.end(
            '<html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><p style="color:red;font-size:1.2rem">Authentication failed: no secret received. Please try again.</p></body></html>'
          )
          server.close()
          reject(new Error('No secret received in callback'))
        }
      } catch (err) {
        res.writeHead(500)
        res.end('Internal error')
        server.close()
        reject(err)
      }
    })

    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port
      const callbackUrl = `http://localhost:${port}/callback`
      const loginUrl = `${appUrl}/cli-auth?callback=${encodeURIComponent(callbackUrl)}`

      logger.info(`If the browser does not open automatically, visit:`)
      logger.info(pc.cyan(loginUrl))
      logger.info('')

      openBrowser(loginUrl)
    })

    const timeout = setTimeout(
      () => {
        server.close()
        reject(new Error('Authentication timed out after 5 minutes'))
      },
      15 * 60 * 1000
    )

    server.on('close', () => clearTimeout(timeout))
  })
}

function generateExampleVideo(): string {
  return `import { autoZoom, createNarration, hide, video, voices } from 'screenci'

const narration = createNarration({
  voice: { name: voices.Sophie },
  languages: {
    en: {
      cues: {
        intro:
          'This video shows how to get started with ScreenCI [pronounce: screen see eye].',
        docs: 'You can find the documentation linked right on the front page.',
      },
    },
  },
})

video('How to get started', async ({ page }) => {
  await hide(async () => {
    await page.goto('https://screenci.com')
    await page.waitForLoadState('networkidle');
  })

  await narration.intro()
  await narration.docs()

  await autoZoom(async () => {
    await page.getByRole('link', { name: 'View Documentation' }).click()
  })

  await page.getByRole('heading', { level: 1, name: 'Installation' }).first().waitFor()
})
`
}

function getDefaultInitProjectName(): string {
  const directoryName = basename(getInitProjectRoot())
  return directoryName.length > 0 ? directoryName : 'screenci-project'
}

async function promptProjectName(): Promise<string> {
  return input({
    message: 'Project name:',
    default: getDefaultInitProjectName(),
  })
}

async function promptYesNo(
  message: string,
  defaultValue: boolean
): Promise<boolean> {
  const answer = await input({
    message,
    default: defaultValue ? 'y' : 'n',
    validate: (value) => {
      const normalized = value.trim().toLowerCase()
      if (
        normalized === '' ||
        normalized === 'y' ||
        normalized === 'yes' ||
        normalized === 'n' ||
        normalized === 'no'
      ) {
        return true
      }
      return 'Enter y or n'
    },
  })

  const normalized = answer.trim().toLowerCase()
  if (normalized === '') return defaultValue
  return normalized === 'y' || normalized === 'yes'
}

async function promptInitGithubActionWorkflow(): Promise<boolean> {
  return promptYesNo('Add a GitHub Actions workflow? (Y/n)', true)
}

async function promptInitPlaywrightBrowsersForPackageManager(
  packageManager: PackageManager
): Promise<boolean> {
  const commands = getPackageManagerCommand(packageManager)
  return promptYesNo(
    `Install Playwright browsers (can be done manually via '${commands.playwrightRun} install chromium')? (Y/n)`,
    true
  )
}

async function promptInitPlaywrightOsDependenciesForPackageManager(
  packageManager: PackageManager
): Promise<boolean> {
  const commands = getPackageManagerCommand(packageManager)
  return promptYesNo(
    `Install Playwright operating system dependencies (might require sudo / root and can be done manually via '${commands.playwrightRun} install-deps chromium')? (y/N)`,
    false
  )
}

async function promptInitScreenCISkill(): Promise<boolean> {
  return promptYesNo(
    "Install the ScreenCI skill for AI agents (can be done manually via 'npx -y skills add screenci/screenci --skill screenci -y')? (Y/n)",
    true
  )
}

async function promptInitPlaywrightCliSkillForPackageManager(
  packageManager: PackageManager
): Promise<boolean> {
  const installPlaywrightCli =
    packageManager === 'pnpm'
      ? 'pnpm add --save-dev @playwright/cli'
      : 'npm install @playwright/cli'
  return promptYesNo(
    `Install playwright-cli for URL-based browser inspection (can be done manually via 'npx -y skills add screenci/screenci --skill playwright-cli -y && ${installPlaywrightCli}')? (Y/n)`,
    true
  )
}

function getInitProjectRoot(): string {
  return process.env['SCREENCI_INIT_CWD'] ?? process.cwd()
}

function getInitScreenciDependencyOverride(): string | undefined {
  return process.env['SCREENCI_INIT_SCREENCI_DEPENDENCY']
}

export async function ensureScreenciSecret(
  resolvedConfigPath?: string
): Promise<string | undefined> {
  const existingSecret = process.env.SCREENCI_SECRET
  if (existingSecret) return existingSecret

  logger.info(
    'Opening browser for authentication to get your SCREENCI_SECRET...'
  )

  const appUrl = getDevFrontendUrl()
  try {
    const secret = await performBrowserLogin(appUrl)
    process.env.SCREENCI_SECRET = secret
    const savePath = resolvedConfigPath
      ? ((await resolveConfiguredEnvFilePath(resolvedConfigPath)) ??
        resolve(process.cwd(), '.env'))
      : resolve(process.cwd(), '.env')
    await appendFile(savePath, `SCREENCI_SECRET=${secret}\n`)
    logger.info(`Successfully saved SCREENCI_SECRET to ${savePath}`)
    return secret
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn(`Authentication failed: ${msg}`)
    logger.info(
      'You can add SCREENCI_SECRET manually to .env later (get it from the API Key page in the dashboard).'
    )
    return undefined
  }
}

type InitOptions = {
  verbose: boolean
  yes: boolean
  packageManager: PackageManager
  agent?: string
}

async function runInit(
  projectNameArg: string | undefined,
  options: InitOptions
): Promise<void> {
  const { verbose, yes, agent, packageManager } = options
  const commands = getPackageManagerCommand(packageManager)
  const initCwd = getInitProjectRoot()

  let projectName = projectNameArg?.trim()

  if (!projectName) {
    projectName = yes ? getDefaultInitProjectName() : await promptProjectName()
  }

  if (!projectName) {
    logger.error('Error: Project name is required')
    process.exit(1)
  }

  const projectDir = initCwd
  const githubWorkflowsDir = resolve(projectDir, '.github', 'workflows')
  const githubActionPath = resolve(githubWorkflowsDir, 'screenci.yaml')
  const shouldAddGithubActionWorkflow = yes
    ? true
    : await promptInitGithubActionWorkflow()
  const shouldInstallPlaywrightBrowsers = yes
    ? true
    : await promptInitPlaywrightBrowsersForPackageManager(packageManager)
  const shouldInstallPlaywrightOsDependencies = yes
    ? false
    : await promptInitPlaywrightOsDependenciesForPackageManager(packageManager)
  const shouldInstallScreenCISkill = yes
    ? true
    : await promptInitScreenCISkill()
  const shouldInstallPlaywrightCli = yes
    ? true
    : await promptInitPlaywrightCliSkillForPackageManager(packageManager)

  if (shouldAddGithubActionWorkflow && existsSync(githubActionPath)) {
    logger.error(
      'Error: GitHub Actions workflow ".github/workflows/screenci.yaml" already exists'
    )
    process.exit(1)
  }

  const skills: string[] = []
  if (shouldInstallScreenCISkill) {
    skills.push('screenci')
  }
  if (shouldInstallPlaywrightCli) {
    skills.push('playwright-cli')
  }
  const skillsArgs =
    skills.length === 0
      ? null
      : [
          '-y',
          'skills',
          'add',
          'screenci/screenci',
          ...(agent ? ['--agent', agent] : []),
          ...skills.flatMap((skillName) => ['--skill', skillName]),
          '-y',
        ]
  const skillsCommand =
    skillsArgs === null ? null : `npx ${skillsArgs.join(' ')}`
  const screenciDependency =
    getInitScreenciDependencyOverride() ?? (await readCurrentScreenciVersion())
  const packageJsonPath = resolve(projectDir, 'package.json')
  const hasExistingPackageJson = existsSync(packageJsonPath)

  logger.info("Initializing project in '.'")
  await mkdir(resolve(projectDir, 'videos'), { recursive: true })
  if (shouldAddGithubActionWorkflow) {
    await mkdir(githubWorkflowsDir, { recursive: true })
  }
  await writeFile(
    resolve(projectDir, 'screenci.config.ts'),
    generateConfig(projectName)
  )
  if (!hasExistingPackageJson) {
    await writeFile(packageJsonPath, generateEmptyPackageJson())
  }
  await writeFile(
    resolve(projectDir, 'README.md'),
    generateReadmeForPackageManager(projectName, packageManager)
  )
  await writeInitGitignore(projectDir)
  await writeFile(
    resolve(projectDir, 'videos', 'example.video.ts'),
    generateExampleVideo()
  )
  if (shouldAddGithubActionWorkflow) {
    await writeFile(githubActionPath, generateGithubAction(packageManager))
  }

  if (skillsArgs !== null) {
    if (verbose) {
      logger.info(`Running '${skillsCommand}'...`)
      await spawnInherited('npx', skillsArgs, projectDir, 'screenci init')
    } else {
      const spinner = ora('Adding selected AI skills...').start()
      try {
        await spawnSilent('npx', skillsArgs, projectDir)
        spinner.succeed('Selected AI skills added')
      } catch (err) {
        spinner.fail('AI skills install failed')
        throw err
      }
    }
  }

  await installInitDependencies(
    projectDir,
    verbose,
    screenciDependency,
    shouldInstallPlaywrightCli,
    packageManager
  )

  if (shouldInstallPlaywrightBrowsers) {
    logger.info(
      `Installing Playwright Chromium with '${commands.playwrightRun} install chromium'...`
    )
    await spawnInherited(
      packageManager === 'pnpm' ? 'pnpm' : 'npx',
      packageManager === 'pnpm'
        ? ['exec', 'playwright', 'install', 'chromium']
        : ['playwright', 'install', 'chromium'],
      projectDir,
      'screenci init'
    )
    logger.info(`${pc.green('✔')} Playwright Chromium installed successfully`)
  }

  if (shouldInstallPlaywrightOsDependencies) {
    logger.info(
      `Installing Playwright operating system dependencies with '${commands.playwrightRun} install-deps chromium'...`
    )
    await spawnInherited(
      packageManager === 'pnpm' ? 'pnpm' : 'npx',
      packageManager === 'pnpm'
        ? ['exec', 'playwright', 'install-deps', 'chromium']
        : ['playwright', 'install-deps', 'chromium'],
      projectDir,
      'screenci init'
    )
    logger.info(
      `${pc.green('✔')} Playwright operating system dependencies installed successfully`
    )
  }

  printInitNextSteps(projectDir, packageManager)
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
        logRecordFailureHint()
        if (
          error instanceof Error &&
          error.message.startsWith('Playwright exited with code ')
        ) {
          playwrightFailure = error
        } else {
          throw error
        }
      }

      if (process.env.SCREENCI_RECORDING === 'true') return

      // After recording, upload results to API if configured
      const resolvedConfigPath = findScreenCIConfig(parsed.configPath)
      if (resolvedConfigPath) {
        try {
          const screenciConfig =
            await loadRecordConfigWithoutPlaywrightCollision(resolvedConfigPath)
          if (screenciConfig.envFile) {
            const envFilePath = resolve(
              dirname(resolvedConfigPath),
              screenciConfig.envFile
            )
            loadEnvFile(envFilePath, true)
          }
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
              'No secret configured, skipping upload. Set SCREENCI_SECRET in your .env file.'
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
              hadFailures: boolean
              failedVideoNames: string[]
              failedVideoMessages: Array<{ videoName: string; message: string }>
            } = {
              projectId: null,
              hadFailures: false,
              failedVideoNames: [],
              failedVideoMessages: [],
            }
            try {
              logger.info('')
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
              hadFailures,
              failedVideoNames,
              failedVideoMessages,
            } = uploadResult
            if (projectId !== null) {
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

      logger.info('')
      logger.info(
        `Tests passed. Run ${pc.cyan('npx screenci record')} to render the videos.`
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
      'package manager to use: npm or pnpm'
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
            options['packageManager'] as string | undefined
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

function spawnInherited(
  cmd: string,
  args: string[],
  cwd?: string,
  activityLabel = cmd
): Promise<void> {
  const spawnSpec = resolveSpawnSpec(cmd, args)
  const child = spawn(spawnSpec.command, spawnSpec.args, {
    stdio: 'inherit',
    ...(spawnSpec.shell !== undefined ? { shell: spawnSpec.shell } : {}),
    ...(cwd ? { cwd } : {}),
  })
  const childSignals = forwardChildSignals(child, activityLabel)

  return new Promise<void>((resolve, reject) => {
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
      } else if (code === 0) {
        resolve()
      } else {
        reject(new Error(`${cmd} exited with code ${code}`))
      }
    })

    child.on('error', (err) => {
      childSignals.cleanup()
      reject(err)
    })
  })
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
      : 'Error: screenci.config.ts not found in current directory'
    logger.error(errorMsg)
    process.exit(1)
  }

  if (command === 'test' || process.env.SCREENCI_RECORDING !== 'true') {
    await loadEnvFileFromConfigSource(configPath, false)
  }

  // Only validate args for record command
  if (command === 'record') {
    await ensureScreenciSecret(configPath)
    validateArgs(additionalArgs)
    const screenciDir = resolve(dirname(configPath), '.screenci')
    clearDirectory(screenciDir)
  }

  const envForChild = { ...process.env }

  await validateUniqueDiscoveredTestTitles(configPath, additionalArgs, {
    ...envForChild,
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

  const spawnSpec = resolveSpawnSpec('playwright', playwrightArgs)
  const child = spawn(spawnSpec.command, spawnSpec.args, {
    stdio: 'inherit',
    ...(process.platform !== 'win32' ? { detached: true } : {}),
    ...(spawnSpec.shell !== undefined ? { shell: spawnSpec.shell } : {}),
    env: {
      ...envForChild,
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
    if (isPartialUploadError(error)) {
      process.exit(1)
    }
    logger.error('Error:', error.message)
    process.exit(1)
  })
}
