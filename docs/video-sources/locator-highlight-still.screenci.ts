import type { Locator } from '@playwright/test'
import { createOverlays, screenshot } from 'screenci'

// Source of record for the "highlight a locator" still in the Screenshots
// guide. It rings a single element on the marketing site with a margin around
// it, then captures a branded still. The Overlays guide animates the same
// example (locator-highlight-animated.screenci.ts).
const overlays = createOverlays({
  // The overlay is sized to the element's box (plus the margin) and the ring
  // fills it, so it lands exactly around the locator with breathing room.
  ring: (target: Locator) => ({
    html: '<div style="width:100%;height:100%;border:4px solid #ec4899;border-radius:14px;box-shadow:0 0 0 6px rgba(236,72,153,0.25)"></div>',
    over: target,
    margin: 12,
  }),
})

screenshot('Locator highlight', async ({ page }) => {
  await page.goto('https://screenci.com/')
  await page.waitForLoadState('networkidle')

  const cta = page.getByRole('link', { name: 'View Documentation' })
  await cta.scrollIntoViewIfNeeded()

  // In a still, start the overlay and leave it open: it stays in the image,
  // with no matching end() needed.
  await overlays.ring(cta).start()
})
