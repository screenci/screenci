import type { Locator } from '@playwright/test'
import { video } from 'screenci'

// Animates the same ring as the Screenshots still: it pulses while the page is
// driven underneath, then closes before the recording stops. An opacity-only
// pulse keeps the ring landed exactly on the element (no scale, so no capture
// padding is needed).
video.overlays({
  ring: (target: Locator) => ({
    html: '<div class="ring"></div>',
    css: `
      .ring {
        width: 100%;
        height: 100%;
        box-sizing: border-box;
        border: 4px solid #ec4899;
        border-radius: 14px;
        animation: ring-pulse 2s ease-in-out infinite;
      }
      @keyframes ring-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.3; }
      }
    `,
    over: target,
    margin: 6,
    animate: true,
    duration: '2.4s',
  }),
})('Locator highlight (animated)', async ({ page, overlays }) => {
  await page.goto('https://screenci.com/')
  await page.waitForLoadState('networkidle')

  const cta = page.getByRole('link', { name: 'View Documentation' })
  await cta.scrollIntoViewIfNeeded()

  // The ring pulses while the page stays live. Every start() must be ended
  // before the video function returns.
  const ring = overlays.ring(cta)
  await ring.start()
  await cta.hover()
  await ring.end()
})
