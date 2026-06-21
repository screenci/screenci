import { describe, it, expect } from 'vitest'
import {
  buildScreenCIContextOptions,
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
