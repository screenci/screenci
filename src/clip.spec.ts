import { describe, it, expect } from 'vitest'
import type { Locator, Page } from '@playwright/test'
import { applyClipPadding, resolveClip } from './clip.js'

const VIEWPORT = { width: 1000, height: 800 }

describe('applyClipPadding', () => {
  it('returns the rect unchanged (clamped) with zero padding', () => {
    const rect = { x: 200, y: 300, width: 400, height: 200 }
    const result = applyClipPadding(rect, 0, VIEWPORT)
    expect(result).toEqual({ x: 200, y: 300, width: 400, height: 200 })
  })

  it('expands by the padding (CSS px) on every side', () => {
    const rect = { x: 200, y: 300, width: 400, height: 200 }
    const padded = applyClipPadding(rect, 40, VIEWPORT)
    expect(padded).toEqual({ x: 160, y: 260, width: 480, height: 280 })
  })

  it('applies uneven per-side padding', () => {
    const rect = { x: 200, y: 300, width: 400, height: 200 }
    const padded = applyClipPadding(
      rect,
      { top: 10, right: 20, bottom: 30, left: 40 },
      VIEWPORT
    )
    // left 200-40, top 300-10, right 600+20, bottom 500+30.
    expect(padded).toEqual({ x: 160, y: 290, width: 460, height: 240 })
  })

  it('treats omitted sides of a per-side padding as zero', () => {
    const rect = { x: 200, y: 300, width: 400, height: 200 }
    const padded = applyClipPadding(rect, { left: 50 }, VIEWPORT)
    expect(padded).toEqual({ x: 150, y: 300, width: 450, height: 200 })
  })

  it('clamps to the viewport bounds', () => {
    const rect = { x: 50, y: 0, width: 900, height: 800 }
    const padded = applyClipPadding(rect, 450, VIEWPORT)
    expect(padded).toEqual({ x: 0, y: 0, width: 1000, height: 800 })
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

describe('resolveClip', () => {
  it('records a locator bounding box as a locked box with zero padding', async () => {
    const page = fakePage({ width: 1000, height: 800 })
    const locator = fakeLocator({ x: 100, y: 80, width: 300, height: 200 })

    const clip = await resolveClip(locator, page)

    expect(clip).toEqual({
      box: { x: 100, y: 80, width: 300, height: 200 },
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      source: 'locator',
    })
  })

  it('records an explicit region as an editable box with zero padding', async () => {
    const page = fakePage({ width: 1000, height: 800 })

    const clip = await resolveClip(
      { x: 100, y: 160, width: 800, height: 480 },
      page
    )

    expect(clip).toEqual({
      box: { x: 100, y: 160, width: 800, height: 480 },
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      source: 'region',
    })
  })

  it('keeps a locator box locked and the padding separate (editable in Studio)', async () => {
    const page = fakePage({ width: 1000, height: 1000 })
    const locator = fakeLocator({ x: 400, y: 400, width: 200, height: 200 })

    // The box stays the element box; padding is recorded as a per-side amount and
    // applied later by the renderer, not folded into the box here.
    const clip = await resolveClip(locator, page, { padding: 20 })

    expect(clip).toEqual({
      box: { x: 400, y: 400, width: 200, height: 200 },
      padding: { top: 20, right: 20, bottom: 20, left: 20 },
      source: 'locator',
    })
  })

  it('normalizes uneven per-side padding on a locator clip', async () => {
    const page = fakePage({ width: 1000, height: 1000 })
    const locator = fakeLocator({ x: 400, y: 300, width: 200, height: 200 })

    const clip = await resolveClip(locator, page, {
      padding: { top: 10, right: 20, bottom: 30, left: 40 },
    })

    expect(clip).toEqual({
      box: { x: 400, y: 300, width: 200, height: 200 },
      padding: { top: 10, right: 20, bottom: 30, left: 40 },
      source: 'locator',
    })
  })

  it('folds padding into a region box and clamps it to the viewport', async () => {
    const page = fakePage({ width: 1000, height: 1000 })

    // Region 100,100,200,200 padded 50 px -> 50,50,300,300 (within viewport).
    const clip = await resolveClip(
      { x: 100, y: 100, width: 200, height: 200 },
      page,
      { padding: 50 }
    )

    expect(clip).toEqual({
      box: { x: 50, y: 50, width: 300, height: 300 },
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      source: 'region',
    })
  })

  it('rejects a negative per-side padding', async () => {
    const page = fakePage({ width: 1000, height: 800 })
    await expect(
      resolveClip({ x: 0, y: 0, width: 500, height: 500 }, page, {
        padding: { top: -5 },
      })
    ).rejects.toThrow(/clip/)
  })

  it('rejects a negative region', async () => {
    const page = fakePage({ width: 1000, height: 800 })
    await expect(
      resolveClip({ x: -1, y: 0, width: 500, height: 500 }, page)
    ).rejects.toThrow(/clip/)
  })

  it('rejects a zero-sized region', async () => {
    const page = fakePage({ width: 1000, height: 800 })
    await expect(
      resolveClip({ x: 0, y: 0, width: 0, height: 500 }, page)
    ).rejects.toThrow(/clip/)
  })

  it('rejects a negative padding', async () => {
    const page = fakePage({ width: 1000, height: 800 })
    await expect(
      resolveClip({ x: 0, y: 0, width: 500, height: 500 }, page, {
        padding: -1,
      })
    ).rejects.toThrow(/clip/)
  })

  it('throws when a locator has no bounding box', async () => {
    const page = fakePage({ width: 1000, height: 800 })
    await expect(resolveClip(fakeLocator(null), page)).rejects.toThrow(
      /bounding box/
    )
  })
})
