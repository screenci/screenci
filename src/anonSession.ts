import { existsSync, mkdirSync } from 'fs'
import { readFile, writeFile, unlink } from 'fs/promises'
import { randomUUID } from 'crypto'
import { resolve } from 'path'
import { getDevBackendUrl } from './linkSession.js'

// Anonymous CLI trial: `screenci record` with no SCREENCI_SECRET uploads
// under a locally generated token instead of requiring an account up front.
// The token lives only in `.screenci/anon-session.json` and, server-side, in
// the anonymousSessions table (never printed or embedded in any URL).

const ANON_SESSION_FILE = 'anon-session.json'

export const ANON_TOKEN_HEADER = 'X-ScreenCI-Anon-Token'
export const SECRET_HEADER = 'X-ScreenCI-Secret'

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
): Promise<string | null> {
  try {
    const raw = await readFile(getAnonSessionFilePath(screenciDir), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<AnonSessionFile>
    return typeof parsed.token === 'string' ? parsed.token : null
  } catch {
    return null
  }
}

async function writeAnonSessionFile(
  screenciDir: string,
  token: string
): Promise<void> {
  mkdirSync(screenciDir, { recursive: true })
  await writeFile(
    getAnonSessionFilePath(screenciDir),
    `${JSON.stringify({ token } satisfies AnonSessionFile, null, 2)}\n`
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
  if (existing) return existing

  const token = randomUUID()
  await writeAnonSessionFile(screenciDir, token)
  return token
}

export type AnonSessionStatus =
  | { status: 'not_found' }
  | { status: 'expired' }
  | { status: 'pending' }
  | { status: 'claimed'; secret: string }

/**
 * Checks the server-side status of a locally stored anon token before every
 * upload attempt: still pending (proceed anonymously), claimed (the CLI
 * should self-upgrade to the real secret), or expired/not found (start a
 * fresh trial). Defaults to `pending` on a network failure so a transient
 * outage doesn't block an otherwise-working anonymous upload.
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
      return { status: 'claimed', secret: body.secret }
    }
    if (body.status === 'expired') return { status: 'expired' }
    if (body.status === 'not_found') return { status: 'not_found' }
    return { status: 'pending' }
  } catch {
    return { status: 'pending' }
  }
}
