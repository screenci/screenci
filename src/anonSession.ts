import { existsSync, mkdirSync } from 'fs'
import { readFile, writeFile, unlink } from 'fs/promises'
import { randomUUID } from 'crypto'
import { resolve } from 'path'
import { getDevBackendUrl } from './linkSession.js'

// Anonymous CLI trial: `screenci record` with no SCREENCI_SECRET uploads
// under a locally generated token instead of requiring an account up front.
// The token lives only in `.screenci/anon-session.json` and, server-side, in
// the anonymousSessions table (never printed or embedded in any URL).

// The anon session token file lives directly inside `.screenci/`, alongside
// the per-recording directories. It must survive the per-run wipe of that
// directory (see clearRecordingDirectories), or every `record` would mint a
// fresh trial and the one-recording cap, claim, and auto-graduate would all
// break. Exported so the wipe can preserve it by name.
export const ANON_SESSION_FILE = 'anon-session.json'

export const ANON_TOKEN_HEADER = 'X-ScreenCI-Anon-Token'
export const SECRET_HEADER = 'X-ScreenCI-Secret'

// Canonical Terms of Service URL. Hardcoded like the docs links elsewhere in
// the CLI (the legal pages are not environment-specific). Anonymous trial
// recordings upload to our servers without an account, so the CLI surfaces this
// up front (before recording) and again in the post-upload summary. Signed-in
// users accept the versioned Terms server-side in the web app instead.
export const SCREENCI_TERMS_URL = 'https://screenci.com/legal/tos'

/**
 * Single-line browsewrap notice shown on the anonymous trial path. Kept pure
 * (no logger dependency) so it is trivially unit-testable and reusable in both
 * the up-front record gate and the post-upload summary.
 */
export function formatAnonTermsNotice(): string {
  return `Recording during an anonymous trial agrees to the Terms: ${SCREENCI_TERMS_URL}`
}

export type CliCredential =
  | { header: typeof SECRET_HEADER; value: string }
  | { header: typeof ANON_TOKEN_HEADER; value: string }

export function secretCredential(secret: string): CliCredential {
  return { header: SECRET_HEADER, value: secret }
}

export function anonCredential(token: string): CliCredential {
  return { header: ANON_TOKEN_HEADER, value: token }
}

function getAnonSessionFilePath(screenciDir: string): string {
  return resolve(screenciDir, ANON_SESSION_FILE)
}

type AnonSessionFile = { token: string; recordUrl?: string }

async function readAnonSessionFile(
  screenciDir: string
): Promise<AnonSessionFile | null> {
  try {
    const raw = await readFile(getAnonSessionFilePath(screenciDir), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<AnonSessionFile>
    if (typeof parsed.token !== 'string') return null
    return {
      token: parsed.token,
      ...(typeof parsed.recordUrl === 'string'
        ? { recordUrl: parsed.recordUrl }
        : {}),
    }
  } catch {
    return null
  }
}

async function writeAnonSessionFile(
  screenciDir: string,
  session: AnonSessionFile
): Promise<void> {
  mkdirSync(screenciDir, { recursive: true })
  await writeFile(
    getAnonSessionFilePath(screenciDir),
    `${JSON.stringify(session satisfies AnonSessionFile, null, 2)}\n`
  )
}

export async function deleteAnonSessionFile(
  screenciDir: string
): Promise<void> {
  const path = getAnonSessionFilePath(screenciDir)
  if (!existsSync(path)) return
  try {
    await unlink(path)
  } catch {
    // Best-effort: a stale file left behind is harmless (a fresh token is
    // minted on the next read if this one still resolves as expired).
  }
}

/**
 * Reads the locally stored anon session token, minting and persisting a new
 * one on first use in this project directory. Reused across every subsequent
 * `record` so multiple videos land under the same anonymous trial.
 */
export async function getOrCreateAnonToken(
  screenciDir: string
): Promise<string> {
  const existing = await readAnonSessionFile(screenciDir)
  if (existing) return existing.token

  const token = randomUUID()
  await writeAnonSessionFile(screenciDir, { token })
  return token
}

/**
 * Remembers the successful anonymous recording URL locally so a second
 * anonymous `record` attempt can point back to the trial recording instead of
 * only showing the sign-up URL.
 */
export async function saveAnonSessionRecordUrl(
  screenciDir: string,
  token: string,
  recordUrl: string
): Promise<void> {
  const existing = await readAnonSessionFile(screenciDir)
  await writeAnonSessionFile(screenciDir, {
    ...(existing?.token === token ? existing : {}),
    token,
    recordUrl,
  })
}

export async function readAnonSessionRecordUrl(
  screenciDir: string
): Promise<string | null> {
  const existing = await readAnonSessionFile(screenciDir)
  return existing?.recordUrl ?? null
}

// How many separate `screenci record` runs an anonymous trial may upload before
// it must sign up. Kept in sync with ANON_MAX_RECORDINGS server-side.
export const ANON_MAX_RECORDINGS = 3

/** A short "N recordings left" phrase for the anonymous trial. */
export function formatAnonRecordingsLeft(remaining: number): string {
  if (remaining <= 0) {
    return 'That was your last free trial recording. Sign up to record more.'
  }
  return `${remaining} free trial recording${
    remaining === 1 ? '' : 's'
  } left. Sign up to record without limits.`
}

/** A single-line notice shown after an anonymous recording succeeds. */
export function formatAnonPostRecordNotice(remaining: number): string {
  if (remaining <= 0) {
    return 'Recorded without an account. That was your last free trial recording. Sign up to keep it and record more.'
  }
  return `Recorded without an account. ${remaining} free trial recording${
    remaining === 1 ? '' : 's'
  } left. Sign up to keep it and record without limits.`
}

export type AnonSessionStatus =
  | { status: 'not_found' }
  | { status: 'expired' }
  // `used`: all trial recordings are spent. `remaining`: how many are left.
  | { status: 'pending'; used: boolean; remaining: number }
  | { status: 'claimed'; secret: string }

/**
 * Checks the server-side status of a locally stored anon token: still pending
 * (with `used` telling whether the one free trial recording is already spent),
 * claimed (the CLI should self-upgrade to the real secret), or expired/not
 * found. Defaults to a fresh, unused `pending` on a network failure so a
 * transient outage doesn't block an otherwise-working first anonymous upload.
 */
export async function checkAnonSessionStatus(
  token: string,
  options: { backendUrl?: string; fetchImpl?: typeof fetch } = {}
): Promise<AnonSessionStatus> {
  const backendUrl = options.backendUrl ?? getDevBackendUrl()
  const fetchImpl = options.fetchImpl ?? fetch

  try {
    const response = await fetchImpl(`${backendUrl}/cli/anon-session-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
    const body = (await response.json().catch(() => ({}))) as {
      status?: string
      secret?: string
      used?: boolean
      remaining?: number
    }

    if (body.status === 'claimed' && typeof body.secret === 'string') {
      return { status: 'claimed', secret: body.secret }
    }
    if (body.status === 'expired') return { status: 'expired' }
    if (body.status === 'not_found') return { status: 'not_found' }
    const remaining =
      typeof body.remaining === 'number'
        ? body.remaining
        : body.used === true
          ? 0
          : ANON_MAX_RECORDINGS
    return { status: 'pending', used: remaining <= 0, remaining }
  } catch {
    return { status: 'pending', used: false, remaining: ANON_MAX_RECORDINGS }
  }
}

export type AnonRecordingGate =
  | { allowed: true }
  | { allowed: false; reason: 'used' | 'expired' }

/**
 * Decides whether a fresh anonymous `record` is allowed to START, given the
 * session's current status. An anonymous trial gets up to ANON_MAX_RECORDINGS
 * recordings: once all are used (a pending session that has spent its trial) or
 * the session has expired, a further recording is refused up front so the user
 * is told to sign up before anything renders, rather than silently minting a new
 * trial or only failing after the whole recording ran. A first-run token the
 * server has not seen yet (`not_found`), a pending session with recordings left,
 * and a `claimed` session (the upload path self-upgrades to the real secret) all
 * proceed.
 */
export function evaluateAnonRecordingGate(
  status: AnonSessionStatus
): AnonRecordingGate {
  if (status.status === 'expired') return { allowed: false, reason: 'expired' }
  if (status.status === 'pending' && status.used) {
    return { allowed: false, reason: 'used' }
  }
  return { allowed: true }
}
