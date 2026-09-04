import { existsSync, mkdirSync } from 'fs'
import { readFile, writeFile, unlink } from 'fs/promises'
import { randomUUID } from 'crypto'
import { resolve } from 'path'
import { getDevBackendUrl } from './linkSession.js'

// Anonymous CLI trial: `screenci export` with no SCREENCI_SECRET uploads
// under a locally generated token instead of requiring an account up front.
// The token lives only in `.screenci/anon-session.json` and, server-side, in
// the anonymousSessions table (never printed or embedded in any URL).

// The anon session token file lives directly inside `.screenci/`, alongside
// the per-recording directories. It must survive the per-run wipe of that
// directory (see clearRecordingDirectories), or every `record` would mint a
// fresh trial and the claim and auto-graduate flows would break. Exported so
// the wipe can preserve it by name.
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
  return `Recording during an anonymous trial agrees to the terms: ${SCREENCI_TERMS_URL}`
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

type AnonSessionFile = { token: string }

async function readAnonSessionFile(
  screenciDir: string
): Promise<AnonSessionFile | null> {
  try {
    const raw = await readFile(getAnonSessionFilePath(screenciDir), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<AnonSessionFile>
    if (typeof parsed.token !== 'string') return null
    return { token: parsed.token }
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
 * Reads the locally stored anon session token without ever creating one.
 * Used by side-effect-free flows (the pre-run edit sync in test/export) that
 * must not start a trial on their own.
 */
export async function peekAnonToken(
  screenciDir: string
): Promise<string | null> {
  const existing = await readAnonSessionFile(screenciDir)
  return existing?.token ?? null
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

/** A single-line notice shown after an anonymous recording succeeds. */
export function formatAnonPostRecordNotice(): string {
  return 'Recorded without an account. Preview and edit for free; sign up with a plan to export the finished video.'
}

export type AnonSessionStatus =
  | { status: 'not_found' }
  | { status: 'expired' }
  // Anonymous trials are preview-only and uncapped. The server's legacy
  // `used`/`remaining` wire fields are ignored.
  | { status: 'pending' }
  | { status: 'claimed'; secret: string }

/**
 * Checks the server-side status of a locally stored anon token: still pending,
 * claimed (the CLI should self-upgrade to the real secret), or expired/not
 * found. Defaults to `pending` on a network failure so a transient outage
 * doesn't block an otherwise-working first anonymous upload.
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
    }

    if (body.status === 'claimed' && typeof body.secret === 'string') {
      return {
        status: 'claimed',
        secret: body.secret,
      }
    }
    if (body.status === 'expired') return { status: 'expired' }
    if (body.status === 'not_found') return { status: 'not_found' }
    return { status: 'pending' }
  } catch {
    return { status: 'pending' }
  }
}

export type AnonRecordingGate =
  { allowed: true } | { allowed: false; reason: 'expired' }

/**
 * Decides whether a fresh anonymous `record` is allowed to START, given the
 * session's current status. Anonymous trials are preview-only and uncapped,
 * so only an expired session refuses (the user is told to sign up up front,
 * rather than silently minting a new trial or failing after the whole
 * recording ran). A first-run token the server has not seen yet (`not_found`),
 * a pending session, and a `claimed` session (the upload path self-upgrades
 * to the real secret) all proceed.
 */
export function evaluateAnonRecordingGate(
  status: AnonSessionStatus
): AnonRecordingGate {
  if (status.status === 'expired') return { allowed: false, reason: 'expired' }
  return { allowed: true }
}
