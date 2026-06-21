import { describe, it, expect } from 'vitest'
import type { Locator, Page } from '@playwright/test'
import { applyCropPadding, resolveCrop } from './crop.js'

describe('applyCropPadding', () => {
  it('returns the rect unchanged (clamped) with zero padding', () => {
    const rect = { x: 0.2, y: 0.3, width: 0.4, height: 0.2 }
    const result = applyCropPadding(rect, 0)
    expect(result.x).toBeCloseTo(0.2, 6)
    expect(result.y).toBeCloseTo(0.3, 6)
    expect(result.width).toBeCloseTo(0.4, 6)
    expect(result.height).toBeCloseTo(0.2, 6)
  })

  it('expands by a fraction of the longer edge on every side', () => {
    // longer edge = width 0.4; pad = 0.4 * 0.1 = 0.04
    const rect = { x: 0.2, y: 0.3, width: 0.4, height: 0.2 }
    const padded = applyCropPadding(rect, 0.1)
    expect(padded.x).toBeCloseTo(0.16, 6)
    expect(padded.y).toBeCloseTo(0.26, 6)
    expect(padded.width).toBeCloseTo(0.48, 6)
    expect(padded.height).toBeCloseTo(0.28, 6)
  })

  it('clamps to the [0, 1] image bounds', () => {
    const rect = { x: 0.05, y: 0.0, width: 0.9, height: 1.0 }
    const padded = applyCropPadding(rect, 0.5)
    expect(padded.x).toBe(0)
    expect(padded.y).toBe(0)
    expect(padded.width).toBe(1)
    expect(padded.height).toBe(1)
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
  it('resolves a locator bounding box to a fractional rect', async () => {
    const page = fakePage({ width: 1000, height: 800 })
    const locator = fakeLocator({ x: 100, y: 80, width: 300, height: 200 })

    const crop = await resolveCrop(locator, page)

    expect(crop.x).toBeCloseTo(0.1, 6)
    expect(crop.y).toBeCloseTo(0.1, 6)
    expect(crop.width).toBeCloseTo(0.3, 6)
    expect(crop.height).toBeCloseTo(0.25, 6)
  })

  it('passes an explicit fractional region through', async () => {
    const page = fakePage({ width: 1000, height: 800 })

    const crop = await resolveCrop(
      { x: 0.1, y: 0.2, width: 0.8, height: 0.6 },
      page
    )

    expect(crop.x).toBeCloseTo(0.1, 6)
    expect(crop.y).toBeCloseTo(0.2, 6)
    expect(crop.width).toBeCloseTo(0.8, 6)
    expect(crop.height).toBeCloseTo(0.6, 6)
  })

  it('expands a locator crop by padding', async () => {
    const page = fakePage({ width: 1000, height: 1000 })
    const locator = fakeLocator({ x: 400, y: 400, width: 200, height: 200 })

    // rect = 0.4,0.4,0.2,0.2; pad = max(0.2,0.2) * 0.1 = 0.02
    const crop = await resolveCrop(locator, page, { padding: 0.1 })

    expect(crop.x).toBeCloseTo(0.38, 6)
    expect(crop.y).toBeCloseTo(0.38, 6)
    expect(crop.width).toBeCloseTo(0.24, 6)
    expect(crop.height).toBeCloseTo(0.24, 6)
  })

  it('rejects an out-of-range region', async () => {
    const page = fakePage({ width: 1000, height: 800 })
    await expect(
      resolveCrop({ x: 0, y: 0, width: 1.5, height: 0.5 }, page)
    ).rejects.toThrow(/crop/)
  })

  it('rejects a negative padding', async () => {
    const page = fakePage({ width: 1000, height: 800 })
    await expect(
      resolveCrop({ x: 0, y: 0, width: 0.5, height: 0.5 }, page, {
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
