import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import type { ExploreLaunchOptions, ExploreSession } from './explore.js'
import {
  createSnapshotRequestGuard,
  isBlockedSnapshotRequest,
  resolvesToForbiddenAddress,
  snapshotCredentialOptions,
  isForbiddenSnapshotTarget,
  parseSnapshotRequest,
  SNAPSHOT_MAX_BODY_BYTES,
  SNAPSHOT_MAX_STEPS,
  startSnapshotServer,
  takeSnapshot,
} from './snapshotServer.js'

describe('isForbiddenSnapshotTarget', () => {
  it.each([
    'https://example.com/',
    'http://app.acme.io:8080/login?next=/x',
    'https://8.8.8.8/',
    'https://[2606:4700:4700::1111]/',
  ])('allows the public address %s', (url) => {
    expect(isForbiddenSnapshotTarget(url)).toBe(false)
  })

  it.each([
    'file:///etc/passwd',
    'ftp://example.com/',
    'javascript:alert(1)',
    'not a url',
    'http://localhost:3000/',
    'http://LOCALHOST/',
    'http://app.localhost/',
    'http://localhost./',
    'http://127.0.0.1/',
    'http://127.1/',
    'http://2130706433/',
    'http://0x7f000001/',
    'http://0.0.0.0/',
    'http://10.1.2.3/',
    'http://172.16.0.1/',
    'http://172.31.255.255/',
    'http://192.168.1.1/',
    'http://169.254.169.254/computeMetadata/v1/',
    'http://100.64.0.1/',
    'http://224.0.0.1/',
    'http://[::1]/',
    'http://[::]/',
    'http://[fc00::1]/',
    'http://[fd12:3456::1]/',
    'http://[fe80::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:169.254.169.254]/',
    'http://[64:ff9b::a9fe:a9fe]/',
    'http://[2002:a9fe:a9fe::1]/',
    'http://192.0.0.1/',
    'http://198.18.0.1/',
    'http://metadata/',
    'http://metadata.cloud.internal/computeMetadata/v1/',
    'http://service.internal/',
    'http://printer.local/',
    'http://intranet/',
    'https://user:pass@example.com/',
  ])('refuses %s', (url) => {
    expect(isForbiddenSnapshotTarget(url)).toBe(true)
  })

  it('lets the page build data and blob URLs but not internal requests', () => {
    expect(isBlockedSnapshotRequest('data:image/png;base64,AAAA')).toBe(false)
    expect(isBlockedSnapshotRequest('blob:https://example.com/uuid')).toBe(
      false
    )
    expect(isBlockedSnapshotRequest('http://169.254.169.254/')).toBe(true)
    expect(isBlockedSnapshotRequest('https://cdn.example.com/a.js')).toBe(false)
  })

  it('allows the boundary addresses just outside the private ranges', () => {
    expect(isForbiddenSnapshotTarget('http://172.15.255.255/')).toBe(false)
    expect(isForbiddenSnapshotTarget('http://172.32.0.1/')).toBe(false)
    expect(isForbiddenSnapshotTarget('http://169.255.0.1/')).toBe(false)
  })
})

describe('parseSnapshotRequest', () => {
  it('accepts a full request', () => {
    const result = parseSnapshotRequest({
      url: 'https://app.example.com/',
      steps: [
        { kind: 'click', name: 'Sign in' },
        { kind: 'fill', label: 'Email', value: 'a@b.c' },
      ],
      contextOptions: {
        httpCredentials: { username: 'u', password: 'p' },
        extraHTTPHeaders: { 'X-Bypass': 't' },
        proxy: { server: 'http://proxy:1', username: 'pu' },
      },
      storageState: { cookies: [], origins: [] },
      credentialOrigin: 'https://app.example.com/ignored-path',
    })
    expect(result).toEqual({
      ok: true,
      request: {
        url: 'https://app.example.com/',
        steps: [
          { kind: 'click', name: 'Sign in' },
          { kind: 'fill', label: 'Email', value: 'a@b.c' },
        ],
        contextOptions: {
          httpCredentials: { username: 'u', password: 'p' },
          extraHTTPHeaders: { 'X-Bypass': 't' },
          proxy: { server: 'http://proxy:1', username: 'pu' },
        },
        storageState: { cookies: [], origins: [] },
        credentialOrigin: 'https://app.example.com',
      },
    })
  })

  it.each([
    [null, /JSON object/],
    [{ url: 1 }, /url/],
    [{ url: 'http://10.0.0.1/' }, /public/],
    [{ url: 'https://example.com', steps: 'x' }, /steps must be an array/],
    [
      {
        url: 'https://example.com',
        steps: Array.from({ length: SNAPSHOT_MAX_STEPS + 1 }, () => ({
          kind: 'click',
          name: 'x',
        })),
      },
      /At most 10 steps/,
    ],
    [{ url: 'https://example.com', steps: [{ kind: 'eval' }] }, /Each step/],
    [
      { url: 'https://example.com', contextOptions: { proxy: {} } },
      /proxy needs a server/,
    ],
    [
      {
        url: 'https://example.com',
        contextOptions: { extraHTTPHeaders: { a: 1 } },
      },
      /extraHTTPHeaders/,
    ],
    [
      { url: 'https://example.com', storageState: { cookies: 1 } },
      /storageState/,
    ],
    [
      { url: 'https://example.com', credentialOrigin: 'ftp://x' },
      /credentialOrigin/,
    ],
    [{ url: 'https://example.com', credentialOrigin: 5 }, /credentialOrigin/],
  ])('rejects %j', (body, error) => {
    const result = parseSnapshotRequest(body)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(error)
  })
})

function fakeSession(urls: string[]): ExploreSession & { closed: boolean } {
  let current = 'about:blank'
  let next = 0
  const session = {
    closed: false,
    goto: vi.fn(async () => {
      current = urls[next++] ?? current
    }),
    clickByName: vi.fn(async () => {
      current = urls[next++] ?? current
    }),
    fillByLabel: vi.fn(async () => {}),
    ariaSnapshot: vi.fn(
      async () => '- heading "Welcome" [level=1]\n- text: hi'
    ),
    screenshot: vi.fn(async () => Buffer.from('jpeg-bytes')),
    url: () => current,
    close: vi.fn(async () => {
      session.closed = true
    }),
  }
  return session
}

/** Every name resolves to a public address. */
const publicLookup = async (): Promise<string[]> => ['93.184.216.34']

describe('resolvesToForbiddenAddress', () => {
  const lookup = async (host: string): Promise<string[]> => {
    if (host === 'metadata.nip.io') return ['169.254.169.254']
    if (host === 'mixed.example.com') return ['93.184.216.34', '10.0.0.1']
    if (host === 'v6.example.com') return ['fd00::1']
    if (host === 'public.example.com') return ['93.184.216.34']
    throw new Error('ENOTFOUND')
  }

  it('refuses names that resolve to internal addresses or not at all', async () => {
    expect(
      await resolvesToForbiddenAddress('http://metadata.nip.io/', lookup)
    ).toBe(true)
    expect(
      await resolvesToForbiddenAddress('https://mixed.example.com/', lookup)
    ).toBe(true)
    expect(
      await resolvesToForbiddenAddress('https://v6.example.com/', lookup)
    ).toBe(true)
    expect(
      await resolvesToForbiddenAddress('https://nowhere.example.com/', lookup)
    ).toBe(true)
    expect(
      await resolvesToForbiddenAddress('https://public.example.com/x', lookup)
    ).toBe(false)
  })

  it('caches per host in one guard', async () => {
    const counting = vi.fn(async () => ['93.184.216.34'])
    const guard = createSnapshotRequestGuard(counting)
    expect(await guard('https://a.example.com/1')).toBe(false)
    expect(await guard('https://a.example.com/2')).toBe(false)
    expect(counting).toHaveBeenCalledTimes(1)
    expect(await guard('data:text/plain,hi')).toBe(false)
  })
})

describe('snapshotCredentialOptions', () => {
  const request = {
    url: 'https://other.example.com/start',
    steps: [],
    contextOptions: {
      extraHTTPHeaders: { 'X-A': 'b' },
      httpCredentials: { username: 'u', password: 'p' },
    },
    storageState: { cookies: [], origins: [] },
  }

  it('drops the session when the page starts on another origin', () => {
    const options = snapshotCredentialOptions({
      ...request,
      credentialOrigin: 'https://app.example.com',
    })
    expect(options.storageState).toBeUndefined()
    expect(options.originHeaders?.origin).toBe('https://app.example.com')
  })

  it('uses no credentials, headers or session without an origin', () => {
    expect(
      snapshotCredentialOptions({ ...request, credentialOrigin: null })
    ).toEqual({ contextOptions: {} })
  })
})

describe('takeSnapshot', () => {
  it('runs the steps and answers snapshot, screenshot and final URL', async () => {
    const session = fakeSession([
      'https://app.example.com/',
      'https://app.example.com/signin',
    ])
    const launch = vi.fn(async (_options: ExploreLaunchOptions) => session)
    const result = await takeSnapshot(
      {
        url: 'https://app.example.com/',
        steps: [{ kind: 'click', name: 'Sign in' }],
        contextOptions: {
          extraHTTPHeaders: { 'X-A': 'b' },
          httpCredentials: { username: 'u', password: 'p' },
          proxy: { server: 'http://proxy.example.com:3128' },
        },
        storageState: { cookies: [], origins: [] },
        credentialOrigin: 'https://app.example.com',
      },
      { launch, budgetMs: 1000, lookup: publicLookup }
    )
    expect(result.finalUrl).toBe('https://app.example.com/signin')
    expect(result.screenshotJpegBase64).toBe(
      Buffer.from('jpeg-bytes').toString('base64')
    )
    expect(result.snapshot).toContain(
      '## after load (https://app.example.com/)'
    )
    expect(result.snapshot).toContain('## after click "Sign in"')
    expect(result.snapshot).toContain('- heading "Welcome"')
    expect(session.closed).toBe(true)
    const options = launch.mock.calls[0]![0]
    // Secrets are bound to the credential origin; the proxy is not.
    expect(options.contextOptions).toEqual({
      proxy: { server: 'http://proxy.example.com:3128' },
      httpCredentials: {
        username: 'u',
        password: 'p',
        origin: 'https://app.example.com',
      },
    })
    expect(options.originHeaders).toEqual({
      origin: 'https://app.example.com',
      headers: { 'X-A': 'b' },
    })
    expect(options.storageState).toEqual({ cookies: [], origins: [] })
    expect(await options.blockRequest?.('http://169.254.169.254/')).toBe(true)
    expect(await options.blockRequest?.('wss://10.0.0.1/socket')).toBe(true)
    expect(await options.blockRequest?.('https://cdn.example.com/a.js')).toBe(
      false
    )
  })

  it('stops when the page redirects to a forbidden address', async () => {
    const session = fakeSession(['http://10.0.0.5/admin'])
    await expect(
      takeSnapshot(
        {
          url: 'https://evil.example.com/',
          steps: [],
          contextOptions: {},
          storageState: null,
          credentialOrigin: null,
        },
        { launch: async () => session, budgetMs: 1000, lookup: publicLookup }
      )
    ).rejects.toThrow(/forbidden address/)
    expect(session.closed).toBe(true)
    expect(session.screenshot).not.toHaveBeenCalled()
  })

  it('refuses an internal proxy and a name resolving to an internal address', async () => {
    const launch = vi.fn(async () => fakeSession(['https://example.com/']))
    const base = {
      url: 'https://example.com/',
      steps: [],
      storageState: null,
      credentialOrigin: null,
    }
    await expect(
      takeSnapshot(
        { ...base, contextOptions: { proxy: { server: '127.0.0.1:3128' } } },
        { launch, budgetMs: 1000, lookup: publicLookup }
      )
    ).rejects.toThrow(/forbidden address/)
    await expect(
      takeSnapshot(
        { ...base, contextOptions: {} },
        {
          launch,
          budgetMs: 1000,
          lookup: async () => ['10.1.2.3'],
        }
      )
    ).rejects.toThrow(/forbidden address/)
    expect(launch).not.toHaveBeenCalled()
  })

  it('gives up after the budget and closes the browser', async () => {
    const session = fakeSession([])
    session.goto = vi.fn(() => new Promise<void>(() => {}))
    await expect(
      takeSnapshot(
        {
          url: 'https://slow.example.com/',
          steps: [],
          contextOptions: {},
          storageState: null,
          credentialOrigin: null,
        },
        { launch: async () => session, budgetMs: 20, lookup: publicLookup }
      )
    ).rejects.toThrow(/did not finish/)
    expect(session.closed).toBe(true)
  })
})

describe('snapshot HTTP server', () => {
  let server: Server | null = null
  afterEach(async () => {
    const running = server
    server = null
    if (running !== null) {
      await new Promise<void>((resolve) => running.close(() => resolve()))
    }
  })

  async function start(): Promise<string> {
    server = startSnapshotServer(
      { port: 0 },
      {
        launch: async () => fakeSession(['https://example.com/']),
        budgetMs: 1000,
        lookup: publicLookup,
        log: () => {},
      }
    )
    await new Promise<void>((resolve) => server!.once('listening', resolve))
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  }

  it('answers health checks, snapshots and validation errors', async () => {
    const base = await start()
    expect(await (await fetch(`${base}/healthz`)).json()).toEqual({ ok: true })

    const ok = await fetch(`${base}/snapshot`, {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com/' }),
    })
    expect(ok.status).toBe(200)
    expect(await ok.json()).toMatchObject({ finalUrl: 'https://example.com/' })

    const bad = await fetch(`${base}/snapshot`, {
      method: 'POST',
      body: JSON.stringify({ url: 'http://localhost/' }),
    })
    expect(bad.status).toBe(400)

    const notJson = await fetch(`${base}/snapshot`, {
      method: 'POST',
      body: '{',
    })
    expect(notJson.status).toBe(400)

    const huge = await fetch(`${base}/snapshot`, {
      method: 'POST',
      body: 'x'.repeat(SNAPSHOT_MAX_BODY_BYTES + 1),
    })
    expect(huge.status).toBe(413)

    expect((await fetch(`${base}/snapshot`)).status).toBe(405)
    expect((await fetch(`${base}/nope`)).status).toBe(404)
  })
})
