import { SECRET_HEADER } from './anonSession.js'
import { persistEnvVar } from './linkSession.js'

/**
 * The organisation's AI context as the service resolves it for a project:
 * where the product's source code lives, where it runs, whether the agent may
 * start it from the repository, and free-form notes. Fetched by `screenci
 * start` (in the setup-code exchange) and `screenci context`
 * (`GET /cli/dev/ai-context`). The person's site login travels separately
 * (`GET /cli/dev/app-login`, `fetchAppLogin`) and only ever lands in the
 * island's env file as APP_USERNAME / APP_PASSWORD.
 */

export type AiContextSource = 'project' | 'org' | 'none'

export type CliAiContext = {
  gitUrl: string | null
  siteUrl: string | null
  runLocallyIfNeeded: boolean
  guide: string | null
  sources: {
    gitUrl: AiContextSource
    siteUrl: AiContextSource
    runLocallyIfNeeded: AiContextSource
    guide: AiContextSource
  }
}

export const EMPTY_AI_CONTEXT: CliAiContext = {
  gitUrl: null,
  siteUrl: null,
  runLocallyIfNeeded: false,
  guide: null,
  sources: {
    gitUrl: 'none',
    siteUrl: 'none',
    runLocallyIfNeeded: 'none',
    guide: 'none',
  },
}

/** Header carrying the personal editor token on `/cli/dev/*` calls. */
export const DEV_TOKEN_HEADER = 'X-ScreenCI-Dev-Token'

export const APP_USERNAME_ENV = 'APP_USERNAME'
export const APP_PASSWORD_ENV = 'APP_PASSWORD'

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function source(value: unknown): AiContextSource {
  return value === 'project' || value === 'org' ? value : 'none'
}

/** Tolerant parse: an older server (no context at all) yields the empty context. */
export function parseAiContext(value: unknown): CliAiContext {
  if (typeof value !== 'object' || value === null) return EMPTY_AI_CONTEXT
  const v = value as Record<string, unknown>
  const sources = (
    typeof v.sources === 'object' && v.sources !== null ? v.sources : {}
  ) as Record<string, unknown>
  return {
    gitUrl: optionalString(v.gitUrl),
    siteUrl: optionalString(v.siteUrl),
    runLocallyIfNeeded: v.runLocallyIfNeeded === true,
    guide: optionalString(v.guide),
    sources: {
      gitUrl: source(sources.gitUrl),
      siteUrl: source(sources.siteUrl),
      runLocallyIfNeeded: source(sources.runLocallyIfNeeded),
      guide: source(sources.guide),
    },
  }
}

export type FetchAiContextResult =
  | {
      ok: true
      context: CliAiContext
      projectName: string | null
      sourceMode: 'service' | 'local' | null
      login: { saved: boolean }
    }
  | { ok: false; message: string }

/** `GET /cli/dev/ai-context` for `screenci context`. */
export async function fetchAiContext(
  params: {
    apiUrl: string
    secret: string
    editToken?: string | undefined
    projectName?: string | undefined
  },
  fetchFn: typeof fetch
): Promise<FetchAiContextResult> {
  const url = new URL(`${params.apiUrl}/cli/dev/ai-context`)
  if (params.projectName !== undefined) {
    url.searchParams.set('projectName', params.projectName)
  }
  let response: Response
  try {
    response = await fetchFn(url.toString(), {
      headers: {
        [SECRET_HEADER]: params.secret,
        ...(params.editToken !== undefined
          ? { [DEV_TOKEN_HEADER]: params.editToken }
          : {}),
      },
    })
  } catch (err) {
    return {
      ok: false,
      message: `Could not reach ScreenCI: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    return {
      ok: false,
      message: `Fetching the AI context failed with status ${response.status}${text ? `: ${text}` : ''}`,
    }
  }
  let body: unknown
  try {
    body = await response.json()
  } catch {
    return { ok: false, message: 'The AI context response is not JSON' }
  }
  const b = (body ?? {}) as Record<string, unknown>
  const login = (b.login ?? {}) as Record<string, unknown>
  return {
    ok: true,
    context: parseAiContext(body),
    projectName: optionalString(b.projectName),
    sourceMode:
      b.sourceMode === 'service' || b.sourceMode === 'local'
        ? b.sourceMode
        : null,
    login: { saved: login.saved === true },
  }
}

export type AppLogin = { username: string; password: string }

export type FetchAppLoginResult =
  { ok: true; login: AppLogin | null } | { ok: false; message: string }

/**
 * `GET /cli/dev/app-login`: the personal site login of the person behind
 * `editToken`, or null when none is saved (or the token has no owner).
 */
export async function fetchAppLogin(
  params: { apiUrl: string; secret: string; editToken: string },
  fetchFn: typeof fetch
): Promise<FetchAppLoginResult> {
  let response: Response
  try {
    response = await fetchFn(`${params.apiUrl}/cli/dev/app-login`, {
      headers: {
        [SECRET_HEADER]: params.secret,
        [DEV_TOKEN_HEADER]: params.editToken,
      },
    })
  } catch (err) {
    return {
      ok: false,
      message: `Could not reach ScreenCI: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    return {
      ok: false,
      message: `Fetching the site login failed with status ${response.status}${text ? `: ${text}` : ''}`,
    }
  }
  let body: unknown
  try {
    body = await response.json()
  } catch {
    return { ok: false, message: 'The site login response is not JSON' }
  }
  const b = (body ?? {}) as Record<string, unknown>
  if (b.saved !== true) return { ok: true, login: null }
  if (typeof b.username !== 'string' || typeof b.password !== 'string') {
    return { ok: false, message: 'The site login response is malformed' }
  }
  return { ok: true, login: { username: b.username, password: b.password } }
}

/** `KEY=value` lines already present with a non-empty value. */
export function readEnvValues(
  content: string,
  keys: readonly string[]
): Record<string, string> {
  const values: Record<string, string> = {}
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    if (!keys.includes(key)) continue
    const value = line.slice(eq + 1).trim()
    if (value.length > 0) values[key] = value
  }
  return values
}

export type PersistAppLoginOutcome = 'written' | 'placeholders' | 'kept'

export type PersistAppLoginDeps = {
  readEnvFile: (path: string) => Promise<string | null>
  persistEnvVar: (path: string, key: string, value: string) => Promise<void>
}

export const defaultPersistAppLoginDeps: PersistAppLoginDeps = {
  readEnvFile: async (path) => {
    try {
      const { readFile } = await import('node:fs/promises')
      return await readFile(path, 'utf-8')
    } catch {
      return null
    }
  },
  persistEnvVar,
}

/**
 * Writes APP_USERNAME / APP_PASSWORD into the island env file. With a login,
 * both are written (`overwrite: false` keeps values a person typed by hand).
 * Without one, empty placeholders are added so the script can read them and
 * the person knows where to paste theirs; existing values are never blanked.
 */
export async function persistAppLogin(
  envFilePath: string,
  login: AppLogin | null,
  options: { overwrite: boolean },
  deps: PersistAppLoginDeps = defaultPersistAppLoginDeps
): Promise<PersistAppLoginOutcome> {
  const existing = readEnvValues((await deps.readEnvFile(envFilePath)) ?? '', [
    APP_USERNAME_ENV,
    APP_PASSWORD_ENV,
  ])
  const hasExisting =
    existing[APP_USERNAME_ENV] !== undefined ||
    existing[APP_PASSWORD_ENV] !== undefined
  if (login !== null) {
    if (hasExisting && !options.overwrite) return 'kept'
    await deps.persistEnvVar(envFilePath, APP_USERNAME_ENV, login.username)
    await deps.persistEnvVar(envFilePath, APP_PASSWORD_ENV, login.password)
    return 'written'
  }
  if (hasExisting) return 'kept'
  await deps.persistEnvVar(envFilePath, APP_USERNAME_ENV, '')
  await deps.persistEnvVar(envFilePath, APP_PASSWORD_ENV, '')
  return 'placeholders'
}
