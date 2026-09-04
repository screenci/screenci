import { mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  APP_SESSION_PATH_ENV,
  APP_SESSION_PROFILE_ENV,
  appSessionMetaPath,
  appSessionStatePath,
  describeAppSessionStatus,
  formatAge,
  isAppSessionExpired,
  isValidProfileName,
  originOf,
  parseAppSessionMeta,
  readAppSessionStatus,
  resolveAppSession,
  resolveProfileName,
  storageStateExpiry,
  writeAppSession,
  deleteAppSession,
  APP_SESSION_DIR,
  type AppSessionFsDeps,
} from './appSession.js'

const CONFIG_DIR = '/workspace/screenci'

function memDeps(files: Record<string, string> = {}): {
  deps: AppSessionFsDeps
  files: Record<string, string>
  modes: Record<string, number>
} {
  const store = { ...files }
  const modes: Record<string, number> = {}
  return {
    files: store,
    modes,
    deps: {
      readFile: async (path) => store[path] ?? null,
      writeFile: async (path, content, mode) => {
        store[path] = content
        modes[path] = mode
      },
      mkdir: async () => {},
      remove: async (path) => {
        delete store[path]
      },
      exists: (path) => store[path] !== undefined,
    },
  }
}

describe('profile names', () => {
  it('accepts boring path-safe names and rejects the rest', () => {
    expect(isValidProfileName('default')).toBe(true)
    expect(isValidProfileName('admin-2')).toBe(true)
    expect(isValidProfileName('qa.eu')).toBe(true)
    expect(isValidProfileName('../escape')).toBe(false)
    expect(isValidProfileName('has space')).toBe(false)
    expect(isValidProfileName('')).toBe(false)
    expect(isValidProfileName('.hidden')).toBe(false)
  })

  it('prefers the explicit name, then the env var, then default', () => {
    expect(resolveProfileName('admin', {})).toBe('admin')
    expect(
      resolveProfileName(undefined, { [APP_SESSION_PROFILE_ENV]: 'qa' })
    ).toBe('qa')
    expect(resolveProfileName(undefined, {})).toBe('default')
  })

  it('throws on a name that would escape the auth directory', () => {
    expect(() => resolveProfileName('../../etc/passwd', {})).toThrow(
      /not a usable profile name/
    )
  })
})

describe('resolveAppSession', () => {
  const statePath = appSessionStatePath(CONFIG_DIR, 'default')

  it('leaves an explicitly configured storageState alone', () => {
    const resolved = resolveAppSession({
      configDir: CONFIG_DIR,
      configuredStorageState: 'auth/user.json',
      env: {},
      exists: () => true,
    })
    expect(resolved).toEqual({ source: 'config', path: null })
  })

  it('honours the env var over the profile file, resolving it against the config dir', () => {
    const resolved = resolveAppSession({
      configDir: CONFIG_DIR,
      env: { [APP_SESSION_PATH_ENV]: 'ci/user.json' },
      exists: () => true,
    })
    expect(resolved).toEqual({
      source: 'env',
      path: join(CONFIG_DIR, 'ci/user.json'),
    })
  })

  it('keeps an absolute env path as given', () => {
    const resolved = resolveAppSession({
      configDir: CONFIG_DIR,
      env: { [APP_SESSION_PATH_ENV]: '/tmp/user.json' },
      exists: () => true,
    })
    expect(resolved.path).toBe('/tmp/user.json')
  })

  it('uses the profile file when it exists', () => {
    const resolved = resolveAppSession({
      configDir: CONFIG_DIR,
      env: {},
      exists: (path) => path === statePath,
    })
    expect(resolved).toEqual({ source: 'file', path: statePath })
  })

  it('picks the named profile from the env var', () => {
    const adminPath = appSessionStatePath(CONFIG_DIR, 'admin')
    const resolved = resolveAppSession({
      configDir: CONFIG_DIR,
      env: { [APP_SESSION_PROFILE_ENV]: 'admin' },
      exists: (path) => path === adminPath,
    })
    expect(resolved).toEqual({ source: 'file', path: adminPath })
  })

  it('resolves to nothing when no session was ever saved', () => {
    const resolved = resolveAppSession({
      configDir: CONFIG_DIR,
      env: {},
      exists: () => false,
    })
    expect(resolved).toEqual({ source: 'none', path: null })
  })

  it('ignores an empty env var rather than pointing at nothing', () => {
    const resolved = resolveAppSession({
      configDir: CONFIG_DIR,
      env: { [APP_SESSION_PATH_ENV]: '' },
      exists: () => false,
    })
    expect(resolved.source).toBe('none')
  })
})

describe('storageStateExpiry', () => {
  it('takes the last dated cookie', () => {
    const state = JSON.stringify({
      cookies: [
        { name: 'a', expires: 1_800_000_000 },
        { name: 'b', expires: 1_900_000_000 },
      ],
    })
    expect(storageStateExpiry(state)).toBe(
      new Date(1_900_000_000 * 1000).toISOString()
    )
  })

  it('ignores session cookies, which say nothing about how long the login lasts', () => {
    const state = JSON.stringify({ cookies: [{ name: 'a', expires: -1 }] })
    expect(storageStateExpiry(state)).toBeNull()
  })

  it('survives a file that is not a storageState', () => {
    expect(storageStateExpiry('not json')).toBeNull()
    expect(storageStateExpiry('{}')).toBeNull()
    expect(storageStateExpiry(JSON.stringify({ cookies: 'nope' }))).toBeNull()
  })
})

describe('expiry and age', () => {
  const now = new Date('2026-09-03T12:00:00.000Z')

  it('treats an undated session as never expired', () => {
    expect(isAppSessionExpired({ expiresAt: null }, now)).toBe(false)
  })

  it('expires only once the last cookie is in the past', () => {
    expect(
      isAppSessionExpired({ expiresAt: '2026-09-03T11:59:59.000Z' }, now)
    ).toBe(true)
    expect(
      isAppSessionExpired({ expiresAt: '2026-09-03T12:00:01.000Z' }, now)
    ).toBe(false)
  })

  it('describes the age in units a person reads', () => {
    expect(formatAge('2026-09-03T11:59:30.000Z', now)).toBe('just now')
    expect(formatAge('2026-09-03T11:00:00.000Z', now)).toBe('60 minutes ago')
    expect(formatAge('2026-09-02T12:00:00.000Z', now)).toBe('24 hours ago')
    expect(formatAge('2026-08-31T12:00:00.000Z', now)).toBe('3 days ago')
    expect(formatAge('nonsense', now)).toBe('at an unknown time')
  })
})

describe('meta parsing', () => {
  it('falls back to the asked-for profile and tolerates missing fields', () => {
    const meta = parseAppSessionMeta(
      JSON.stringify({ savedAt: '2026-09-01T00:00:00.000Z' }),
      'admin'
    )
    expect(meta).toEqual({
      profile: 'admin',
      origin: null,
      savedAt: '2026-09-01T00:00:00.000Z',
      expiresAt: null,
    })
  })

  it('rejects a meta file with no savedAt rather than inventing one', () => {
    expect(parseAppSessionMeta('{}', 'default')).toBeNull()
    expect(parseAppSessionMeta('broken', 'default')).toBeNull()
  })
})

describe('originOf', () => {
  it('keeps scheme, host, and port and drops the path', () => {
    expect(originOf('https://app.example.com/videos/1?x=2')).toBe(
      'https://app.example.com'
    )
    expect(originOf('http://localhost:3000/')).toBe('http://localhost:3000')
    expect(originOf('not a url')).toBeNull()
  })
})

describe('write / read / delete', () => {
  const now = new Date('2026-09-03T12:00:00.000Z')

  it('writes the state and its metadata owner-only', async () => {
    const { deps, files, modes } = memDeps()
    const stateJson = JSON.stringify({
      cookies: [{ name: 'session', expires: 1_900_000_000 }],
      origins: [],
    })
    const written = await writeAppSession(
      {
        configDir: CONFIG_DIR,
        profile: 'default',
        stateJson,
        origin: 'https://app.example.com',
        savedAt: now,
      },
      deps
    )
    expect(written.statePath).toBe(appSessionStatePath(CONFIG_DIR, 'default'))
    expect(files[written.statePath]).toBe(stateJson)
    expect(modes[written.statePath]).toBe(0o600)
    expect(modes[written.metaPath]).toBe(0o600)
    expect(written.meta.origin).toBe('https://app.example.com')
    expect(written.meta.expiresAt).toBe(
      new Date(1_900_000_000 * 1000).toISOString()
    )
  })

  it('reports no session before anything is saved', async () => {
    const { deps } = memDeps()
    await expect(
      readAppSessionStatus(
        { configDir: CONFIG_DIR, profile: 'default', now },
        deps
      )
    ).resolves.toEqual({ saved: false })
  })

  it('reports a saved session and whether it expired', async () => {
    const { deps } = memDeps({
      [appSessionStatePath(CONFIG_DIR, 'default')]: '{}',
      [appSessionMetaPath(CONFIG_DIR, 'default')]: JSON.stringify({
        profile: 'default',
        origin: 'https://app.example.com',
        savedAt: '2026-09-01T12:00:00.000Z',
        expiresAt: '2026-09-02T12:00:00.000Z',
      }),
    })
    const status = await readAppSessionStatus(
      { configDir: CONFIG_DIR, profile: 'default', now },
      deps
    )
    expect(status).toMatchObject({ saved: true, expired: true })
    expect(describeAppSessionStatus(status, now)).toBe(
      'The saved session for https://app.example.com expired (saved 2 days ago).'
    )
  })

  it('describes a live session without leaking anything from the file', async () => {
    const { deps } = memDeps({
      [appSessionStatePath(CONFIG_DIR, 'default')]: '{"cookies":[]}',
      [appSessionMetaPath(CONFIG_DIR, 'default')]: JSON.stringify({
        profile: 'default',
        origin: 'https://app.example.com',
        savedAt: '2026-09-03T11:00:00.000Z',
        expiresAt: null,
      }),
    })
    const status = await readAppSessionStatus(
      { configDir: CONFIG_DIR, profile: 'default', now },
      deps
    )
    expect(describeAppSessionStatus(status, now)).toBe(
      'A signed-in session is saved for https://app.example.com (saved 60 minutes ago).'
    )
  })

  it('deletes both files and says whether one was there', async () => {
    const { deps, files } = memDeps({
      [appSessionStatePath(CONFIG_DIR, 'default')]: '{}',
      [appSessionMetaPath(CONFIG_DIR, 'default')]: '{}',
    })
    await expect(
      deleteAppSession({ configDir: CONFIG_DIR, profile: 'default' }, deps)
    ).resolves.toBe(true)
    expect(Object.keys(files)).toHaveLength(0)
    await expect(
      deleteAppSession({ configDir: CONFIG_DIR, profile: 'default' }, deps)
    ).resolves.toBe(false)
  })
})

describe('permissions on disk', () => {
  it('creates the session owner-only, directory included', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'screenci-perms-'))
    const { statePath, metaPath } = await writeAppSession({
      configDir: dir,
      profile: 'default',
      stateJson: '{"cookies":[],"origins":[]}',
      origin: 'https://app.example.com',
      savedAt: new Date(),
    })
    expect(statSync(statePath).mode & 0o777).toBe(0o600)
    expect(statSync(metaPath).mode & 0o777).toBe(0o600)
    expect(statSync(join(dir, APP_SESSION_DIR)).mode & 0o777).toBe(0o700)
  })

  it('tightens a session file that arrived world-readable', async () => {
    // A file restored from a backup, copied between machines, or written by an
    // older build. `writeFile`'s mode applies only when it creates the file,
    // so overwriting alone would leave a bearer credential readable by others.
    const dir = mkdtempSync(join(tmpdir(), 'screenci-perms-'))
    const statePath = appSessionStatePath(dir, 'default')
    mkdirSync(join(dir, APP_SESSION_DIR), { recursive: true })
    writeFileSync(statePath, '{}', { mode: 0o644 })
    expect(statSync(statePath).mode & 0o777).toBe(0o644)

    await writeAppSession({
      configDir: dir,
      profile: 'default',
      stateJson: '{"cookies":[],"origins":[]}',
      origin: null,
      savedAt: new Date(),
    })
    expect(statSync(statePath).mode & 0o777).toBe(0o600)
  })
})
