import type { Locator } from '@playwright/test'
import { createOverlays, video } from 'screenci'

// Source of record for the animated "highlight a locator" overlay in the
// Overlays guide. It rings the same element as the Screenshots still
// (locator-highlight-still.screenci.ts), but the ring pulses while the page is
// driven underneath, then closes before the recording stops.
const overlays = createOverlays({
  // Sized to the element's box (plus the margin); the ring fills it and pulses
  // via a CSS animation. capturePadding gives the scale-up room so it is not
  // clipped at the box edge.
  ring: (target: Locator) => ({
    html: '<div class="screenci-ring"></div>',
    css: `
      .screenci-ring {
        width: 100%;
        height: 100%;
        border: 4px solid #ec4899;
        border-radius: 14px;
        box-shadow: 0 0 0 6px rgba(236, 72, 153, 0.25);
        animation: screenci-ring-pulse 1.2s ease-in-out infinite;
      }
      @keyframes screenci-ring-pulse {
        0%,
        100% {
          opacity: 1;
          transform: scale(1);
        }
        50% {
          opacity: 0.45;
          transform: scale(1.04);
        }
      }
    `,
    over: target,
    margin: 12,
    animate: true,
    durationMs: 2400,
    capturePadding: 24,
  }),
})

video('Locator highlight (animated)', async ({ page }) => {
  await page.goto('https://screenci.com/')
  await page.waitForLoadState('networkidle')

  const cta = page.getByRole('link', { name: 'View Documentation' })
  await cta.scrollIntoViewIfNeeded()

  // The ring pulses while the page stays live underneath. Every start() must be
  // ended before the video function returns. Capture the controller so the
  // locator appears once.
  const ring = overlays.ring(cta)
  await ring.start()
  await cta.hover()
  await ring.end()
})
