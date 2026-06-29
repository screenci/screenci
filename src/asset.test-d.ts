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
        x: 200,
        y: 120,
        width: 600,
      },
    })
  })

  it('accepts a flat config object with an element', () => {
    createOverlays({
      badge: { element: createElement('span', null, 'hi'), height: 200 },
    })
  })

  it('accepts a flat config object with inline html', () => {
    createOverlays({
      note: {
        html: '<div class="note">Tip</div>',
        durationMs: 1200,
        x: 1340,
        y: 110,
        width: 380,
      },
    })
  })

  it('rejects a non-string inline html value', () => {
    createOverlays({
      // @ts-expect-error html must be a string fragment
      note: { html: 123, durationMs: 1200 },
    })
  })

  it('accepts the fill option', () => {
    createOverlays({ intro: { path: './intro.mp4', fill: 'screen' } })
  })

  it('rejects an invalid fill value', () => {
    createOverlays({
      // @ts-expect-error fill must be 'recording' or 'screen'
      intro: { path: './intro.mp4', fill: 'window' },
    })
  })

  it('accepts volume on a video file overlay', () => {
    createOverlays({ intro: { path: './intro.mp4', volume: 0.5 } })
  })

  it('rejects volume on an inline html overlay', () => {
    createOverlays({
      // @ts-expect-error volume only applies to .mp4 file overlays
      note: { html: '<div>x</div>', durationMs: 1000, volume: 0.5 },
    })
  })

  it('rejects volume on a React element overlay', () => {
    createOverlays({
      // @ts-expect-error volume only applies to .mp4 file overlays
      badge: { element: createElement('div', null, 'x'), volume: 0.5 },
    })
  })

  it('rejects mixing two content sources', () => {
    createOverlays({
      // @ts-expect-error provide only one of path, element, or html
      mixed: { path: './logo.png', html: '<div>x</div>' },
    })
  })

  it('maps each key to an OverlayController', () => {
    const overlays = createOverlays({ logo: './logo.png' })
    expectTypeOf(overlays.logo).toEqualTypeOf<OverlayController>()
  })

  it('rejects an invalid relativeTo', () => {
    createOverlays({
      // @ts-expect-error relativeTo must be 'screen' or 'recording'
      logo: { path: './logo.png', relativeTo: 'viewport', width: 300 },
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
      ring: (p: { rect: { x: number; y: number; width: number } }) => ({
        element: createElement('div', null, 'ring'),
        ...p.rect,
      }),
    })
    expectTypeOf(overlays.ring).parameter(0).toEqualTypeOf<{
      rect: { x: number; y: number; width: number }
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

  it('accepts crop on an image and video file overlay', () => {
    createOverlays({
      logo: {
        path: './logo.png',
        duration: '1s',
        crop: { x: 0, y: 0, width: 100, height: 80 },
      },
      clip: {
        path: './clip.mp4',
        crop: { x: 10, y: 20, width: 200, height: 100 },
      },
    })
  })

  it('accepts start/end on a video file overlay', () => {
    createOverlays({
      clip: { path: './clip.mp4', start: '2s', end: '50%' },
    })
  })

  it('rejects crop on a React element overlay', () => {
    createOverlays({
      // @ts-expect-error crop only applies to image/video file overlays
      badge: {
        element: createElement('div', null, 'x'),
        crop: { x: 0, y: 0, width: 1, height: 1 },
      },
    })
  })

  it('rejects crop on an inline html overlay', () => {
    createOverlays({
      // @ts-expect-error crop only applies to image/video file overlays
      note: {
        html: '<div>x</div>',
        duration: '1s',
        crop: { x: 0, y: 0, width: 1, height: 1 },
      },
    })
  })

  it('rejects start/end on a React element overlay', () => {
    createOverlays({
      // @ts-expect-error start only applies to .mp4 file overlays
      badge: { element: createElement('div', null, 'x'), start: '1s' },
    })
  })

  it('rejects start/end on an inline html overlay', () => {
    createOverlays({
      // @ts-expect-error end only applies to .mp4 file overlays
      note: { html: '<div>x</div>', duration: '1s', end: '1s' },
    })
  })
})
