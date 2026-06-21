import { describe, it, expect } from 'vitest'
import type { Locator } from '@playwright/test'
import { overlayRect } from './overlayRect.js'

type Box = { x: number; y: number; width: number; height: number } | null
type Size = { width: number; height: number } | null

function fakeLocator(box: Box, viewport: Size, innerSize?: Size): Locator {
  const page = {
    viewportSize: () => viewport,
    evaluate: async () => innerSize ?? { width: 0, height: 0 },
  }
  return {
    boundingBox: async () => box,
    page: () => page,
  } as unknown as Locator
}

describe('overlayRect', () => {
  it('exposes the bounding box in CSS px of the recording viewport', async () => {
    const rect = await overlayRect(
      fakeLocator(
        { x: 192, y: 108, width: 384, height: 216 },
        { width: 1920, height: 1080 }
      )
    )

    expect(rect.relativeTo).toBe('recording')
    expect(rect.x).toBe(192)
    expect(rect.y).toBe(108)
    expect(rect.width).toBe(384)
    expect(rect.height).toBeUndefined()
    expect(rect.pixels).toEqual({ x: 192, y: 108, width: 384, height: 216 })
  })

  it('exposes height instead of width when dimension is "height"', async () => {
    const rect = await overlayRect(
      fakeLocator(
        { x: 0, y: 0, width: 960, height: 540 },
        { width: 1920, height: 1080 }
      ),
      { dimension: 'height' }
    )

    expect(rect.height).toBe(540)
    expect(rect.width).toBeUndefined()
    // pixels still carries both dimensions for component props.
    expect(rect.pixels).toEqual({ x: 0, y: 0, width: 960, height: 540 })
  })

  it('inflates by margin (px on every side)', async () => {
    const rect = await overlayRect(
      fakeLocator(
        { x: 100, y: 100, width: 200, height: 200 },
        { width: 1000, height: 1000 }
      ),
      { margin: 50 }
    )
    expect(rect.pixels).toEqual({ x: 50, y: 50, width: 300, height: 300 })
    expect(rect.x).toBe(50)
    expect(rect.width).toBe(300)
  })

  it('clamps a margin that would extend past the viewport edges', async () => {
    const rect = await overlayRect(
      fakeLocator(
        { x: 10, y: 10, width: 100, height: 100 },
        { width: 1000, height: 1000 }
      ),
      { margin: 40 }
    )
    // Left/top clamp to 0 (10 - 40 < 0); right/bottom stay 110 + 40 = 150.
    expect(rect.pixels).toEqual({ x: 0, y: 0, width: 150, height: 150 })
  })

  it('passes relativeTo through to the result', async () => {
    const rect = await overlayRect(
      fakeLocator(
        { x: 0, y: 0, width: 100, height: 100 },
        { width: 1000, height: 1000 }
      ),
      { relativeTo: 'screen' }
    )
    expect(rect.relativeTo).toBe('screen')
  })

  it('spreads into a placement that resolveOverlayPlacement accepts', async () => {
    // The top-level placement fields (relativeTo/x/y/width) are exactly what an
    // OverlayConfig consumes; pixels is extra and ignored.
    const rect = await overlayRect(
      fakeLocator(
        { x: 100, y: 200, width: 300, height: 100 },
        { width: 1000, height: 1000 }
      )
    )
    const placement = {
      relativeTo: rect.relativeTo,
      x: rect.x,
      y: rect.y,
      width: rect.width,
    }
    expect(placement).toEqual({
      relativeTo: 'recording',
      x: 100,
      y: 200,
      width: 300,
    })
  })

  it('falls back to the live inner size when the context has no fixed viewport', async () => {
    // No fixed viewport, so the clamp uses the live inner size (500x500). The
    // margin pushes the right/bottom edge past it and is clamped there.
    const rect = await overlayRect(
      fakeLocator({ x: 400, y: 400, width: 100, height: 100 }, null, {
        width: 500,
        height: 500,
      }),
      { margin: 40 }
    )
    expect(rect.pixels).toEqual({ x: 360, y: 360, width: 140, height: 140 })
  })

  it('throws when the locator has no bounding box', async () => {
    await expect(
      overlayRect(fakeLocator(null, { width: 1000, height: 1000 }))
    ).rejects.toThrow('no bounding box')
  })
})
