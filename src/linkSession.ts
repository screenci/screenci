import { readFile, writeFile } from 'fs/promises'

// Shared CLI helpers for resolving the ScreenCI environment/URLs and for the
// init one-time-password (OTP) handoff. `screenci init` receives an OTP as its
// positional argument, swaps it for the org's default secret via
// `POST /cli-link/exchange`, and writes SCREENCI_SECRET into the project `.env`
// so `record` can upload immediately, no browser sign-in required.

const SCREENCI_ENVIRONMENT_VARIABLE = 'SCREENCI_ENVIRONMENT'
const SCREENCI_ENVIRONMENT_OPTION_VALUES = ['local', 'dev', 'prod'] as const
const SCREENCI_PRODUCTION_BACKEND_URL = 'https://api.screenci.com'
const SCREENCI_PRODUCTION_FRONTEND_URL = 'https://app.screenci.com'
const SCREENCI_DEVELOPMENT_BACKEND_URL = 'https://dev.api.screenci.com'
const SCREENCI_DEVELOPMENT_FRONTEND_URL = 'https://dev.app.screenci.com'

// Init OTPs are prefixed so the CLI can tell a one-time setup token apart from
// a project name passed as the same `init`/`create-screenci` positional.
export const INIT_OTP_PREFIX = 'otp_'

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

export function looksLikeInitOtp(value: string): boolean {
  return value.startsWith(INIT_OTP_PREFIX)
}

export type ExchangeInitOtpResult =
  | { ok: true; secret: string }
  | { ok: false; reason: string }

/**
 * Exchanges a one-time init token for the org's default SCREENCI_SECRET. The
 * token maps to a single-use, short-lived session, so a used or expired token
 * resolves to `{ ok: false }` and the caller falls back to guiding the user to
 * copy their secret from the secrets page. Never throws.
 */
export async function exchangeInitOtp(
  otp: string,
  options: { backendUrl?: string; fetchImpl?: typeof fetch } = {}
): Promise<ExchangeInitOtpResult> {
  const backendUrl = options.backendUrl ?? getDevBackendUrl()
  const fetchImpl = options.fetchImpl ?? fetch

  try {
    const response = await fetchImpl(`${backendUrl}/cli-link/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ otp }),
    })

    const body = (await response.json().catch(() => ({}))) as {
      status?: string
      secret?: string
    }

    if (response.ok && body.status === 'completed' && body.secret) {
      return { ok: true, secret: body.secret }
    }

    if (body.status === 'consumed') {
      return { ok: false, reason: 'This setup token has already been used.' }
    }
    if (body.status === 'expired') {
      return { ok: false, reason: 'This setup token has expired.' }
    }
    return { ok: false, reason: 'This setup token is invalid.' }
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Writes (or replaces) the `SCREENCI_SECRET=` line in the given env file,
 * preserving the position of an existing entry and any surrounding lines.
 */
export async function persistScreenCISecret(
  envFilePath: string,
  secret: string
): Promise<void> {
  const nextLine = `SCREENCI_SECRET=${secret}`

  try {
    const existing = await readFile(envFilePath, 'utf-8')
    const lines = existing === '' ? [] : existing.split(/\r?\n/)
    const firstSecretIndex = lines.findIndex((line) =>
      line.startsWith('SCREENCI_SECRET=')
    )
    const linesWithoutSecret = lines.filter(
      (line) => !line.startsWith('SCREENCI_SECRET=')
    )
    const finalLines =
      firstSecretIndex >= 0
        ? [
            ...linesWithoutSecret.slice(0, firstSecretIndex),
            nextLine,
            ...linesWithoutSecret.slice(firstSecretIndex),
          ]
        : [...linesWithoutSecret, nextLine]
    let nextContent = finalLines.join('\n')
    if (!nextContent.endsWith('\n')) nextContent += '\n'
    await writeFile(envFilePath, nextContent)
    return
  } catch (err) {
    if (!isMissingFileError(err)) throw err
  }

  await writeFile(envFilePath, `${nextLine}\n`)
}
