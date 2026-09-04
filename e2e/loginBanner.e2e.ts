import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import {
  LOGIN_BANNER_BINDING,
  LOGIN_BANNER_HOST_ID,
  loginBannerCopy,
  loginBannerScript,
} from '../src/loginBanner.js'

/**
 * The card `screenci login` floats over the product. The unit spec can only
 * assert on the script's text; everything that actually matters here is
 * behaviour in a real browser: where it lands, whether it covers the
 * product's own sign-in control, and whether it can be moved out of the way.
 */

const ORIGIN = 'http://app.test'

/** A product with its own sign-in button pinned top right, as most have. */
const PAGE_HTML = `
  <style>
    body { margin: 0; font: 14px sans-serif; }
    #topbar { position: fixed; top: 0; left: 0; right: 0; height: 56px;
      background: #eee; z-index: 5; }
    #app-login { position: absolute; right: 24px; top: 14px; padding: 6px 14px; }
  </style>
  <div id="topbar"><button id="app-login">Log in</button></div>
`

async function openProduct(page: Page): Promise<() => boolean> {
  let finished = false
  await page.context().exposeBinding(LOGIN_BANNER_BINDING, () => {
    finished = true
  })
  await page.context().addInitScript({
    content: loginBannerScript(loginBannerCopy(ORIGIN), ORIGIN),
  })
  await page.route(`${ORIGIN}/**`, (route) =>
    route.fulfill({ contentType: 'text/html', body: PAGE_HTML })
  )
  await page.goto(`${ORIGIN}/`)
  await expect(page.locator(`#${LOGIN_BANNER_HOST_ID}`)).toBeVisible()
  return () => finished
}

test.describe('the sign-in card', () => {
  test("leaves the product's own sign-in button clickable", async ({
    page,
  }) => {
    await openProduct(page)
    // A full-width bar across the top covered exactly this button, which is
    // the reason the card is a small floating one.
    await page.locator('#app-login').click({ timeout: 3000 })
  })

  test('sits in the top left corner, not across the top', async ({ page }) => {
    await openProduct(page)
    const viewport = page.viewportSize()!
    const box = (await page.locator(`#${LOGIN_BANNER_HOST_ID}`).boundingBox())!

    expect(box.width).toBeLessThan(320)
    // Nowhere near full width, and in the left half: sign-in and account
    // controls live on the right far more often than the left.
    expect(box.width).toBeLessThan(viewport.width / 2)
    expect(box.x).toBeLessThan(viewport.width / 4)
    expect(box.y).toBeLessThan(viewport.height / 2)
  })

  test('can be dragged anywhere, and stays where it was put', async ({
    page,
  }) => {
    await openProduct(page)
    const host = page.locator(`#${LOGIN_BANNER_HOST_ID}`)
    const before = (await host.boundingBox())!

    await page.mouse.move(before.x + 60, before.y + 12)
    await page.mouse.down()
    await page.mouse.move(before.x + 60 + 400, before.y + 12 + 200, {
      steps: 10,
    })
    await page.mouse.up()

    const after = (await host.boundingBox())!
    expect(Math.round(after.x)).toBe(Math.round(before.x + 400))
    expect(Math.round(after.y)).toBe(Math.round(before.y + 200))

    // A sign-in is several pages; dropping the card back over the form on
    // every navigation would make moving it pointless.
    await page.goto(`${ORIGIN}/step-2`)
    await expect(host).toBeVisible()
    const restored = (await host.boundingBox())!
    expect(Math.round(restored.x)).toBe(Math.round(after.x))
    expect(Math.round(restored.y)).toBe(Math.round(after.y))
  })

  test('cannot be dragged out of reach', async ({ page }) => {
    await openProduct(page)
    const host = page.locator(`#${LOGIN_BANNER_HOST_ID}`)
    const before = (await host.boundingBox())!
    const viewport = page.viewportSize()!

    await page.mouse.move(before.x + 60, before.y + 12)
    await page.mouse.down()
    await page.mouse.move(-4000, 4000, { steps: 8 })
    await page.mouse.up()

    const box = (await host.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height)
  })

  test('finishes the sign-in when its button is pressed, and never on a drag', async ({
    page,
  }) => {
    const finished = await openProduct(page)
    const host = page.locator(`#${LOGIN_BANNER_HOST_ID}`)
    const before = (await host.boundingBox())!

    await page.mouse.move(before.x + 60, before.y + 12)
    await page.mouse.down()
    await page.mouse.move(before.x + 10, before.y + 120, { steps: 6 })
    await page.mouse.up()
    expect(finished()).toBe(false)

    await host.getByRole('button').click()
    await expect.poll(finished).toBe(true)
    // It reports what it is doing rather than sitting there looking idle.
    await expect(host.getByRole('button')).toHaveText(
      loginBannerCopy(null).busy
    )
  })

  test('keeps out of an identity provider and out of iframes', async ({
    page,
  }) => {
    await openProduct(page)
    // Someone else's sign-in page must never get ScreenCI chrome over it.
    await page.route('http://idp.test/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<h1>SSO</h1>' })
    )
    await page.goto('http://idp.test/')
    await expect(page.locator(`#${LOGIN_BANNER_HOST_ID}`)).toHaveCount(0)

    await page.goto(`${ORIGIN}/`)
    await expect(page.locator(`#${LOGIN_BANNER_HOST_ID}`)).toBeVisible()
    // An embedded captcha or payment widget must not get one either.
    await page.evaluate((origin) => {
      const frame = document.createElement('iframe')
      frame.src = `${origin}/embedded`
      document.body.appendChild(frame)
    }, ORIGIN)
    const frame = page.frameLocator('iframe')
    await expect(frame.locator('#topbar')).toBeVisible()
    await expect(frame.locator(`#${LOGIN_BANNER_HOST_ID}`)).toHaveCount(0)
  })
})
