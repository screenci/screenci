#!/usr/bin/env -S npx tsx

import { spawn, spawnSync } from 'child_process'
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
import { createHash } from 'crypto'
import { createServer } from 'http'
import type { AddressInfo } from 'net'
import { mkdir, readdir, readFile, stat, writeFile } from 'fs/promises'
import { dirname, relative as pathRelative, resolve } from 'path'
import { fileURLToPath } from 'url'
import { Command, CommanderError } from 'commander'
import { input, confirm } from '@inquirer/prompts'
import ora from 'ora'
import pc from 'picocolors'
import { logger } from './src/logger.js'
import type {
  RecordingCustomVoiceRef,
  RecordingData,
  VideoCaptionTranslationFile,
} from './src/events.js'
import type { VoiceKey } from './src/voices.js'
import type { ScreenCIConfig } from './src/types.js'

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

class UploadCancelledError extends Error {
  constructor(message = 'Upload cancelled') {
    super(message)
    this.name = 'UploadCancelledError'
  }
}

function isUploadCancelledError(err: unknown): boolean {
  return (
    err instanceof UploadCancelledError ||
    (err instanceof Error &&
      (err.name === 'AbortError' || err.name === 'UploadCancelledError'))
  )
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

function parseDockerfileVersion(dockerfilePath: string): string {
  let content: string
  try {
    content = readFileSync(dockerfilePath, 'utf-8')
  } catch {
    return 'unknown'
  }
  const fromLine = content
    .split('\n')
    .find((line) => line.trim().toUpperCase().startsWith('FROM'))
  if (!fromLine) return 'unknown'
  const match = fromLine.match(/:([^\s@]+)/)
  return match?.[1] ?? 'unknown'
}

const CONTAINER_RUNTIME_DOCS_URL =
  'https://screenci.com/guides/getting-started/#prerequisites'

function prerequisitesMessage(): string {
  return `See prerequisites: ${pc.blue(CONTAINER_RUNTIME_DOCS_URL)}`
}

const MIN_CONTAINER_RUNTIME_MAJOR_VERSION = {
  podman: 5,
  docker: 28,
} as const

type ContainerRuntimeName = keyof typeof MIN_CONTAINER_RUNTIME_MAJOR_VERSION

type ContainerRuntimeCheckResult = {
  runtime: ContainerRuntimeName
  version: string
  majorVersion: number | null
}

function parseContainerRuntimeMajorVersion(
  versionOutput: string
): number | null {
  const match = versionOutput.match(/(\d+)(?:\.\d+){0,2}/)
  if (!match) return null

  const majorVersion = Number.parseInt(match[1] ?? '', 10)
  return Number.isNaN(majorVersion) ? null : majorVersion
}

function checkContainerRuntime(
  runtime: ContainerRuntimeName
): ContainerRuntimeCheckResult | null {
  const result = spawnSync(runtime, ['--version'], { encoding: 'utf8' })

  if (result.status !== 0 || result.error !== undefined) {
    return null
  }

  const version = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()

  return {
    runtime,
    version,
    majorVersion: parseContainerRuntimeMajorVersion(version),
  }
}

function getPreferredContainerRuntime(): ContainerRuntimeCheckResult | null {
  const podman = checkContainerRuntime('podman')
  if (podman) return podman

  return checkContainerRuntime('docker')
}

function exitContainerRuntimeNotFound(runtime: ContainerRuntimeName): never {
  logger.error(`Error: ${runtime} not found.`)
  logger.error(`Install ${runtime} or remove the --${runtime} flag.`)
  logger.error(prerequisitesMessage())
  process.exit(1)
}

function warnIfContainerRuntimeVersionIsOld(
  runtimeCheck: ContainerRuntimeCheckResult
): void {
  const minimumVersion =
    MIN_CONTAINER_RUNTIME_MAJOR_VERSION[runtimeCheck.runtime]

  if (
    runtimeCheck.majorVersion !== null &&
    runtimeCheck.majorVersion < minimumVersion
  ) {
    logger.warn(
      `${runtimeCheck.runtime} ${minimumVersion}+ recommended (detected: ${runtimeCheck.version}). Most likely this still works, continuing.`
    )
    logger.warn(prerequisitesMessage())
  }
}

function spawnSilent(cmd: string, args: string[], cwd?: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'pipe', ...(cwd ? { cwd } : {}) })
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

function spawnCaptured(
  cmd: string,
  args: string[],
  cwd?: string
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'pipe', ...(cwd ? { cwd } : {}) })
    const childSignals = forwardChildSignals(child, cmd)
    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString()
    })
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString()
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
      resolve({ code, stdout, stderr })
    })
    child.on('error', (err) => {
      childSignals.cleanup()
      reject(err)
    })
  })
}

function forwardChildSignals(
  child: ChildProcess,
  activityLabel: string
): { cleanup: () => void; getForwardedSignal: () => NodeJS.Signals | null } {
  let forwardedSignal: NodeJS.Signals | null = null
  let forceKillTimer: NodeJS.Timeout | null = null

  const forwardSignal = (signal: NodeJS.Signals) => {
    if (forwardedSignal !== null) return
    forwardedSignal = signal
    if (process.env.SCREENCI_SIGNAL_LOGGING !== 'silent') {
      logger.info(`Received ${signal}, stopping ${activityLabel}...`)
    }
    if (!child.killed) {
      child.kill(signal)
    }
    forceKillTimer = setTimeout(() => {
      if (child.exitCode === null) {
        if (process.env.SCREENCI_SIGNAL_LOGGING !== 'silent') {
          logger.info(`Forcing ${activityLabel} to stop after timeout...`)
        }
        child.kill('SIGKILL')
      }
    }, 3000)
    forceKillTimer.unref()
  }

  const handleSigint = () => forwardSignal('SIGINT')
  const handleSigterm = () => forwardSignal('SIGTERM')

  process.on('SIGINT', handleSigint)
  process.on('SIGTERM', handleSigterm)

  return {
    cleanup: () => {
      if (forceKillTimer !== null) {
        clearTimeout(forceKillTimer)
      }
      process.off('SIGINT', handleSigint)
      process.off('SIGTERM', handleSigterm)
    },
    getForwardedSignal: () => forwardedSignal,
  }
}

async function getPlaywrightChromiumInstallStatus(
  projectDir: string,
  verbose = false
): Promise<{ needed: boolean; version: string | null }> {
  try {
    if (verbose) {
      logger.info(
        'Checking Playwright Chromium install with: npx playwright install --list'
      )
    }
    const list = await spawnCaptured(
      'npx',
      ['playwright', 'install', '--list'],
      projectDir
    )
    if (verbose) {
      if (list.stdout.trim() !== '') logger.info(list.stdout.trimEnd())
      if (list.stderr.trim() !== '') logger.info(list.stderr.trimEnd())
      logger.info(`Check result: exit code ${list.code ?? 'null'}`)
    }
    const output = `${list.stdout}\n${list.stderr}`
    const versionMatch = output.match(/\bchromium-(\d+)\b/i)
    if (list.code === 0 && versionMatch) {
      if (verbose) {
        logger.info(
          `Chromium check result: Chromium found in Playwright install list (version ${versionMatch[1]})`
        )
      }
      return { needed: false, version: versionMatch[1] ?? null }
    }
    if (verbose) {
      logger.info(
        'Chromium check result: Chromium not found in Playwright install list'
      )
    }
  } catch {
    // If the probe fails, default to asking.
  }

  if (verbose) {
    logger.info(
      'Chromium check result: unable to verify, install still recommended'
    )
  }
  return { needed: true, version: null }
}

const CONTAINER_LOG_FILTER = [
  /^Running ScreenCI /,
  /^Using config:/,
  /^Starting Xvfb /,
  /^Xvfb started /,
  /^Recording video to:/,
  /^Recording with /,
  /^Stopping recording\.\.\./,
  /^FFmpeg exited /,
  /^Video saved to:/,
  /^Events saved to:/,
]

function spawnContainerRecording(cmd: string, args: string[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['inherit', 'pipe', 'pipe'] })
    const childSignals = forwardChildSignals(child, 'screenci record')

    function forwardFiltered(chunk: Buffer, out: NodeJS.WriteStream): void {
      const lines = chunk.toString().split('\n')
      for (const line of lines) {
        if (line === '') continue
        if (!CONTAINER_LOG_FILTER.some((re) => re.test(line.trimStart()))) {
          out.write(line + '\n')
        }
      }
    }

    child.stdout?.on('data', (chunk: Buffer) =>
      forwardFiltered(chunk, process.stdout)
    )
    child.stderr?.on('data', (chunk: Buffer) =>
      forwardFiltered(chunk, process.stderr)
    )

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

function findRepoRoot(startDir: string): string | null {
  let current = startDir
  while (true) {
    if (
      existsSync(resolve(current, '.git')) ||
      existsSync(resolve(current, 'pnpm-workspace.yaml')) ||
      existsSync(resolve(current, 'package-lock.json')) ||
      existsSync(resolve(current, 'yarn.lock'))
    ) {
      return current
    }
    const parent = resolve(current, '..')
    if (parent === current) return null
    current = parent
  }
}

async function findLatestEntry(screenciDir: string): Promise<string | null> {
  let entries: string[]
  try {
    entries = await readdir(screenciDir)
  } catch {
    return null
  }

  let latestEntry: string | null = null
  let latestMtime = 0

  for (const entry of entries) {
    try {
      const entryPath = resolve(screenciDir, entry)
      const s = await stat(entryPath)
      if (s.mtimeMs > latestMtime) {
        latestMtime = s.mtimeMs
        latestEntry = entry
      }
    } catch {
      // skip unreadable entries
    }
  }

  return latestEntry
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
    if (event.type === 'captionStart' && event.translations) {
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

    if (event.type === 'videoCaptionStart' && event.translations) {
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

    if (event.type === 'videoCaptionStart') {
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

      if (event.type === 'captionStart' && event.translations) {
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

      if (event.type !== 'videoCaptionStart') return event

      // Strip assetPath from translations — hash was already computed during recording
      if (event.translations) {
        const translations = Object.fromEntries(
          Object.entries(event.translations).map(([language, translation]) => {
            if ('assetHash' in translation) {
              const { assetPath: _removed, ...rest } =
                translation as VideoCaptionTranslationFile
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

async function uploadAssets(
  assets: PreparedUploadAsset[],
  apiUrl: string,
  secret: string,
  recordingId: string,
  signal: AbortSignal,
  throwIfAborted: () => void
): Promise<void> {
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
        logger.info(`Asset already exists: ${asset.path}`)
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
          logger.info(`Asset already exists: ${asset.path}`)
        } else {
          logger.warn(
            `Failed to upload asset ${asset.path}: ${res.status} ${text}${hint401(res.status, secret)}`
          )
        }
      } else {
        logger.info(`Asset uploaded: ${asset.path}`)
      }
    } catch (err) {
      if (isUploadCancelledError(err)) {
        throw err
      }
      logger.warn(`Network error uploading asset ${asset.path}:`, err)
    }
  }
}

async function uploadRecordings(
  screenciDir: string,
  projectName: string,
  apiUrl: string,
  secret: string,
  specificEntry?: string,
  verbose = false
): Promise<string | null> {
  const uploadAbort = createUploadAbortController('upload')
  let entries: string[]
  try {
    entries = await readdir(screenciDir)
  } catch {
    logger.warn('No .screenci directory found, skipping upload')
    return null
  }

  if (specificEntry !== undefined) {
    entries = entries.filter((e) => e === specificEntry)
  }

  let firstProjectId: string | null = null

  try {
    for (const entry of entries) {
      uploadAbort.throwIfAborted()
      const dataJsonPath = resolve(screenciDir, entry, 'data.json')
      if (!existsSync(dataJsonPath)) {
        if (verbose) logger.info(`Skipping "${entry}": no data.json found`)
        continue
      }

      let data: RecordingData
      try {
        const raw = await readFile(dataJsonPath, 'utf-8')
        data = JSON.parse(raw) as RecordingData
      } catch {
        logger.warn(`Failed to read ${dataJsonPath}, skipping`)
        continue
      }

      const videoName = data.metadata?.videoName ?? entry
      const preparedUploadAssets = await collectUploadAssets(
        data,
        resolve(screenciDir, '..')
      )
      data = annotateRecordingDataWithAssetHashes(data, preparedUploadAssets)

      const uploadSpinner = ora(`Uploading "${videoName}"`).start()
      try {
        uploadAbort.throwIfAborted()
        const recordingPath = resolve(screenciDir, entry, 'recording.mp4')
        const recordingHash = existsSync(recordingPath)
          ? await hashFile(recordingPath)
          : undefined
        // Step 1: register upload and get recordingId
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
          uploadSpinner.fail(`Failed to upload "${videoName}"`)
          logger.warn(
            `Failed to start upload for "${videoName}": ${startResponse.status} ${text}${hint401(startResponse.status, secret)}`
          )
          continue
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

        if (firstProjectId === null) {
          firstProjectId = projectId
        }

        // Step 1b: upload all referenced files via the shared asset flow
        await uploadAssets(
          preparedUploadAssets,
          apiUrl,
          secret,
          recordingId,
          uploadAbort.signal,
          uploadAbort.throwIfAborted
        )

        // Step 2: stream the recording video file (if it exists)
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
              uploadSpinner.fail(`Failed to upload "${videoName}"`)
              logger.warn(
                `Failed to upload recording for "${videoName}": ${recordingResponse.status} ${text}${hint401(recordingResponse.status, secret)}`
              )
              continue
            }
          } finally {
            uploadAbort.signal.removeEventListener('abort', abortStream)
          }
        }

        uploadSpinner.succeed(`Uploaded "${videoName}"`)
      } catch (err) {
        if (isUploadCancelledError(err)) {
          uploadSpinner.fail(`Cancelled "${videoName}"`)
          throw err
        }
        uploadSpinner.fail(`Error uploading "${videoName}"`)
        logger.warn(`Network error uploading "${videoName}":`, err)
      }
    }

    return firstProjectId
  } finally {
    uploadAbort.cleanup()
  }
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

async function uploadLatest(
  configPath: string | undefined,
  verbose = false
): Promise<void> {
  const { resolvedConfigPath, screenciConfig } =
    await loadScreenCIConfigAndEnv(configPath)

  const apiUrl = getDevBackendUrl()

  const secret = process.env.SCREENCI_SECRET
  if (!secret) {
    logger.error(
      'No secret configured. Set SCREENCI_SECRET in your .env file (get it from the API Key page in the dashboard).'
    )
    process.exit(1)
  }

  const configDir = dirname(resolvedConfigPath)
  const screenciDir = resolve(configDir, '.screenci')

  if (verbose) {
    logger.info(`screenciDir=${screenciDir}`)
    logger.info(`apiUrl=${apiUrl}`)
  }

  const appUrl = getDevFrontendUrl()

  let projectId: string | null = null
  try {
    projectId = await uploadRecordings(
      screenciDir,
      screenciConfig.projectName,
      apiUrl,
      secret,
      undefined,
      verbose
    )
  } catch (err) {
    if (isUploadCancelledError(err)) {
      process.exit(130)
    }
    throw err
  }
  if (projectId !== null) {
    logger.info('')
    logger.info('Recording finished, results available at:')
    logger.info(pc.cyan(`${appUrl}/project/${projectId}`))
  }
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
    try {
      process.loadEnvFile(envFilePath)
    } catch (err) {
      logger.warn(`Failed to load env file ${envFilePath}:`, err)
    }
  }

  return { resolvedConfigPath, screenciConfig }
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

async function tryReadConfigFromSource(
  resolvedConfigPath: string
): Promise<Pick<ScreenCIConfig, 'projectName'> & { envFile?: string }> {
  const configSource = await readFile(resolvedConfigPath, 'utf-8')
  const projectName = extractConfigStringLiteral(configSource, 'projectName')

  if (!projectName) {
    throw new Error(
      'Could not determine projectName from screenci.config.ts without importing it.'
    )
  }

  const envFile = extractConfigStringLiteral(configSource, 'envFile')

  return {
    projectName,
    ...(envFile !== undefined ? { envFile } : {}),
  }
}

async function loadRecordConfigWithoutPlaywrightCollision(
  resolvedConfigPath: string
): Promise<ScreenCIConfig> {
  try {
    const configModule = await import(resolvedConfigPath)
    return configModule.default as ScreenCIConfig
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.includes('Requiring @playwright/test second time')
    ) {
      logger.warn(
        'Playwright was loaded from multiple module paths. Falling back to static config parsing for upload metadata.'
      )
      return (await tryReadConfigFromSource(
        resolvedConfigPath
      )) as ScreenCIConfig
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
  forbidOnly: !!process.env.CI,
  reporter: 'html',
  use: {
    trace: 'retain-on-failure',
    sendTraces: true,
    recordOptions: {
      aspectRatio: '16:9',
      quality: '1080p',
      fps: 30,
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

function generatePackageJson(
  projectName: string,
  includePlaywrightCli = false
): string {
  const npmName = projectName.toLowerCase().replace(/[^a-z0-9-]/g, '-')
  const devDependencies: Record<string, string> = {
    '@types/node': '^25.0.0',
    tsx: '^4.21.0',
  }
  if (includePlaywrightCli) {
    devDependencies['@playwright/cli'] = 'latest'
  }
  return (
    JSON.stringify(
      {
        name: npmName,
        version: '1.0.0',
        description: '',
        type: 'module',
        scripts: {
          record: 'screenci record',
          retry: 'screenci retry',
          dev: 'screenci dev',
        },
        dependencies: {
          screenci: 'latest',
        },
        devDependencies,
      },
      null,
      2
    ) + '\n'
  )
}

function generateDockerfile(): string {
  return `FROM ghcr.io/screenci/record:latest

COPY package.json ./
COPY screenci.config.ts ./
COPY videos ./videos
`
}

function generateGitignore(): string {
  return `/playwright-report/
.screenci
node_modules/
.env
`
}

function generateGithubAction(): string {
  return `name: Record

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  record:
    runs-on: ubuntu-latest
    steps:
      - name: Check SCREENCI_SECRET
        env:
          SCREENCI_SECRET: \${{ secrets.SCREENCI_SECRET }}
        run: |
          if [ -z "$SCREENCI_SECRET" ]; then
            echo "::error::SCREENCI_SECRET is not set. Add it under Settings → Secrets and variables → Actions."
            exit 1
          fi

      - uses: actions/checkout@v4

      - name: Build Docker image
        run: docker build -t screenci-project .

      - name: Record
        env:
          SCREENCI_SECRET: \${{ secrets.SCREENCI_SECRET }}
        run: |
          docker run --rm \\
            -e SCREENCI_SECRET \\
            -e SCREENCI_IN_CONTAINER=true \\
            -e SCREENCI_RECORD=true \\
            screenci-project \\
            npm run record
`
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'start'
        : 'xdg-open'
  spawn(cmd, [url], { detached: true, stdio: 'ignore' }).unref()
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
            '<html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><p style="font-size:1.2rem">Authentication successful! You can close this tab.</p></body></html>'
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
      5 * 60 * 1000
    )

    server.on('close', () => clearTimeout(timeout))
  })
}

function generateExampleVideo(): string {
  return `import { video } from 'screenci'

video('Example video', async ({ page }) => {
  await page.goto('https://example.com')
  await page.waitForTimeout(3000)
})
`
}

async function promptProjectName(): Promise<string> {
  return input({ message: 'Project name:' })
}

function getProjectDirName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-')
}

async function runInitAuth(): Promise<void> {
  const appUrl = getDevFrontendUrl()
  try {
    const secret = await performBrowserLogin(appUrl)
    const savePath = resolve(process.cwd(), '.env')
    await writeFile(savePath, `SCREENCI_SECRET=${secret}\n`)
    logger.info(`Successfully saved SCREENCI_SECRET to ${savePath}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn(`Authentication failed: ${msg}`)
    logger.info(
      'You can add SCREENCI_SECRET manually to .env later (get it from the API Key page in the dashboard).'
    )
  }
}

function checkNodeVersion(): void {
  const [major] = process.versions.node.split('.').map(Number)
  if (major === undefined || major < 18) {
    logger.error(
      `Error: Node.js 18 or higher is required (current: v${process.versions.node})`
    )
    process.exit(1)
  }
}

async function runInit(
  projectNameArg?: string,
  verbose = false
): Promise<void> {
  checkNodeVersion()
  checkContainerRuntimeForInit()

  let projectName = projectNameArg?.trim()

  if (!projectName) {
    projectName = await promptProjectName()
  }

  if (!projectName) {
    logger.error('Error: Project name is required')
    process.exit(1)
  }

  const dirName = getProjectDirName(projectName)
  const projectDir = resolve(process.cwd(), dirName)

  if (existsSync(projectDir)) {
    logger.error(`Error: Directory "${dirName}" already exists`)
    process.exit(1)
  }

  const shouldAddPlaywrightCli = await confirm({
    message:
      'Do you want to write videos with an AI agent based on a URL? playwright-cli is recommended and will be added as a dev dependency.',
    default: true,
  })

  // Authenticate before creating any files
  let secret = process.env.SCREENCI_SECRET
  if (!secret) {
    logger.info(
      'Opening browser for authentication to get your SCREENCI_SECRET...'
    )
    const appUrl = getDevFrontendUrl()
    try {
      secret = await performBrowserLogin(appUrl)
      process.env.SCREENCI_SECRET = secret
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.warn(`Authentication failed: ${msg}`)
      logger.info(
        'You can add SCREENCI_SECRET manually to .env later (get it from the API Key page in the dashboard).'
      )
    }
  }

  const skillsArgs = [
    '--yes',
    'skills',
    'add',
    'screenci/screenci',
    '--skill',
    'screenci',
    ...(shouldAddPlaywrightCli ? ['--skill', 'playwright-cli'] : []),
    '-y',
  ]
  const skillsCommand = `npx ${skillsArgs.join(' ')}`

  await mkdir(resolve(projectDir, 'videos'), { recursive: true })
  await mkdir(resolve(projectDir, '.github', 'workflows'), { recursive: true })
  await writeFile(
    resolve(projectDir, 'screenci.config.ts'),
    generateConfig(projectName)
  )
  await writeFile(
    resolve(projectDir, 'package.json'),
    generatePackageJson(dirName, shouldAddPlaywrightCli)
  )
  await writeFile(resolve(projectDir, 'Dockerfile'), generateDockerfile())
  await writeFile(resolve(projectDir, '.gitignore'), generateGitignore())
  await writeFile(
    resolve(projectDir, 'videos', 'example.video.ts'),
    generateExampleVideo()
  )
  await writeFile(
    resolve(projectDir, '.github', 'workflows', 'record.yml'),
    generateGithubAction()
  )
  if (secret) {
    await writeFile(resolve(projectDir, '.env'), `SCREENCI_SECRET=${secret}\n`)
  }

  logger.info(`Initialized screenci project "${projectName}" in ${projectDir}/`)
  logger.info('Files created:')
  logger.info('  screenci.config.ts')
  logger.info('  package.json')
  logger.info('  Dockerfile')
  logger.info('  .gitignore')
  logger.info('  videos/example.video.ts')
  logger.info('  .github/workflows/record.yml')
  if (secret) {
    logger.info('  .env  (contains SCREENCI_SECRET)')
  }
  logger.info('')
  logger.info('screenci requires dependencies to be installed.')
  if (verbose) {
    logger.info(`Running '${skillsCommand}'...`)
    await spawnInherited('npx', skillsArgs, projectDir, 'screenci init')
  } else {
    const spinner = ora('Adding ScreenCI skills...').start()
    try {
      await spawnSilent('npx', skillsArgs, projectDir)
      spinner.succeed('ScreenCI skills added')
    } catch (err) {
      spinner.fail('ScreenCI skills install failed')
      throw err
    }
  }

  let chromiumReady = false

  if (verbose) {
    logger.info("Running 'npm install'...")
    await spawnInherited('npm', ['install'], projectDir, 'screenci init')
  } else {
    const spinner = ora('Running npm install...').start()
    try {
      await spawnSilent('npm', ['install', '--prefix', projectDir])
      spinner.succeed('npm install complete')
    } catch (err) {
      spinner.fail('npm install failed')
      throw err
    }
  }

  const chromiumInstallStatus = await getPlaywrightChromiumInstallStatus(
    projectDir,
    verbose
  )

  if (!chromiumInstallStatus.needed) {
    chromiumReady = true
    const versionText = chromiumInstallStatus.version
      ? `, version ${chromiumInstallStatus.version} already installed.`
      : ' because it is already installed.'
    logger.info(`${pc.green('✔')} Skipping Chromium installation${versionText}`)
  } else {
    logger.info('Local development requires Chromium for Playwright.')
    logger.info("Running 'npx playwright install chromium --with-deps'...")
    await spawnInherited(
      'npx',
      ['playwright', 'install', 'chromium', '--with-deps'],
      projectDir,
      'screenci init'
    )
    chromiumReady = true
  }

  logger.info('')
  logger.info('Next steps:')
  logger.info(`  cd ${dirName}`)
  if (!chromiumReady) {
    logger.info('  npx playwright install chromium --with-deps')
  }
  logger.info('  npx screenci test')
  logger.info('  npx screenci record')
}

export async function main() {
  if (process.argv.length <= 2) {
    logger.error('Error: No command provided')
    logger.error(
      'Available commands: record, dev, test, info, make-public, make-private, retry, init'
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
    .allowUnknownOption(true)
    .action(async () => {
      const parsed = parseRecordCliArgs(getSubcommandArgv('record'))

      if (parsed.forcedRuntime === 'both') {
        logger.error('Error: --podman and --docker cannot be used together')
        process.exit(1)
      }

      const useContainer =
        !parsed.noContainer && process.env.SCREENCI_IN_CONTAINER !== 'true'

      // Validate early so we don't build the container unnecessarily
      if (useContainer) {
        validateArgs(parsed.otherArgs)
      }

      // On the host, load .env so SCREENCI_SECRET is available for uploads
      if (process.env.SCREENCI_IN_CONTAINER !== 'true') {
        const resolvedConfigForSecret = findScreenCIConfig(parsed.configPath)
        if (resolvedConfigForSecret) {
          try {
            const screenciConfig =
              await loadRecordConfigWithoutPlaywrightCollision(
                resolvedConfigForSecret
              )
            if (screenciConfig.envFile) {
              const envFilePath = resolve(
                dirname(resolvedConfigForSecret),
                screenciConfig.envFile
              )
              try {
                process.loadEnvFile(envFilePath)
              } catch {
                // env file may not exist yet
              }
            }
          } catch {
            // Config import failed — continue with whatever is already in env
          }
        }
      }

      if (useContainer) {
        await runWithContainer(
          parsed.otherArgs,
          parsed.configPath,
          parsed.imageTag,
          parsed.verbose,
          parsed.forcedRuntime
        )
      } else {
        await run('record', parsed.otherArgs, parsed.configPath)
      }

      // Upload only from the host, not from inside the container
      if (process.env.SCREENCI_IN_CONTAINER === 'true') return

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
            try {
              process.loadEnvFile(envFilePath)
            } catch (err) {
              logger.warn(`Failed to load env file ${envFilePath}:`, err)
            }
          }
          const apiUrl = getDevBackendUrl()
          const appUrl = getDevFrontendUrl()
          const secret = process.env.SCREENCI_SECRET
          if (!secret) {
            logger.info(
              'No secret configured, skipping upload. Set SCREENCI_SECRET in your .env file.'
            )
            return
          }
          const configDir = dirname(resolvedConfigPath)
          const screenciDir = resolve(configDir, '.screenci')
          let projectId: string | null = null
          try {
            projectId = await uploadRecordings(
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
          if (projectId !== null) {
            logger.info('')
            logger.info('Recording finished, results available at:')
            logger.info(pc.cyan(`${appUrl}/project/${projectId}`))
          }
        } catch (err) {
          logger.warn('Failed to load config for upload:', err)
        }
      }
    })

  // dev command — playwright args pass through as-is
  program
    .command('dev [playwrightArgs...]')
    .description('Run Playwright in dev/UI mode')
    .allowUnknownOption(true)
    .action(async () => {
      const parsed = parseDevCliArgs(getSubcommandArgv('dev'))
      await run('dev', parsed.otherArgs, parsed.configPath)
    })

  program
    .command('test [playwrightArgs...]')
    .description('Run Playwright test with screenci.config.ts')
    .allowUnknownOption(true)
    .action(async () => {
      const parsed = parseDevCliArgs(getSubcommandArgv('test'))
      await run('test', parsed.otherArgs, parsed.configPath)
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

  // retry command
  program
    .command('retry')
    .description('Retry uploading all pending recordings')
    .option('-c, --config <path>', 'path to screenci.config.ts')
    .option('-v, --verbose', 'verbose output')
    .action(async (options: Record<string, unknown>) => {
      await uploadLatest(
        options['config'] as string | undefined,
        (options['verbose'] as boolean | undefined) ?? false
      )
    })

  // init command
  program
    .command('init [name]')
    .description('Initialize a new screenci project')
    .option('-v, --verbose', 'verbose output')
    .action(
      async (name: string | undefined, options: Record<string, unknown>) => {
        if (name === 'auth') {
          await runInitAuth()
        } else {
          await runInit(
            name,
            (options['verbose'] as boolean | undefined) ?? false
          )
        }
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
  noContainer: boolean
  imageTag: string | undefined
  verbose: boolean
  forcedRuntime: ContainerRuntimeName | 'both' | undefined
  otherArgs: string[]
} {
  let configPath: string | undefined
  let noContainer = false
  let imageTag: string | undefined
  let verbose = false
  let forcedRuntime: ContainerRuntimeName | 'both' | undefined
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
    } else if (arg === '--no-container') {
      noContainer = true
    } else if (arg === '--verbose' || arg === '-v') {
      verbose = true
    } else if (arg === '--podman') {
      forcedRuntime = forcedRuntime === 'docker' ? 'both' : 'podman'
    } else if (arg === '--docker') {
      forcedRuntime = forcedRuntime === 'podman' ? 'both' : 'docker'
    } else if (arg === '--tag') {
      const nextArg = args[i + 1]
      if (nextArg === undefined) {
        logger.error('Error: --tag requires a tag argument')
        process.exit(1)
      }
      imageTag = nextArg
      i++
    } else {
      otherArgs.push(arg)
    }
  }

  return {
    configPath,
    noContainer,
    imageTag,
    verbose,
    forcedRuntime,
    otherArgs,
  }
}

function parseDevCliArgs(args: string[]): {
  configPath: string | undefined
  otherArgs: string[]
} {
  let configPath: string | undefined
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
    } else {
      otherArgs.push(arg)
    }
  }

  return { configPath, otherArgs }
}

function validateArgs(args: string[]): void {
  const disallowedFlags = ['--fully-parallel', '--workers', '-j', '--retries']

  for (const arg of args) {
    if (arg === undefined) continue

    // Check if it's a disallowed flag
    if (disallowedFlags.includes(arg)) {
      throw new Error(
        `Flag "${arg}" is not supported by screenci. ` +
          'screenci enforces sequential test execution with a single worker and no retries for proper video recording.'
      )
    }

    // Check if it's a --workers=N, -j=N, or --retries=N format
    if (
      arg.startsWith('--workers=') ||
      arg.startsWith('-j=') ||
      arg.startsWith('--retries=')
    ) {
      throw new Error(
        `Flag "${arg}" is not supported by screenci. ` +
          'screenci enforces sequential test execution with a single worker and no retries for proper video recording.'
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
  const child = spawn(cmd, args, { stdio: 'inherit', ...(cwd ? { cwd } : {}) })
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

export function detectContainerRuntime(
  forcedRuntime?: ContainerRuntimeName
): string {
  const runtimeCheck = forcedRuntime
    ? checkContainerRuntime(forcedRuntime)
    : getPreferredContainerRuntime()

  if (runtimeCheck) {
    warnIfContainerRuntimeVersionIsOld(runtimeCheck)
    return runtimeCheck.runtime
  }

  if (forcedRuntime) {
    exitContainerRuntimeNotFound(forcedRuntime)
  }

  logger.error('Error: Neither podman nor docker found.')
  logger.error(
    'Please install podman (recommended) or docker to use screenci record.'
  )
  logger.error(prerequisitesMessage())
  process.exit(1)
}

function checkContainerRuntimeForInit(): void {
  const runtimeCheck = getPreferredContainerRuntime()

  if (!runtimeCheck) {
    logger.warn(
      'Neither podman nor docker found. Install one before running screenci record.'
    )
    logger.warn(prerequisitesMessage())
    return
  }

  warnIfContainerRuntimeVersionIsOld(runtimeCheck)
}

async function buildImage(
  cmd: string,
  args: string[],
  label: string,
  verbose: boolean
): Promise<void> {
  if (verbose) {
    await spawnInherited(cmd, args)
    return
  }
  const spinner = ora(label).start()
  try {
    await spawnSilent(cmd, args)
    spinner.succeed(label)
  } catch (err) {
    spinner.fail(label)
    const msg = err instanceof Error ? err.message : String(err)
    logger.error(msg)
    logger.error('Run again with --verbose to see the full build output')
    process.exit(1)
  }
}

async function runWithContainer(
  additionalArgs: string[],
  customConfigPath?: string,
  imageTag?: string,
  verbose = false,
  forcedRuntime?: ContainerRuntimeName
) {
  const configPath = findScreenCIConfig(customConfigPath)

  if (!configPath) {
    const errorMsg = customConfigPath
      ? `Error: Config file not found: ${customConfigPath}`
      : 'Error: screenci.config.ts not found in current directory'
    logger.error(errorMsg)
    process.exit(1)
  }

  const configDir = dirname(configPath)
  const dockerfilePath = resolve(configDir, 'Dockerfile')

  if (!existsSync(dockerfilePath)) {
    logger.error(`Error: Dockerfile not found at ${dockerfilePath}`)
    logger.error(
      'Container mode requires a Dockerfile next to screenci.config.ts'
    )
    process.exit(1)
  }

  const repoRoot = findRepoRoot(configDir)
  if (!repoRoot) {
    logger.error(
      'Error: Could not find repository root (.git or pnpm-workspace.yaml)'
    )
    process.exit(1)
  }

  const containerRuntime = detectContainerRuntime(forcedRuntime)

  const ghcrImage = 'ghcr.io/screenci/record:latest'

  const dockerfileVersion = parseDockerfileVersion(dockerfilePath)

  if (process.env['SCREENCI_LOCAL_IMAGE']) {
    logger.info('SCREENCI_LOCAL_IMAGE set — skipping screenci image build')
  } else if (imageTag !== undefined) {
    const remoteImage = `ghcr.io/screenci/record:${imageTag}`
    const imageExists =
      spawnSync(containerRuntime, ['image', 'exists', remoteImage], {
        stdio: 'ignore',
      }).status === 0
    logger.info(
      `Using image tag ${imageTag} instead of the version ${dockerfileVersion} from Dockerfile`
    )
    if (!imageExists) {
      await buildImage(
        containerRuntime,
        ['pull', remoteImage],
        'Pulling screenci image',
        verbose
      )
    }
    await spawnSilent(containerRuntime, ['tag', remoteImage, ghcrImage])
  } else {
    const cliDir = dirname(fileURLToPath(import.meta.url))
    const screenciPackageRoot = existsSync(resolve(cliDir, 'package.json'))
      ? cliDir
      : resolve(cliDir, '..')
    const screenciDockerfilePath = resolve(cliDir, 'Dockerfile')

    if (verbose) {
      await spawnInherited(
        containerRuntime,
        [
          'build',
          '-f',
          screenciDockerfilePath,
          '-t',
          ghcrImage,
          screenciPackageRoot,
        ],
        undefined,
        'building screenci image'
      )
      await spawnInherited(
        containerRuntime,
        ['build', '-f', dockerfilePath, '-t', 'screenci', configDir],
        undefined,
        'building project image'
      )
    } else {
      const spinner = ora('Building screenci image').start()
      try {
        await spawnSilent(containerRuntime, [
          'build',
          '-f',
          screenciDockerfilePath,
          '-t',
          ghcrImage,
          screenciPackageRoot,
        ])
        await spawnSilent(containerRuntime, [
          'build',
          '-f',
          dockerfilePath,
          '-t',
          'screenci',
          configDir,
        ])
        spinner.succeed('Building screenci image')
      } catch (err) {
        spinner.fail('Building screenci image')
        const msg = err instanceof Error ? err.message : String(err)
        logger.error(msg)
        logger.error('Run again with --verbose to see the full build output')
        process.exit(1)
      }
    }
  }

  if (imageTag !== undefined || process.env['SCREENCI_LOCAL_IMAGE']) {
    await buildImage(
      containerRuntime,
      ['build', '-f', dockerfilePath, '-t', 'screenci', configDir],
      'Building project image',
      verbose
    )
  }

  clearDirectory(resolve(configDir, '.screenci'))

  const secret = process.env['SCREENCI_SECRET']
  if (secret === undefined) {
    logger.error('Error: SCREENCI_SECRET is not set')
    process.exit(1)
  }
  await spawnContainerRecording(containerRuntime, [
    'run',
    '--rm',
    '-e',
    'SCREENCI_IN_CONTAINER=true',
    '-e',
    'SCREENCI_RECORD=true',
    '-e',
    `SCREENCI_SECRET=${secret}`,
    '-e',
    'SCREENCI_SIGNAL_LOGGING=silent',
    '-v',
    `${configDir}/.screenci:/app/.screenci`,
    '-v',
    `${configPath}:/app/screenci.config.ts`,
    '-v',
    `${configDir}/videos:/app/videos`,
    'screenci',
    'screenci',
    'record',
    ...additionalArgs,
  ])
}

async function run(
  command: string,
  additionalArgs: string[],
  customConfigPath?: string
) {
  const configPath = findScreenCIConfig(customConfigPath)

  if (!configPath) {
    const errorMsg = customConfigPath
      ? `Error: Config file not found: ${customConfigPath}`
      : 'Error: screenci.config.ts not found in current directory'
    logger.error(errorMsg)
    process.exit(1)
  }

  // Only validate args for record command (dev allows parallel execution)
  if (command === 'record') {
    validateArgs(additionalArgs)
    const screenciDir = resolve(dirname(configPath), '.screenci')
    clearDirectory(screenciDir)
  }

  // For dev command: use --ui unless --headed is specified
  const isHeaded = additionalArgs.includes('--headed')
  const shouldUseUI = command === 'dev' && !isHeaded

  const mode =
    command === 'dev'
      ? isHeaded
        ? 'headed mode'
        : 'UI mode'
      : command === 'test'
        ? 'tests'
        : 'recorder'
  if (process.env.SCREENCI_IN_CONTAINER !== 'true') {
    logger.info(`Running ScreenCI ${mode} with npx...`)
    logger.info(`Using config: ${configPath}`)
  }

  const playwrightArgs = [
    'playwright',
    'test',
    '--config',
    configPath,
    ...(shouldUseUI ? ['--ui'] : []),
    ...additionalArgs,
  ]

  const child = spawn('npx', playwrightArgs, {
    stdio: 'inherit',
    env: {
      ...process.env,
      // Enable recording only for record command
      ...(command === 'record' ? { SCREENCI_RECORD: 'true' } : {}),
    },
  })
  const childSignals = forwardChildSignals(child, `screenci ${command}`)

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
      }
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`Playwright exited with code ${code}`))
      }
    })

    child.on('error', (err) => {
      childSignals.cleanup()
      reject(err)
    })
  })
}

// Only run if this file is being executed directly
// Check if this module is the main module (handles symlinks properly)
const currentFile = fileURLToPath(import.meta.url)
const mainFile = process.argv[1] ? realpathSync(process.argv[1]) : null

if (
  mainFile &&
  (currentFile === mainFile || currentFile === realpathSync(mainFile))
) {
  main().catch((error) => {
    logger.error('Error:', error.message)
    process.exit(1)
  })
}
