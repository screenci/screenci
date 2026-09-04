/**
 * Dev-channel registration behind `screenci preview`: registers this machine
 * as a dev listener for the run, reports which videos it is bringing up to
 * date (the editor locks those videos' timelines until the list clears), and
 * deregisters on exit. All side effects (fetch, sleeping) are injected so the
 * helpers are unit-testable.
 */

export type DevListenLogger = {
  info: (message: string) => void
  warn: (message: string) => void
  error: (message: string) => void
}

export type DevListenDeps = {
  fetchFn: typeof fetch
  sleep: (ms: number) => Promise<void>
  logger: DevListenLogger
}

export type DevListenConfig = {
  apiUrl: string
  /**
   * The org credential every dev call authenticates with: a real org secret
   * (X-ScreenCI-Secret) or, for an account-less `screenci preview`, the anon
   * session token (X-ScreenCI-Anon-Token, resolved to the trial org's secret
   * by the backend proxy). See src/anonSession.ts CliCredential.
   */
  credential: { header: string; value: string }
  projectName: string
  machineName: string
}

/** Thrown when the backend rejects our credentials; the caller must stop. */
export class DevAuthError extends Error {}

async function postDev<T>(
  config: DevListenConfig,
  deps: Pick<DevListenDeps, 'fetchFn'>,
  path: string,
  body: Record<string, unknown>
): Promise<T> {
  const res = await deps.fetchFn(`${config.apiUrl}${path}`, {
    method: 'POST',
    headers: {
      [config.credential.header]: config.credential.value,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ projectName: config.projectName, ...body }),
  })

  if (res.status === 401) {
    const text = await res.text().catch(() => '')
    throw new DevAuthError(
      `The backend rejected this session (401). Check your SCREENCI_SECRET. ${text}`.trim()
    )
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Request to ${path} failed: ${res.status} ${text}`.trim())
  }
  // Tolerate an empty 2xx body: the /cli/dev/* proxy (and idle keep-alives) can
  // return an empty response, and calling res.json() on it throws "Unexpected
  // end of JSON input", which callers would otherwise log as a connection
  // problem. An empty body just means "nothing to report", so resolve to an
  // empty object.
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
): Promise<{ listenerId: string }> {
  return await postDev(config, deps, '/cli/dev/register', {
    machineName: config.machineName,
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
