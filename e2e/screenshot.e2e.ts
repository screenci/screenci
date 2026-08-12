import { test, expect } from '@playwright/test'
import { resolveClip } from '../src/clip.js'
import { buildScreenCIContextOptions } from '../src/contextOptions.js'

test.describe('resolveClip', () => {
  test('resolves a pixel rect for a locator', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 800 })
    await page.setContent(
      '<div id="card" style="position:absolute;left:100px;top:80px;width:300px;height:200px;background:#333"></div>'
    )

    const recorded = await resolveClip(page.locator('#card'), page)

    expect(recorded.source).toBe('locator')
    expect(recorded.box.x).toBeCloseTo(100, 3)
    expect(recorded.box.y).toBeCloseTo(80, 3)
    expect(recorded.box.width).toBeCloseTo(300, 3)
    expect(recorded.box.height).toBeCloseTo(200, 3)
    expect(recorded.padding).toEqual({ top: 0, right: 0, bottom: 0, left: 0 })
  })

  test('resolves an explicit pixel region', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 800 })
    const recorded = await resolveClip(
      { x: 100, y: 160, width: 800, height: 480 },
      page
    )

    expect(recorded.source).toBe('region')
    expect(recorded.box.x).toBeCloseTo(100, 3)
    expect(recorded.box.y).toBeCloseTo(160, 3)
    expect(recorded.box.width).toBeCloseTo(800, 3)
    expect(recorded.box.height).toBeCloseTo(480, 3)
  })

  test('keeps a locator box locked and records padding separately', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1000, height: 1000 })
    await page.setContent(
      '<div id="card" style="position:absolute;left:400px;top:400px;width:200px;height:200px"></div>'
    )

    const recorded = await resolveClip(page.locator('#card'), page, {
      padding: 20,
    })

    // The element box is unchanged; the renderer applies the padding later.
    expect(recorded.box.x).toBeCloseTo(400, 3)
    expect(recorded.box.y).toBeCloseTo(400, 3)
    expect(recorded.box.width).toBeCloseTo(200, 3)
    expect(recorded.box.height).toBeCloseTo(200, 3)
    expect(recorded.padding).toEqual({
      top: 20,
      right: 20,
      bottom: 20,
      left: 20,
    })
  })

  test('rejects a negative region', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 800 })
    await expect(
      resolveClip({ x: -1, y: 0, width: 500, height: 500 }, page)
    ).rejects.toThrow(/clip/)
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
