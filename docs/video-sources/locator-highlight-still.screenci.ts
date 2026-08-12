import type { Locator } from '@playwright/test'
import { screenshot } from 'screenci'

// Rings a single element on the marketing site, then captures a branded still.
// The Overlays guide animates the same example.
screenshot.overlays({
  // A full .html page that fills its box; `over` sizes it to the element.
  ring: (target: Locator) => ({
    path: './assets/ring.html',
    over: target,
    margin: 6,
  }),
})('Locator highlight', async ({ page, overlays }) => {
  await page.goto('https://screenci.com/')

  const cta = page.getByRole('link', { name: 'View Documentation' })
  await cta.scrollIntoViewIfNeeded()

  // In a still, start the overlay and leave it open: it stays in the image.
  await overlays.ring(cta).start()
})
