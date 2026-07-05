import { describe, it, expectTypeOf } from 'vitest'
import { createOverlays, type OverlayController } from './asset.js'

describe('createOverlays type constraints', () => {
  it('accepts a bare file path string', () => {
    createOverlays({ logo: './logo.png' })
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

  it('accepts an .html page overlay', () => {
    createOverlays({
      note: { path: './note.html', durationMs: 1200, x: 1340, width: 380 },
    })
  })

  it('accepts a .tsx page overlay with props', () => {
    createOverlays({
      badge: { path: './Badge.tsx', props: { label: 'New' }, width: 200 },
    })
  })

  it('rejects props on a non-.tsx overlay', () => {
    createOverlays({
      // @ts-expect-error props are only supported for .tsx page overlays
      note: { path: './note.html', props: { label: 'x' } },
    })
  })

  it('rejects props on an image overlay', () => {
    createOverlays({
      // @ts-expect-error props are only supported for .tsx page overlays
      logo: { path: './logo.png', props: { label: 'x' } },
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

  it('accepts crop and start/end on a video file overlay', () => {
    createOverlays({
      clip: {
        path: './clip.mp4',
        crop: { x: 10, y: 20, width: 200, height: 100 },
        start: '2s',
        end: '50%',
      },
    })
  })

  it('accepts crop on an image file overlay', () => {
    createOverlays({
      logo: {
        path: './logo.png',
        duration: '1s',
        crop: { x: 0, y: 0, width: 100, height: 80 },
      },
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
      ring: (p: { path: `${string}.html`; x: number }) => ({
        path: p.path,
        x: p.x,
      }),
    })
    expectTypeOf(overlays.ring).toEqualTypeOf<
      (props: { path: `${string}.html`; x: number }) => OverlayController
    >()
    expectTypeOf(
      overlays.ring({ path: './ring.html', x: 1 })
    ).toEqualTypeOf<OverlayController>()
  })

  it('keeps static keys as plain controllers alongside factory keys', () => {
    const overlays = createOverlays({
      logo: './logo.png',
      note: (p: { x: number }) => ({ path: './note.html', x: p.x }),
    })
    expectTypeOf(overlays.logo).toEqualTypeOf<OverlayController>()
    expectTypeOf(overlays.note).toEqualTypeOf<
      (props: { x: number }) => OverlayController
    >()
  })

  it('rejects calling a static-key controller with props', () => {
    const overlays = createOverlays({ logo: './logo.png' })
    // @ts-expect-error a static overlay controller takes a durationMs, not props
    overlays.logo({ text: 'hi' })
  })

  it('rejects calling a factory-key controller without props', () => {
    const overlays = createOverlays({
      note: (p: { x: number }) => ({ path: './note.html', x: p.x }),
    })
    // @ts-expect-error the factory requires its props argument
    overlays.note()
  })
})
