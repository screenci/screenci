import { test, expect } from '@playwright/test'
import { resolveCrop } from '../src/crop.js'
import { buildScreenCIContextOptions } from '../src/contextOptions.js'

test.describe('resolveCrop', () => {
  test('resolves a fractional rect for a locator', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 800 })
    await page.setContent(
      '<div id="card" style="position:absolute;left:100px;top:80px;width:300px;height:200px;background:#333"></div>'
    )

    const recorded = await resolveCrop(page.locator('#card'), page)

    expect(recorded.x).toBeCloseTo(0.1, 3)
    expect(recorded.y).toBeCloseTo(0.1, 3)
    expect(recorded.width).toBeCloseTo(0.3, 3)
    expect(recorded.height).toBeCloseTo(0.25, 3)
  })

  test('resolves an explicit fractional region', async ({ page }) => {
    const recorded = await resolveCrop(
      { x: 0.1, y: 0.2, width: 0.8, height: 0.6 },
      page
    )

    expect(recorded.x).toBeCloseTo(0.1, 3)
    expect(recorded.y).toBeCloseTo(0.2, 3)
    expect(recorded.width).toBeCloseTo(0.8, 3)
    expect(recorded.height).toBeCloseTo(0.6, 3)
  })

  test('expands a locator crop by padding', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 1000 })
    await page.setContent(
      '<div id="card" style="position:absolute;left:400px;top:400px;width:200px;height:200px"></div>'
    )

    // rect = 0.4,0.4,0.2,0.2; pad = max(0.2,0.2) * 0.1 = 0.02
    const recorded = await resolveCrop(page.locator('#card'), page, {
      padding: 0.1,
    })

    expect(recorded.x).toBeCloseTo(0.38, 3)
    expect(recorded.y).toBeCloseTo(0.38, 3)
    expect(recorded.width).toBeCloseTo(0.24, 3)
    expect(recorded.height).toBeCloseTo(0.24, 3)
  })

  test('rejects an out-of-range region', async ({ page }) => {
    await expect(
      resolveCrop({ x: 0, y: 0, width: 1.5, height: 0.5 }, page)
    ).rejects.toThrow(/crop/)
  })
})

test.describe('context option forwarding', () => {
  test('forwards colorScheme: dark to the created context', async ({
    browser,
  }) => {
    const context = await browser.newContext(
      buildScreenCIContextOptions({
        dimensions: { width: 800, height: 600 },
        forwarded: { colorScheme: 'dark' },
        applyLocaleDefault: false,
      })
    )
    const page = await context.newPage()
    const prefersDark = await page.evaluate(
      () => window.matchMedia('(prefers-color-scheme: dark)').matches
    )
    expect(prefersDark).toBe(true)
    await context.close()
  })

  test('captures at the requested deviceScaleFactor', async ({ browser }) => {
    const context = await browser.newContext(
      buildScreenCIContextOptions({
        dimensions: { width: 400, height: 300 },
        forwarded: {},
        applyLocaleDefault: false,
        deviceScaleFactor: 2,
      })
    )
    const page = await context.newPage()
    const dpr = await page.evaluate(() => window.devicePixelRatio)
    expect(dpr).toBe(2)
    await context.close()
  })
})
