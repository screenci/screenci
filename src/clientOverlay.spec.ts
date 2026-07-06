import { describe, it, expect, afterEach } from 'vitest'
import {
  buildClientOverlayDocument,
  buildOverlayHostDocument,
  setClientOverlayBundler,
  resetClientOverlayBundler,
  type ClientOverlayEntry,
} from './clientOverlay.js'

describe('buildClientOverlayDocument', () => {
  afterEach(() => {
    resetClientOverlayBundler()
  })

  it('passes the file entry and JSON-serialized props to the bundler', async () => {
    let seen: { entry: ClientOverlayEntry; propsJson: string } | undefined
    setClientOverlayBundler(async (opts) => {
      seen = opts
      return { js: 'BUNDLE_OUTPUT', css: '' }
    })

    const doc = await buildClientOverlayDocument(
      { kind: 'file', path: '/abs/Menu.tsx', framework: 'react' },
      {
        isActive: true,
        count: 2,
      }
    )

    expect(seen).toEqual({
      entry: { kind: 'file', path: '/abs/Menu.tsx', framework: 'react' },
      propsJson: '{"isActive":true,"count":2}',
    })
    // The document embeds the bundle and provides the empty overlay root.
    expect(doc).toContain('BUNDLE_OUTPUT')
    expect(doc).toContain('id="screenci-overlay-root"')
    expect(doc).toContain('"Noto Sans CJK SC"')
    expect(doc).toContain('"Noto Sans CJK JP"')
    expect(doc).toContain('"Noto Sans Devanagari"')
    expect(doc.startsWith('<!doctype html>')).toBe(true)
  })

  it('passes an inline-source entry through with its resolveDir and framework', async () => {
    let seen: { entry: ClientOverlayEntry; propsJson: string } | undefined
    setClientOverlayBundler(async (opts) => {
      seen = opts
      return { js: 'JS', css: '' }
    })

    await buildClientOverlayDocument(
      {
        kind: 'source',
        code: 'export default () => null',
        resolveDir: '/recordings',
        framework: 'solid',
      },
      { label: 'hi' }
    )

    expect(seen).toEqual({
      entry: {
        kind: 'source',
        code: 'export default () => null',
        resolveDir: '/recordings',
        framework: 'solid',
      },
      propsJson: '{"label":"hi"}',
    })
  })

  it('inlines bundled CSS into the host document', async () => {
    setClientOverlayBundler(async () => ({
      js: 'JS_CODE',
      css: '.badge{color:red}',
    }))

    const doc = await buildClientOverlayDocument(
      { kind: 'file', path: '/abs/Badge.vue', framework: 'vue' },
      undefined
    )

    expect(doc).toContain('<style>.badge{color:red}</style>')
    expect(doc).toContain('JS_CODE')
  })

  it('defaults props to an empty object', async () => {
    let seen: { entry: ClientOverlayEntry; propsJson: string } | undefined
    setClientOverlayBundler(async (opts) => {
      seen = opts
      return { js: '', css: '' }
    })

    await buildClientOverlayDocument(
      { kind: 'file', path: '/abs/X.tsx', framework: 'react' },
      undefined
    )

    expect(seen?.propsJson).toBe('{}')
  })
})

describe('buildOverlayHostDocument', () => {
  it('wraps root content in the transparent host page', () => {
    const doc = buildOverlayHostDocument({ rootContent: '<b>Hi</b>' })
    expect(doc.startsWith('<!doctype html>')).toBe(true)
    expect(doc).toContain('<div id="screenci-overlay-root"><b>Hi</b></div>')
    expect(doc).toContain('background:transparent')
    expect(doc).not.toContain('<script>')
  })

  it('emits extra CSS and the mount script when given', () => {
    const doc = buildOverlayHostDocument({
      css: '.x{opacity:1}',
      script: 'MOUNT()',
    })
    expect(doc).toContain('<style>.x{opacity:1}</style>')
    expect(doc).toContain('<script>MOUNT()</script>')
    expect(doc).toContain('<div id="screenci-overlay-root"></div>')
  })
})
