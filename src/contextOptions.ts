import type { Browser } from '@playwright/test'
import type { RecordOptions } from './types.js'

/** The exact options object accepted by `browser.newContext()`. */
export type NewContextOptions = NonNullable<
  Parameters<Browser['newContext']>[0]
>

/**
 * Playwright `use` context options that screenci forwards verbatim into the
 * browser context it creates for itself.
 *
 * screenci builds its own context (rather than using Playwright's auto-created
 * one) so it can pin the viewport to `recordOptions`. Historically that meant
 * every other `use` option (most notably `colorScheme: 'dark'`) was silently
 * dropped. These keys are passed straight through so they take effect again.
 *
 * `viewport` is intentionally excluded (screenci owns it) and `deviceScaleFactor`
 * is handled separately so it can be applied to screenshots but not to the video
 * screencast, whose encoder expects frames at the viewport size.
 */
export const FORWARDED_CONTEXT_OPTION_KEYS = [
  'colorScheme',
  'locale',
  'timezoneId',
  'userAgent',
  'geolocation',
  'permissions',
  'extraHTTPHeaders',
  'proxy',
  'httpCredentials',
  'ignoreHTTPSErrors',
  'offline',
  'storageState',
  'baseURL',
  'bypassCSP',
  'acceptDownloads',
  'javaScriptEnabled',
  'hasTouch',
  'isMobile',
] as const

export type ForwardedContextOptions = {
  [K in (typeof FORWARDED_CONTEXT_OPTION_KEYS)[number]]?:
    NewContextOptions[K] | undefined
}

/**
 * Resolve the device scale factor (DPR) for capture. `recordOptions` wins so the
 * dedicated `recordOptions.deviceScaleFactor` knob is the easy way to ask for a
 * higher-DPI still; a Playwright `use: { deviceScaleFactor }` is honored as a
 * fallback. `defaultDsf` is the fallback when neither is set (screenshots pass
 * `2` for crisp stills; the general default is `1`).
 */
export function resolveDeviceScaleFactor(
  recordOptions: RecordOptions,
  forwarded: number | undefined,
  defaultDsf = 1
): number {
  return recordOptions.deviceScaleFactor ?? forwarded ?? defaultDsf
}

/**
 * Build the options for the browser context screenci creates, merging the
 * forwarded `use` options with screenci-managed values.
 *
 * - `viewport` is always set from `recordOptions` dimensions (never forwarded).
 * - `deviceScaleFactor` is set only when provided (screenshots); video leaves it
 *   at Playwright's default so the screencast stays at viewport resolution.
 * - `locale` defaults to `'en-US'` while recording unless the user set one.
 * - `userAgent` falls back to `defaultUserAgent` when the config sets none and
 *   the context is not mobile.
 */
export function buildScreenCIContextOptions(params: {
  dimensions: { width: number; height: number }
  forwarded: ForwardedContextOptions
  applyLocaleDefault: boolean
  deviceScaleFactor?: number
  defaultUserAgent?: string | undefined
}): NewContextOptions {
  const {
    dimensions,
    forwarded,
    applyLocaleDefault,
    deviceScaleFactor,
    defaultUserAgent,
  } = params

  const options: NewContextOptions = {}
  for (const key of FORWARDED_CONTEXT_OPTION_KEYS) {
    const value = forwarded[key]
    if (value !== undefined) {
      ;(options as Record<string, unknown>)[key] = value
    }
  }

  options.viewport = dimensions
  if (deviceScaleFactor !== undefined) {
    options.deviceScaleFactor = deviceScaleFactor
  }
  if (options.locale === undefined && applyLocaleDefault) {
    options.locale = 'en-US'
  }
  // A mobile context keeps Chromium's own (mobile) user agent.
  if (
    options.userAgent === undefined &&
    options.isMobile !== true &&
    defaultUserAgent !== undefined
  ) {
    options.userAgent = defaultUserAgent
  }

  return options
}

function userAgentPlatformToken(platform: NodeJS.Platform): string {
  switch (platform) {
    case 'darwin':
      return 'Macintosh; Intel Mac OS X 10_15_7'
    case 'win32':
      return 'Windows NT 10.0; Win64; x64'
    default:
      return 'X11; Linux x86_64'
  }
}

/**
 * The user agent a desktop Chrome of this version sends. Headless Chromium
 * announces itself as `HeadlessChrome`, which some bot protection refuses
 * outright, so screenci sends this instead unless the config sets `userAgent`.
 *
 * `browserVersion` is `browser.version()` (for example `141.0.7390.37`); like
 * Chrome, only the major version is reported.
 */
export function defaultRecordingUserAgent(
  platform: NodeJS.Platform,
  browserVersion: string
): string | undefined {
  const major = /^(\d+)\./.exec(browserVersion)?.[1]
  if (major === undefined) return undefined
  return `Mozilla/5.0 (${userAgentPlatformToken(platform)}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`
}
