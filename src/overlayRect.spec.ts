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
  it('normalizes the bounding box against the viewport (recording space)', async () => {
    const rect = await overlayRect(
      fakeLocator(
        { x: 192, y: 108, width: 384, height: 216 },
        { width: 1920, height: 1080 }
      )
    )

    expect(rect.relativeTo).toBe('recording')
    expect(rect.normalized).toEqual({ x: 0.1, y: 0.1, width: 0.2, height: 0.2 })
    expect(rect.x).toBe(0.1)
    expect(rect.y).toBe(0.1)
    expect(rect.width).toBe(0.2)
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

    expect(rect.height).toBe(0.5)
    expect(rect.width).toBeUndefined()
    // normalized still carries both dimensions for component props.
    expect(rect.normalized).toEqual({ x: 0, y: 0, width: 0.5, height: 0.5 })
  })

  it('inflates by margin (px on every side) and re-normalizes', async () => {
    const rect = await overlayRect(
      fakeLocator(
        { x: 100, y: 100, width: 200, height: 200 },
        { width: 1000, height: 1000 }
      ),
      { margin: 50 }
    )
    expect(rect.pixels).toEqual({ x: 50, y: 50, width: 300, height: 300 })
    expect(rect.normalized).toEqual({
      x: 0.05,
      y: 0.05,
      width: 0.3,
      height: 0.3,
    })
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
    // OverlayConfig consumes; normalized/pixels are extra and ignored.
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
      x: 0.1,
      y: 0.2,
      width: 0.3,
    })
  })

  it('falls back to the live inner size when the context has no fixed viewport', async () => {
    const rect = await overlayRect(
      fakeLocator({ x: 50, y: 50, width: 100, height: 100 }, null, {
        width: 500,
        height: 500,
      })
    )
    expect(rect.normalized).toEqual({ x: 0.1, y: 0.1, width: 0.2, height: 0.2 })
  })

  it('throws when the locator has no bounding box', async () => {
    await expect(
      overlayRect(fakeLocator(null, { width: 1000, height: 1000 }))
    ).rejects.toThrow('no bounding box')
  })
})
