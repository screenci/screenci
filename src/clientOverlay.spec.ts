import { describe, it, expect, afterEach } from 'vitest'
import {
  bundleClientOverlay,
  setClientOverlayBundler,
  resetClientOverlayBundler,
} from './clientOverlay.js'

describe('bundleClientOverlay', () => {
  afterEach(() => {
    resetClientOverlayBundler()
  })

  it('passes the entry path and JSON-serialized props to the bundler', async () => {
    let seen: { entryPath: string; propsJson: string } | undefined
    setClientOverlayBundler(async (opts) => {
      seen = opts
      return 'BUNDLE_OUTPUT'
    })

    const out = await bundleClientOverlay('/abs/Menu.tsx', {
      isActive: true,
      count: 2,
    })

    expect(out).toBe('BUNDLE_OUTPUT')
    expect(seen).toEqual({
      entryPath: '/abs/Menu.tsx',
      propsJson: '{"isActive":true,"count":2}',
    })
  })

  it('defaults props to an empty object', async () => {
    let seen: { entryPath: string; propsJson: string } | undefined
    setClientOverlayBundler(async (opts) => {
      seen = opts
      return ''
    })

    await bundleClientOverlay('/abs/X.tsx', undefined)

    expect(seen?.propsJson).toBe('{}')
  })
})
