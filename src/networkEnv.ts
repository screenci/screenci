import type { ForwardedContextOptions } from './contextOptions.js'

/**
 * Network settings read from the environment (usually the island `.env`), so
 * a hosted run and a developer's machine reach a protected site the same way
 * without code in `screenci.config.ts`:
 *
 * - `SCREENCI_PROXY_SERVER`, `SCREENCI_PROXY_USERNAME`, `SCREENCI_PROXY_PASSWORD`
 * - `SCREENCI_HTTP_CREDENTIALS_USERNAME`, `SCREENCI_HTTP_CREDENTIALS_PASSWORD`
 * - `SCREENCI_EXTRA_HEADERS_JSON`: a JSON object of header name to value
 * - `SCREENCI_CREDENTIAL_ORIGIN`: the one origin (`https://app.example.com`)
 *   the HTTP credentials and extra headers may be sent to. A hosted run
 *   always sets it to the origin a developer approved. Without it (a
 *   developer's own machine) the credentials and headers apply to every
 *   request, as Playwright's own options do.
 *
 * The proxy is unaffected by the origin. The config wins: a value the
 * config's `use` block sets is never replaced.
 */

export const NETWORK_ENV_KEYS = {
  proxyServer: 'SCREENCI_PROXY_SERVER',
  proxyUsername: 'SCREENCI_PROXY_USERNAME',
  proxyPassword: 'SCREENCI_PROXY_PASSWORD',
  httpCredentialsUsername: 'SCREENCI_HTTP_CREDENTIALS_USERNAME',
  httpCredentialsPassword: 'SCREENCI_HTTP_CREDENTIALS_PASSWORD',
  extraHeadersJson: 'SCREENCI_EXTRA_HEADERS_JSON',
  credentialOrigin: 'SCREENCI_CREDENTIAL_ORIGIN',
} as const

export type NetworkContextOptions = Pick<
  ForwardedContextOptions,
  'proxy' | 'httpCredentials' | 'extraHTTPHeaders'
>

/** Headers that go only to requests for one origin. */
export type OriginHeaders = {
  origin: string
  headers: Record<string, string>
}

export type NetworkEnvSettings = {
  /** Options for the browser context itself. */
  contextOptions: NetworkContextOptions
  /** Headers injected per request (only with a credential origin). */
  originHeaders: OriginHeaders | null
}

function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value.trim() !== '' ? value : undefined
}

/** Parses `SCREENCI_EXTRA_HEADERS_JSON`; throws a clear error when malformed. */
export function parseExtraHeadersJson(raw: string): Record<string, string> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(
      `${NETWORK_ENV_KEYS.extraHeadersJson} is not valid JSON; expected an object like {"X-Header": "value"}.`
    )
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      `${NETWORK_ENV_KEYS.extraHeadersJson} must be a JSON object of header names to string values.`
    )
  }
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(parsed)) {
    if (typeof value !== 'string') {
      throw new Error(
        `${NETWORK_ENV_KEYS.extraHeadersJson}: the value of "${name}" must be a string.`
      )
    }
    headers[name] = value
  }
  return headers
}

/** `scheme://host[:port]` of an http(s) URL; throws a clear error otherwise. */
export function parseCredentialOrigin(raw: string): string {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new Error(
      `${NETWORK_ENV_KEYS.credentialOrigin} must be an origin like https://app.example.com.`
    )
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(
      `${NETWORK_ENV_KEYS.credentialOrigin} must be an http or https origin.`
    )
  }
  return url.origin
}

export function readNetworkEnv(env: NodeJS.ProcessEnv): NetworkEnvSettings {
  const contextOptions: NetworkContextOptions = {}
  const rawOrigin = nonEmpty(env[NETWORK_ENV_KEYS.credentialOrigin])
  const origin =
    rawOrigin !== undefined ? parseCredentialOrigin(rawOrigin) : undefined

  const proxyServer = nonEmpty(env[NETWORK_ENV_KEYS.proxyServer])
  if (proxyServer !== undefined) {
    const username = nonEmpty(env[NETWORK_ENV_KEYS.proxyUsername])
    const password = env[NETWORK_ENV_KEYS.proxyPassword]
    contextOptions.proxy = {
      server: proxyServer,
      ...(username !== undefined ? { username } : {}),
      ...(username !== undefined && password !== undefined ? { password } : {}),
    }
  }
  const credentialsUsername = nonEmpty(
    env[NETWORK_ENV_KEYS.httpCredentialsUsername]
  )
  if (credentialsUsername !== undefined) {
    contextOptions.httpCredentials = {
      username: credentialsUsername,
      password: env[NETWORK_ENV_KEYS.httpCredentialsPassword] ?? '',
      // Playwright then answers an auth challenge from this origin only.
      ...(origin !== undefined ? { origin } : {}),
    }
  }
  let originHeaders: OriginHeaders | null = null
  const headersJson = nonEmpty(env[NETWORK_ENV_KEYS.extraHeadersJson])
  if (headersJson !== undefined) {
    const headers = parseExtraHeadersJson(headersJson)
    if (Object.keys(headers).length > 0) {
      if (origin !== undefined) originHeaders = { origin, headers }
      else contextOptions.extraHTTPHeaders = headers
    }
  }
  return { contextOptions, originHeaders }
}

/** The context options part of `readNetworkEnv`. */
export function readNetworkContextOptions(
  env: NodeJS.ProcessEnv
): NetworkContextOptions {
  return readNetworkEnv(env).contextOptions
}

/**
 * Fills the network options the config left unset from the environment.
 * Extra headers merge per header name, the config's value winning.
 */
export function mergeNetworkContextOptions(
  forwarded: ForwardedContextOptions,
  network: NetworkContextOptions
): ForwardedContextOptions {
  const merged: ForwardedContextOptions = { ...forwarded }
  if (merged.proxy === undefined && network.proxy !== undefined) {
    merged.proxy = network.proxy
  }
  if (
    merged.httpCredentials === undefined &&
    network.httpCredentials !== undefined
  ) {
    merged.httpCredentials = network.httpCredentials
  }
  if (network.extraHTTPHeaders !== undefined) {
    merged.extraHTTPHeaders = {
      ...network.extraHTTPHeaders,
      ...(merged.extraHTTPHeaders ?? {}),
    }
  }
  return merged
}

/** Drops the headers the config already sets (the config wins). */
export function originHeadersExcluding(
  originHeaders: OriginHeaders | null,
  configHeaders: Readonly<Record<string, string>> | undefined
): OriginHeaders | null {
  if (originHeaders === null) return null
  const taken = new Set(
    Object.keys(configHeaders ?? {}).map((name) => name.toLowerCase())
  )
  const headers = Object.fromEntries(
    Object.entries(originHeaders.headers).filter(
      ([name]) => !taken.has(name.toLowerCase())
    )
  )
  return Object.keys(headers).length > 0
    ? { origin: originHeaders.origin, headers }
    : null
}

/** True when `url` belongs to `origin` (exact scheme, host and port). */
export function isSameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin
  } catch {
    return false
  }
}

/** The slice of a browser context the header injection needs. */
export interface RoutableContext {
  route(
    url: string,
    handler: (route: {
      request(): { url(): string; headers(): Record<string, string> }
      fallback(options?: { headers?: Record<string, string> }): Promise<void>
    }) => Promise<void>
  ): Promise<unknown>
}

/**
 * Adds the headers to every request for their origin, and to nothing else.
 * Registered first, so routes the script adds later still see the request
 * first; this handler falls back either way.
 */
export async function installOriginHeaders(
  context: RoutableContext,
  originHeaders: OriginHeaders | null
): Promise<void> {
  if (originHeaders === null) return
  await context.route('**/*', async (route) => {
    const request = route.request()
    if (!isSameOrigin(request.url(), originHeaders.origin)) {
      await route.fallback()
      return
    }
    await route.fallback({
      headers: { ...request.headers(), ...originHeaders.headers },
    })
  })
}
