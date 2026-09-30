import { describe, it, expect } from 'vitest'
import {
  buildScreenCIContextOptions,
  defaultRecordingUserAgent,
  resolveDeviceScaleFactor,
} from './contextOptions.js'

const dimensions = { width: 1920, height: 1080 }

describe('buildScreenCIContextOptions', () => {
  it('always pins the viewport from dimensions', () => {
    const options = buildScreenCIContextOptions({
      dimensions,
      forwarded: {},
      applyLocaleDefault: false,
    })
    expect(options.viewport).toEqual(dimensions)
  })

  it('forwards defined use options like colorScheme', () => {
    const options = buildScreenCIContextOptions({
      dimensions,
      forwarded: { colorScheme: 'dark', timezoneId: 'Europe/Helsinki' },
      applyLocaleDefault: false,
    })
    expect(options.colorScheme).toBe('dark')
    expect(options.timezoneId).toBe('Europe/Helsinki')
  })

  it('omits undefined forwarded options', () => {
    const options = buildScreenCIContextOptions({
      dimensions,
      forwarded: { colorScheme: undefined },
      applyLocaleDefault: false,
    })
    expect('colorScheme' in options).toBe(false)
  })

  it('applies the en-US locale default only when requested and unset', () => {
    expect(
      buildScreenCIContextOptions({
        dimensions,
        forwarded: {},
        applyLocaleDefault: true,
      }).locale
    ).toBe('en-US')

    expect(
      buildScreenCIContextOptions({
        dimensions,
        forwarded: {},
        applyLocaleDefault: false,
      }).locale
    ).toBeUndefined()
  })

  it('does not override a user-provided locale with the default', () => {
    const options = buildScreenCIContextOptions({
      dimensions,
      forwarded: { locale: 'fi-FI' },
      applyLocaleDefault: true,
    })
    expect(options.locale).toBe('fi-FI')
  })

  it('sets deviceScaleFactor only when provided', () => {
    expect(
      buildScreenCIContextOptions({
        dimensions,
        forwarded: {},
        applyLocaleDefault: false,
      }).deviceScaleFactor
    ).toBeUndefined()

    expect(
      buildScreenCIContextOptions({
        dimensions,
        forwarded: {},
        applyLocaleDefault: false,
        deviceScaleFactor: 2,
      }).deviceScaleFactor
    ).toBe(2)
  })

  it('never forwards a viewport from use options', () => {
    const options = buildScreenCIContextOptions({
      dimensions,
      // viewport is not a forwardable key, but guard the contract anyway.
      forwarded: {} as never,
      applyLocaleDefault: false,
    })
    expect(options.viewport).toEqual(dimensions)
  })
})

describe('resolveDeviceScaleFactor', () => {
  it('prefers recordOptions.deviceScaleFactor', () => {
    expect(resolveDeviceScaleFactor({ deviceScaleFactor: 3 }, 2)).toBe(3)
  })

  it('falls back to the forwarded use value', () => {
    expect(resolveDeviceScaleFactor({}, 2)).toBe(2)
  })

  it('defaults to 1', () => {
    expect(resolveDeviceScaleFactor({}, undefined)).toBe(1)
  })

  it('uses the provided default when nothing is set (screenshots pass 2)', () => {
    expect(resolveDeviceScaleFactor({}, undefined, 2)).toBe(2)
  })

  it('still prefers an explicit recordOptions value over the default', () => {
    expect(
      resolveDeviceScaleFactor({ deviceScaleFactor: 1 }, undefined, 2)
    ).toBe(1)
  })
})

describe('default user agent', () => {
  it('builds a desktop Chrome user agent without a Headless token', () => {
    const ua = defaultRecordingUserAgent('linux', '141.0.7390.37')
    expect(ua).toBe(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
    )
    expect(ua).not.toContain('Headless')
  })

  it('uses the platform token of the host', () => {
    expect(defaultRecordingUserAgent('darwin', '141.0.1')).toContain(
      'Macintosh'
    )
    expect(defaultRecordingUserAgent('win32', '141.0.1')).toContain(
      'Windows NT 10.0'
    )
  })

  it('returns undefined for an unparseable version', () => {
    expect(defaultRecordingUserAgent('linux', 'unknown')).toBeUndefined()
  })

  it('applies the default only when the config sets no userAgent', () => {
    expect(
      buildScreenCIContextOptions({
        dimensions,
        forwarded: {},
        applyLocaleDefault: false,
        defaultUserAgent: 'default-ua',
      }).userAgent
    ).toBe('default-ua')
    expect(
      buildScreenCIContextOptions({
        dimensions,
        forwarded: { userAgent: 'config-ua' },
        applyLocaleDefault: false,
        defaultUserAgent: 'default-ua',
      }).userAgent
    ).toBe('config-ua')
  })

  it('keeps the mobile user agent for a mobile context', () => {
    expect(
      buildScreenCIContextOptions({
        dimensions,
        forwarded: { isMobile: true },
        applyLocaleDefault: false,
        defaultUserAgent: 'default-ua',
      }).userAgent
    ).toBeUndefined()
  })
})
