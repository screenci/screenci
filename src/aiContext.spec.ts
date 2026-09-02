import { describe, expect, it } from 'vitest'
import {
  fetchAiContext,
  fetchAppLogin,
  parseAiContext,
  persistAppLogin,
  readEnvValues,
  type PersistAppLoginDeps,
} from './aiContext.js'

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
        guide: 'Notes',
        sources: { gitUrl: 'org', siteUrl: 'project', guide: 'org' },
      })
    ).toEqual({
      gitUrl: 'https://github.com/acme/app',
      siteUrl: 'http://localhost:3000',
      runLocallyIfNeeded: true,
      guide: 'Notes',
      sources: {
        gitUrl: 'org',
        siteUrl: 'project',
        runLocallyIfNeeded: 'none',
        guide: 'org',
      },
    })
    expect(parseAiContext(undefined).gitUrl).toBeNull()
    expect(parseAiContext(undefined).runLocallyIfNeeded).toBe(false)
  })
})

describe('fetchAiContext', () => {
  it('sends the secret and token and parses the answer', async () => {
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
        login: { saved: true },
      })
    }) as unknown as typeof fetch
    const result = await fetchAiContext(
      {
        apiUrl: 'https://api.example.com',
        secret: 'sec',
        editToken: 'tok',
        projectName: 'Acme',
      },
      fetchFn
    )
    expect(seen).toEqual({
      url: 'https://api.example.com/cli/dev/ai-context?projectName=Acme',
      headers: { 'X-ScreenCI-Secret': 'sec', 'X-ScreenCI-Dev-Token': 'tok' },
    })
    expect(result).toEqual({
      ok: true,
      context: expect.objectContaining({
        gitUrl: 'git@github.com:acme/app.git',
      }),
      projectName: 'Acme',
      sourceMode: 'local',
      login: { saved: true },
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

describe('fetchAppLogin', () => {
  it('returns the login, or null when none is saved', async () => {
    const saved = (async () =>
      jsonResponse({
        saved: true,
        username: 'demo@acme.com',
        password: 'pw',
      })) as unknown as typeof fetch
    expect(
      await fetchAppLogin(
        { apiUrl: 'https://api.example.com', secret: 's', editToken: 't' },
        saved
      )
    ).toEqual({
      ok: true,
      login: { username: 'demo@acme.com', password: 'pw' },
    })
    const none = (async () =>
      jsonResponse({ saved: false })) as unknown as typeof fetch
    expect(
      await fetchAppLogin(
        { apiUrl: 'https://api.example.com', secret: 's', editToken: 't' },
        none
      )
    ).toEqual({ ok: true, login: null })
  })
})

describe('readEnvValues', () => {
  it('returns only non-empty values of the requested keys', () => {
    expect(
      readEnvValues(
        'SCREENCI_SECRET=abc\nAPP_USERNAME=\nAPP_PASSWORD=pw\n# APP_USERNAME=x\n',
        ['APP_USERNAME', 'APP_PASSWORD']
      )
    ).toEqual({ APP_PASSWORD: 'pw' })
  })
})

describe('persistAppLogin', () => {
  function memDeps(initial: string | null) {
    let content = initial
    const writes: Array<[string, string]> = []
    const deps: PersistAppLoginDeps = {
      readEnvFile: async () => content,
      persistEnvVar: async (_path, key, value) => {
        writes.push([key, value])
        content = `${content ?? ''}${key}=${value}\n`
      },
    }
    return { deps, writes }
  }

  it('writes placeholders when nothing is saved and nothing exists', async () => {
    const { deps, writes } = memDeps('SCREENCI_SECRET=s\n')
    expect(
      await persistAppLogin('/w/.env', null, { overwrite: false }, deps)
    ).toBe('placeholders')
    expect(writes).toEqual([
      ['APP_USERNAME', ''],
      ['APP_PASSWORD', ''],
    ])
  })

  it('keeps hand-typed values unless overwriting', async () => {
    const { deps, writes } = memDeps('APP_USERNAME=me\nAPP_PASSWORD=pw\n')
    expect(
      await persistAppLogin(
        '/w/.env',
        { username: 'a', password: 'b' },
        { overwrite: false },
        deps
      )
    ).toBe('kept')
    expect(writes).toEqual([])
    expect(
      await persistAppLogin(
        '/w/.env',
        { username: 'a', password: 'b' },
        { overwrite: true },
        deps
      )
    ).toBe('written')
    expect(writes).toEqual([
      ['APP_USERNAME', 'a'],
      ['APP_PASSWORD', 'b'],
    ])
  })

  it('writes a saved login into an empty file', async () => {
    const { deps } = memDeps(null)
    expect(
      await persistAppLogin(
        '/w/.env',
        { username: 'a', password: 'b' },
        { overwrite: false },
        deps
      )
    ).toBe('written')
  })
})
