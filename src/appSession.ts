import { existsSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'

/**
 * The signed-in browser session a recording replays instead of scripting a
 * sign-in. It is a Playwright `storageState` JSON (cookies plus local and
 * IndexedDB storage) that `screenci login` captures from a real browser the
 * person signed into themselves, so 2FA, SSO, passkeys, and magic links all
 * work without screenci ever seeing a credential.
 *
 * The file never leaves the machine that produced it: it is written under the
 * workspace's gitignored `.screenci/auth/`, owner-readable only, and its
 * contents are never logged, uploaded, or shown to an agent. Treat it exactly
 * like the password it stands in for.
 */

/** Points a run at a session file directly. The CI path, and the escape hatch. */
export const APP_SESSION_PATH_ENV = 'SCREENCI_APP_STORAGE_STATE'

/** Picks a named session for a run without editing the config. */
export const APP_SESSION_PROFILE_ENV = 'SCREENCI_AUTH_PROFILE'

/** The profile `screenci login` writes when none is named. */
export const DEFAULT_APP_SESSION_PROFILE = 'default'

/**
 * The session directory's own name, inside `.screenci/`. Exported so the
 * per-run wipe of `.screenci/` (clearRecordingDirectories) can preserve it:
 * wiping it would sign every recording out again after the first run.
 */
export const APP_SESSION_DIR_NAME = 'auth'

/** Where sessions live, relative to the directory holding `screenci.config.ts`. */
export const APP_SESSION_DIR = join('.screenci', APP_SESSION_DIR_NAME)

/** Owner read/write only: the file is a bearer credential. */
export const APP_SESSION_FILE_MODE = 0o600

/** Owner-only directory, so a session file cannot be listed by other users. */
export const APP_SESSION_DIR_MODE = 0o700

/** Profiles name files, so keep them to a boring, path-safe alphabet. */
const PROFILE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/

export function isValidProfileName(profile: string): boolean {
  return profile.length <= 64 && PROFILE_PATTERN.test(profile)
}

export function assertValidProfileName(profile: string): void {
  if (!isValidProfileName(profile)) {
    throw new Error(
      `"${profile}" is not a usable profile name. Use letters, digits, dots, dashes, and underscores, starting with a letter or digit.`
    )
  }
}

export function appSessionDir(configDir: string): string {
  return join(configDir, APP_SESSION_DIR)
}

export function appSessionStatePath(
  configDir: string,
  profile: string
): string {
  return join(appSessionDir(configDir), `${profile}.json`)
}

export function appSessionMetaPath(configDir: string, profile: string): string {
  return join(appSessionDir(configDir), `${profile}.meta.json`)
}

/** Bookkeeping for a browser `screenci login` left open, per profile. */
export function loginHandshakePath(configDir: string, profile: string): string {
  return join(appSessionDir(configDir), `.login-${profile}.json`)
}

/** The file `screenci login --done` drops for the waiting browser to notice. */
export function loginDoneSignalPath(
  configDir: string,
  profile: string
): string {
  return join(appSessionDir(configDir), `.login-${profile}.done`)
}

/** The file `screenci login --cancel` drops to close the browser unsaved. */
export function loginCancelSignalPath(
  configDir: string,
  profile: string
): string {
  return join(appSessionDir(configDir), `.login-${profile}.cancel`)
}

/** How the browser said it ended, for `--done` to report accurately. */
export function loginResultPath(configDir: string, profile: string): string {
  return join(appSessionDir(configDir), `.login-${profile}.result`)
}

export function loginLogPath(configDir: string, profile: string): string {
  return join(appSessionDir(configDir), `.login-${profile}.log`)
}

/** The profile a run should use: an explicit name, else the env var, else `default`. */
export function resolveProfileName(
  explicit: string | undefined,
  env: NodeJS.ProcessEnv = process.env
): string {
  const profile =
    explicit ?? env[APP_SESSION_PROFILE_ENV] ?? DEFAULT_APP_SESSION_PROFILE
  assertValidProfileName(profile)
  return profile
}

export type AppSessionSource = 'config' | 'env' | 'file' | 'none'

export type ResolvedAppSession = {
  source: AppSessionSource
  /** Absolute path to the storageState file, or null when nothing applies. */
  path: string | null
}

/**
 * Which session a run replays. An explicit `use.storageState` in the config
 * always wins, then {@link APP_SESSION_PATH_ENV} (how CI supplies one), then
 * the profile's file under `.screenci/auth/` when it exists.
 */
export function resolveAppSession(params: {
  configDir: string
  configuredStorageState?: unknown
  profile?: string | undefined
  env?: NodeJS.ProcessEnv
  exists: (path: string) => boolean
}): ResolvedAppSession {
  const env = params.env ?? process.env
  if (params.configuredStorageState !== undefined) {
    return { source: 'config', path: null }
  }
  const fromEnv = env[APP_SESSION_PATH_ENV]
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return {
      source: 'env',
      path: isAbsolute(fromEnv) ? fromEnv : resolve(params.configDir, fromEnv),
    }
  }
  const profile = resolveProfileName(params.profile, env)
  const path = appSessionStatePath(params.configDir, profile)
  if (!params.exists(path)) return { source: 'none', path: null }
  return { source: 'file', path }
}

export type AppSessionMeta = {
  profile: string
  /** Origin the person signed into, e.g. `https://app.example.com`. */
  origin: string | null
  /** ISO timestamp of the capture. */
  savedAt: string
  /** ISO timestamp the last dated cookie dies, or null when none is dated. */
  expiresAt: string | null
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** Tolerant parse: a meta file from an older CLI must not break a run. */
export function parseAppSessionMeta(
  content: string,
  fallbackProfile: string
): AppSessionMeta | null {
  let value: unknown
  try {
    value = JSON.parse(content)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  const savedAt = optionalString(v.savedAt)
  if (savedAt === null) return null
  return {
    profile: optionalString(v.profile) ?? fallbackProfile,
    origin: optionalString(v.origin),
    savedAt,
    expiresAt: optionalString(v.expiresAt),
  }
}

/** `https://app.example.com` from any URL, or null when it is not one. */
export function originOf(url: string): string | null {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

/**
 * When the last dated cookie in a storageState dies, as an ISO timestamp.
 * Session cookies carry `expires: -1` and are ignored: they say nothing about
 * how long the session lasts. Null means the file dates nothing, so staleness
 * cannot be judged and the run proceeds without a warning.
 */
export function storageStateExpiry(content: string): string | null {
  let value: unknown
  try {
    value = JSON.parse(content)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const cookies = (value as Record<string, unknown>).cookies
  if (!Array.isArray(cookies)) return null
  let latest: number | null = null
  for (const cookie of cookies) {
    if (typeof cookie !== 'object' || cookie === null) continue
    const expires = (cookie as Record<string, unknown>).expires
    if (typeof expires !== 'number' || expires <= 0) continue
    if (latest === null || expires > latest) latest = expires
  }
  if (latest === null) return null
  return new Date(latest * 1000).toISOString()
}

export function isAppSessionExpired(
  meta: Pick<AppSessionMeta, 'expiresAt'>,
  now: Date
): boolean {
  if (meta.expiresAt === null) return false
  const expiry = Date.parse(meta.expiresAt)
  return Number.isFinite(expiry) && expiry <= now.getTime()
}

/** "3 days ago" / "22 hours ago", for status output. */
export function formatAge(savedAt: string, now: Date): string {
  const saved = Date.parse(savedAt)
  if (!Number.isFinite(saved)) return 'at an unknown time'
  const seconds = Math.max(0, Math.round((now.getTime() - saved) / 1000))
  if (seconds < 90) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 90) return `${minutes} minutes ago`
  const hours = Math.round(minutes / 60)
  if (hours < 36) return `${hours} hours ago`
  const days = Math.round(hours / 24)
  return `${days} days ago`
}

export type AppSessionFsDeps = {
  readFile: (path: string) => Promise<string | null>
  writeFile: (path: string, content: string, mode: number) => Promise<void>
  mkdir: (path: string) => Promise<void>
  remove: (path: string) => Promise<void>
  exists: (path: string) => boolean
}

export const defaultAppSessionFsDeps: AppSessionFsDeps = {
  readFile: async (path) => {
    try {
      const { readFile } = await import('node:fs/promises')
      return await readFile(path, 'utf-8')
    } catch {
      return null
    }
  },
  writeFile: async (path, content, mode) => {
    const { chmod, mkdir, writeFile } = await import('node:fs/promises')
    await mkdir(dirname(path), { recursive: true, mode: APP_SESSION_DIR_MODE })
    await writeFile(path, content, { encoding: 'utf-8', mode })
    // `writeFile`'s mode applies only when it creates the file. Overwriting a
    // session restored from a backup, copied in, or written by an older build
    // would otherwise keep whatever permissions it arrived with, leaving a
    // bearer credential world-readable on a shared machine.
    await chmod(path, mode)
  },
  mkdir: async (path) => {
    const { mkdir } = await import('node:fs/promises')
    await mkdir(path, { recursive: true, mode: APP_SESSION_DIR_MODE })
  },
  remove: async (path) => {
    const { rm } = await import('node:fs/promises')
    await rm(path, { force: true })
  },
  // Sync on purpose: `defineConfig` resolves the session while the config
  // module is still evaluating, which cannot await.
  exists: (path) => existsSync(path),
}

export type AppSessionStatus =
  | { saved: false }
  | { saved: true; path: string; meta: AppSessionMeta | null; expired: boolean }

/** What `--status`, `screenci context`, and the run-time warning all read. */
export async function readAppSessionStatus(
  params: { configDir: string; profile: string; now: Date },
  deps: AppSessionFsDeps = defaultAppSessionFsDeps
): Promise<AppSessionStatus> {
  const path = appSessionStatePath(params.configDir, params.profile)
  if (!deps.exists(path)) return { saved: false }
  const metaContent = await deps.readFile(
    appSessionMetaPath(params.configDir, params.profile)
  )
  const meta =
    metaContent === null
      ? null
      : parseAppSessionMeta(metaContent, params.profile)
  return {
    saved: true,
    path,
    meta,
    expired: meta === null ? false : isAppSessionExpired(meta, params.now),
  }
}

/** One line for humans. Never includes anything from inside the session file. */
export function describeAppSessionStatus(
  status: AppSessionStatus,
  now: Date
): string {
  if (!status.saved) return 'No signed-in session is saved.'
  const where =
    status.meta?.origin !== null && status.meta?.origin !== undefined
      ? ` for ${status.meta.origin}`
      : ''
  const when =
    status.meta !== null
      ? ` (saved ${formatAge(status.meta.savedAt, now)})`
      : ''
  if (status.expired) {
    return `The saved session${where} expired${when}.`
  }
  return `A signed-in session is saved${where}${when}.`
}

/** Writes the session and its metadata, owner-only, creating the auth dir. */
export async function writeAppSession(
  params: {
    configDir: string
    profile: string
    stateJson: string
    origin: string | null
    savedAt: Date
  },
  deps: AppSessionFsDeps = defaultAppSessionFsDeps
): Promise<{ statePath: string; metaPath: string; meta: AppSessionMeta }> {
  const statePath = appSessionStatePath(params.configDir, params.profile)
  const metaPath = appSessionMetaPath(params.configDir, params.profile)
  const meta: AppSessionMeta = {
    profile: params.profile,
    origin: params.origin,
    savedAt: params.savedAt.toISOString(),
    expiresAt: storageStateExpiry(params.stateJson),
  }
  await deps.writeFile(statePath, params.stateJson, APP_SESSION_FILE_MODE)
  await deps.writeFile(
    metaPath,
    `${JSON.stringify(meta, null, 2)}\n`,
    APP_SESSION_FILE_MODE
  )
  return { statePath, metaPath, meta }
}

export async function deleteAppSession(
  params: { configDir: string; profile: string },
  deps: AppSessionFsDeps = defaultAppSessionFsDeps
): Promise<boolean> {
  const statePath = appSessionStatePath(params.configDir, params.profile)
  const existed = deps.exists(statePath)
  await deps.remove(statePath)
  await deps.remove(appSessionMetaPath(params.configDir, params.profile))
  return existed
}
