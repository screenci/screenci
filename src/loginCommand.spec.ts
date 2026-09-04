import { describe, it, expect, vi } from 'vitest'
import {
  appSessionMetaPath,
  appSessionStatePath,
  loginCancelSignalPath,
  loginDoneSignalPath,
  loginHandshakePath,
  loginResultPath,
  type AppSessionFsDeps,
} from './appSession.js'
import {
  DEFAULT_LOGIN_TIMEOUT_MINUTES,
  LoginCommandError,
  displayIsAvailable,
  parseLoginHandshake,
  parseTimeoutMinutes,
  readLiveHandshake,
  resolveLoginUrl,
  runLoginCancel,
  runLoginDone,
  runLoginServe,
  runLoginStart,
  runLoginWait,
  runLoginStatus,
  runLogout,
  storageStateIsEmpty,
  type LoginBrowser,
  type LoginDeps,
} from './loginCommand.js'

const CONFIG_DIR = '/workspace/screenci'
const PROFILE = 'default'
const NOW = new Date('2026-09-03T12:00:00.000Z')

function memFs(files: Record<string, string> = {}): {
  fs: AppSessionFsDeps
  files: Record<string, string>
} {
  const store = { ...files }
  return {
    files: store,
    fs: {
      readFile: async (path) => store[path] ?? null,
      writeFile: async (path, content) => {
        store[path] = content
      },
      mkdir: async () => {},
      remove: async (path) => {
        delete store[path]
      },
      exists: (path) => store[path] !== undefined,
    },
  }
}

function makeDeps(
  overrides: Partial<LoginDeps> & { files?: Record<string, string> } = {}
): { deps: LoginDeps; files: Record<string, string>; logs: string[] } {
  const { files: seed, ...rest } = overrides
  const { fs, files } = memFs(seed)
  const logs: string[] = []
  const deps: LoginDeps = {
    logger: {
      info: (message) => logs.push(message),
      warn: (message) => logs.push(message),
    },
    fs,
    now: () => NOW,
    // A real macrotask, so a runaway poll loop shows up as a test timeout
    // rather than starving the timers and hanging the run.
    sleep: () => new Promise((resolve) => setTimeout(resolve, 0)),
    hasDisplay: () => true,
    processAlive: () => true,
    spawnHelper: async () => 4242,
    launchBrowser: async () => ({
      onClosed: () => {},
      storageState: async () => '{"cookies":[],"origins":[]}',
      close: async () => {},
    }),
    ...rest,
  }
  return { deps, files, logs }
}

function handshake(url = 'https://app.example.com', pid = 4242): string {
  return JSON.stringify({
    pid,
    profile: PROFILE,
    url,
    startedAt: '2026-09-03T11:00:00.000Z',
  })
}

describe('displayIsAvailable', () => {
  it('assumes a display off Linux', () => {
    expect(displayIsAvailable('darwin', {})).toBe(true)
    expect(displayIsAvailable('win32', {})).toBe(true)
  })

  it('needs X or Wayland on Linux', () => {
    expect(displayIsAvailable('linux', {})).toBe(false)
    expect(displayIsAvailable('linux', { DISPLAY: '' })).toBe(false)
    expect(displayIsAvailable('linux', { DISPLAY: ':0' })).toBe(true)
    expect(displayIsAvailable('linux', { WAYLAND_DISPLAY: 'wayland-0' })).toBe(
      true
    )
  })
})

describe('resolveLoginUrl', () => {
  it('prefers the argument, then the config baseURL', () => {
    expect(resolveLoginUrl('https://a.test', 'https://b.test')).toBe(
      'https://a.test'
    )
    expect(resolveLoginUrl(undefined, 'https://b.test')).toBe('https://b.test')
  })

  it('explains how to supply one when there is none', () => {
    expect(() => resolveLoginUrl(undefined, undefined)).toThrow(
      /No address to sign in to/
    )
  })

  it('rejects something that is not an address', () => {
    expect(() => resolveLoginUrl('app.example.com', undefined)).toThrow(
      /not a valid address/
    )
  })
})

describe('parseTimeoutMinutes', () => {
  it('defaults, accepts a number, and rejects nonsense', () => {
    expect(parseTimeoutMinutes(undefined)).toBe(DEFAULT_LOGIN_TIMEOUT_MINUTES)
    expect(parseTimeoutMinutes('45')).toBe(45)
    expect(() => parseTimeoutMinutes('soon')).toThrow(/number of minutes/)
    expect(() => parseTimeoutMinutes('0')).toThrow(/number of minutes/)
  })
})

describe('parseLoginHandshake', () => {
  it('reads a complete handshake and rejects a partial one', () => {
    expect(parseLoginHandshake(handshake())?.pid).toBe(4242)
    expect(parseLoginHandshake('{"pid":1}')).toBeNull()
    expect(parseLoginHandshake('nope')).toBeNull()
  })
})

describe('readLiveHandshake', () => {
  it('clears a handshake whose process is gone, so login is not blocked forever', async () => {
    const { deps, files } = makeDeps({
      files: { [loginHandshakePath(CONFIG_DIR, PROFILE)]: handshake() },
      processAlive: () => false,
    })
    await expect(
      readLiveHandshake({ configDir: CONFIG_DIR, profile: PROFILE }, deps)
    ).resolves.toBeNull()
    expect(files[loginHandshakePath(CONFIG_DIR, PROFILE)]).toBeUndefined()
  })

  it('returns the handshake while the helper is alive', async () => {
    const { deps } = makeDeps({
      files: { [loginHandshakePath(CONFIG_DIR, PROFILE)]: handshake() },
    })
    const live = await readLiveHandshake(
      { configDir: CONFIG_DIR, profile: PROFILE },
      deps
    )
    expect(live?.url).toBe('https://app.example.com')
  })
})

describe('runLoginStart', () => {
  const params = {
    configDir: CONFIG_DIR,
    configPath: `${CONFIG_DIR}/screenci.config.ts`,
    profile: PROFILE,
    url: 'https://app.example.com',
    timeoutMinutes: 30,
  }

  it('hands the helper the config file, not its directory', async () => {
    const spawnHelper = vi.fn().mockResolvedValue(1)
    const { deps } = makeDeps({ spawnHelper })
    await runLoginStart(params, deps)
    expect(spawnHelper).toHaveBeenCalledWith(
      expect.objectContaining({ configPath: params.configPath })
    )
  })

  it('spawns the helper, records the handshake, and says how to finish', async () => {
    const spawnHelper = vi.fn().mockResolvedValue(777)
    const { deps, files, logs } = makeDeps({ spawnHelper })
    const result = await runLoginStart(params, deps)

    expect(spawnHelper).toHaveBeenCalledWith(
      expect.objectContaining({ url: params.url, profile: PROFILE })
    )
    expect(result.pid).toBe(777)
    expect(
      JSON.parse(files[loginHandshakePath(CONFIG_DIR, PROFILE)] ?? '{}')
    ).toMatchObject({ pid: 777, url: params.url })
    const printed = logs.join('\n')
    expect(printed).toContain('npx screenci login --done')
    expect(printed).toContain('nothing they type is sent to ScreenCI')
    expect(printed).toContain('do not script a sign-in in the video')
  })

  it('refuses on a machine with no display and points at the CI docs', async () => {
    const { deps } = makeDeps({ hasDisplay: () => false })
    await expect(runLoginStart(params, deps)).rejects.toThrow(
      /no display[\s\S]*ci-setup/
    )
  })

  it('refuses a second browser for the same profile', async () => {
    const { deps } = makeDeps({
      files: { [loginHandshakePath(CONFIG_DIR, PROFILE)]: handshake() },
    })
    await expect(runLoginStart(params, deps)).rejects.toThrow(
      /already open[\s\S]*--done/
    )
  })

  it('clears signals left by a previous run before opening', async () => {
    const { deps, files } = makeDeps({
      files: {
        [loginDoneSignalPath(CONFIG_DIR, PROFILE)]: 'stale',
        [loginCancelSignalPath(CONFIG_DIR, PROFILE)]: 'stale',
      },
    })
    await runLoginStart(params, deps)
    expect(files[loginDoneSignalPath(CONFIG_DIR, PROFILE)]).toBeUndefined()
    expect(files[loginCancelSignalPath(CONFIG_DIR, PROFILE)]).toBeUndefined()
  })
})

describe('storageStateIsEmpty', () => {
  it('is empty with no cookies and no origins', () => {
    expect(storageStateIsEmpty('{"cookies":[],"origins":[]}')).toBe(true)
    expect(storageStateIsEmpty('broken')).toBe(true)
    expect(storageStateIsEmpty('{"cookies":[{"name":"a"}],"origins":[]}')).toBe(
      false
    )
    expect(
      storageStateIsEmpty('{"cookies":[],"origins":[{"origin":"a"}]}')
    ).toBe(false)
  })
})

describe('runLoginServe', () => {
  const params = {
    configDir: CONFIG_DIR,
    profile: PROFILE,
    url: 'https://app.example.com',
    timeoutMinutes: 30,
  }
  const signedIn = JSON.stringify({
    cookies: [{ name: 'session', value: 'x', expires: 1_900_000_000 }],
    origins: [],
  })

  function browserFake(state: string): {
    browser: LoginBrowser
    closed: () => boolean
  } {
    let didClose = false
    return {
      closed: () => didClose,
      browser: {
        onClosed: () => {},
        storageState: async () => state,
        close: async () => {
          didClose = true
        },
      },
    }
  }

  it('saves the session when the done signal appears, then cleans up', async () => {
    const fake = browserFake(signedIn)
    const { deps, files } = makeDeps({
      files: {
        [loginDoneSignalPath(CONFIG_DIR, PROFILE)]: 'go',
        [loginHandshakePath(CONFIG_DIR, PROFILE)]: handshake(),
      },
      launchBrowser: async () => fake.browser,
    })
    await expect(runLoginServe(params, deps)).resolves.toBe('saved')
    expect(files[appSessionStatePath(CONFIG_DIR, PROFILE)]).toBe(signedIn)
    expect(
      JSON.parse(files[appSessionMetaPath(CONFIG_DIR, PROFILE)] ?? '{}')
    ).toMatchObject({ origin: 'https://app.example.com' })
    expect(files[loginDoneSignalPath(CONFIG_DIR, PROFILE)]).toBeUndefined()
    expect(files[loginHandshakePath(CONFIG_DIR, PROFILE)]).toBeUndefined()
    expect(fake.closed()).toBe(true)
  })

  it('saves nothing when the person cancels', async () => {
    const { deps, files } = makeDeps({
      files: { [loginCancelSignalPath(CONFIG_DIR, PROFILE)]: 'stop' },
      launchBrowser: async () => browserFake(signedIn).browser,
    })
    await expect(runLoginServe(params, deps)).resolves.toBe('cancelled')
    expect(files[appSessionStatePath(CONFIG_DIR, PROFILE)]).toBeUndefined()
  })

  it('refuses to overwrite a good session with an empty one', async () => {
    const { deps, files } = makeDeps({
      files: {
        [loginDoneSignalPath(CONFIG_DIR, PROFILE)]: 'go',
        [appSessionStatePath(CONFIG_DIR, PROFILE)]: signedIn,
      },
      launchBrowser: async () =>
        browserFake('{"cookies":[],"origins":[]}').browser,
    })
    await expect(runLoginServe(params, deps)).resolves.toBe('empty')
    expect(files[appSessionStatePath(CONFIG_DIR, PROFILE)]).toBe(signedIn)
  })

  it('saves from the last snapshot when the person just closes the window', async () => {
    // The real browser cannot be read once it is gone: `context.storageState()`
    // rejects on a disconnected browser. Only the cache taken while it was
    // still open can be saved, so model exactly that.
    let closeHandler: (() => void) | null = null
    let open = true
    const { deps, files } = makeDeps({
      launchBrowser: async () => ({
        onClosed: (handler) => {
          closeHandler = handler
        },
        storageState: async () => {
          if (!open)
            throw new Error('Target page, context or browser has been closed')
          return signedIn
        },
        close: async () => {},
      }),
      sleep: async () => {
        // One poll caches the state, the next closes the window.
        if (closeHandler !== null && !open) return
        open = false
        closeHandler?.()
      },
    })
    await expect(runLoginServe(params, deps)).resolves.toBe('saved')
    expect(files[appSessionStatePath(CONFIG_DIR, PROFILE)]).toBe(signedIn)
  })

  it('saves nothing when the window is closed before anything was cached', async () => {
    let closeHandler: (() => void) | null = null
    const { deps, files } = makeDeps({
      launchBrowser: async () => ({
        onClosed: (handler) => {
          closeHandler = handler
        },
        storageState: async () => {
          throw new Error('Target page, context or browser has been closed')
        },
        close: async () => {},
      }),
      sleep: async () => closeHandler?.(),
    })
    await expect(runLoginServe(params, deps)).resolves.toBe('empty')
    expect(files[appSessionStatePath(CONFIG_DIR, PROFILE)]).toBeUndefined()
  })

  it('records how it ended so --done never has to guess', async () => {
    const { deps, files } = makeDeps({
      files: { [loginCancelSignalPath(CONFIG_DIR, PROFILE)]: 'stop' },
      launchBrowser: async () => browserFake(signedIn).browser,
    })
    await runLoginServe(params, deps)
    expect(
      JSON.parse(files[loginResultPath(CONFIG_DIR, PROFILE)] ?? '{}')
    ).toMatchObject({ outcome: 'cancelled' })
  })

  it('gives up and closes the browser once the timeout passes', async () => {
    let clock = NOW.getTime()
    const fake = browserFake(signedIn)
    const { deps, files } = makeDeps({
      launchBrowser: async () => fake.browser,
      now: () => new Date(clock),
      sleep: async () => {
        clock += 60_000
      },
    })
    await expect(
      runLoginServe({ ...params, timeoutMinutes: 1 }, deps)
    ).resolves.toBe('timeout')
    expect(files[appSessionStatePath(CONFIG_DIR, PROFILE)]).toBeUndefined()
    expect(fake.closed()).toBe(true)
  })
})

describe('runLoginDone', () => {
  const params = { configDir: CONFIG_DIR, profile: PROFILE }

  it('signals the open browser and reports the session it saved', async () => {
    const { deps, files } = makeDeps({
      files: { [loginHandshakePath(CONFIG_DIR, PROFILE)]: handshake() },
    })
    // Stand in for the helper reacting to the signal: it saves, records how it
    // ended, and drops its handshake, which is what `--done` waits for.
    deps.sleep = async () => {
      delete files[loginHandshakePath(CONFIG_DIR, PROFILE)]
      files[appSessionStatePath(CONFIG_DIR, PROFILE)] = '{}'
      files[appSessionMetaPath(CONFIG_DIR, PROFILE)] = JSON.stringify({
        profile: PROFILE,
        origin: 'https://app.example.com',
        savedAt: NOW.toISOString(),
        expiresAt: null,
      })
      files[loginResultPath(CONFIG_DIR, PROFILE)] = JSON.stringify({
        outcome: 'saved',
        at: NOW.toISOString(),
      })
    }
    const result = await runLoginDone(params, deps)
    expect(result.saved).toBe(true)
    expect(result.message).toContain('https://app.example.com')
    expect(result.message).toContain('Do not script a sign-in')
  })

  it('is a no-op success when the banner button already finished it', async () => {
    const { deps } = makeDeps({
      files: {
        [appSessionStatePath(CONFIG_DIR, PROFILE)]: '{}',
        [appSessionMetaPath(CONFIG_DIR, PROFILE)]: JSON.stringify({
          profile: PROFILE,
          origin: 'https://app.example.com',
          savedAt: NOW.toISOString(),
          expiresAt: null,
        }),
      },
    })
    await expect(runLoginDone(params, deps)).resolves.toMatchObject({
      saved: true,
    })
  })

  it('explains how to start one when nothing is open and nothing is saved', async () => {
    const { deps } = makeDeps()
    await expect(runLoginDone(params, deps)).rejects.toThrow(
      /No sign-in browser is open[\s\S]*screenci login <url>/
    )
  })

  it('reports that nothing was captured when the browser closed signed out', async () => {
    const { deps, files } = makeDeps({
      files: { [loginHandshakePath(CONFIG_DIR, PROFILE)]: handshake() },
    })
    deps.sleep = async () => {
      delete files[loginHandshakePath(CONFIG_DIR, PROFILE)]
      files[loginResultPath(CONFIG_DIR, PROFILE)] = JSON.stringify({
        outcome: 'empty',
        at: NOW.toISOString(),
      })
    }
    await expect(runLoginDone(params, deps)).rejects.toThrow(
      /closed without a signed-in session/
    )
  })

  it('does not call a run that captured nothing a success just because an old session is on disk', async () => {
    const { deps, files } = makeDeps({
      files: {
        [loginHandshakePath(CONFIG_DIR, PROFILE)]: handshake(),
        // A session from a previous, unrelated sign-in.
        [appSessionStatePath(CONFIG_DIR, PROFILE)]:
          '{"cookies":[{"name":"a"}]}',
        [appSessionMetaPath(CONFIG_DIR, PROFILE)]: JSON.stringify({
          profile: PROFILE,
          origin: 'https://app.example.com',
          savedAt: '2026-08-01T12:00:00.000Z',
          expiresAt: null,
        }),
      },
    })
    deps.sleep = async () => {
      delete files[loginHandshakePath(CONFIG_DIR, PROFILE)]
      files[loginResultPath(CONFIG_DIR, PROFILE)] = JSON.stringify({
        outcome: 'empty',
        at: NOW.toISOString(),
      })
    }
    // Reporting success here would have the agent record a signed-out app.
    await expect(runLoginDone(params, deps)).rejects.toThrow(
      /closed without a signed-in session/
    )
  })

  it('reports a cancelled sign-in as cancelled, not as a success', async () => {
    const { deps, files } = makeDeps({
      files: { [loginHandshakePath(CONFIG_DIR, PROFILE)]: handshake() },
    })
    deps.sleep = async () => {
      delete files[loginHandshakePath(CONFIG_DIR, PROFILE)]
      files[loginResultPath(CONFIG_DIR, PROFILE)] = JSON.stringify({
        outcome: 'cancelled',
        at: NOW.toISOString(),
      })
    }
    await expect(runLoginDone(params, deps)).rejects.toThrow(/cancelled/)
  })

  it('says so when the browser never answers the signal', async () => {
    let clock = NOW.getTime()
    const { deps } = makeDeps({
      files: { [loginHandshakePath(CONFIG_DIR, PROFILE)]: handshake() },
      now: () => new Date(clock),
    })
    deps.sleep = async () => {
      clock += 30_000
    }
    await expect(runLoginDone(params, deps)).rejects.toThrow(
      /did not answer in time/
    )
  })

  it('reports the outcome the banner button already produced', async () => {
    const { deps, files } = makeDeps({
      files: {
        [loginResultPath(CONFIG_DIR, PROFILE)]: JSON.stringify({
          outcome: 'saved',
          at: NOW.toISOString(),
        }),
        [appSessionStatePath(CONFIG_DIR, PROFILE)]: '{}',
        [appSessionMetaPath(CONFIG_DIR, PROFILE)]: JSON.stringify({
          profile: PROFILE,
          origin: 'https://app.example.com',
          savedAt: NOW.toISOString(),
          expiresAt: null,
        }),
      },
    })
    await expect(runLoginDone(params, deps)).resolves.toMatchObject({
      saved: true,
    })
    // Consumed, so a later `--done` cannot replay it.
    expect(files[loginResultPath(CONFIG_DIR, PROFILE)]).toBeUndefined()
  })
})

describe('runLoginWait', () => {
  const params = { configDir: CONFIG_DIR, profile: PROFILE }

  it('returns as soon as the person clicks the card', async () => {
    // The case that stranded a person: they clicked, the browser saved and
    // closed, and the agent had already ended its turn so nothing noticed.
    const { deps, files } = makeDeps({
      files: { [loginHandshakePath(CONFIG_DIR, PROFILE)]: handshake() },
    })
    deps.sleep = async () => {
      delete files[loginHandshakePath(CONFIG_DIR, PROFILE)]
      files[appSessionStatePath(CONFIG_DIR, PROFILE)] = '{}'
      files[appSessionMetaPath(CONFIG_DIR, PROFILE)] = JSON.stringify({
        profile: PROFILE,
        origin: 'https://app.example.com',
        savedAt: NOW.toISOString(),
        expiresAt: null,
      })
      files[loginResultPath(CONFIG_DIR, PROFILE)] = JSON.stringify({
        outcome: 'saved',
        at: NOW.toISOString(),
      })
    }
    const result = await runLoginWait(params, deps)
    expect(result.saved).toBe(true)
    expect(result.message).toContain('https://app.example.com')
  })

  it('never signals the browser: the person finishes on their own terms', async () => {
    const { deps, files } = makeDeps({
      files: { [loginHandshakePath(CONFIG_DIR, PROFILE)]: handshake() },
    })
    deps.sleep = async () => {
      delete files[loginHandshakePath(CONFIG_DIR, PROFILE)]
      files[loginResultPath(CONFIG_DIR, PROFILE)] = JSON.stringify({
        outcome: 'empty',
        at: NOW.toISOString(),
      })
    }
    await expect(runLoginWait(params, deps)).rejects.toThrow(/closed without/)
    // `--done` writes this; waiting must not, or it would cut the person off
    // mid-sign-in.
    expect(files[loginDoneSignalPath(CONFIG_DIR, PROFILE)]).toBeUndefined()
  })

  it('reports the outcome when the browser finished before the wait started', async () => {
    const { deps } = makeDeps({
      files: {
        [loginResultPath(CONFIG_DIR, PROFILE)]: JSON.stringify({
          outcome: 'saved',
          at: NOW.toISOString(),
        }),
        [appSessionStatePath(CONFIG_DIR, PROFILE)]: '{}',
        [appSessionMetaPath(CONFIG_DIR, PROFILE)]: JSON.stringify({
          profile: PROFILE,
          origin: 'https://app.example.com',
          savedAt: NOW.toISOString(),
          expiresAt: null,
        }),
      },
    })
    await expect(runLoginWait(params, deps)).resolves.toMatchObject({
      saved: true,
    })
  })

  it('gives up in a way that can be resumed, rather than being killed by a shell timeout', async () => {
    let clock = NOW.getTime()
    const { deps } = makeDeps({
      files: { [loginHandshakePath(CONFIG_DIR, PROFILE)]: handshake() },
      now: () => new Date(clock),
    })
    deps.sleep = async () => {
      clock += 30_000
    }
    await expect(runLoginWait(params, deps)).rejects.toThrow(
      /Still waiting[\s\S]*--wait` again/
    )
  })

  it('explains how to start one when no browser is open', async () => {
    const { deps } = makeDeps()
    await expect(runLoginWait(params, deps)).rejects.toThrow(
      /No sign-in browser is open[\s\S]*screenci login <url>/
    )
  })
})

describe('runLoginCancel', () => {
  it('says so when no browser is open', async () => {
    const { deps, logs } = makeDeps()
    await expect(
      runLoginCancel({ configDir: CONFIG_DIR, profile: PROFILE }, deps)
    ).resolves.toEqual({ closed: false })
    expect(logs.join('\n')).toContain('No sign-in browser is open')
  })

  it('drops a cancel signal for the open browser', async () => {
    const { deps, files } = makeDeps({
      files: { [loginHandshakePath(CONFIG_DIR, PROFILE)]: handshake() },
    })
    deps.sleep = async () => {
      delete files[loginHandshakePath(CONFIG_DIR, PROFILE)]
    }
    await expect(
      runLoginCancel({ configDir: CONFIG_DIR, profile: PROFILE }, deps)
    ).resolves.toEqual({ closed: true })
    expect(files[loginCancelSignalPath(CONFIG_DIR, PROFILE)]).toBeDefined()
  })
})

describe('runLoginStatus', () => {
  it('reports nothing saved without inventing a session', async () => {
    const { deps, logs } = makeDeps()
    await expect(
      runLoginStatus({ configDir: CONFIG_DIR, profile: PROFILE }, deps)
    ).resolves.toEqual({
      saved: false,
      expired: false,
      origin: null,
      browserOpen: false,
    })
    expect(logs.join('\n')).toContain('No signed-in session is saved.')
  })

  it('reports an expired session and how to fix it, never its contents', async () => {
    const secret = 'super-secret-cookie-value'
    const { deps, logs } = makeDeps({
      files: {
        [appSessionStatePath(CONFIG_DIR, PROFILE)]: JSON.stringify({
          cookies: [{ name: 'session', value: secret }],
        }),
        [appSessionMetaPath(CONFIG_DIR, PROFILE)]: JSON.stringify({
          profile: PROFILE,
          origin: 'https://app.example.com',
          savedAt: '2026-08-01T12:00:00.000Z',
          expiresAt: '2026-08-30T12:00:00.000Z',
        }),
      },
    })
    const result = await runLoginStatus(
      { configDir: CONFIG_DIR, profile: PROFILE },
      deps
    )
    expect(result).toMatchObject({ saved: true, expired: true })
    const printed = logs.join('\n')
    expect(printed).toContain('expired')
    expect(printed).toContain('npx screenci login')
    expect(printed).not.toContain(secret)
  })

  it('mentions a browser that is still open', async () => {
    const { deps, logs } = makeDeps({
      files: { [loginHandshakePath(CONFIG_DIR, PROFILE)]: handshake() },
    })
    const result = await runLoginStatus(
      { configDir: CONFIG_DIR, profile: PROFILE },
      deps
    )
    expect(result.browserOpen).toBe(true)
    expect(logs.join('\n')).toContain('A sign-in browser is open')
  })
})

describe('runLogout', () => {
  it('removes the session and says whether there was one', async () => {
    const { deps, files, logs } = makeDeps({
      files: {
        [appSessionStatePath(CONFIG_DIR, PROFILE)]: '{}',
        [appSessionMetaPath(CONFIG_DIR, PROFILE)]: '{}',
      },
    })
    await expect(
      runLogout({ configDir: CONFIG_DIR, profile: PROFILE }, deps)
    ).resolves.toEqual({ removed: true })
    expect(Object.keys(files)).toHaveLength(0)
    expect(logs.join('\n')).toContain('Removed the saved session')
  })
})

describe('LoginCommandError', () => {
  it('is named so the CLI can report it plainly', () => {
    expect(new LoginCommandError('x').name).toBe('LoginCommandError')
  })
})
