import { describe, it, expectTypeOf } from 'vitest'
import { createElement } from 'react'
import {
  createOverlays,
  type OverlayConfig,
  type OverlayController,
} from './asset.js'

describe('createOverlays type constraints', () => {
  it('accepts a bare file path string', () => {
    createOverlays({ logo: './logo.png' })
  })

  it('accepts a React element value', () => {
    createOverlays({ badge: createElement('div', null, 'New') })
  })

  it('accepts a flat config object with a path', () => {
    createOverlays({
      logo: {
        path: './logo.png',
        durationMs: 1200,
        x: 0.1,
        y: 0.1,
        width: 0.3,
      },
    })
  })

  it('accepts a flat config object with an element', () => {
    createOverlays({
      badge: { element: createElement('span', null, 'hi'), height: 0.2 },
    })
  })

  it('accepts a flat config object with inline html', () => {
    createOverlays({
      note: {
        html: '<div class="note">Tip</div>',
        durationMs: 1200,
        x: 0.7,
        y: 0.1,
        width: 0.2,
      },
    })
  })

  it('rejects a non-string inline html value', () => {
    createOverlays({
      // @ts-expect-error html must be a string fragment
      note: { html: 123, durationMs: 1200 },
    })
  })

  it('accepts the fullScreen flag', () => {
    createOverlays({ intro: { path: './intro.mp4', fullScreen: true } })
  })

  it('maps each key to an OverlayController', () => {
    const overlays = createOverlays({ logo: './logo.png' })
    expectTypeOf(overlays.logo).toEqualTypeOf<OverlayController>()
  })

  it('rejects an invalid relativeTo', () => {
    createOverlays({
      // @ts-expect-error relativeTo must be 'screen' or 'recording'
      logo: { path: './logo.png', relativeTo: 'viewport', width: 0.3 },
    })
  })

  it('rejects a non-numeric placement field', () => {
    createOverlays({
      // @ts-expect-error width must be a number
      logo: { path: './logo.png', width: 'big' },
    })
  })

  it('maps a config-factory key to a props-taking controller', () => {
    const overlays = createOverlays({
      note: (p: { text: string }) => ({
        html: `<div class="note">${p.text}</div>`,
      }),
    })
    expectTypeOf(overlays.note).toEqualTypeOf<
      (props: { text: string }) => OverlayController
    >()
    expectTypeOf(
      overlays.note({ text: 'hi' })
    ).toEqualTypeOf<OverlayController>()
  })

  it('keeps static keys as plain controllers alongside factory keys', () => {
    const overlays = createOverlays({
      logo: './logo.png',
      note: (p: { text: string }) => ({ html: `<b>${p.text}</b>` }),
    })
    expectTypeOf(overlays.logo).toEqualTypeOf<OverlayController>()
    expectTypeOf(overlays.note).toEqualTypeOf<
      (props: { text: string }) => OverlayController
    >()
  })

  it('infers props from a factory using a placement-spreadable shape', () => {
    const overlays = createOverlays({
      ring: (p: { rect: OverlayConfig }) => ({
        element: createElement('div', null, 'ring'),
        ...p.rect,
      }),
    })
    expectTypeOf(overlays.ring).parameter(0).toEqualTypeOf<{
      rect: OverlayConfig
    }>()
  })

  it('rejects calling a static-key controller with props', () => {
    const overlays = createOverlays({ logo: './logo.png' })
    // @ts-expect-error a static overlay controller takes a durationMs, not props
    overlays.logo({ text: 'hi' })
  })

  it('rejects calling a factory-key controller without props', () => {
    const overlays = createOverlays({
      note: (p: { text: string }) => ({ html: `<b>${p.text}</b>` }),
    })
    // @ts-expect-error the factory requires its props argument
    overlays.note()
  })
})
