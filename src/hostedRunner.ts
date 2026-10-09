import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assembleIsland,
  defaultDetectIslandPackageManager,
  spawnIslandInstall,
  type AssembleIslandInput,
  type AssembleIslandResult,
  type HostedNetwork,
} from './islandAssembly.js'
import { nodeProjectFilesFs } from './localProjectFiles.js'
import { RECORD_ID_PATTERN } from './sourceSync.js'

/**
 * The hosted recording job (`screenci-hosted-runner`): one run of one video
 * on ScreenCI's own machines. It fetches the run's spec with its single-use
 * run token, builds the island from the stored files, records the video with
 * the island's own `screenci preview`, and reports the outcome. The process
 * exit code mirrors the outcome (0 finished, 1 failed).
 *
 * One deadline covers the whole run (spec, assembly, install, recording):
 * `HOSTED_RUN_TIMEOUT_MS` from start, inside the job's own 16 minute limit.
 * The recording gets whatever time is left minus `REPORT_MARGIN_MS`, so a
 * terminal status is always reported before the deadline.
 *
 * Children (the install, the recording) are spawned without `RUN_ID`,
 * `RUN_TOKEN` and `BACKEND_URL`, and the token is deleted from this
 * process's environment once read. That does not make the token unreachable:
 * the project's code runs as the same user and could read it from this
 * process (for example through /proc). It is single-use and the service
 * computes billing from its own timestamps, so a stolen token can at most
 * end this run early.
 */

export const RUN_TOKEN_HEADER = 'X-ScreenCI-Run-Token'
/** The whole run, measured from the runner's start. */
export const HOSTED_RUN_TIMEOUT_MS = 15 * 60_000
/** Kept back from the deadline for reporting the terminal status. */
export const REPORT_MARGIN_MS = 30_000
/** One status or spec request never waits longer than this. */
const REQUEST_TIMEOUT_MS = 15_000
export const DEFAULT_HOSTED_WORK_DIR = '/work/island'
const ERROR_TAIL_BYTES = 2048

export interface HostedRunSpec {
  runId: string
  projectName: string
  videoName: string
  videoSlug: string | null
  appUrl: string | null
  files: Array<{ path: string; contentBase64: string }>
  envVars: Record<string, string>
  network: HostedNetwork | null
  uploadSecret: string
  recordId: string
  backendUrl: string | null
}

export type HostedRunStatus =
  | { status: 'running' }
  | { status: 'finished'; recordId: string; wallClockMs: number }
  | { status: 'failed'; error: string; wallClockMs?: number }

export interface RunPreviewParams {
  islandDir: string
  videoName: string
  env: Record<string, string>
  timeoutMs: number
}

export interface RunPreviewResult {
  exitCode: number | null
  timedOut: boolean
  /** The last bytes of the process's error output. */
  errorTail: string
}

export interface HostedRunnerDeps {
  env: NodeJS.ProcessEnv
  fetchFn: typeof fetch
  assemble: (input: AssembleIslandInput) => Promise<AssembleIslandResult>
  runPreview: (params: RunPreviewParams) => Promise<RunPreviewResult>
  now: () => number
  /** Resolves after `ms` (the deadline timer). */
  delay: (ms: number) => Promise<void>
  log: (message: string) => void
}

/** Variables only the runner itself may see. */
export const RUNNER_ONLY_ENV = ['RUN_ID', 'RUN_TOKEN', 'BACKEND_URL'] as const

/** A copy of `base` without the runner-only variables. */
export function withoutRunnerEnv(
  base: NodeJS.ProcessEnv
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [name, value] of Object.entries(base)) {
    if (value === undefined) continue
    if ((RUNNER_ONLY_ENV as readonly string[]).includes(name)) continue
    env[name] = value
  }
  return env
}

class DeadlineError extends Error {}

/** `work`, or a DeadlineError once `ms` have passed. */
async function withDeadline<T>(
  work: Promise<T>,
  ms: number,
  delay: HostedRunnerDeps['delay']
): Promise<T> {
  if (ms <= 0) throw new DeadlineError()
  return await Promise.race([
    work,
    delay(ms).then(() => {
      throw new DeadlineError()
    }),
  ])
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseNetwork(raw: unknown): HostedNetwork | null {
  if (!isRecord(raw)) return null
  const optional = (key: string): Record<string, string> => {
    const value = raw[key]
    return typeof value === 'string' && value !== '' ? { [key]: value } : {}
  }
  const credentialOrigin = raw.credentialOrigin
  const headers = Array.isArray(raw.extraHeaders)
    ? raw.extraHeaders.flatMap((header: unknown) =>
        isRecord(header) &&
        typeof header.name === 'string' &&
        typeof header.valueEnv === 'string'
          ? [{ name: header.name, valueEnv: header.valueEnv }]
          : []
      )
    : []
  return {
    ...optional('proxyServer'),
    ...optional('proxyUsernameEnv'),
    ...optional('proxyPasswordEnv'),
    ...optional('httpCredentialsUsernameEnv'),
    ...optional('httpCredentialsPasswordEnv'),
    ...(typeof credentialOrigin === 'string' && credentialOrigin !== ''
      ? { credentialOrigin }
      : {}),
    extraHeaders: headers,
  }
}

function recordIdOf(value: string): string {
  // The CLI only honours SCREENCI_RECORD_ID in this shape; anything else
  // would upload under a fresh id the finished report never names.
  if (!RECORD_ID_PATTERN.test(value)) {
    throw new Error('The run spec has a malformed recordId')
  }
  return value
}

/** Shape-checks the spec the backend served; throws on anything off. */
export function parseHostedRunSpec(raw: unknown): HostedRunSpec {
  if (!isRecord(raw)) throw new Error('The run spec is not an object')
  const str = (key: string): string => {
    const value = raw[key]
    if (typeof value !== 'string' || value === '') {
      throw new Error(`The run spec has no ${key}`)
    }
    return value
  }
  const nullableStr = (key: string): string | null => {
    const value = raw[key]
    return typeof value === 'string' && value !== '' ? value : null
  }
  if (!Array.isArray(raw.files)) throw new Error('The run spec has no files')
  const files = raw.files.map((file: unknown) => {
    if (
      !isRecord(file) ||
      typeof file.path !== 'string' ||
      typeof file.contentBase64 !== 'string'
    ) {
      throw new Error('The run spec lists a malformed file')
    }
    return { path: file.path, contentBase64: file.contentBase64 }
  })
  const envVars: Record<string, string> = {}
  if (isRecord(raw.envVars)) {
    for (const [name, value] of Object.entries(raw.envVars)) {
      if (typeof value === 'string') envVars[name] = value
    }
  }
  return {
    runId: str('runId'),
    projectName: str('projectName'),
    videoName: str('videoName'),
    videoSlug: nullableStr('videoSlug'),
    appUrl: nullableStr('appUrl'),
    files,
    envVars,
    network: parseNetwork(raw.network),
    uploadSecret: str('uploadSecret'),
    recordId: recordIdOf(str('recordId')),
    backendUrl: nullableStr('backendUrl'),
  }
}

/** The last `maxBytes` of a text, on a character boundary. */
export function tailText(text: string, maxBytes = ERROR_TAIL_BYTES): string {
  const bytes = Buffer.from(text, 'utf-8')
  if (bytes.byteLength <= maxBytes) return text
  return bytes
    .subarray(bytes.byteLength - maxBytes)
    .toString('utf-8')
    .replace(/^�+/, '')
}

/**
 * The `screenci preview` arguments that record exactly this video: it is
 * selected by title equality and run by location, never by a title regex.
 */
export function previewArgsForTitle(title: string): string[] {
  return ['preview', '--exact-title', title]
}

/**
 * The environment the recording process gets: the runner's own environment
 * without the runner-only variables, plus the island env and the run's
 * identity.
 */
export function buildPreviewEnv(
  base: NodeJS.ProcessEnv,
  islandEnv: Readonly<Record<string, string>>,
  spec: Pick<HostedRunSpec, 'recordId' | 'uploadSecret'>
): Record<string, string> {
  return {
    ...withoutRunnerEnv(base),
    ...islandEnv,
    SCREENCI_CI: '1',
    SCREENCI_RUNNER: 'hosted',
    SCREENCI_RECORD_ID: spec.recordId,
    SCREENCI_SECRET: spec.uploadSecret,
  }
}

async function postStatus(
  params: { backendUrl: string; runToken: string },
  status: HostedRunStatus,
  deps: Pick<HostedRunnerDeps, 'fetchFn' | 'log'>
): Promise<boolean> {
  try {
    const response = await deps.fetchFn(
      `${params.backendUrl}/hosted-run/status`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [RUN_TOKEN_HEADER]: params.runToken,
        },
        body: JSON.stringify(status),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }
    )
    if (!response.ok) {
      deps.log(`Reporting "${status.status}" answered ${response.status}.`)
      return false
    }
    return true
  } catch (err) {
    deps.log(
      `Reporting "${status.status}" failed: ${err instanceof Error ? err.message : String(err)}`
    )
    return false
  }
}

/** One hosted run end to end. Resolves with the process exit code. */
export async function runHostedRun(deps: HostedRunnerDeps): Promise<number> {
  const runId = deps.env.RUN_ID
  const runToken = deps.env.RUN_TOKEN
  const backendUrl = deps.env.BACKEND_URL?.replace(/\/+$/, '')
  if (!runId || !runToken || !backendUrl) {
    deps.log('RUN_ID, RUN_TOKEN and BACKEND_URL must all be set.')
    return 2
  }
  // Children never inherit it (see the module comment for what this does
  // and does not protect).
  delete deps.env.RUN_TOKEN
  const islandDir = resolve(
    deps.env.SCREENCI_WORK_DIR ?? DEFAULT_HOSTED_WORK_DIR
  )
  const startedAt = deps.now()
  const deadline = startedAt + HOSTED_RUN_TIMEOUT_MS
  /** Time left for work, keeping the reporting margin. */
  const remaining = (): number => deadline - REPORT_MARGIN_MS - deps.now()
  const timedOut = (stage: string): string =>
    `The run did not finish within ${HOSTED_RUN_TIMEOUT_MS / 60_000} minutes (stopped while ${stage}).`
  const target = { backendUrl, runToken }
  const fail = async (error: string): Promise<number> => {
    deps.log(`Run ${runId} failed: ${error}`)
    await postStatus(
      target,
      {
        status: 'failed',
        error: tailText(error),
        wallClockMs: Math.max(0, deps.now() - startedAt),
      },
      deps
    )
    return 1
  }

  let spec: HostedRunSpec
  try {
    const response = await deps.fetchFn(`${backendUrl}/hosted-run/spec`, {
      headers: { [RUN_TOKEN_HEADER]: runToken },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      return await fail(
        `Fetching the run spec answered ${response.status}${text ? `: ${text.slice(0, 300)}` : ''}`
      )
    }
    spec = parseHostedRunSpec(await response.json())
  } catch (err) {
    return await fail(
      `Could not read the run spec: ${err instanceof Error ? err.message : String(err)}`
    )
  }
  deps.log(
    `Run ${spec.runId}: recording "${spec.videoName}" of ${spec.projectName}.`
  )
  await postStatus(target, { status: 'running' }, deps)

  let assembled: AssembleIslandResult
  try {
    assembled = await withDeadline(
      deps.assemble({
        islandDir,
        files: spec.files.map((file) => ({
          path: file.path,
          content: Buffer.from(file.contentBase64, 'base64'),
        })),
        envVars: spec.envVars,
        network: spec.network,
        secret: spec.uploadSecret,
        backendUrl: spec.backendUrl ?? backendUrl,
        appUrl: spec.appUrl,
      }),
      remaining(),
      deps.delay
    )
  } catch (err) {
    if (err instanceof DeadlineError) {
      return await fail(timedOut('preparing the project'))
    }
    return await fail(
      `Could not prepare the project: ${err instanceof Error ? err.message : String(err)}`
    )
  }

  const previewTimeoutMs = remaining()
  if (previewTimeoutMs <= 0)
    return await fail(timedOut('preparing the project'))
  let result: RunPreviewResult
  try {
    result = await withDeadline(
      deps.runPreview({
        islandDir,
        videoName: spec.videoName,
        env: buildPreviewEnv(deps.env, assembled.env, spec),
        timeoutMs: previewTimeoutMs,
      }),
      // The recording kills itself at its timeout; this is the backstop.
      previewTimeoutMs + REPORT_MARGIN_MS / 2,
      deps.delay
    )
  } catch (err) {
    if (err instanceof DeadlineError) return await fail(timedOut('recording'))
    return await fail(
      `Could not start the recording: ${err instanceof Error ? err.message : String(err)}`
    )
  }
  if (result.timedOut) {
    return await fail(`${timedOut('recording')}\n${result.errorTail}`)
  }
  if (result.exitCode !== 0) {
    return await fail(
      result.errorTail.trim() !== ''
        ? result.errorTail
        : `The recording exited with code ${String(result.exitCode)}.`
    )
  }
  await postStatus(
    target,
    {
      status: 'finished',
      recordId: spec.recordId,
      wallClockMs: Math.max(0, deps.now() - startedAt),
    },
    deps
  )
  deps.log(`Run ${spec.runId} finished.`)
  return 0
}

/**
 * The CLI the recording runs with: the island's own installed `screenci`
 * (the version its scripts were written for), else the runner's copy.
 */
export function resolvePreviewCliEntry(
  islandDir: string,
  exists: (path: string) => boolean = existsSync
): string {
  const islandEntry = resolve(
    islandDir,
    'node_modules',
    'screenci',
    'bin',
    'screenci.js'
  )
  if (exists(islandEntry)) return islandEntry
  return fileURLToPath(new URL('../../bin/screenci.js', import.meta.url))
}

/** Spawns `screenci preview --grep <title>` in the island with a timeout. */
export async function spawnPreview(
  params: RunPreviewParams
): Promise<RunPreviewResult> {
  const entry = resolvePreviewCliEntry(params.islandDir)
  return await new Promise<RunPreviewResult>((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      [entry, ...previewArgsForTitle(params.videoName)],
      {
        cwd: params.islandDir,
        env: params.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    )
    let stderrTail = ''
    let stdoutTail = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      process.stdout.write(chunk)
      stdoutTail = tailText(stdoutTail + chunk.toString('utf-8'))
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      process.stderr.write(chunk)
      stderrTail = tailText(stderrTail + chunk.toString('utf-8'))
    })
    let timedOut = false
    let killTimer: NodeJS.Timeout | undefined
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      killTimer = setTimeout(() => child.kill('SIGKILL'), 5_000)
    }, params.timeoutMs)
    child.on('error', (err) => {
      clearTimeout(timer)
      if (killTimer !== undefined) clearTimeout(killTimer)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (killTimer !== undefined) clearTimeout(killTimer)
      resolvePromise({
        exitCode: code,
        timedOut,
        errorTail: stderrTail.trim() !== '' ? stderrTail : stdoutTail,
      })
    })
  })
}

export function createDefaultHostedRunnerDeps(): HostedRunnerDeps {
  const log = (message: string): void => {
    process.stdout.write(`[screenci-hosted-runner] ${message}\n`)
  }
  return {
    env: process.env,
    fetchFn: fetch,
    assemble: (input) =>
      assembleIsland(input, {
        fs: nodeProjectFilesFs,
        install: spawnIslandInstall,
        detectPackageManager: defaultDetectIslandPackageManager,
        log,
      }),
    runPreview: spawnPreview,
    now: () => Date.now(),
    delay: (ms) =>
      new Promise((resolvePromise) => {
        // Never keeps the process alive on its own.
        setTimeout(resolvePromise, ms).unref()
      }),
    log,
  }
}

export async function runHostedRunnerMain(): Promise<number> {
  return await runHostedRun(createDefaultHostedRunnerDeps())
}
