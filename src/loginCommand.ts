import { Option, type Command } from 'commander'
import pc from 'picocolors'
import {
  APP_SESSION_PATH_ENV,
  appSessionDir,
  appSessionStatePath,
  deleteAppSession,
  describeAppSessionStatus,
  defaultAppSessionFsDeps,
  loginCancelSignalPath,
  loginDoneSignalPath,
  loginHandshakePath,
  loginLogPath,
  loginResultPath,
  originOf,
  readAppSessionStatus,
  resolveProfileName,
  writeAppSession,
  type AppSessionFsDeps,
} from './appSession.js'
import {
  LOGIN_BANNER_BINDING,
  loginBannerCopy,
  loginBannerScript,
} from './loginBanner.js'

/**
 * `screenci login`: capture the signed-in session of the person's own product
 * so recordings never script a sign-in.
 *
 * The person signs in themselves in a real browser, which is the only approach
 * that works for 2FA, SSO, passkeys, and magic links alike. The command is
 * deliberately split so an agent can speak before it waits: `login` opens the
 * browser and returns immediately (so the agent can say "sign in over there"),
 * and `login --wait` then blocks until the person finishes.
 *
 * That wait is not optional in practice. Clicking the card's button saves the
 * session in the browser but tells the agent nothing, so an agent that ends its
 * turn instead of waiting leaves the person clicking at a stalled chat.
 * `login --done` covers the other direction, when they say so in words instead.
 *
 * The captured state is a bearer credential. It is written owner-only under the
 * gitignored `.screenci/auth/`, and neither this command nor any other ever
 * prints, logs, or uploads its contents.
 */

export class LoginCommandError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LoginCommandError'
  }
}

/** How long a browser left open waits before closing itself. */
export const DEFAULT_LOGIN_TIMEOUT_MINUTES = 30

/** How often the open browser looks for a `--done` or `--cancel` signal. */
export const LOGIN_SIGNAL_POLL_MS = 400

/**
 * How often the open browser caches its storage state. Closing the window is a
 * natural way to say "I am done", but once the browser is gone its state can
 * no longer be read, so the last cache is what gets saved in that case.
 */
export const LOGIN_SNAPSHOT_EVERY_MS = 5_000

/** How long `--done` waits for the browser to save and exit. */
export const LOGIN_DONE_TIMEOUT_MS = 90_000

/**
 * How long `--wait` blocks before reporting back so it can be run again.
 *
 * An agent's shell usually caps a command at ten minutes, and a person signing
 * in with a password manager and a one-time code can easily take a few. This
 * sits under that cap: the wait ends, says it is not finished, and the agent
 * runs it again rather than having its shell killed mid-command.
 */
export const LOGIN_WAIT_TIMEOUT_MS = 8 * 60_000

export const CI_DOCS_URL = 'https://screenci.com/docs/guides/ci-setup'

export type LoginHandshake = {
  pid: number
  profile: string
  url: string
  startedAt: string
}

export function parseLoginHandshake(content: string): LoginHandshake | null {
  let value: unknown
  try {
    value = JSON.parse(content)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  if (
    typeof v.pid !== 'number' ||
    typeof v.profile !== 'string' ||
    typeof v.url !== 'string' ||
    typeof v.startedAt !== 'string'
  ) {
    return null
  }
  return { pid: v.pid, profile: v.profile, url: v.url, startedAt: v.startedAt }
}

/** The browser the helper drives. Narrow on purpose so tests can fake it. */
export type LoginBrowser = {
  /** Resolves once the person closes the window. */
  onClosed: (handler: () => void) => void
  /** The current storageState as JSON. Never logged. */
  storageState: () => Promise<string>
  close: () => Promise<void>
}

export type LaunchLoginBrowser = (params: {
  url: string
  bannerScript: string
  bannerBinding: string
  onBannerClick: () => void
}) => Promise<LoginBrowser>

export type LoginDeps = {
  logger: { info: (message: string) => void; warn: (message: string) => void }
  fs: AppSessionFsDeps
  now: () => Date
  sleep: (ms: number) => Promise<void>
  /** Whether a browser window can actually be shown here. */
  hasDisplay: () => boolean
  /** True when the process is still running (a stale handshake means it is not). */
  processAlive: (pid: number) => boolean
  /** Starts the detached helper that owns the browser; returns its pid. */
  spawnHelper: (params: {
    /** The config file itself, not its directory: the helper re-resolves it. */
    configPath: string
    profile: string
    url: string
    timeoutMinutes: number
    logPath: string
  }) => Promise<number>
  launchBrowser: LaunchLoginBrowser
}

/**
 * A window can only be shown where there is a display. Everywhere else this is
 * a CI machine, and CI has its own documented answer.
 */
export function displayIsAvailable(
  platform: string,
  env: NodeJS.ProcessEnv
): boolean {
  if (platform !== 'linux') return true
  return (
    (env.DISPLAY !== undefined && env.DISPLAY !== '') ||
    (env.WAYLAND_DISPLAY !== undefined && env.WAYLAND_DISPLAY !== '')
  )
}

export const NO_DISPLAY_MESSAGE =
  `\`screenci login\` opens a real browser, and this machine has no display (no DISPLAY or WAYLAND_DISPLAY).\n` +
  `Run it on the machine the person is sitting at. For an unattended machine, supply a session through ${APP_SESSION_PATH_ENV} instead: ${CI_DOCS_URL}`

/** The URL to open: an explicit one, else the config's baseURL. */
export function resolveLoginUrl(
  explicit: string | undefined,
  baseURL: string | undefined
): string {
  const url = explicit ?? baseURL
  if (url === undefined || url.length === 0) {
    throw new LoginCommandError(
      'No address to sign in to. Pass one (`npx screenci login https://app.example.com`) or set `use.baseURL` in screenci.config.ts.'
    )
  }
  if (originOf(url) === null) {
    throw new LoginCommandError(`"${url}" is not a valid address.`)
  }
  return url
}

/** The handshake of a browser that is genuinely still open, else null. */
export async function readLiveHandshake(
  params: { configDir: string; profile: string },
  deps: Pick<LoginDeps, 'fs' | 'processAlive'>
): Promise<LoginHandshake | null> {
  const path = loginHandshakePath(params.configDir, params.profile)
  const content = await deps.fs.readFile(path)
  if (content === null) return null
  const handshake = parseLoginHandshake(content)
  if (handshake === null || !deps.processAlive(handshake.pid)) {
    // A crashed or killed helper leaves its handshake behind. Clear it so the
    // next `login` is not refused by a browser that is not there.
    await deps.fs.remove(path)
    return null
  }
  return handshake
}

async function clearSignals(
  configDir: string,
  profile: string,
  deps: Pick<LoginDeps, 'fs'>
): Promise<void> {
  await deps.fs.remove(loginDoneSignalPath(configDir, profile))
  await deps.fs.remove(loginCancelSignalPath(configDir, profile))
  await deps.fs.remove(loginResultPath(configDir, profile))
}

export type LoginResult = { outcome: LoginServeOutcome; at: string }

export function parseLoginResult(content: string): LoginResult | null {
  let value: unknown
  try {
    value = JSON.parse(content)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  if (
    v.outcome !== 'saved' &&
    v.outcome !== 'cancelled' &&
    v.outcome !== 'timeout' &&
    v.outcome !== 'empty'
  ) {
    return null
  }
  if (typeof v.at !== 'string') return null
  return { outcome: v.outcome, at: v.at }
}

export type LoginStartResult = {
  url: string
  profile: string
  pid: number
  statePath: string
}

/** `screenci login [url]`: open the browser and hand the person over to it. */
export async function runLoginStart(
  params: {
    configDir: string
    configPath: string
    url: string
    profile: string
    timeoutMinutes: number
  },
  deps: LoginDeps
): Promise<LoginStartResult> {
  if (!deps.hasDisplay()) throw new LoginCommandError(NO_DISPLAY_MESSAGE)

  const live = await readLiveHandshake(params, deps)
  if (live !== null) {
    throw new LoginCommandError(
      `A sign-in browser for the "${params.profile}" profile is already open at ${live.url}.\n` +
        `Finish it with \`npx screenci login --done\`, or close it with \`npx screenci login --cancel\`.`
    )
  }

  await deps.fs.mkdir(appSessionDir(params.configDir))
  await clearSignals(params.configDir, params.profile, deps)

  const logPath = loginLogPath(params.configDir, params.profile)
  const pid = await deps.spawnHelper({
    configPath: params.configPath,
    profile: params.profile,
    url: params.url,
    timeoutMinutes: params.timeoutMinutes,
    logPath,
  })
  const handshake: LoginHandshake = {
    pid,
    profile: params.profile,
    url: params.url,
    startedAt: deps.now().toISOString(),
  }
  await deps.fs.writeFile(
    loginHandshakePath(params.configDir, params.profile),
    `${JSON.stringify(handshake, null, 2)}\n`,
    0o600
  )

  for (const line of formatLoginStartMessage(params.url, params.profile)) {
    deps.logger.info(line)
  }
  return {
    url: params.url,
    profile: params.profile,
    pid,
    statePath: appSessionStatePath(params.configDir, params.profile),
  }
}

/** What the agent reads back, and reads aloud to the person. */
export function formatLoginStartMessage(
  url: string,
  profile: string
): string[] {
  const profileNote = profile === 'default' ? '' : ` (profile "${profile}")`
  return [
    `${pc.green('✔')} A browser opened at ${pc.cyan(url)}${profileNote}.`,
    '',
    'Tell the person to sign in there the way they normally do, then click',
    `"${loginBannerCopy(null).button}" in the small ScreenCI card floating over the page.`,
    'Two-factor codes, single sign-on, passkeys, and magic links all work: it is',
    'their own browser window and nothing they type is sent to ScreenCI.',
    '',
    'Then run this, which blocks until they finish:',
    `  ${pc.cyan('npx screenci login --wait')}`,
    '',
    'Do NOT end your turn instead of waiting. Clicking the card saves the session',
    'in the browser but tells you nothing, so if nothing is waiting, the person',
    'clicks and sees no reply. If the wait reports that it is still going, run it',
    'again. If they say they are done some other way, run `npx screenci login --done`.',
    '',
    'The session is saved on this machine only. Recordings then start signed in,',
    'so do not script a sign-in in the video.',
  ]
}

export type LoginServeOutcome = 'saved' | 'cancelled' | 'timeout' | 'empty'

/**
 * The detached helper. Owns the browser for the whole sign-in and writes the
 * session when the person (or the agent) says they are done.
 */
export async function runLoginServe(
  params: {
    configDir: string
    url: string
    profile: string
    timeoutMinutes: number
  },
  deps: LoginDeps
): Promise<LoginServeOutcome> {
  const origin = originOf(params.url)
  let finish: LoginServeOutcome | null = null
  const browser = await deps.launchBrowser({
    url: params.url,
    bannerScript: loginBannerScript(loginBannerCopy(origin), origin),
    bannerBinding: LOGIN_BANNER_BINDING,
    onBannerClick: () => {
      finish ??= 'saved'
    },
  })
  browser.onClosed(() => {
    finish ??= 'saved'
  })

  // The state as of the last poll. Closing the window is one of the ways to
  // finish, and by the time that is noticed the browser is gone and its state
  // can no longer be read, so a cached copy is the only thing left to save.
  let snapshot: string | null = null
  let nextSnapshotAt = 0

  const donePath = loginDoneSignalPath(params.configDir, params.profile)
  const cancelPath = loginCancelSignalPath(params.configDir, params.profile)
  const deadline = deps.now().getTime() + params.timeoutMinutes * 60_000

  while (finish === null) {
    if (deps.fs.exists(cancelPath)) finish = 'cancelled'
    else if (deps.fs.exists(donePath)) finish = 'saved'
    else if (deps.now().getTime() >= deadline) finish = 'timeout'
    else {
      if (deps.now().getTime() >= nextSnapshotAt) {
        try {
          snapshot = await browser.storageState()
        } catch {
          // The browser went away between the check and the read; the close
          // handler above has already set the outcome.
        }
        nextSnapshotAt = deps.now().getTime() + LOGIN_SNAPSHOT_EVERY_MS
      }
      await deps.sleep(LOGIN_SIGNAL_POLL_MS)
    }
  }

  let outcome: LoginServeOutcome = finish
  if (finish === 'saved') {
    // A live read is exact; the cache covers the window-closed case, where
    // there is nothing live left to read.
    let stateJson: string | null
    try {
      stateJson = await browser.storageState()
    } catch {
      stateJson = snapshot
    }
    if (stateJson === null || storageStateIsEmpty(stateJson)) {
      // Closing the window before signing in must not overwrite a good session
      // with an anonymous one.
      outcome = 'empty'
    } else {
      await writeAppSession(
        {
          configDir: params.configDir,
          profile: params.profile,
          stateJson,
          origin,
          savedAt: deps.now(),
        },
        deps.fs
      )
    }
  }

  await browser.close().catch(() => {})
  await clearSignals(params.configDir, params.profile, deps)
  // Say how it ended before dropping the handshake: `--done` waits on the
  // handshake disappearing and would otherwise have to guess from whatever
  // session file happens to be on disk, including a stale one.
  await deps.fs.writeFile(
    loginResultPath(params.configDir, params.profile),
    `${JSON.stringify({ outcome, at: deps.now().toISOString() })}\n`,
    0o600
  )
  await deps.fs.remove(loginHandshakePath(params.configDir, params.profile))
  return outcome
}

/** Nothing worth keeping: no cookies and no stored origins. */
export function storageStateIsEmpty(stateJson: string): boolean {
  let value: unknown
  try {
    value = JSON.parse(stateJson)
  } catch {
    return true
  }
  if (typeof value !== 'object' || value === null) return true
  const v = value as Record<string, unknown>
  const cookies = Array.isArray(v.cookies) ? v.cookies.length : 0
  const origins = Array.isArray(v.origins) ? v.origins.length : 0
  return cookies === 0 && origins === 0
}

export type LoginDoneResult = { saved: boolean; message: string }

/** `screenci login --done`: what the agent runs when the person says so. */
export async function runLoginDone(
  params: { configDir: string; profile: string },
  deps: LoginDeps
): Promise<LoginDoneResult> {
  const live = await readLiveHandshake(params, deps)
  if (live === null) {
    const finished = await readLoginResult(params, deps)
    if (finished !== null) return reportLoginResult(finished, params, deps)
    const status = await readAppSessionStatus(
      { ...params, now: deps.now() },
      deps.fs
    )
    if (status.saved) {
      // The banner button already finished it.
      return {
        saved: true,
        message: `${pc.green('✔')} ${describeAppSessionStatus(status, deps.now())}`,
      }
    }
    throw new LoginCommandError(
      `No sign-in browser is open for the "${params.profile}" profile, and no session is saved.\n` +
        'Start one with `npx screenci login <url>`.'
    )
  }

  await deps.fs.writeFile(
    loginDoneSignalPath(params.configDir, params.profile),
    `${deps.now().toISOString()}\n`,
    0o600
  )

  const deadline = deps.now().getTime() + LOGIN_DONE_TIMEOUT_MS
  const handshakePath = loginHandshakePath(params.configDir, params.profile)
  while (deps.fs.exists(handshakePath) && deps.now().getTime() < deadline) {
    await deps.sleep(LOGIN_SIGNAL_POLL_MS)
  }
  if (deps.fs.exists(handshakePath)) {
    throw new LoginCommandError(
      'The sign-in browser did not answer in time. Leave it open and try `npx screenci login --done` again, or close it and start over.'
    )
  }

  const finished = await readLoginResult(params, deps)
  if (finished === null) {
    throw new LoginCommandError(
      'The sign-in browser stopped without saying how it ended. Run `npx screenci login <url>` again.'
    )
  }
  return reportLoginResult(finished, params, deps)
}

/** Reads and consumes the browser's outcome, so it is never read twice. */
async function readLoginResult(
  params: { configDir: string; profile: string },
  deps: LoginDeps
): Promise<LoginResult | null> {
  const path = loginResultPath(params.configDir, params.profile)
  const content = await deps.fs.readFile(path)
  if (content === null) return null
  await deps.fs.remove(path)
  return parseLoginResult(content)
}

/**
 * What the browser actually produced, rather than whatever session file
 * happens to be on disk: a stale one from a previous sign-in would otherwise
 * make a run that captured nothing look like a success, and the recording
 * would then be made signed out.
 */
async function reportLoginResult(
  result: LoginResult,
  params: { configDir: string; profile: string },
  deps: LoginDeps
): Promise<LoginDoneResult> {
  switch (result.outcome) {
    case 'saved': {
      const status = await readAppSessionStatus(
        { ...params, now: deps.now() },
        deps.fs
      )
      if (!status.saved) {
        throw new LoginCommandError(
          'The sign-in browser reported a session it did not write. Run `npx screenci login <url>` again.'
        )
      }
      return {
        saved: true,
        message: [
          `${pc.green('✔')} ${describeAppSessionStatus(status, deps.now())}`,
          'Recordings now start signed in. Do not script a sign-in in the video.',
        ].join('\n'),
      }
    }
    case 'empty':
      throw new LoginCommandError(
        'The browser closed without a signed-in session. Nothing was saved.\n' +
          'Run `npx screenci login <url>` again and make sure the person is signed in before finishing.'
      )
    case 'cancelled':
      throw new LoginCommandError(
        'The sign-in was cancelled, so nothing was saved. Run `npx screenci login <url>` again.'
      )
    case 'timeout':
      throw new LoginCommandError(
        'The sign-in browser closed itself before anyone finished. Run `npx screenci login <url>` again, and pass --timeout <minutes> if the person needs longer.'
      )
    default: {
      const exhaustive: never = result.outcome
      throw new Error(`Unhandled sign-in outcome: ${String(exhaustive)}`)
    }
  }
}

/**
 * `screenci login --wait`: block until the person finishes signing in.
 *
 * Clicking the card's button saves the session in the browser but tells the
 * agent nothing: by then the agent has ended its turn and is idle, so the
 * click lands on nobody and the person is left staring at a stalled chat.
 * Waiting here means something is listening when they click.
 *
 * Bounded and resumable, because a blocking command has to fit inside an
 * agent's shell timeout.
 */
export async function runLoginWait(
  params: { configDir: string; profile: string },
  deps: LoginDeps
): Promise<LoginDoneResult> {
  const finished = await readLoginResult(params, deps)
  if (finished !== null) return reportLoginResult(finished, params, deps)

  const live = await readLiveHandshake(params, deps)
  if (live === null) {
    const status = await readAppSessionStatus(
      { ...params, now: deps.now() },
      deps.fs
    )
    if (status.saved) {
      return {
        saved: true,
        message: `${pc.green('✔')} ${describeAppSessionStatus(status, deps.now())}`,
      }
    }
    throw new LoginCommandError(
      `No sign-in browser is open for the "${params.profile}" profile, and no session is saved.\n` +
        'Start one with `npx screenci login <url>`.'
    )
  }

  const deadline = deps.now().getTime() + LOGIN_WAIT_TIMEOUT_MS
  const handshakePath = loginHandshakePath(params.configDir, params.profile)
  while (deps.fs.exists(handshakePath) && deps.now().getTime() < deadline) {
    await deps.sleep(LOGIN_SIGNAL_POLL_MS)
  }
  if (deps.fs.exists(handshakePath)) {
    throw new LoginCommandError(
      'Still waiting for the person to finish signing in. The browser is still open.\n' +
        'Check whether they need help, then run `npx screenci login --wait` again to keep waiting.'
    )
  }

  const result = await readLoginResult(params, deps)
  if (result === null) {
    throw new LoginCommandError(
      'The sign-in browser stopped without saying how it ended. Run `npx screenci login <url>` again.'
    )
  }
  return reportLoginResult(result, params, deps)
}

/** `screenci login --cancel`: close the browser and keep whatever was saved. */
export async function runLoginCancel(
  params: { configDir: string; profile: string },
  deps: LoginDeps
): Promise<{ closed: boolean }> {
  const live = await readLiveHandshake(params, deps)
  if (live === null) {
    deps.logger.info(
      `No sign-in browser is open for the "${params.profile}" profile.`
    )
    return { closed: false }
  }
  await deps.fs.writeFile(
    loginCancelSignalPath(params.configDir, params.profile),
    `${deps.now().toISOString()}\n`,
    0o600
  )
  const deadline = deps.now().getTime() + LOGIN_DONE_TIMEOUT_MS
  const handshakePath = loginHandshakePath(params.configDir, params.profile)
  while (deps.fs.exists(handshakePath) && deps.now().getTime() < deadline) {
    await deps.sleep(LOGIN_SIGNAL_POLL_MS)
  }
  deps.logger.info('Closed the sign-in browser. Nothing was saved.')
  return { closed: true }
}

export type LoginStatusResult = {
  saved: boolean
  expired: boolean
  origin: string | null
  browserOpen: boolean
}

/** `screenci login --status`: metadata only, never anything from inside the file. */
export async function runLoginStatus(
  params: { configDir: string; profile: string },
  deps: LoginDeps
): Promise<LoginStatusResult> {
  const now = deps.now()
  const status = await readAppSessionStatus({ ...params, now }, deps.fs)
  const live = await readLiveHandshake(params, deps)
  deps.logger.info(describeAppSessionStatus(status, now))
  if (status.saved) {
    deps.logger.info(
      `  ${appSessionStatePath(params.configDir, params.profile)}`
    )
    if (status.expired) {
      deps.logger.info(`  Sign in again with ${pc.cyan('npx screenci login')}.`)
    }
  }
  if (live !== null) {
    deps.logger.info(
      `A sign-in browser is open at ${live.url}. Finish it with ${pc.cyan('npx screenci login --done')}.`
    )
  }
  const result: LoginStatusResult = {
    saved: status.saved,
    expired: status.saved && status.expired,
    origin: status.saved ? (status.meta?.origin ?? null) : null,
    browserOpen: live !== null,
  }
  deps.logger.info(JSON.stringify(result))
  return result
}

/** `screenci logout`: forget the saved session on this machine. */
export async function runLogout(
  params: { configDir: string; profile: string },
  deps: LoginDeps
): Promise<{ removed: boolean }> {
  const removed = await deleteAppSession(params, deps.fs)
  deps.logger.info(
    removed
      ? `${pc.green('✔')} Removed the saved session for the "${params.profile}" profile.`
      : `No session was saved for the "${params.profile}" profile.`
  )
  return { removed }
}

export type LoginCommandOptions = {
  config?: string | undefined
  profile?: string | undefined
  done?: boolean
  wait?: boolean
  cancel?: boolean
  status?: boolean
  serve?: boolean
  timeout?: string | undefined
  url?: string | undefined
}

export function parseTimeoutMinutes(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_LOGIN_TIMEOUT_MINUTES
  const minutes = Number(raw)
  if (!Number.isFinite(minutes) || minutes <= 0) {
    throw new LoginCommandError(
      `"${raw}" is not a number of minutes. Pass something like --timeout 45.`
    )
  }
  return minutes
}

export type LoginCommandContext = {
  /** The resolved screenci.config.ts, handed to the detached helper verbatim. */
  configPath: string
  /** The directory holding it, which is where `.screenci/auth/` lives. */
  configDir: string
  /** `use.baseURL` from that config, when it sets one. */
  baseURL: string | undefined
}

export function registerLoginCommand(
  program: Command,
  deps: LoginDeps,
  loadContext: (configPath: string | undefined) => Promise<LoginCommandContext>
): void {
  program
    .command('login [url]')
    .description(
      'Sign in to your own app once in a real browser and reuse that session in every recording'
    )
    .option('-c, --config <path>', 'path to screenci.config.ts')
    .option(
      '--profile <name>',
      'name this session, for videos that need a second role'
    )
    .option(
      '--wait',
      'block until the person finishes signing in in the browser'
    )
    .option(
      '--done',
      'save the session from the browser that is open and close it'
    )
    .option('--cancel', 'close the browser that is open without saving')
    .option('--status', 'show whether a session is saved, and until when')
    .option(
      '--timeout <minutes>',
      `close the browser by itself after this long (default ${DEFAULT_LOGIN_TIMEOUT_MINUTES})`
    )
    // The detached helper re-enters the CLI with this. Hidden: it is an
    // implementation detail of `login`, never something a person types.
    .addOption(
      new Option(
        '--serve',
        'internal: run the browser that login opened'
      ).hideHelp()
    )
    .action(async (url: string | undefined, options: LoginCommandOptions) => {
      const context = await loadContext(options.config)
      const profile = resolveProfileName(options.profile)
      const params = { configDir: context.configDir, profile }
      if (options.status === true) {
        await runLoginStatus(params, deps)
        return
      }
      if (options.cancel === true) {
        await runLoginCancel(params, deps)
        return
      }
      if (options.wait === true) {
        const result = await runLoginWait(params, deps)
        deps.logger.info(result.message)
        return
      }
      if (options.done === true) {
        const result = await runLoginDone(params, deps)
        deps.logger.info(result.message)
        return
      }
      const timeoutMinutes = parseTimeoutMinutes(options.timeout)
      const target = resolveLoginUrl(url, context.baseURL)
      if (options.serve === true) {
        await runLoginServe({ ...params, url: target, timeoutMinutes }, deps)
        return
      }
      await runLoginStart(
        {
          ...params,
          configPath: context.configPath,
          url: target,
          timeoutMinutes,
        },
        deps
      )
    })

  program
    .command('logout')
    .description('Forget the signed-in session saved on this machine')
    .option('-c, --config <path>', 'path to screenci.config.ts')
    .option('--profile <name>', 'which session to forget')
    .action(async (options: LoginCommandOptions) => {
      const context = await loadContext(options.config)
      await runLogout(
        {
          configDir: context.configDir,
          profile: resolveProfileName(options.profile),
        },
        deps
      )
    })
}

export function createDefaultLoginDeps(logger: LoginDeps['logger']): LoginDeps {
  return {
    logger,
    fs: defaultAppSessionFsDeps,
    now: () => new Date(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    hasDisplay: () => displayIsAvailable(process.platform, process.env),
    processAlive: (pid) => {
      try {
        process.kill(pid, 0)
        return true
      } catch {
        return false
      }
    },
    spawnHelper: async ({
      configPath,
      profile,
      url,
      timeoutMinutes,
      logPath,
    }) => {
      const { spawn } = await import('node:child_process')
      const { openSync, mkdirSync } = await import('node:fs')
      const { dirname } = await import('node:path')
      mkdirSync(dirname(logPath), { recursive: true })
      const out = openSync(logPath, 'a')
      const entry = process.argv[1]
      if (entry === undefined) {
        throw new LoginCommandError(
          'Could not work out how to restart the CLI for the sign-in browser.'
        )
      }
      const child = spawn(
        process.execPath,
        [
          entry,
          'login',
          url,
          '--serve',
          '--config',
          configPath,
          '--profile',
          profile,
          '--timeout',
          String(timeoutMinutes),
        ],
        { detached: true, stdio: ['ignore', out, out] }
      )
      child.unref()
      if (child.pid === undefined) {
        throw new LoginCommandError('Could not start the sign-in browser.')
      }
      return child.pid
    },
    launchBrowser: async ({
      url,
      bannerScript,
      bannerBinding,
      onBannerClick,
    }) => {
      let chromium: typeof import('@playwright/test').chromium
      try {
        ;({ chromium } = await import('@playwright/test'))
      } catch {
        throw new LoginCommandError(
          'Playwright is not installed in this workspace, so no browser can be opened. Run `npm install` first.'
        )
      }
      // Prefer the installed Chrome: some identity providers refuse the
      // bundled Chromium build. Fall back when Chrome is not on the machine.
      const browser = await chromium
        .launch({ headless: false, channel: 'chrome' })
        .catch(() => chromium.launch({ headless: false }))
      const context = await browser.newContext()
      // The binding is reachable from every frame, including third-party ones
      // an identity provider embeds. Only the top-level document carries the
      // banner, so only it may finish the sign-in.
      await context.exposeBinding(bannerBinding, (source) => {
        if (source.frame !== source.page.mainFrame()) return
        onBannerClick()
      })
      await context.addInitScript({ content: bannerScript })
      const page = await context.newPage()
      await page.goto(url).catch(() => {})
      return {
        onClosed: (handler) => {
          browser.on('disconnected', handler)
          page.on('close', handler)
        },
        storageState: async () =>
          JSON.stringify(await context.storageState(), null, 2),
        close: async () => {
          await browser.close()
        },
      }
    },
  }
}
