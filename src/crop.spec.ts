import { describe, it, expect } from 'vitest'
import type { Locator, Page } from '@playwright/test'
import { applyCropAspectRatio, applyCropPadding, resolveCrop } from './crop.js'

const VIEWPORT = { width: 1000, height: 800 }

describe('applyCropPadding', () => {
  it('returns the rect unchanged (clamped) with zero padding', () => {
    const rect = { x: 200, y: 300, width: 400, height: 200 }
    const result = applyCropPadding(rect, 0, VIEWPORT)
    expect(result).toEqual({ x: 200, y: 300, width: 400, height: 200 })
  })

  it('expands by the padding (CSS px) on every side', () => {
    const rect = { x: 200, y: 300, width: 400, height: 200 }
    const padded = applyCropPadding(rect, 40, VIEWPORT)
    expect(padded).toEqual({ x: 160, y: 260, width: 480, height: 280 })
  })

  it('applies uneven per-side padding', () => {
    const rect = { x: 200, y: 300, width: 400, height: 200 }
    const padded = applyCropPadding(
      rect,
      { top: 10, right: 20, bottom: 30, left: 40 },
      VIEWPORT
    )
    // left 200-40, top 300-10, right 600+20, bottom 500+30.
    expect(padded).toEqual({ x: 160, y: 290, width: 460, height: 240 })
  })

  it('treats omitted sides of a per-side padding as zero', () => {
    const rect = { x: 200, y: 300, width: 400, height: 200 }
    const padded = applyCropPadding(rect, { left: 50 }, VIEWPORT)
    expect(padded).toEqual({ x: 150, y: 300, width: 450, height: 200 })
  })

  it('clamps to the viewport bounds', () => {
    const rect = { x: 50, y: 0, width: 900, height: 800 }
    const padded = applyCropPadding(rect, 450, VIEWPORT)
    expect(padded).toEqual({ x: 0, y: 0, width: 1000, height: 800 })
  })
})

describe('applyCropAspectRatio', () => {
  const square = { width: 1000, height: 1000 }

  it('widens a too-narrow crop to the ratio, centered', () => {
    const rect = { x: 400, y: 300, width: 200, height: 200 }
    const out = applyCropAspectRatio(rect, 2, square)
    expect(out).toEqual({ x: 300, y: 300, width: 400, height: 200 })
  })

  it('grows the height of a too-wide crop to the ratio, centered', () => {
    const rect = { x: 200, y: 400, width: 400, height: 200 }
    const out = applyCropAspectRatio(rect, 1, square)
    expect(out).toEqual({ x: 200, y: 300, width: 400, height: 400 })
  })

  it('trims the other axis when the viewport caps the growth', () => {
    // Want 4:1 from a square, but the viewport is only 400 wide: width caps at
    // 400, so the height shrinks to 100 to keep the ratio exact.
    const rect = { x: 0, y: 0, width: 200, height: 200 }
    const out = applyCropAspectRatio(rect, 4, { width: 400, height: 1000 })
    expect(out).toEqual({ x: 0, y: 50, width: 400, height: 100 })
  })
})

/** Minimal page stub with a fixed viewport for region-based crops. */
function fakePage(viewport: { width: number; height: number }): Page {
  return {
    viewportSize: () => viewport,
  } as unknown as Page
}

/** Locator stub returning a fixed bounding box (or null). */
function fakeLocator(
  box: { x: number; y: number; width: number; height: number } | null
): Locator {
  return {
    boundingBox: async () => box,
  } as unknown as Locator
}

describe('resolveCrop', () => {
  it('resolves a locator bounding box to a pixel rect', async () => {
    const page = fakePage({ width: 1000, height: 800 })
    const locator = fakeLocator({ x: 100, y: 80, width: 300, height: 200 })

    const crop = await resolveCrop(locator, page)

    expect(crop).toEqual({ x: 100, y: 80, width: 300, height: 200 })
  })

  it('passes an explicit pixel region through', async () => {
    const page = fakePage({ width: 1000, height: 800 })

    const crop = await resolveCrop(
      { x: 100, y: 160, width: 800, height: 480 },
      page
    )

    expect(crop).toEqual({ x: 100, y: 160, width: 800, height: 480 })
  })

  it('expands a locator crop by padding', async () => {
    const page = fakePage({ width: 1000, height: 1000 })
    const locator = fakeLocator({ x: 400, y: 400, width: 200, height: 200 })

    // rect = 400,400,200,200; padding 20 px on every side
    const crop = await resolveCrop(locator, page, { padding: 20 })

    expect(crop).toEqual({ x: 380, y: 380, width: 240, height: 240 })
  })

  it('applies uneven padding then forces the aspect ratio', async () => {
    const page = fakePage({ width: 1000, height: 1000 })
    const locator = fakeLocator({ x: 400, y: 300, width: 200, height: 200 })

    // padding 50 px -> {350,250,300,300}; aspectRatio 2 widens to 600x300.
    const crop = await resolveCrop(locator, page, {
      padding: 50,
      aspectRatio: 2,
    })

    expect(crop).toEqual({ x: 200, y: 250, width: 600, height: 300 })
  })

  it('rejects a negative per-side padding', async () => {
    const page = fakePage({ width: 1000, height: 800 })
    await expect(
      resolveCrop({ x: 0, y: 0, width: 500, height: 500 }, page, {
        padding: { top: -5 },
      })
    ).rejects.toThrow(/crop/)
  })

  it('rejects a non-positive aspect ratio', async () => {
    const page = fakePage({ width: 1000, height: 800 })
    await expect(
      resolveCrop({ x: 0, y: 0, width: 500, height: 500 }, page, {
        aspectRatio: 0,
      })
    ).rejects.toThrow(/crop/)
  })

  it('rejects a negative region', async () => {
    const page = fakePage({ width: 1000, height: 800 })
    await expect(
      resolveCrop({ x: -1, y: 0, width: 500, height: 500 }, page)
    ).rejects.toThrow(/crop/)
  })

  it('rejects a zero-sized region', async () => {
    const page = fakePage({ width: 1000, height: 800 })
    await expect(
      resolveCrop({ x: 0, y: 0, width: 0, height: 500 }, page)
    ).rejects.toThrow(/crop/)
  })

  it('rejects a negative padding', async () => {
    const page = fakePage({ width: 1000, height: 800 })
    await expect(
      resolveCrop({ x: 0, y: 0, width: 500, height: 500 }, page, {
        padding: -1,
      })
    ).rejects.toThrow(/crop/)
  })

  it('throws when a locator has no bounding box', async () => {
    const page = fakePage({ width: 1000, height: 800 })
    await expect(resolveCrop(fakeLocator(null), page)).rejects.toThrow(
      /bounding box/
    )
  })
})
