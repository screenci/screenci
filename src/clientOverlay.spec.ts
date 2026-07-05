import { describe, it, expect, afterEach } from 'vitest'
import {
  buildClientOverlayDocument,
  setClientOverlayBundler,
  resetClientOverlayBundler,
} from './clientOverlay.js'

describe('buildClientOverlayDocument', () => {
  afterEach(() => {
    resetClientOverlayBundler()
  })

  it('passes the entry path and JSON-serialized props to the bundler', async () => {
    let seen: { entryPath: string; propsJson: string } | undefined
    setClientOverlayBundler(async (opts) => {
      seen = opts
      return 'BUNDLE_OUTPUT'
    })

    const doc = await buildClientOverlayDocument('/abs/Menu.tsx', {
      isActive: true,
      count: 2,
    })

    expect(seen).toEqual({
      entryPath: '/abs/Menu.tsx',
      propsJson: '{"isActive":true,"count":2}',
    })
    // The document embeds the bundle and provides the empty overlay root.
    expect(doc).toContain('BUNDLE_OUTPUT')
    expect(doc).toContain('id="screenci-overlay-root"')
    expect(doc.startsWith('<!doctype html>')).toBe(true)
  })

  it('defaults props to an empty object', async () => {
    let seen: { entryPath: string; propsJson: string } | undefined
    setClientOverlayBundler(async (opts) => {
      seen = opts
      return ''
    })

    await buildClientOverlayDocument('/abs/X.tsx', undefined)

    expect(seen?.propsJson).toBe('{}')
  })
})
