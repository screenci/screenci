import { describe, expect, it } from 'vitest'
import { fetchAiContext, parseAiContext } from './aiContext.js'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('parseAiContext', () => {
  it('reads a full payload and tolerates a missing one', () => {
    expect(
      parseAiContext({
        gitUrl: 'https://github.com/acme/app',
        siteUrl: 'http://localhost:3000',
        runLocallyIfNeeded: true,
        siteRequiresLogin: true,
        packageManager: 'pnpm',
        guide: 'Notes',
        sources: {
          gitUrl: 'org',
          siteUrl: 'project',
          siteRequiresLogin: 'project',
          packageManager: 'org',
          guide: 'org',
        },
      })
    ).toEqual({
      gitUrl: 'https://github.com/acme/app',
      siteUrl: 'http://localhost:3000',
      runLocallyIfNeeded: true,
      siteRequiresLogin: true,
      packageManager: 'pnpm',
      guide: 'Notes',
      sources: {
        gitUrl: 'org',
        siteUrl: 'project',
        runLocallyIfNeeded: 'none',
        siteRequiresLogin: 'project',
        packageManager: 'org',
        guide: 'org',
      },
    })
    expect(parseAiContext(undefined).gitUrl).toBeNull()
    expect(parseAiContext(undefined).runLocallyIfNeeded).toBe(false)
  })

  it('defaults siteRequiresLogin to false for a server that does not send it', () => {
    expect(parseAiContext({ gitUrl: 'x' }).siteRequiresLogin).toBe(false)
    expect(parseAiContext({ gitUrl: 'x' }).sources.siteRequiresLogin).toBe(
      'none'
    )
  })

  it('reads no package manager from a server that does not send one, and ignores an unknown one', () => {
    expect(parseAiContext({ gitUrl: 'x' }).packageManager).toBeNull()
    expect(parseAiContext({ gitUrl: 'x' }).sources.packageManager).toBe('none')
    expect(parseAiContext({ packageManager: 'bun' }).packageManager).toBeNull()
  })
})

describe('fetchAiContext', () => {
  it('sends the secret and parses the answer', async () => {
    let seen: { url: string; headers: Record<string, string> } | null = null
    const fetchFn = (async (url: string, init?: RequestInit) => {
      seen = { url, headers: init?.headers as Record<string, string> }
      return jsonResponse({
        gitUrl: 'git@github.com:acme/app.git',
        siteUrl: null,
        runLocallyIfNeeded: false,
        guide: null,
        sources: {},
        projectName: 'Acme',
        sourceMode: 'local',
      })
    }) as unknown as typeof fetch
    const result = await fetchAiContext(
      {
        apiUrl: 'https://api.example.com',
        secret: 'sec',
        projectName: 'Acme',
      },
      fetchFn
    )
    expect(seen).toEqual({
      url: 'https://api.example.com/cli/dev/ai-context?projectName=Acme',
      headers: { 'X-ScreenCI-Secret': 'sec' },
    })
    expect(result).toEqual({
      ok: true,
      context: expect.objectContaining({
        gitUrl: 'git@github.com:acme/app.git',
      }),
      projectName: 'Acme',
      sourceMode: 'local',
    })
  })

  it('maps failures to messages', async () => {
    const fetchFn = (async () =>
      jsonResponse({ error: 'x' }, 401)) as unknown as typeof fetch
    const result = await fetchAiContext(
      { apiUrl: 'https://api.example.com', secret: 'sec' },
      fetchFn
    )
    expect(result.ok).toBe(false)
  })
})
