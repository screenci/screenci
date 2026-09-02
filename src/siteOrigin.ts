/**
 * Which site a recording ran against. The origin (scheme, host, port; never a
 * path or query, which may carry tokens) of the first real navigation is
 * stamped into `metadata.site` together with a local/deployed classification,
 * so the web app can tell a version recorded against a dev server from one
 * recorded against a deployed site. Pure helpers, unit-tested.
 */

export type SiteKind = 'local' | 'deployed'

/**
 * Who started the app the recording ran against.
 * - `config`: Playwright's `webServer` in screenci.config.ts started it.
 * - `agent`: the coding agent started it by hand (from the repository).
 * - `existing`: it was already running, or is a deployed site.
 */
export type SiteLaunchedBy = 'config' | 'agent' | 'existing'

export type SiteMetadata = {
  origin: string
  kind: SiteKind
  launchedBy?: SiteLaunchedBy
}

/** Env var a coding agent sets when it started the app itself. */
export const SCREENCI_APP_LAUNCHED_BY_ENV = 'SCREENCI_APP_LAUNCHED_BY'

/** Origin of an http(s) URL, or null for anything else (about:blank, data:). */
export function toSiteOrigin(url: string | undefined | null): string | null {
  if (url === undefined || url === null || url.trim() === '') return null
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  return parsed.origin
}

function isPrivateIpv4(host: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!match) return false
  const [a, b] = [Number(match[1]), Number(match[2])]
  if (a === 127 || a === 10 || a === 0) return true
  if (a === 192 && b === 168) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 169 && b === 254) return true
  return false
}

/**
 * `local` for loopback, `*.localhost`, `*.local`, link-local and private
 * network hosts (a dev server or a LAN machine); `deployed` for everything
 * else.
 */
export function classifySiteOrigin(origin: string): SiteKind {
  let host: string
  try {
    host = new URL(origin).hostname.toLowerCase()
  } catch {
    return 'deployed'
  }
  // Bracketed IPv6 hostnames come back without brackets from URL.hostname.
  const bare = host.replace(/^\[|\]$/g, '')
  if (bare === 'localhost' || bare.endsWith('.localhost')) return 'local'
  if (bare.endsWith('.local')) return 'local'
  if (bare === '::1' || bare === '::') return 'local'
  if (/^fe80:/i.test(bare) || /^f[cd][0-9a-f]{2}:/i.test(bare)) return 'local'
  if (isPrivateIpv4(bare)) return 'local'
  return 'deployed'
}

/** Reads the agent-declared launch mode from the environment, if valid. */
export function parseLaunchedByEnv(
  value: string | undefined
): SiteLaunchedBy | undefined {
  switch (value) {
    case 'config':
    case 'agent':
    case 'existing':
      return value
    default:
      return undefined
  }
}

/**
 * Builds the metadata for a recording from what the fixture observed. The
 * first navigated origin wins; `baseURL` is the fallback for scripts whose
 * navigation the fixture did not see. A configured `webServer` beats the env
 * declaration: Playwright started the app, whatever the agent set.
 */
export function buildSiteMetadata(input: {
  navigatedOrigin: string | null
  baseURL: string | undefined
  webServerConfigured: boolean
  env: NodeJS.ProcessEnv
}): SiteMetadata | undefined {
  const origin = input.navigatedOrigin ?? toSiteOrigin(input.baseURL)
  if (origin === null) return undefined
  const launchedBy: SiteLaunchedBy | undefined = input.webServerConfigured
    ? 'config'
    : parseLaunchedByEnv(input.env[SCREENCI_APP_LAUNCHED_BY_ENV])
  return {
    origin,
    kind: classifySiteOrigin(origin),
    ...(launchedBy !== undefined ? { launchedBy } : {}),
  }
}
