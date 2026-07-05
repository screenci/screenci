import type { Locator } from '@playwright/test'
import { video } from 'screenci'

// Animates the same ring as the Screenshots still: it pulses while the page is
// driven underneath, then closes before the recording stops. An opacity-only
// pulse keeps the ring landed exactly on the element (no scale, so no capture
// padding is needed).
video.overlays({
  // A full .html page whose CSS pulses the ring; `over` sizes it to the element.
  ring: (target: Locator) => ({
    path: './assets/ring-animated.html',
    over: target,
    margin: 6,
    animate: true,
    duration: '2.4s',
  }),
})('Locator highlight (animated)', async ({ page, overlays }) => {
  await page.goto('https://screenci.com/')

  const cta = page.getByRole('link', { name: 'View Documentation' })
  await cta.scrollIntoViewIfNeeded()

  // The ring pulses while the page stays live. Every start() must be ended
  // before the video function returns.
  const ring = overlays.ring(cta)
  await ring.start()
  await cta.hover()
  await ring.end()
})
