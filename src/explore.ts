import { existsSync } from 'node:fs'
import { Option, type Command } from 'commander'
import { getChromiumLaunchOptions } from './browserLaunchOptions.js'
import type { NewContextOptions } from './contextOptions.js'
import {
  installOriginHeaders,
  isSameOrigin,
  type OriginHeaders,
} from './networkEnv.js'

/**
 * `screenci explore <url>`: a quick, read-only look at a page for a coding
 * agent writing a script. It opens the recorder's browser (with the session
 * `screenci login` saved, when there is one), runs a few clicks and fills,
 * and prints a compact accessibility snapshot after each step, so the agent
 * finds real roles and names without writing a Playwright script of its own.
 */

/** One step, in the order given on the command line. */
export type ExploreAction =
  | { kind: 'click'; name: string }
  | { kind: 'fill'; label: string; value: string }

/** The browser page as explore needs it; the real one wraps Playwright. */
export interface ExploreSession {
  goto(url: string): Promise<void>
  clickByName(name: string): Promise<void>
  fillByLabel(label: string, value: string): Promise<void>
  /** The page's aria snapshot (Playwright's YAML-like text). */
  ariaSnapshot(): Promise<string>
  /** The visible viewport as a JPEG (quality 60). */
  screenshot(): Promise<Buffer>
  url(): string
  close(): Promise<void>
}

export type ExploreLaunchOptions = {
  channel?: string
  baseURL?: string
  /** Playwright storage state file to start signed in from. */
  storageStatePath?: string
  /** Playwright storage state object (wins over `storageStatePath`). */
  storageState?: ExploreStorageState
  /** Network options for the browser context. */
  contextOptions?: ExploreContextOptions
  /**
   * Called for every request the page makes; true aborts it. The snapshot
   * service uses it to keep pages away from internal addresses.
   */
  blockRequest?: (url: string) => boolean | Promise<boolean>
  /** Headers added only to requests for one origin. */
  originHeaders?: OriginHeaders
}

/** A Playwright storage state object (cookies and origins). */
export type ExploreStorageState = {
  cookies: Array<Record<string, unknown>>
  origins: Array<Record<string, unknown>>
}

export type ExploreContextOptions = {
  httpCredentials?: { username: string; password: string; origin?: string }
  extraHTTPHeaders?: Record<string, string>
  proxy?: { server: string; username?: string; password?: string }
}

export type ExploreLauncher = (
  options: ExploreLaunchOptions
) => Promise<ExploreSession>

export interface ExploreDeps {
  launch: ExploreLauncher
  /** Resolves the workspace's browser settings and saved session. */
  resolveLaunchOptions: (configPath?: string) => Promise<ExploreLaunchOptions>
  print: (text: string) => void
}

/** Roles worth showing to someone writing locators. */
const KEPT_ROLES = new Set([
  'heading',
  'button',
  'link',
  'textbox',
  'searchbox',
  'combobox',
  'listbox',
  'option',
  'checkbox',
  'radio',
  'switch',
  'slider',
  'spinbutton',
  'tab',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'dialog',
  'alertdialog',
  'alert',
  'navigation',
  'form',
])

export const EXPLORE_SNAPSHOT_MAX_LINES = 150

/**
 * Keeps the interactive and heading lines of an aria snapshot, drops the
 * rest (text, generic containers, link urls), and caps the length.
 */
export function trimAriaSnapshot(
  snapshot: string,
  maxLines = EXPLORE_SNAPSHOT_MAX_LINES
): string {
  const kept: string[] = []
  for (const line of snapshot.split('\n')) {
    const match = /^(\s*)- ([a-z]+)\b(.*)$/.exec(line)
    if (match === null) continue
    const [, indent = '', role = '', rest = ''] = match
    if (!KEPT_ROLES.has(role)) continue
    // One space per level is enough to read nesting; a trailing ':' only
    // announces children, which may have been dropped.
    const depth = Math.floor(indent.length / 2)
    kept.push(`${' '.repeat(depth)}- ${role}${rest.replace(/:$/, '')}`)
  }
  if (kept.length <= maxLines) return kept.join('\n')
  return [
    ...kept.slice(0, maxLines),
    `... (${kept.length - maxLines} more lines)`,
  ].join('\n')
}

/** Parses `label=value` for --fill; the value may itself contain `=`. */
export function parseFillArgument(raw: string): {
  label: string
  value: string
} {
  const index = raw.indexOf('=')
  if (index <= 0) {
    throw new Error(`--fill expects <label>=<value>, got "${raw}"`)
  }
  return { label: raw.slice(0, index), value: raw.slice(index + 1) }
}

function describeAction(action: ExploreAction): string {
  switch (action.kind) {
    case 'click':
      return `click "${action.name}"`
    case 'fill':
      return `fill "${action.label}"`
    default: {
      const exhaustive: never = action
      throw new Error(`Unhandled explore action: ${String(exhaustive)}`)
    }
  }
}

export async function runExplore(
  params: { url: string; actions: readonly ExploreAction[]; config?: string },
  deps: ExploreDeps
): Promise<void> {
  const launchOptions = await deps.resolveLaunchOptions(params.config)
  const session = await deps.launch(launchOptions)
  const printSnapshot = async (heading: string): Promise<void> => {
    const snapshot = trimAriaSnapshot(await session.ariaSnapshot())
    deps.print(`## ${heading} (${session.url()})`)
    deps.print(snapshot === '' ? '(no interactive elements)' : snapshot)
  }
  try {
    await session.goto(params.url)
    await printSnapshot('after load')
    for (const action of params.actions) {
      switch (action.kind) {
        case 'click':
          await session.clickByName(action.name)
          break
        case 'fill':
          await session.fillByLabel(action.label, action.value)
          break
        default: {
          const exhaustive: never = action
          throw new Error(`Unhandled explore action: ${String(exhaustive)}`)
        }
      }
      await printSnapshot(`after ${describeAction(action)}`)
    }
    deps.print(`Final URL: ${session.url()}`)
  } finally {
    await session.close()
  }
}

/** Launches the recorder's Chromium headless through Playwright. */
export const playwrightExploreLauncher: ExploreLauncher = async (options) => {
  const { chromium } = await import('@playwright/test')
  const browser = await chromium.launch({
    ...(getChromiumLaunchOptions(false, false, options.channel) ?? {}),
    headless: true,
  })
  const storageState = options.storageState ?? options.storageStatePath
  const network = options.contextOptions ?? {}
  // Playwright's StorageState type is stricter than the JSON the service
  // hands over; Playwright validates the object itself.
  const context = await browser
    .newContext({
      viewport: { width: 1920, height: 1080 },
      ...(options.baseURL !== undefined ? { baseURL: options.baseURL } : {}),
      ...(storageState !== undefined
        ? {
            storageState: storageState as NonNullable<
              NewContextOptions['storageState']
            >,
          }
        : {}),
      ...(network.httpCredentials !== undefined
        ? { httpCredentials: network.httpCredentials }
        : {}),
      ...(network.extraHTTPHeaders !== undefined
        ? { extraHTTPHeaders: network.extraHTTPHeaders }
        : {}),
      ...(network.proxy !== undefined ? { proxy: network.proxy } : {}),
      // Service worker requests bypass context routes, so a guarded
      // context has none.
      ...(options.blockRequest !== undefined
        ? { serviceWorkers: 'block' as const }
        : {}),
    })
    .catch(async (err: unknown) => {
      await browser.close().catch(() => {})
      throw err
    })
  const blockRequest = options.blockRequest
  const originHeaders = options.originHeaders
  const headersFor = (url: string, headers: Record<string, string>) =>
    originHeaders !== undefined && isSameOrigin(url, originHeaders.origin)
      ? { ...headers, ...originHeaders.headers }
      : headers
  if (blockRequest !== undefined) {
    await context.route('**/*', async (route) => {
      const request = route.request()
      if (await blockRequest(request.url())) {
        await route.abort('blockedbyclient')
        return
      }
      // Routes only see the first URL of a redirect chain, so fetch without
      // following redirects: the browser follows each Location itself, as
      // a new request that passes through this guard again (and gets the
      // origin headers only if it lands on their origin).
      try {
        const response = await route.fetch({
          maxRedirects: 0,
          headers: headersFor(request.url(), request.headers()),
        })
        await route.fulfill({ response })
      } catch {
        await route.abort('failed').catch(() => {})
      }
    })
    await context.routeWebSocket(/.*/, async (ws) => {
      if (await blockRequest(ws.url())) {
        await ws.close({ code: 1008, reason: 'blocked' })
        return
      }
      ws.connectToServer()
    })
  } else if (originHeaders !== undefined) {
    await installOriginHeaders(context, originHeaders)
  }
  const page = await context.newPage()
  const settle = async (): Promise<void> => {
    await page.waitForLoadState('load').catch(() => {})
    await page
      .waitForLoadState('networkidle', { timeout: 3000 })
      .catch(() => {})
  }
  return {
    goto: async (url) => {
      await page.goto(url)
      await settle()
    },
    clickByName: async (name) => {
      await page
        .getByRole('button', { name })
        .or(page.getByRole('link', { name }))
        .or(page.getByRole('tab', { name }))
        .or(page.getByRole('menuitem', { name }))
        .or(page.getByRole('checkbox', { name }))
        .or(page.getByText(name, { exact: true }))
        .first()
        .click()
      await settle()
    },
    fillByLabel: async (label, value) => {
      await page
        .getByLabel(label)
        .or(page.getByPlaceholder(label))
        .first()
        .fill(value)
    },
    ariaSnapshot: () => page.locator('body').ariaSnapshot(),
    screenshot: () =>
      page.screenshot({ type: 'jpeg', quality: 60, fullPage: false }),
    url: () => page.url(),
    close: () => browser.close(),
  }
}

/** The saved session file, when `screenci login` wrote one. */
export function existingStorageState(
  path: string,
  exists: (path: string) => boolean = existsSync
): string | undefined {
  return exists(path) ? path : undefined
}

export function registerExploreCommand(
  program: Command,
  deps: ExploreDeps
): Command {
  // Clicks and fills run in the order given, so both flags push into one list.
  const actions: ExploreAction[] = []
  return program
    .command('explore <url>')
    .description(
      'Print a compact accessibility snapshot of a page (after load and after each --click/--fill), using the recorder browser and the saved sign-in'
    )
    .addOption(
      new Option(
        '--click <name>',
        'click the button, link, tab or text with this name (repeatable)'
      ).argParser((name: string, previous: unknown) => {
        actions.push({ kind: 'click', name })
        return previous
      })
    )
    .addOption(
      new Option(
        '--fill <label=value>',
        'fill the field with this label or placeholder (repeatable)'
      ).argParser((raw: string, previous: unknown) => {
        actions.push({ kind: 'fill', ...parseFillArgument(raw) })
        return previous
      })
    )
    .option('-c, --config <path>', 'path to screenci.config.ts')
    .action(async (url: string, options: Record<string, unknown>) => {
      const config = options['config'] as string | undefined
      await runExplore(
        { url, actions, ...(config !== undefined ? { config } : {}) },
        deps
      )
    })
}
