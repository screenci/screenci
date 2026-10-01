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
  /** Opaque persisted machine id (never the hostname). */
  machineId: string
}

/** Thrown when the backend rejects our credentials; the caller must stop. */
export class DevAuthError extends Error {}

/**
 * Describes a fetch rejection's root cause. Node's fetch rejects with a bare
 * "fetch failed" TypeError and hides the real reason (DNS, refused, TLS,
 * timeout) in `error.cause`, so walk the cause chain.
 */
export function describeFetchError(error: unknown): string {
  const parts: string[] = []
  let current: unknown = error
  for (let depth = 0; current !== undefined && depth < 5; depth++) {
    if (current instanceof Error) {
      const code = (current as { code?: unknown }).code
      parts.push(
        typeof code === 'string' && !current.message.includes(code)
          ? `${current.message} (${code})`
          : current.message
      )
      current = current.cause
    } else {
      parts.push(String(current))
      break
    }
  }
  return parts.join(': ')
}

/**
 * Thrown when the request never got an HTTP response (offline, DNS, TLS,
 * firewall, or a sandbox that blocks network access).
 */
export class DevNetworkError extends Error {
  constructor(
    readonly url: string,
    cause: unknown
  ) {
    super(
      `Could not reach ${url}: ${describeFetchError(cause)}. ` +
        'No HTTP response was received, so this is a network problem, not an ' +
        'authentication or quota error. Check your internet connection, proxy ' +
        'or firewall. If you run this inside a sandboxed coding agent, allow it ' +
        'network access.',
      { cause }
    )
  }
}

async function postDev<T>(
  config: DevListenConfig,
  deps: Pick<DevListenDeps, 'fetchFn'>,
  path: string,
  body: Record<string, unknown>
): Promise<T> {
  const url = `${config.apiUrl}${path}`
  let res: Response
  try {
    res = await deps.fetchFn(url, {
      method: 'POST',
      headers: {
        [config.credential.header]: config.credential.value,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ projectName: config.projectName, ...body }),
    })
  } catch (error) {
    throw new DevNetworkError(url, error)
  }

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
    machineId: config.machineId,
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
