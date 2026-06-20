import { describe, it, expectTypeOf } from 'vitest'
import { createElement } from 'react'
import { createOverlays, type OverlayController } from './asset.js'

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
})
