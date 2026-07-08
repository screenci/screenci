/**
 * Poll loop behind `screenci dev`: registers this machine as a dev listener,
 * heartbeats via short polling, and runs a record when the web editor asks
 * for one. All side effects (fetch, sleeping, the actual record run) are
 * injected so the loop is unit-testable.
 */

export const DEV_TOKEN_HEADER = 'X-ScreenCI-Dev-Token'
export const SCREENCI_DEV_TOKEN_ENV = 'SCREENCI_DEV_TOKEN'

export const DEV_POLL_INTERVAL_MS = 2_500
export const DEV_RUN_HEARTBEAT_MS = 10_000
/** Back off to this interval while the backend is unreachable. */
export const DEV_POLL_ERROR_BACKOFF_MS = 10_000

export type DevTrigger = {
  triggerId: string
  videoName: string
  language: string
  requestedByName: string
}

export type DevListenLogger = {
  info: (message: string) => void
  warn: (message: string) => void
  error: (message: string) => void
}

export type DevListenDeps = {
  fetchFn: typeof fetch
  sleep: (ms: number) => Promise<void>
  logger: DevListenLogger
  /** Runs the actual record for a claimed trigger; throws on failure. */
  runRecord: (trigger: DevTrigger) => Promise<void>
  /** Registers a heartbeat timer during a run; returns a cancel function. */
  setIntervalFn?: (fn: () => void, ms: number) => () => void
}

export type DevListenConfig = {
  apiUrl: string
  secret: string
  devToken: string
  projectName: string
  machineName: string
  pollIntervalMs?: number
  errorBackoffMs?: number
  runHeartbeatMs?: number
}

/** Thrown when the backend rejects our credentials; the loop must stop. */
export class DevAuthError extends Error {}

function defaultSetInterval(fn: () => void, ms: number): () => void {
  const handle = setInterval(fn, ms)
  return () => clearInterval(handle)
}

async function postDev<T>(
  config: DevListenConfig,
  deps: DevListenDeps,
  path: string,
  body: Record<string, unknown>
): Promise<T> {
  const res = await deps.fetchFn(`${config.apiUrl}${path}`, {
    method: 'POST',
    headers: {
      'X-ScreenCI-Secret': config.secret,
      [DEV_TOKEN_HEADER]: config.devToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ projectName: config.projectName, ...body }),
  })

  if (res.status === 401) {
    const text = await res.text().catch(() => '')
    throw new DevAuthError(
      `The backend rejected this session (401). Your dev token may have been revoked. ${text}`.trim()
    )
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Request to ${path} failed: ${res.status} ${text}`.trim())
  }
  return (await res.json()) as T
}

export async function registerDevListener(
  config: DevListenConfig,
  deps: DevListenDeps
): Promise<{ listenerId: string; userName: string }> {
  return await postDev(config, deps, '/cli/dev/register', {
    machineName: config.machineName,
  })
}

export async function pollDevListener(
  config: DevListenConfig,
  deps: DevListenDeps,
  listenerId: string
): Promise<DevTrigger | null> {
  const result = await postDev<{ trigger: DevTrigger | null }>(
    config,
    deps,
    '/cli/dev/poll',
    { listenerId }
  )
  return result.trigger
}

export async function reportDevTrigger(
  config: DevListenConfig,
  deps: DevListenDeps,
  listenerId: string,
  triggerId: string,
  state: 'running' | 'done' | 'failed',
  errorMessage?: string
): Promise<void> {
  await postDev(config, deps, '/cli/dev/report', {
    listenerId,
    triggerId,
    state,
    ...(errorMessage !== undefined ? { errorMessage } : {}),
  })
}

export async function deregisterDevListener(
  config: DevListenConfig,
  deps: DevListenDeps,
  listenerId: string
): Promise<void> {
  await postDev(config, deps, '/cli/dev/deregister', { listenerId })
}

async function handleTrigger(
  config: DevListenConfig,
  deps: DevListenDeps,
  listenerId: string,
  trigger: DevTrigger
): Promise<void> {
  const setIntervalFn = deps.setIntervalFn ?? defaultSetInterval
  deps.logger.info(
    `Record requested by ${trigger.requestedByName}: "${trigger.videoName}" (${trigger.language})`
  )
  await reportDevTrigger(config, deps, listenerId, trigger.triggerId, 'running')

  // Re-report `running` periodically so a long record keeps the listener's
  // heartbeat fresh; best-effort, a missed beat only delays the status UI.
  const cancelHeartbeat = setIntervalFn(() => {
    void reportDevTrigger(
      config,
      deps,
      listenerId,
      trigger.triggerId,
      'running'
    ).catch(() => {})
  }, config.runHeartbeatMs ?? DEV_RUN_HEARTBEAT_MS)

  try {
    await deps.runRecord(trigger)
    cancelHeartbeat()
    await reportDevTrigger(config, deps, listenerId, trigger.triggerId, 'done')
    deps.logger.info(
      `Finished recording "${trigger.videoName}" (${trigger.language}).`
    )
  } catch (error) {
    cancelHeartbeat()
    const message = error instanceof Error ? error.message : String(error)
    deps.logger.error(
      `Record for "${trigger.videoName}" (${trigger.language}) failed: ${message}`
    )
    await reportDevTrigger(
      config,
      deps,
      listenerId,
      trigger.triggerId,
      'failed',
      message
    )
  }
}

export type DevListenController = {
  stop: () => void
}

/**
 * Runs the listener loop until `controller.stop()` is called or the backend
 * rejects our credentials (DevAuthError propagates to the caller). Network
 * hiccups are logged and retried with a longer backoff.
 */
export async function runDevListenLoop(
  config: DevListenConfig,
  deps: DevListenDeps,
  listenerId: string,
  controller: { stopped: boolean }
): Promise<void> {
  const pollIntervalMs = config.pollIntervalMs ?? DEV_POLL_INTERVAL_MS
  const errorBackoffMs = config.errorBackoffMs ?? DEV_POLL_ERROR_BACKOFF_MS

  while (!controller.stopped) {
    let delayMs = pollIntervalMs
    try {
      const trigger = await pollDevListener(config, deps, listenerId)
      if (trigger && !controller.stopped) {
        await handleTrigger(config, deps, listenerId, trigger)
      }
    } catch (error) {
      if (error instanceof DevAuthError) throw error
      const message = error instanceof Error ? error.message : String(error)
      deps.logger.warn(`Connection problem, retrying: ${message}`)
      delayMs = errorBackoffMs
    }
    if (controller.stopped) return
    await deps.sleep(delayMs)
  }
}
