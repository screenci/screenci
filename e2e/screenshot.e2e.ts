import { test, expect } from '@playwright/test'
import { resolveCrop } from '../src/crop.js'
import { buildScreenCIContextOptions } from '../src/contextOptions.js'

test.describe('resolveCrop', () => {
  test('resolves a pixel rect for a locator', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 800 })
    await page.setContent(
      '<div id="card" style="position:absolute;left:100px;top:80px;width:300px;height:200px;background:#333"></div>'
    )

    const recorded = await resolveCrop(page.locator('#card'), page)

    expect(recorded.x).toBeCloseTo(100, 3)
    expect(recorded.y).toBeCloseTo(80, 3)
    expect(recorded.width).toBeCloseTo(300, 3)
    expect(recorded.height).toBeCloseTo(200, 3)
  })

  test('resolves an explicit pixel region', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 800 })
    const recorded = await resolveCrop(
      { x: 100, y: 160, width: 800, height: 480 },
      page
    )

    expect(recorded.x).toBeCloseTo(100, 3)
    expect(recorded.y).toBeCloseTo(160, 3)
    expect(recorded.width).toBeCloseTo(800, 3)
    expect(recorded.height).toBeCloseTo(480, 3)
  })

  test('expands a locator crop by padding', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 1000 })
    await page.setContent(
      '<div id="card" style="position:absolute;left:400px;top:400px;width:200px;height:200px"></div>'
    )

    // rect = 400,400,200,200; padding 20 px on every side
    const recorded = await resolveCrop(page.locator('#card'), page, {
      padding: 20,
    })

    expect(recorded.x).toBeCloseTo(380, 3)
    expect(recorded.y).toBeCloseTo(380, 3)
    expect(recorded.width).toBeCloseTo(240, 3)
    expect(recorded.height).toBeCloseTo(240, 3)
  })

  test('rejects a negative region', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 800 })
    await expect(
      resolveCrop({ x: -1, y: 0, width: 500, height: 500 }, page)
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
