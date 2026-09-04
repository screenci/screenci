import { Command } from 'commander'
import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import { EMPTY_AI_CONTEXT } from './aiContext.js'
import { EMPTY_BRANDING } from './branding.js'
import {
  AiContextCommandError,
  registerAiContextCommands,
  runContextCommand,
  type AiContextCommandDeps,
  type IslandCredentials,
} from './aiContextCommands.js'

function makeDeps(
  overrides: Partial<AiContextCommandDeps> = {},
  creds: Partial<IslandCredentials> = {}
) {
  const logs: string[] = []
  const sessionReads: Array<{ configDir: string; profile: string }> = []
  const deps: AiContextCommandDeps = {
    fetchFn: (async () => new Response('')) as unknown as typeof fetch,
    loadCredentials: async () => ({
      secret: 'sec',
      apiUrl: 'https://api.example.com',
      appUrl: 'https://app.example.com',
      envFilePath: '/w/screenci/.env',
      islandDir: '/w/screenci',
      projectName: 'Acme',
      ...creds,
    }),
    fetchAiContext: async () => ({
      ok: true,
      context: {
        ...EMPTY_AI_CONTEXT,
        gitUrl: 'https://github.com/acme/app',
        guide: 'Use the demo tenant.',
      },
      projectName: 'Acme',
      sourceMode: 'service',
    }),
    now: () => new Date('2026-09-03T12:00:00.000Z'),
    readAppSessionStatus: async ({ configDir, profile }) => {
      sessionReads.push({ configDir, profile })
      return {
        saved: true,
        path: '/w/screenci/.screenci/auth/default.json',
        meta: {
          profile,
          origin: 'https://app.acme.com',
          savedAt: '2026-09-03T11:00:00.000Z',
          expiresAt: null,
        },
        expired: false,
      }
    },
    fetchBranding: async () => ({
      ok: true,
      branding: {
        ...EMPTY_BRANDING,
        cursorStyle: 'black',
        sources: { ...EMPTY_BRANDING.sources, cursorStyle: 'org' },
      },
      projectName: 'Acme',
    }),
    downloadBrandingVoiceSample: async () => ({ status: 'none' }),
    logger: {
      info: (message) => logs.push(stripVTControlCharacters(message)),
      warn: (message) => logs.push(message),
    },
    ...overrides,
  }
  return { deps, logs, sessionReads }
}

describe('runContextCommand', () => {
  it('prints a summary and a JSON line', async () => {
    const { deps, logs } = makeDeps()
    const result = await runContextCommand({ json: false }, deps)
    expect(result.context.gitUrl).toBe('https://github.com/acme/app')
    const text = logs.join('\n')
    expect(text).toContain('Repository: https://github.com/acme/app')
    expect(text).toContain('Use the demo tenant.')
    expect(text).toContain(
      'A signed-in session is saved for https://app.acme.com'
    )
    expect(text).toContain('do not script a sign-in')
    const jsonLine = logs.find((line) => line.startsWith('{'))
    expect(jsonLine && JSON.parse(jsonLine)).toMatchObject({
      gitUrl: 'https://github.com/acme/app',
      projectName: 'Acme',
      session: { saved: true, expired: false },
      envFile: '/w/screenci/.env',
    })
  })

  it('reads the session from the island on disk, not from the service', async () => {
    const { deps, sessionReads } = makeDeps()
    await runContextCommand({ json: true }, deps)
    expect(sessionReads).toEqual([
      { configDir: '/w/screenci', profile: 'default' },
    ])
  })

  it('says how to sign in again when the saved session expired', async () => {
    const { deps, logs } = makeDeps({
      readAppSessionStatus: async () => ({
        saved: true,
        path: '/w/screenci/.screenci/auth/default.json',
        meta: {
          profile: 'default',
          origin: 'https://app.acme.com',
          savedAt: '2026-08-01T12:00:00.000Z',
          expiresAt: '2026-08-30T12:00:00.000Z',
        },
        expired: true,
      }),
    })
    await runContextCommand({ json: false }, deps)
    const printed = logs.join('\n')
    expect(printed).toContain('expired')
    expect(printed).toContain('npx screenci login')
  })

  it('tells the agent to open a browser when nothing is saved yet', async () => {
    const { deps, logs } = makeDeps({
      readAppSessionStatus: async () => ({ saved: false }),
    })
    await runContextCommand({ json: false }, deps)
    const printed = logs.join('\n')
    expect(printed).toContain('No signed-in session is saved.')
    expect(printed).toContain('npx screenci login')
  })

  it('reports what the team said about the site needing a sign-in', async () => {
    const { deps, logs } = makeDeps({
      fetchAiContext: async () => ({
        ok: true,
        context: { ...EMPTY_AI_CONTEXT, siteRequiresLogin: true },
        projectName: null,
        sourceMode: null,
      }),
    })
    await runContextCommand({ json: false }, deps)
    expect(logs.join('\n')).toContain('Site needs a sign-in: yes')
  })

  it('prints only JSON with --json', async () => {
    const fetchAiContext = vi.fn(async () => ({
      ok: true as const,
      context: EMPTY_AI_CONTEXT,
      projectName: null,
      sourceMode: null,
    }))
    const { deps, logs } = makeDeps({ fetchAiContext })
    await runContextCommand({ json: true }, deps)
    expect(logs).toHaveLength(1)
    expect(fetchAiContext.mock.calls[0]?.[0]).toMatchObject({
      secret: 'sec',
      projectName: 'Acme',
    })
  })

  it('throws a typed error when the fetch fails', async () => {
    const { deps } = makeDeps({
      fetchAiContext: async () => ({ ok: false, message: 'boom' }),
    })
    await expect(runContextCommand({ json: false }, deps)).rejects.toThrow(
      AiContextCommandError
    )
  })

  it('prints the branding and downloads a cloned voice sample', async () => {
    const downloads: string[] = []
    const { deps, logs } = makeDeps({
      fetchBranding: async () => ({
        ok: true,
        branding: {
          ...EMPTY_BRANDING,
          voice: {
            kind: 'sample',
            fileHash: 'a'.repeat(64),
            fileName: 'v.mp3',
          },
          sources: { ...EMPTY_BRANDING.sources, voice: 'org' },
        },
        projectName: 'Acme',
      }),
      downloadBrandingVoiceSample: async (params) => {
        downloads.push(params.islandDir)
        return {
          status: 'kept',
          relativePath: 'branding/v.mp3',
          fileName: 'v.mp3',
        }
      },
    })
    const result = await runContextCommand({ json: false }, deps)
    expect(downloads).toEqual(['/w/screenci'])
    expect(result.brandingSamplePath).toBe('branding/v.mp3')
    const text = logs.join('\n')
    expect(text).toContain('Branding (apply it in the video code')
    expect(text).toContain('saved as branding/v.mp3')
    const jsonLine = logs.find((line) => line.startsWith('{'))
    expect(jsonLine && JSON.parse(jsonLine)).toMatchObject({
      branding: { voice: { kind: 'sample' } },
      brandingSamplePath: 'branding/v.mp3',
    })
  })

  it('keeps going when the branding cannot be fetched', async () => {
    const { deps, logs } = makeDeps({
      fetchBranding: async () => ({ ok: false, message: 'branding down' }),
    })
    const result = await runContextCommand({ json: false }, deps)
    expect(result.branding).toBeNull()
    expect(logs.join('\n')).toContain('branding down')
    expect(logs.join('\n')).toContain('could not be fetched')
  })
})

describe('registerAiContextCommands', () => {
  it('registers context', async () => {
    const { deps, logs } = makeDeps()
    const program = new Command()
    program.exitOverride()
    registerAiContextCommands(program, deps)
    await program.parseAsync(['context', '--json'], { from: 'user' })
    expect(logs).toHaveLength(1)
  })

  it('no longer registers pull-login: nothing stores app credentials', () => {
    const { deps } = makeDeps()
    const program = new Command()
    registerAiContextCommands(program, deps)
    expect(program.commands.map((command) => command.name())).toEqual([
      'context',
    ])
  })
})
