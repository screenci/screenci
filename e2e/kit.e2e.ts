import { test, expect } from '@playwright/test'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { Locator } from '@playwright/test'
import { rasterizeHtmlOverlay } from '../src/htmlRasterizer.js'
import { injectOverlayRootStyle } from '../src/asset.js'
import { buildKitDocument } from '../src/kit/render.js'
import { FALLBACK_THEME } from '../src/kit/theme.js'
import { validateKitInput } from '../src/kit/validate.js'
import { KIT } from '../src/kit/tokens.js'
import {
  createScreenCIRuntimeContext,
  runWithScreenCIRuntimeContext,
} from '../src/runtimeContext.js'

/**
 * Every kit primitive renders in a real browser to a root whose size the
 * flush relies on: content plus bleed padding for anchored and point
 * primitives, the element box plus bleed for the ring, and exactly the
 * viewport for the fill primitives.
 */
const locator = { boundingBox: async () => null } as unknown as Locator
const VIEWPORT = { width: 1280, height: 720 }

test.describe('overlay kit rasterization', () => {
  let dir: string
  test.beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'screenci-kit-e2e-'))
  })
  test.afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const rasterize = (
    page: import('@playwright/test').Page,
    name: string,
    html: string
  ) =>
    runWithScreenCIRuntimeContext(
      createScreenCIRuntimeContext({ page, recordingDir: dir }),
      () => rasterizeHtmlOverlay({ name, html })
    )

  test('ring fills the element box plus bleed', async ({ page }) => {
    const spec = validateKitInput('ring', { kit: 'ring', anchor: locator })
    const html = injectOverlayRootStyle(
      buildKitDocument(spec, {
        theme: FALLBACK_THEME,
        side: 'over',
        geometry: {},
      }),
      { size: { width: 240, height: 90 }, bleed: KIT.ring.bleed }
    )
    const result = await rasterize(page, 'ring', html)
    expect(result.width).toBe(240)
    expect(result.height).toBe(90)
  })

  test('callout, badge, step and keys shrink-wrap their content plus bleed', async ({
    page,
  }) => {
    const cases = [
      {
        name: 'callout',
        spec: validateKitInput('callout', {
          kit: 'callout',
          anchor: locator,
          text: 'Work email only',
        }),
        side: 'bottom' as const,
        bleed: KIT.callout.bleed,
        maxWidth: KIT.callout.maxWidth,
      },
      {
        name: 'badge',
        spec: validateKitInput('badge', {
          kit: 'badge',
          text: 'New',
          x: 0,
          y: 0,
        }),
        side: undefined,
        bleed: KIT.badge.bleed,
        maxWidth: 200,
      },
      {
        name: 'step',
        spec: validateKitInput('step', {
          kit: 'step',
          number: 4,
          anchor: locator,
        }),
        side: 'left' as const,
        bleed: KIT.step.bleed,
        maxWidth: KIT.step.size + 1,
      },
      {
        name: 'keys',
        spec: validateKitInput('keys', {
          kit: 'keys',
          keys: ['Cmd', 'K'],
          x: 0,
          y: 0,
        }),
        side: undefined,
        bleed: KIT.keys.bleed,
        maxWidth: 300,
      },
    ]
    for (const c of cases) {
      const html = injectOverlayRootStyle(
        buildKitDocument(c.spec, {
          theme: FALLBACK_THEME,
          side: c.side,
          geometry: {},
        }),
        { bleed: c.bleed }
      )
      const result = await rasterize(page, c.name, html)
      expect(result.width, c.name).toBeGreaterThan(2 * c.bleed)
      expect(result.width, c.name).toBeLessThanOrEqual(c.maxWidth + 2 * c.bleed)
      expect(result.height, c.name).toBeGreaterThan(2 * c.bleed)
    }
    // The step marker is a circle: content is exactly the token size.
    const step = cases[2]!
    const stepHtml = injectOverlayRootStyle(
      buildKitDocument(step.spec, {
        theme: FALLBACK_THEME,
        side: 'left',
        geometry: {},
      }),
      { bleed: step.bleed }
    )
    const stepResult = await rasterize(page, 'step-exact', stepHtml)
    expect(stepResult.width).toBe(KIT.step.size + 2 * step.bleed)
    expect(stepResult.height).toBe(KIT.step.size + 2 * step.bleed)
  })

  test('spotlight and title cover exactly the viewport', async ({ page }) => {
    const geometry = {
      element: { x: 500, y: 300, width: 200, height: 40 },
      viewport: VIEWPORT,
    }
    const spotlight = buildKitDocument(
      validateKitInput('spot', { kit: 'spotlight', anchor: locator }),
      { theme: FALLBACK_THEME, side: undefined, geometry }
    )
    const spot = await rasterize(page, 'spotlight', spotlight)
    expect(spot.width).toBe(VIEWPORT.width)
    expect(spot.height).toBe(VIEWPORT.height)

    const title = buildKitDocument(
      validateKitInput('title', {
        kit: 'title',
        title: 'Invite your team',
        subtitle: 'Settings > Members',
      }),
      { theme: FALLBACK_THEME, side: undefined, geometry }
    )
    const card = await rasterize(page, 'title', title)
    expect(card.width).toBe(VIEWPORT.width)
    expect(card.height).toBe(VIEWPORT.height)
  })
})
