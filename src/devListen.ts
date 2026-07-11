/**
 * Poll loop behind `screenci dev`: registers this machine as a dev listener,
 * heartbeats via short polling, runs records when the web editor asks for
 * them, and applies editor codegen requests to the test sources. All side
 * effects (fetch, sleeping, the record run, the codegen apply) are injected
 * so the loop is unit-testable.
 *
 * Records run in a background slot so the poll loop keeps serving codegen
 * requests while Playwright runs. A new trigger arriving while a record is
 * active either kills and replaces it (when the run is younger than the kill
 * window) or queues behind it (queue depth 1, latest wins).
 */

export const DEV_TOKEN_HEADER = 'X-ScreenCI-Dev-Token'
export const SCREENCI_DEV_TOKEN_ENV = 'SCREENCI_DEV_TOKEN'

export const DEV_POLL_INTERVAL_MS = 2_500
export const DEV_RUN_HEARTBEAT_MS = 10_000
/** Back off to this interval while the backend is unreachable. */
export const DEV_POLL_ERROR_BACKOFF_MS = 10_000
/**
 * While the editor is actively sending work (codegen requests or triggers),
 * poll faster so an edit's codegen ack lands well inside the editor's 15s
 * budget. The window extends on every piece of received work.
 */
export const DEV_FAST_POLL_INTERVAL_MS = 750
export const DEV_FAST_POLL_WINDOW_MS = 60_000
/**
 * A running record younger than this is killed and replaced when a new
 * trigger arrives; an older one finishes first and the new trigger queues
 * (queue depth 1, latest wins). Configurable via `screenci dev
 * --record-kill-window <seconds>`.
 */
export const DEV_RECORD_KILL_WINDOW_MS = 10_000

export const SUPERSEDED_RECORD_MESSAGE = 'Superseded by a newer record request'

export type DevTrigger = {
  triggerId: string
  videoName: string
  language: string
  requestedByName: string
  /** Record raw footage into the preview slot without dispatching a render. */
  previewOnly?: boolean
}

/**
 * One editor edit to write into the test source, addressed by editId. The
 * edit payload is an opaque JSON-encoded unified timeline-edit record; the
 * CLI's codegen (codeSync/codemod) understands it.
 */
export type DevCodegenRequest = {
  requestId: string
  videoName: string
  editId: string
  editJson: string
  /** True when the edit changes recorded behavior and needs a re-record. */
  requiresRecord: boolean
}

export type DevPollResult = {
  trigger: DevTrigger | null
  codegenRequests: DevCodegenRequest[]
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
  /**
   * Runs the actual record for a claimed trigger; throws on failure. The
   * signal aborts the run (kills the Playwright child) when the loop
   * supersedes it with a newer trigger.
   */
  runRecord: (trigger: DevTrigger, signal?: AbortSignal) => Promise<void>
  /** Applies one codegen request to the test source; throws on failure. */
  applyCodegen?: (request: DevCodegenRequest) => Promise<void>
  /** Registers a heartbeat timer during a run; returns a cancel function. */
  setIntervalFn?: (fn: () => void, ms: number) => () => void
  /** Time source, injectable for tests. */
  now?: () => number
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
  fastPollIntervalMs?: number
  fastPollWindowMs?: number
  recordKillWindowMs?: number
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
  // Tolerate an empty 2xx body: the /cli/dev/* proxy (and idle keep-alives) can
  // return an empty response, and calling res.json() on it throws "Unexpected
  // end of JSON input", which the poll loop would otherwise log as a connection
  // problem and back off on. An empty body just means "nothing to report" (e.g.
  // no pending trigger), so resolve to an empty object.
  const text = await res.text()
  if (text.trim() === '') return {} as T
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(
      `Request to ${path} returned invalid JSON: ${text.slice(0, 200)}`
    )
  }
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
): Promise<DevPollResult> {
  const result = await postDev<{
    trigger?: DevTrigger | null
    codegenRequests?: DevCodegenRequest[] | null
  }>(config, deps, '/cli/dev/poll', { listenerId })
  return {
    trigger: result.trigger ?? null,
    codegenRequests: result.codegenRequests ?? [],
  }
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

export async function reportDevCodegen(
  config: DevListenConfig,
  deps: DevListenDeps,
  listenerId: string,
  requestId: string,
  state: 'applied' | 'failed',
  errorMessage?: string
): Promise<void> {
  await postDev(config, deps, '/cli/dev/report-codegen', {
    listenerId,
    requestId,
    state,
    ...(errorMessage !== undefined ? { errorMessage } : {}),
  })
}

/**
 * Reports which videos this listener is currently bringing up to date (the
 * startup handshake's stale set). The editor locks those videos' timelines
 * until the list is cleared.
 */
export async function reportDevSyncState(
  config: DevListenConfig,
  deps: DevListenDeps,
  listenerId: string,
  syncingVideoNames: string[]
): Promise<void> {
  await postDev(config, deps, '/cli/dev/sync-state', {
    listenerId,
    syncingVideoNames,
  })
}

export async function deregisterDevListener(
  config: DevListenConfig,
  deps: DevListenDeps,
  listenerId: string
): Promise<void> {
  await postDev(config, deps, '/cli/dev/deregister', { listenerId })
}

/** One background record run. */
type ActiveRecord = {
  trigger: DevTrigger
  startedAt: number
  abort: AbortController
  /** Set before aborting so the completion reports "superseded", not "done". */
  superseded: boolean
  done: Promise<void>
}

async function handleCodegenRequest(
  config: DevListenConfig,
  deps: DevListenDeps,
  listenerId: string,
  request: DevCodegenRequest
): Promise<void> {
  if (deps.applyCodegen === undefined) {
    await reportDevCodegen(
      config,
      deps,
      listenerId,
      request.requestId,
      'failed',
      'This listener does not support codegen'
    )
    return
  }
  try {
    await deps.applyCodegen(request)
    await reportDevCodegen(
      config,
      deps,
      listenerId,
      request.requestId,
      'applied'
    )
    deps.logger.info(
      `Applied edit "${request.editId}" to "${request.videoName}".`
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    deps.logger.error(
      `Codegen for edit "${request.editId}" (${request.videoName}) failed: ${message}`
    )
    await reportDevCodegen(
      config,
      deps,
      listenerId,
      request.requestId,
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
  const fastPollIntervalMs =
    config.fastPollIntervalMs ?? DEV_FAST_POLL_INTERVAL_MS
  const fastPollWindowMs = config.fastPollWindowMs ?? DEV_FAST_POLL_WINDOW_MS
  const killWindowMs = config.recordKillWindowMs ?? DEV_RECORD_KILL_WINDOW_MS
  const setIntervalFn = deps.setIntervalFn ?? defaultSetInterval
  const now = deps.now ?? Date.now

  let active: ActiveRecord | null = null
  let queued: DevTrigger | null = null
  let lastActivityAt = -Infinity

  const startRecord = (trigger: DevTrigger): void => {
    const abort = new AbortController()
    const slot: ActiveRecord = {
      trigger,
      startedAt: now(),
      abort,
      superseded: false,
      done: Promise.resolve(),
    }
    active = slot
    slot.done = (async () => {
      deps.logger.info(
        `Record requested by ${trigger.requestedByName}: "${trigger.videoName}" (${trigger.language})`
      )
      let cancelHeartbeat = () => {}
      try {
        await reportDevTrigger(
          config,
          deps,
          listenerId,
          trigger.triggerId,
          'running'
        )
        // Re-report `running` periodically so a long record keeps the
        // listener's heartbeat fresh; best-effort, a missed beat only delays
        // the status UI.
        cancelHeartbeat = setIntervalFn(() => {
          void reportDevTrigger(
            config,
            deps,
            listenerId,
            trigger.triggerId,
            'running'
          ).catch(() => {})
        }, config.runHeartbeatMs ?? DEV_RUN_HEARTBEAT_MS)

        await deps.runRecord(trigger, abort.signal)
        cancelHeartbeat()
        if (slot.superseded) {
          await reportDevTrigger(
            config,
            deps,
            listenerId,
            trigger.triggerId,
            'failed',
            SUPERSEDED_RECORD_MESSAGE
          )
        } else {
          await reportDevTrigger(
            config,
            deps,
            listenerId,
            trigger.triggerId,
            'done'
          )
          deps.logger.info(
            `Finished recording "${trigger.videoName}" (${trigger.language}).`
          )
        }
      } catch (error) {
        cancelHeartbeat()
        const message = slot.superseded
          ? SUPERSEDED_RECORD_MESSAGE
          : error instanceof Error
            ? error.message
            : String(error)
        if (!slot.superseded) {
          deps.logger.error(
            `Record for "${trigger.videoName}" (${trigger.language}) failed: ${message}`
          )
        }
        await reportDevTrigger(
          config,
          deps,
          listenerId,
          trigger.triggerId,
          'failed',
          message
        ).catch(() => {})
      } finally {
        if (active === slot) active = null
        const next = queued
        queued = null
        if (next !== null && !controller.stopped) startRecord(next)
      }
    })()
  }

  const acceptTrigger = async (trigger: DevTrigger): Promise<void> => {
    if (active === null) {
      startRecord(trigger)
      return
    }
    // Latest wins: a previously queued trigger is dropped for the new one.
    if (queued !== null) {
      await reportDevTrigger(
        config,
        deps,
        listenerId,
        queued.triggerId,
        'failed',
        SUPERSEDED_RECORD_MESSAGE
      ).catch(() => {})
    }
    queued = trigger
    if (now() - active.startedAt < killWindowMs) {
      // Young run: kill it, the slot's completion starts the queued trigger.
      deps.logger.info(
        `Killing the record of "${active.trigger.videoName}" for a newer request.`
      )
      active.superseded = true
      active.abort.abort()
    } else {
      deps.logger.info(
        `Queued "${trigger.videoName}" after the record in progress.`
      )
    }
  }

  while (!controller.stopped) {
    let delayMs = pollIntervalMs
    try {
      const result = await pollDevListener(config, deps, listenerId)
      if (result.codegenRequests.length > 0 || result.trigger !== null) {
        lastActivityAt = now()
      }
      // Codegen requests apply serially (the codemod edits source files) and
      // while a record runs in the background slot, so an edit's ack never
      // waits behind Playwright.
      for (const request of result.codegenRequests) {
        if (controller.stopped) break
        await handleCodegenRequest(config, deps, listenerId, request)
      }
      if (result.trigger !== null && !controller.stopped) {
        await acceptTrigger(result.trigger)
      }
    } catch (error) {
      if (error instanceof DevAuthError) {
        // Cast: `active` is only reassigned inside closures, which
        // control-flow analysis cannot see.
        const running = active as ActiveRecord | null
        if (running !== null) {
          running.abort.abort()
          await running.done.catch(() => {})
        }
        throw error
      }
      const message = error instanceof Error ? error.message : String(error)
      deps.logger.warn(`Connection problem, retrying: ${message}`)
      delayMs = errorBackoffMs
    }
    if (controller.stopped) break
    if (active !== null) lastActivityAt = now()
    if (
      delayMs === pollIntervalMs &&
      now() - lastActivityAt <= fastPollWindowMs
    ) {
      delayMs = fastPollIntervalMs
    }
    await deps.sleep(delayMs)
  }

  // Stop requested: kill and settle a record still in flight so the process
  // never exits with a zombie Playwright child. Not marked superseded: a run
  // that manages to complete still reports done; a killed one reports failed
  // with the abort error. (The cast is needed because `active` is only
  // reassigned inside closures, which control-flow analysis cannot see.)
  const remaining = active as ActiveRecord | null
  if (remaining !== null) {
    remaining.abort.abort()
    await remaining.done.catch(() => {})
  }
}
