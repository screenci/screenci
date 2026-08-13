import { readFile, writeFile } from 'fs/promises'

// Shared CLI helpers for resolving the ScreenCI environment/URLs and for
// writing/verifying a SCREENCI_SECRET. `screenci record` with no
// SCREENCI_SECRET set uploads anonymously instead (see anonSession.ts); this
// module no longer handles the (removed) init-OTP handoff.

const SCREENCI_ENVIRONMENT_VARIABLE = 'SCREENCI_ENVIRONMENT'
const SCREENCI_ENVIRONMENT_OPTION_VALUES = ['local', 'dev', 'prod'] as const
const SCREENCI_PRODUCTION_BACKEND_URL = 'https://api.screenci.com'
const SCREENCI_PRODUCTION_FRONTEND_URL = 'https://app.screenci.com'
const SCREENCI_DEVELOPMENT_BACKEND_URL = 'https://dev.api.screenci.com'
const SCREENCI_DEVELOPMENT_FRONTEND_URL = 'https://dev.app.screenci.com'

// A SCREENCI_SECRET is a bare v4 UUID (no prefix). A user who copies their
// secret and pastes it as the init positional should get it written to `.env`
// instead of a project literally named after the secret. The v4-specific shape
// makes it unmistakable from a real project name.
const SCREENCI_SECRET_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type ScreenCIEnvironment =
  (typeof SCREENCI_ENVIRONMENT_OPTION_VALUES)[number]

function isMissingFileError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    err.code === 'ENOENT'
  )
}

function parseScreenCIEnvironment(
  value: string | undefined
): ScreenCIEnvironment | undefined {
  if (value === undefined) return undefined

  if (
    SCREENCI_ENVIRONMENT_OPTION_VALUES.includes(value as ScreenCIEnvironment)
  ) {
    return value as ScreenCIEnvironment
  }

  throw new Error(
    `Invalid ${SCREENCI_ENVIRONMENT_VARIABLE} "${value}". Expected one of: ${SCREENCI_ENVIRONMENT_OPTION_VALUES.join(', ')}`
  )
}

export function getScreenCIEnvironment(): ScreenCIEnvironment {
  const parsed = parseScreenCIEnvironment(
    process.env[SCREENCI_ENVIRONMENT_VARIABLE]
  )
  return parsed ?? 'prod'
}

export function getDevBackendUrl(): string {
  switch (getScreenCIEnvironment()) {
    case 'local': {
      const devBackendPort = process.env.DEV_BACKEND_PORT
      return devBackendPort
        ? `http://localhost:${devBackendPort}`
        : 'http://localhost:8787'
    }
    case 'dev':
      return SCREENCI_DEVELOPMENT_BACKEND_URL
    case 'prod':
      return SCREENCI_PRODUCTION_BACKEND_URL
  }
}

export function getDevFrontendUrl(): string {
  switch (getScreenCIEnvironment()) {
    case 'local': {
      const devFrontendPort = process.env.DEV_FRONTEND_PORT
      return devFrontendPort
        ? `http://localhost:${devFrontendPort}`
        : 'http://localhost:5173'
    }
    case 'dev':
      return SCREENCI_DEVELOPMENT_FRONTEND_URL
    case 'prod':
      return SCREENCI_PRODUCTION_FRONTEND_URL
  }
}

export function getCliLinkSessionApiUrl(): string {
  // The `/cli-link/*` routes are proxied by the backend to the upstream Convex
  // service, so the CLI targets the backend host directly (the CLI runs under
  // Node, so there is no CORS constraint to route around the frontend origin).
  return getDevBackendUrl()
}

export function getScreenCISecretsUrl(): string {
  return `${getDevFrontendUrl()}/secrets`
}

export function getScreenCIGetStartedUrl(): string {
  return `${getDevFrontendUrl()}/get-started`
}

export function looksLikeScreenCISecret(value: string): boolean {
  return SCREENCI_SECRET_PATTERN.test(value.trim())
}

export type VerifyScreenCISecretResult =
  | { ok: true; orgId: string }
  | { ok: false; kind: 'invalid' | 'unreachable'; reason: string }

/**
 * Verifies a pasted SCREENCI_SECRET against the backend so init can confirm it
 * before writing `.env`. `GET /cli/whoami` is gated by the same secret
 * middleware as every other `/cli/*` route: a valid secret returns the org id,
 * an unknown one returns 401. Never throws; a network failure resolves to
 * `unreachable` so the caller can accept the secret optimistically (record
 * verifies it later) rather than block scaffolding.
 */
export async function verifyScreenCISecret(
  secret: string,
  options: { backendUrl?: string; fetchImpl?: typeof fetch } = {}
): Promise<VerifyScreenCISecretResult> {
  const backendUrl = options.backendUrl ?? getDevBackendUrl()
  const fetchImpl = options.fetchImpl ?? fetch

  try {
    const response = await fetchImpl(`${backendUrl}/cli/whoami`, {
      method: 'GET',
      headers: { 'X-ScreenCI-Secret': secret },
    })

    if (response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        orgId?: string
      }
      return { ok: true, orgId: body.orgId ?? '' }
    }

    return {
      ok: false,
      kind: 'invalid',
      reason: 'This secret was not recognized.',
    }
  } catch (err) {
    return {
      ok: false,
      kind: 'unreachable',
      reason: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Writes (or replaces) a `KEY=` line in the given env file, preserving the
 * position of an existing entry and any surrounding lines.
 */
async function persistEnvVar(
  envFilePath: string,
  key: string,
  value: string
): Promise<void> {
  const prefix = `${key}=`
  const nextLine = `${prefix}${value}`

  try {
    const existing = await readFile(envFilePath, 'utf-8')
    const lines = existing === '' ? [] : existing.split(/\r?\n/)
    const firstIndex = lines.findIndex((line) => line.startsWith(prefix))
    const linesWithoutKey = lines.filter((line) => !line.startsWith(prefix))
    const finalLines =
      firstIndex >= 0
        ? [
            ...linesWithoutKey.slice(0, firstIndex),
            nextLine,
            ...linesWithoutKey.slice(firstIndex),
          ]
        : [...linesWithoutKey, nextLine]
    let nextContent = finalLines.join('\n')
    if (!nextContent.endsWith('\n')) nextContent += '\n'
    await writeFile(envFilePath, nextContent)
    return
  } catch (err) {
    if (!isMissingFileError(err)) throw err
  }

  await writeFile(envFilePath, `${nextLine}\n`)
}

/**
 * Writes (or replaces) the `SCREENCI_SECRET=` line in the given env file,
 * preserving the position of an existing entry and any surrounding lines.
 */
export async function persistScreenCISecret(
  envFilePath: string,
  secret: string
): Promise<void> {
  await persistEnvVar(envFilePath, 'SCREENCI_SECRET', secret)
}

/**
 * Writes (or replaces) the `SCREENCI_EDIT_TOKEN=` line in the given env file.
 * Used by the claimed-trial self-upgrade so a running anonymous `screenci
 * edit` keeps working with the real personal editor token after sign-up.
 */
export async function persistScreenCIEditToken(
  envFilePath: string,
  editToken: string
): Promise<void> {
  await persistEnvVar(envFilePath, 'SCREENCI_EDIT_TOKEN', editToken)
}
