import type { Locator } from '@playwright/test'
import { screenshot } from 'screenci'

// Rings a single element on the marketing site, then captures a branded still.
// The Overlays guide animates the same example.
screenshot.overlays({
  ring: (target: Locator) => ({
    html: '<div style="width:100%;height:100%;box-sizing:border-box;border:4px solid #ec4899;border-radius:14px"></div>',
    over: target,
    margin: 6,
  }),
})('Locator highlight', async ({ page, overlays }) => {
  await page.goto('https://screenci.com/')
  await page.waitForLoadState('networkidle')

  const cta = page.getByRole('link', { name: 'View Documentation' })
  await cta.scrollIntoViewIfNeeded()

  // In a still, start the overlay and leave it open: it stays in the image.
  await overlays.ring(cta).start()
})
