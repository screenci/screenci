import { Command } from 'commander'
import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import { EMPTY_AI_CONTEXT, type AppLogin } from './aiContext.js'
import {
  AiContextCommandError,
  registerAiContextCommands,
  runContextCommand,
  runPullLoginCommand,
  type AiContextCommandDeps,
  type IslandCredentials,
} from './aiContextCommands.js'

function makeDeps(
  overrides: Partial<AiContextCommandDeps> = {},
  creds: Partial<IslandCredentials> = {}
) {
  const logs: string[] = []
  const logins: Array<[string, AppLogin | null, boolean]> = []
  const deps: AiContextCommandDeps = {
    fetchFn: (async () => new Response('')) as unknown as typeof fetch,
    loadCredentials: async () => ({
      secret: 'sec',
      editToken: 'tok',
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
      login: { saved: true },
    }),
    fetchAppLogin: async () => ({
      ok: true,
      login: { username: 'demo@acme.com', password: 'pw' },
    }),
    persistAppLogin: async (path, login, options) => {
      logins.push([path, login, options.overwrite])
      return login !== null ? 'written' : 'placeholders'
    },
    logger: {
      info: (message) => logs.push(stripVTControlCharacters(message)),
      warn: (message) => logs.push(message),
    },
    ...overrides,
  }
  return { deps, logs, logins }
}

describe('runContextCommand', () => {
  it('prints a summary and a JSON line', async () => {
    const { deps, logs } = makeDeps()
    const result = await runContextCommand({ json: false }, deps)
    expect(result.context.gitUrl).toBe('https://github.com/acme/app')
    const text = logs.join('\n')
    expect(text).toContain('Repository: https://github.com/acme/app')
    expect(text).toContain('Use the demo tenant.')
    expect(text).toContain('screenci pull-login')
    const jsonLine = logs.find((line) => line.startsWith('{'))
    expect(jsonLine && JSON.parse(jsonLine)).toMatchObject({
      gitUrl: 'https://github.com/acme/app',
      projectName: 'Acme',
      login: { saved: true },
      envFile: '/w/screenci/.env',
    })
  })

  it('prints only JSON with --json and passes the token along', async () => {
    const fetchAiContext = vi.fn(async () => ({
      ok: true as const,
      context: EMPTY_AI_CONTEXT,
      projectName: null,
      sourceMode: null,
      login: { saved: false },
    }))
    const { deps, logs } = makeDeps({ fetchAiContext })
    await runContextCommand({ json: true }, deps)
    expect(logs).toHaveLength(1)
    expect(fetchAiContext.mock.calls[0]?.[0]).toMatchObject({
      secret: 'sec',
      editToken: 'tok',
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
})

describe('runPullLoginCommand', () => {
  it('overwrites the env file with the saved login', async () => {
    const { deps, logins, logs } = makeDeps()
    const result = await runPullLoginCommand({}, deps)
    expect(result).toEqual({
      saved: true,
      outcome: 'written',
      envFilePath: '/w/screenci/.env',
    })
    expect(logins).toEqual([
      ['/w/screenci/.env', { username: 'demo@acme.com', password: 'pw' }, true],
    ])
    expect(logs.join('\n')).not.toContain('demo@acme.com')
  })

  it('explains when nothing is saved', async () => {
    const { deps, logs } = makeDeps({
      fetchAppLogin: async () => ({ ok: true, login: null }),
    })
    const result = await runPullLoginCommand({}, deps)
    expect(result.saved).toBe(false)
    expect(logs.join('\n')).toContain('/ai-context#login')
  })

  it('refuses without an editor token', async () => {
    const { deps } = makeDeps({}, { editToken: null })
    await expect(runPullLoginCommand({}, deps)).rejects.toThrow(
      /SCREENCI_EDIT_TOKEN/
    )
  })
})

describe('registerAiContextCommands', () => {
  it('registers both commands', async () => {
    const { deps, logs, logins } = makeDeps()
    const program = new Command()
    program.exitOverride()
    registerAiContextCommands(program, deps)
    await program.parseAsync(['context', '--json'], { from: 'user' })
    expect(logs).toHaveLength(1)
    await program.parseAsync(['pull-login'], { from: 'user' })
    expect(logins).toHaveLength(1)
  })
})
