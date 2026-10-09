import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'
import { isIPv4, isIPv6 } from 'node:net'
import {
  playwrightExploreLauncher,
  trimAriaSnapshot,
  type ExploreAction,
  type ExploreContextOptions,
  type ExploreLaunchOptions,
  type ExploreLauncher,
  type ExploreSession,
  type ExploreStorageState,
} from './explore.js'
import { isSameOrigin, parseCredentialOrigin } from './networkEnv.js'

/**
 * The page snapshot service (`screenci-snapshot-server`): a small HTTP server
 * that opens a public page in the recorder's browser, runs a few clicks and
 * fills, and answers with a compact accessibility snapshot, a viewport JPEG
 * and the final URL. It lets an agent look at a project's site without a
 * browser of its own.
 *
 * It is a fetcher of arbitrary URLs, so every navigation and every request
 * the page makes is checked against `isForbiddenSnapshotTarget`: no loopback,
 * private, link-local (the cloud metadata server) or internal hosts.
 */

export const SNAPSHOT_MAX_STEPS = 10
export const SNAPSHOT_BUDGET_MS = 60_000
export const SNAPSHOT_MAX_BODY_BYTES = 256 * 1024
const MAX_URL_LENGTH = 2048
const MAX_STEP_TEXT_LENGTH = 500

export interface SnapshotRequest {
  url: string
  steps: ExploreAction[]
  contextOptions: ExploreContextOptions
  storageState: ExploreStorageState | null
  /**
   * The one origin the credentials, extra headers and signed-in session
   * belong to. Null: none of them are used.
   */
  credentialOrigin: string | null
}

export interface SnapshotResponse {
  snapshot: string
  screenshotJpegBase64: string
  finalUrl: string
}

// The cloud metadata server answers on 169.254.169.254 and on a DNS name
// under `.internal`; both are refused below.
const FORBIDDEN_HOSTNAMES = new Set(['localhost', 'metadata'])

function ipv4Octets(address: string): number[] | null {
  if (!isIPv4(address)) return null
  return address.split('.').map((part) => Number(part))
}

function isForbiddenIPv4(address: string): boolean {
  const octets = ipv4Octets(address)
  if (octets === null) return false
  const [a = 0, b = 0] = octets
  return (
    a === 0 || // "this network", 0.0.0.0
    a === 10 || // RFC1918
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, the metadata server
    (a === 172 && b >= 16 && b <= 31) || // RFC1918
    (a === 192 && b === 168) || // RFC1918
    (a === 192 && b === 0 && octets[2] === 0) || // IETF protocol assignments
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast and reserved
  )
}

/** Expands an IPv6 literal into its eight 16-bit groups. */
function ipv6Groups(address: string): number[] | null {
  if (!isIPv6(address)) return null
  let text = address
  // A trailing dotted IPv4 part (::ffff:1.2.3.4) becomes two groups.
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text)
  if (dotted !== null) {
    const octets = ipv4Octets(dotted[1]!)
    if (octets === null) return null
    text =
      text.slice(0, dotted.index) +
      `${((octets[0]! << 8) | octets[1]!).toString(16)}:${((octets[2]! << 8) | octets[3]!).toString(16)}`
  }
  const [head = '', tail] = text.split('::')
  const headGroups = head === '' ? [] : head.split(':')
  const tailGroups = tail === undefined || tail === '' ? [] : tail.split(':')
  const missing = 8 - headGroups.length - tailGroups.length
  const groups = [
    ...headGroups,
    ...(tail !== undefined ? Array<string>(missing).fill('0') : []),
    ...tailGroups,
  ].map((group) => parseInt(group, 16))
  return groups.length === 8 && groups.every((g) => Number.isFinite(g))
    ? groups
    : null
}

function isForbiddenIPv6(address: string): boolean {
  const groups = ipv6Groups(address)
  if (groups === null) return false
  if (groups.every((group) => group === 0)) return true // ::
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) {
    return true // ::1
  }
  const first = groups[0]!
  if ((first & 0xfe00) === 0xfc00) return true // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return true // fe80::/10 link-local
  if ((first & 0xff00) === 0xff00) return true // multicast
  const v4Of = (high: number, low: number): string =>
    `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible forms.
  if (
    groups.slice(0, 5).every((group) => group === 0) &&
    (groups[5] === 0xffff || groups[5] === 0)
  ) {
    return isForbiddenIPv4(v4Of(groups[6]!, groups[7]!))
  }
  // NAT64 (64:ff9b::/96) embeds an IPv4 address in the last 32 bits.
  if (
    first === 0x64 &&
    groups[1] === 0xff9b &&
    groups.slice(2, 6).every((group) => group === 0)
  ) {
    return isForbiddenIPv4(v4Of(groups[6]!, groups[7]!))
  }
  // 6to4 (2002::/16) embeds one in groups 1 and 2.
  if (first === 0x2002) return isForbiddenIPv4(v4Of(groups[1]!, groups[2]!))
  return false
}

/**
 * True for any URL the snapshot service must not open: anything but http(s),
 * loopback and `*.localhost`, private (RFC1918, unique-local), link-local
 * (169.254.0.0/16 is the cloud metadata server), unspecified and multicast
 * addresses, and internal host names. Host names that resolve to such
 * addresses are refused by `resolvesToForbiddenAddress` (the per-request
 * guard runs both checks); the deployment must still deny private egress,
 * since DNS can change between that lookup and the browser's.
 */
export function isForbiddenSnapshotTarget(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return true
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true
  if (parsed.username !== '' || parsed.password !== '') return true
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '')
  if (hostname === '') return true
  const bare =
    hostname.startsWith('[') && hostname.endsWith(']')
      ? hostname.slice(1, -1)
      : hostname
  if (isIPv4(bare)) return isForbiddenIPv4(bare)
  if (isIPv6(bare)) return isForbiddenIPv6(bare)
  if (FORBIDDEN_HOSTNAMES.has(bare)) return true
  if (bare.endsWith('.localhost')) return true
  if (bare.endsWith('.internal') || bare.endsWith('.local')) return true
  // A single-label name only resolves inside a private network.
  if (!bare.includes('.')) return true
  return false
}

/**
 * Request-level guard for the browser: data/blob/about URLs the page builds
 * itself are fine, network requests must pass the target check.
 */
export function isBlockedSnapshotRequest(url: string): boolean {
  if (/^(data|blob|about):/i.test(url)) return false
  return isForbiddenSnapshotTarget(toHttpUrl(url))
}

/** WebSocket URLs are checked like the http(s) URL of the same host. */
function toHttpUrl(url: string): string {
  return url.replace(/^ws(s?):/i, 'http$1:')
}

/** Resolves a host name to every address it has (DNS). */
export type HostLookup = (hostname: string) => Promise<string[]>

export const dnsHostLookup: HostLookup = async (hostname) => {
  const { lookup } = await import('node:dns/promises')
  const results = await lookup(hostname, { all: true, verbatim: true })
  return results.map((result) => result.address)
}

/**
 * True when the URL's host name resolves to any forbidden address (or does
 * not resolve at all). Literal addresses are left to the URL check. DNS can
 * still change between this check and the browser's own lookup, so the
 * service should also run without a route to private networks.
 */
export async function resolvesToForbiddenAddress(
  url: string,
  lookup: HostLookup,
  cache: Map<string, boolean> = new Map()
): Promise<boolean> {
  let hostname: string
  try {
    hostname = new URL(toHttpUrl(url)).hostname.toLowerCase()
  } catch {
    return true
  }
  const bare =
    hostname.startsWith('[') && hostname.endsWith(']')
      ? hostname.slice(1, -1)
      : hostname
  if (isIPv4(bare) || isIPv6(bare)) return false
  const cached = cache.get(bare)
  if (cached !== undefined) return cached
  let forbidden: boolean
  try {
    const addresses = await lookup(bare)
    forbidden =
      addresses.length === 0 ||
      addresses.some(
        (address) => isForbiddenIPv4(address) || isForbiddenIPv6(address)
      )
  } catch {
    forbidden = true
  }
  cache.set(bare, forbidden)
  return forbidden
}

/** The full per-request guard: the URL check, then the DNS check. */
export function createSnapshotRequestGuard(
  lookup: HostLookup
): (url: string) => Promise<boolean> {
  const cache = new Map<string, boolean>()
  return async (url) => {
    if (/^(data|blob|about):/i.test(url)) return false
    if (isBlockedSnapshotRequest(url)) return true
    return await resolvesToForbiddenAddress(url, lookup, cache)
  }
}

export type ParseSnapshotRequestResult =
  { ok: true; request: SnapshotRequest } | { ok: false; error: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function boundedString(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_STEP_TEXT_LENGTH
}

function parseContextOptions(raw: unknown): ExploreContextOptions | string {
  if (raw === undefined || raw === null) return {}
  if (!isRecord(raw)) return 'contextOptions must be an object.'
  const options: ExploreContextOptions = {}
  if (raw.httpCredentials !== undefined) {
    const credentials = raw.httpCredentials
    if (
      !isRecord(credentials) ||
      typeof credentials.username !== 'string' ||
      typeof credentials.password !== 'string'
    ) {
      return 'contextOptions.httpCredentials needs username and password strings.'
    }
    options.httpCredentials = {
      username: credentials.username,
      password: credentials.password,
    }
  }
  if (raw.extraHTTPHeaders !== undefined) {
    const headers = raw.extraHTTPHeaders
    if (!isRecord(headers)) {
      return 'contextOptions.extraHTTPHeaders must be an object of strings.'
    }
    const parsed: Record<string, string> = {}
    for (const [name, value] of Object.entries(headers)) {
      if (typeof value !== 'string') {
        return 'contextOptions.extraHTTPHeaders must be an object of strings.'
      }
      parsed[name] = value
    }
    options.extraHTTPHeaders = parsed
  }
  if (raw.proxy !== undefined) {
    const proxy = raw.proxy
    if (!isRecord(proxy) || typeof proxy.server !== 'string') {
      return 'contextOptions.proxy needs a server string.'
    }
    options.proxy = {
      server: proxy.server,
      ...(typeof proxy.username === 'string'
        ? { username: proxy.username }
        : {}),
      ...(typeof proxy.password === 'string'
        ? { password: proxy.password }
        : {}),
    }
  }
  return options
}

function parseSteps(raw: unknown): ExploreAction[] | string {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) return 'steps must be an array.'
  if (raw.length > SNAPSHOT_MAX_STEPS) {
    return `At most ${SNAPSHOT_MAX_STEPS} steps are allowed.`
  }
  const steps: ExploreAction[] = []
  for (const step of raw) {
    if (!isRecord(step)) return 'Each step must be an object.'
    if (step.kind === 'click' && boundedString(step.name) && step.name !== '') {
      steps.push({ kind: 'click', name: step.name })
    } else if (
      step.kind === 'fill' &&
      boundedString(step.label) &&
      step.label !== '' &&
      boundedString(step.value)
    ) {
      steps.push({ kind: 'fill', label: step.label, value: step.value })
    } else {
      return 'Each step is {kind: "click", name} or {kind: "fill", label, value}.'
    }
  }
  return steps
}

/** Validates a `POST /snapshot` body. */
export function parseSnapshotRequest(raw: unknown): ParseSnapshotRequestResult {
  if (!isRecord(raw)) return { ok: false, error: 'Body must be a JSON object.' }
  if (typeof raw.url !== 'string' || raw.url.length > MAX_URL_LENGTH) {
    return { ok: false, error: 'url must be a string.' }
  }
  if (isForbiddenSnapshotTarget(raw.url)) {
    return {
      ok: false,
      error:
        'url must be a public http(s) address (no localhost, private or internal hosts).',
    }
  }
  const steps = parseSteps(raw.steps)
  if (typeof steps === 'string') return { ok: false, error: steps }
  const contextOptions = parseContextOptions(raw.contextOptions)
  if (typeof contextOptions === 'string') {
    return { ok: false, error: contextOptions }
  }
  let credentialOrigin: string | null = null
  if (raw.credentialOrigin !== undefined && raw.credentialOrigin !== null) {
    if (typeof raw.credentialOrigin !== 'string') {
      return { ok: false, error: 'credentialOrigin must be a string or null.' }
    }
    try {
      credentialOrigin = parseCredentialOrigin(raw.credentialOrigin)
    } catch {
      return {
        ok: false,
        error:
          'credentialOrigin must be an http(s) origin like https://app.example.com.',
      }
    }
  }
  let storageState: ExploreStorageState | null = null
  if (raw.storageState !== undefined && raw.storageState !== null) {
    const state = raw.storageState
    if (
      !isRecord(state) ||
      !Array.isArray(state.cookies) ||
      !Array.isArray(state.origins)
    ) {
      return {
        ok: false,
        error: 'storageState must be a Playwright storage state object.',
      }
    }
    storageState = {
      cookies: state.cookies as Array<Record<string, unknown>>,
      origins: state.origins as Array<Record<string, unknown>>,
    }
  }
  return {
    ok: true,
    request: {
      url: raw.url,
      steps,
      contextOptions,
      storageState,
      credentialOrigin,
    },
  }
}

/**
 * The launch options that carry secrets, bound to the credential origin:
 * HTTP credentials answer only that origin's challenge, extra headers go
 * only to requests for it, and the signed-in session loads only when the
 * page starts there. Without an origin none of them are used. The proxy is
 * not origin-bound.
 */
export function snapshotCredentialOptions(
  request: SnapshotRequest
): Pick<
  ExploreLaunchOptions,
  'contextOptions' | 'storageState' | 'originHeaders'
> {
  const { proxy, httpCredentials, extraHTTPHeaders } = request.contextOptions
  const origin = request.credentialOrigin
  const contextOptions: ExploreContextOptions = {
    ...(proxy !== undefined ? { proxy } : {}),
    ...(origin !== null && httpCredentials !== undefined
      ? { httpCredentials: { ...httpCredentials, origin } }
      : {}),
  }
  const startsAtOrigin = origin !== null && isSameOrigin(request.url, origin)
  return {
    contextOptions,
    ...(startsAtOrigin && request.storageState !== null
      ? { storageState: request.storageState }
      : {}),
    ...(origin !== null &&
    extraHTTPHeaders !== undefined &&
    Object.keys(extraHTTPHeaders).length > 0
      ? { originHeaders: { origin, headers: extraHTTPHeaders } }
      : {}),
  }
}

export class SnapshotTargetError extends Error {
  constructor(url: string) {
    super(`The page went to a forbidden address: ${url}`)
    this.name = 'SnapshotTargetError'
  }
}

export class SnapshotTimeoutError extends Error {
  constructor() {
    super(`The snapshot did not finish within ${SNAPSHOT_BUDGET_MS / 1000} s.`)
    this.name = 'SnapshotTimeoutError'
  }
}

export interface SnapshotDeps {
  launch: ExploreLauncher
  budgetMs: number
  lookup: HostLookup
}

function describeStep(step: ExploreAction): string {
  switch (step.kind) {
    case 'click':
      return `click "${step.name}"`
    case 'fill':
      return `fill "${step.label}"`
    default: {
      const exhaustive: never = step
      throw new Error(`Unhandled step: ${String(exhaustive)}`)
    }
  }
}

/** Opens the page, runs the steps, and returns the snapshot. */
export async function takeSnapshot(
  request: SnapshotRequest,
  deps: SnapshotDeps
): Promise<SnapshotResponse> {
  let session: ExploreSession | null = null
  let timer: NodeJS.Timeout | undefined
  let finished = false
  const work = async (): Promise<SnapshotResponse> => {
    const guard = createSnapshotRequestGuard(deps.lookup)
    if (await guard(request.url)) throw new SnapshotTargetError(request.url)
    const proxyServer = request.contextOptions.proxy?.server
    if (proxyServer !== undefined) {
      // A proxy is a hop the browser sends everything through: it must be a
      // public host too. Schemeless proxy servers default to http.
      const proxyUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(proxyServer)
        ? proxyServer.replace(/^socks[45]?:/i, 'http:')
        : `http://${proxyServer}`
      if (await guard(proxyUrl)) throw new SnapshotTargetError(proxyServer)
    }
    const active = await deps.launch({
      ...snapshotCredentialOptions(request),
      blockRequest: guard,
    })
    if (finished) {
      // The budget ran out while the browser started: nobody closes it later.
      await active.close().catch(() => {})
      throw new SnapshotTimeoutError()
    }
    session = active
    const sections: string[] = []
    const checkLocation = async (): Promise<void> => {
      const current = active.url()
      if (current !== 'about:blank' && (await guard(current))) {
        throw new SnapshotTargetError(current)
      }
    }
    const capture = async (heading: string): Promise<void> => {
      const snapshot = trimAriaSnapshot(await active.ariaSnapshot())
      sections.push(
        `## ${heading} (${active.url()})\n${snapshot === '' ? '(no interactive elements)' : snapshot}`
      )
    }
    await active.goto(request.url)
    await checkLocation()
    await capture('after load')
    for (const step of request.steps) {
      switch (step.kind) {
        case 'click':
          await active.clickByName(step.name)
          break
        case 'fill':
          await active.fillByLabel(step.label, step.value)
          break
        default: {
          const exhaustive: never = step
          throw new Error(`Unhandled step: ${String(exhaustive)}`)
        }
      }
      await checkLocation()
      await capture(`after ${describeStep(step)}`)
    }
    const screenshot = await active.screenshot()
    await checkLocation()
    return {
      snapshot: sections.join('\n\n'),
      screenshotJpegBase64: screenshot.toString('base64'),
      finalUrl: active.url(),
    }
  }
  try {
    return await Promise.race([
      work(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new SnapshotTimeoutError()),
          deps.budgetMs
        )
      }),
    ])
  } finally {
    finished = true
    if (timer !== undefined) clearTimeout(timer)
    const opened = session as ExploreSession | null
    if (opened !== null) await opened.close().catch(() => {})
  }
}

class BodyTooLargeError extends Error {}

async function readBody(
  request: IncomingMessage,
  maxBytes: number
): Promise<string> {
  const declared = Number(request.headers['content-length'])
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new BodyTooLargeError()
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.byteLength
    if (size > maxBytes) throw new BodyTooLargeError()
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf-8')
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown
): void {
  const text = JSON.stringify(body)
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(text),
  })
  response.end(text)
}

export interface SnapshotHandlerDeps extends SnapshotDeps {
  log: (message: string) => void
}

export function createSnapshotHandler(
  deps: SnapshotHandlerDeps
): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  return async (request, response) => {
    const path = (request.url ?? '/').split('?')[0]
    if (request.method === 'GET' && path === '/healthz') {
      sendJson(response, 200, { ok: true })
      return
    }
    if (path !== '/snapshot') {
      sendJson(response, 404, { error: 'Not found.' })
      return
    }
    if (request.method !== 'POST') {
      sendJson(response, 405, { error: 'Use POST.' })
      return
    }
    let raw: unknown
    try {
      raw = JSON.parse(await readBody(request, SNAPSHOT_MAX_BODY_BYTES))
    } catch (err) {
      if (err instanceof BodyTooLargeError) {
        sendJson(response, 413, {
          error: `Body is larger than ${SNAPSHOT_MAX_BODY_BYTES} bytes.`,
        })
        return
      }
      sendJson(response, 400, { error: 'Body must be JSON.' })
      return
    }
    const parsed = parseSnapshotRequest(raw)
    if (!parsed.ok) {
      sendJson(response, 400, { error: parsed.error })
      return
    }
    const startedAt = Date.now()
    try {
      const result = await takeSnapshot(parsed.request, deps)
      deps.log(`snapshot ok in ${Date.now() - startedAt} ms`)
      sendJson(response, 200, result)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      deps.log(`snapshot failed in ${Date.now() - startedAt} ms: ${message}`)
      if (err instanceof SnapshotTargetError) {
        sendJson(response, 400, { error: message })
      } else if (err instanceof SnapshotTimeoutError) {
        sendJson(response, 504, { error: message })
      } else {
        sendJson(response, 502, { error: message.slice(0, 1000) })
      }
    }
  }
}

export function startSnapshotServer(
  params: { port: number },
  deps: SnapshotHandlerDeps
): Server {
  const handler = createSnapshotHandler(deps)
  const server = createServer((request, response) => {
    handler(request, response).catch((err: unknown) => {
      deps.log(
        `snapshot handler crashed: ${err instanceof Error ? err.message : String(err)}`
      )
      if (!response.headersSent) sendJson(response, 500, { error: 'Failed.' })
    })
  })
  server.listen(params.port)
  return server
}

export function runSnapshotServerMain(): Server {
  const port = Number(process.env.PORT ?? '8080')
  const log = (message: string): void => {
    process.stdout.write(`[screenci-snapshot-server] ${message}\n`)
  }
  const server = startSnapshotServer(
    { port: Number.isInteger(port) && port > 0 ? port : 8080 },
    {
      launch: playwrightExploreLauncher,
      budgetMs: SNAPSHOT_BUDGET_MS,
      lookup: dnsHostLookup,
      log,
    }
  )
  log(`listening on ${port}`)
  return server
}
