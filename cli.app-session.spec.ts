import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { clearRecordingDirectories, warnIfAppSessionExpired } from './cli.js'
import { logger } from './src/logger.js'

/**
 * How a record run treats the session `screenci login` saved: it must survive
 * the per-run wipe of `.screenci/`, and an expired one must be called out
 * before Playwright starts, since the recording would otherwise quietly show a
 * signed-out app. Real temp directories, no fs mocks: the wipe is the thing
 * under test.
 */

function workspace(): string {
  return mkdtempSync(join(tmpdir(), 'screenci-session-'))
}

function writeSession(
  dir: string,
  meta: { origin: string; savedAt: string; expiresAt: string | null }
): void {
  const auth = join(dir, '.screenci', 'auth')
  mkdirSync(auth, { recursive: true })
  writeFileSync(join(auth, 'default.json'), '{"cookies":[],"origins":[]}')
  writeFileSync(
    join(auth, 'default.meta.json'),
    JSON.stringify({ profile: 'default', ...meta })
  )
}

describe('clearRecordingDirectories', () => {
  it('keeps the saved sign-in session across runs', () => {
    const dir = workspace()
    const screenciDir = join(dir, '.screenci')
    writeSession(dir, {
      origin: 'https://app.example.com',
      savedAt: '2026-09-01T00:00:00.000Z',
      expiresAt: null,
    })

    clearRecordingDirectories(screenciDir)

    // Without this, every recording after the first would be signed out again.
    expect(existsSync(join(screenciDir, 'auth', 'default.json'))).toBe(true)
    expect(existsSync(join(screenciDir, 'auth', 'default.meta.json'))).toBe(
      true
    )
  })

  it('still wipes an ordinary recording directory beside it', () => {
    const dir = workspace()
    const screenciDir = join(dir, '.screenci')
    writeSession(dir, {
      origin: 'https://app.example.com',
      savedAt: '2026-09-01T00:00:00.000Z',
      expiresAt: null,
    })
    mkdirSync(join(screenciDir, 'stale-run'), { recursive: true })
    writeFileSync(join(screenciDir, 'stale-run', 'recording.mp4'), 'x')

    clearRecordingDirectories(screenciDir)

    expect(existsSync(join(screenciDir, 'stale-run'))).toBe(false)
    expect(existsSync(join(screenciDir, 'auth', 'default.json'))).toBe(true)
  })
})

describe('warnIfAppSessionExpired', () => {
  const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})

  afterEach(() => warn.mockClear())

  it('says nothing when no session was ever saved', async () => {
    await warnIfAppSessionExpired(workspace())
    expect(warn).not.toHaveBeenCalled()
  })

  it('says nothing about a session that is still good', async () => {
    const dir = workspace()
    writeSession(dir, {
      origin: 'https://app.example.com',
      savedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    })
    await warnIfAppSessionExpired(dir)
    expect(warn).not.toHaveBeenCalled()
  })

  it('names the site and the fix when the session expired', async () => {
    const dir = workspace()
    writeSession(dir, {
      origin: 'https://app.example.com',
      savedAt: '2026-08-01T00:00:00.000Z',
      expiresAt: '2026-08-30T00:00:00.000Z',
    })
    await warnIfAppSessionExpired(dir)
    expect(warn).toHaveBeenCalledTimes(1)
    const message = String(warn.mock.calls[0]?.[0])
    expect(message).toContain('https://app.example.com')
    expect(message).toContain('npx screenci login')
    expect(message).toContain('signed-out app')
  })
})
