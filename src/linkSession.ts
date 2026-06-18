import { mkdirSync, rmSync } from 'fs'
import { readFile, writeFile } from 'fs/promises'
import { dirname, resolve } from 'path'
import { logger } from './logger.js'

// Shared CLI link-session logic used by both the `screenci` CLI (record/test)
// and `screenci init`. Keeping it here lets init pre-create a sign-in session
// and persist it so a later `record` reuses the same link, without init having
// to import the CLI entrypoint (which would create a circular dependency).

const SCREENCI_ENVIRONMENT_VARIABLE = 'SCREENCI_ENVIRONMENT'
const SCREENCI_ENVIRONMENT_OPTION_VALUES = ['local', 'dev', 'prod'] as const
const SCREENCI_PRODUCTION_BACKEND_URL = 'https://api.screenci.com'
const SCREENCI_PRODUCTION_FRONTEND_URL = 'https://app.screenci.com'
const SCREENCI_DEVELOPMENT_BACKEND_URL = 'https://dev.api.screenci.com'
const SCREENCI_DEVELOPMENT_FRONTEND_URL = 'https://dev.app.screenci.com'

export const SCREENCI_LINK_SESSION_FILE = 'link-session.json'

export type ScreenCIEnvironment =
  (typeof SCREENCI_ENVIRONMENT_OPTION_VALUES)[number]

export type LinkSessionStatus =
  | 'pending'
  | 'completed'
  | 'consumed'
  | 'expired'
  | 'invalid'

export type PersistedLinkSessionSpec = {
  token: string
  appUrl: string
  pollUrl: string
  createdAt: string
  expiresAt: string
  environment: ScreenCIEnvironment
  resolvedConfigPath?: string
  envFilePath: string
}

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
  // The `/cli-link/session` routes are Convex HTTP actions served from the same
  // backend host as the `/cli/*` upload endpoints. We hit that host directly
  // rather than the frontend: the frontend only forwards these routes via the
  // vite dev-server proxy, which does not exist on the hosted dev/prod frontend
  // (a POST there returns 405). The CLI runs under Node, so there is no CORS
  // constraint that would require going through the frontend origin.
  return getDevBackendUrl()
}

export function getLinkSessionFilePath(projectDir: string): string {
  return resolve(projectDir, '.screenci', SCREENCI_LINK_SESSION_FILE)
}

export async function readPersistedLinkSessionSpec(
  specPath: string
): Promise<PersistedLinkSessionSpec | null> {
  try {
    const raw = await readFile(specPath, 'utf-8')
    return JSON.parse(raw) as PersistedLinkSessionSpec
  } catch (error) {
    if (!isMissingFileError(error)) {
      logger.warn(`Ignoring invalid stored link session at ${specPath}.`)
      rmSync(specPath, { force: true })
    }
    return null
  }
}

export async function writePersistedLinkSessionSpec(
  specPath: string,
  spec: PersistedLinkSessionSpec
): Promise<void> {
  mkdirSync(dirname(specPath), { recursive: true })
  await writeFile(specPath, `${JSON.stringify(spec, null, 2)}\n`)
}

export function deletePersistedLinkSessionSpec(specPath: string): void {
  rmSync(specPath, { force: true })
}

export function isStoredLinkSessionReusable(
  spec: PersistedLinkSessionSpec,
  options: {
    environment: ScreenCIEnvironment
    resolvedConfigPath?: string
    envFilePath: string
  }
): boolean {
  return (
    spec.environment === options.environment &&
    spec.envFilePath === options.envFilePath &&
    spec.resolvedConfigPath === options.resolvedConfigPath &&
    spec.expiresAt > new Date().toISOString()
  )
}

export async function createLinkSessionSpec(options: {
  apiUrl: string
  appUrl: string
  environment: ScreenCIEnvironment
  resolvedConfigPath?: string
  envFilePath: string
}): Promise<PersistedLinkSessionSpec> {
  const response = await fetch(`${options.apiUrl}/cli-link/session`, {
    method: 'POST',
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Failed to create link session: ${response.status} ${text}`)
  }

  const body = (await response.json()) as {
    token: string
    createdAt: string
    expiresAt: string
  }

  return {
    token: body.token,
    appUrl: `${options.appUrl}/cli-auth?session=${encodeURIComponent(body.token)}`,
    pollUrl: `${options.apiUrl}/cli-link/session?token=${encodeURIComponent(body.token)}`,
    createdAt: body.createdAt,
    expiresAt: body.expiresAt,
    environment: options.environment,
    ...(options.resolvedConfigPath
      ? { resolvedConfigPath: options.resolvedConfigPath }
      : {}),
    envFilePath: options.envFilePath,
  }
}
