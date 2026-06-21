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
    | NewContextOptions[K]
    | undefined
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
 */
export function buildScreenCIContextOptions(params: {
  dimensions: { width: number; height: number }
  forwarded: ForwardedContextOptions
  applyLocaleDefault: boolean
  deviceScaleFactor?: number
}): NewContextOptions {
  const { dimensions, forwarded, applyLocaleDefault, deviceScaleFactor } =
    params

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

  return options
}
