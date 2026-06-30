import { test, expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { instrumentPage, setActiveClickRecorder } from '../src/instrument.js'
import { EventRecorder } from '../src/events.js'
import { redact, resolveRedactStyle } from '../src/redact.js'
import {
  redactApplyConfigSelectors,
  redactControllerBootstrap,
  REDACT_ROOT_ID,
} from '../src/redactController.js'
import { resetRedactRuntimeState } from '../src/runtimeContext.js'

const PAGE_HTML = `
  <style>
    body { margin: 0; font: 16px monospace; }
    #secret { position: absolute; top: 40px; left: 40px; width: 200px;
      height: 40px; background: #fff; color: #000; }
    #spacer { height: 2000px; }
    #secret-input { position: absolute; top: 100px; left: 40px; width: 240px; }
  </style>
  <div id="secret">SECRET-API-KEY-12345</div>
  <input id="secret-input" />
  <div id="spacer"></div>
`

function redactFill(locator: Locator): {
  fill(value: string, opts: { redact: boolean }): Promise<void>
} {
  return locator as never
}

async function tickFrames(page: Page, count = 3): Promise<void> {
  await page.evaluate(
    (n) =>
      new Promise<void>((resolve) => {
        let i = 0
        const step = (): void => {
          i += 1
          if (i >= n) resolve()
          else requestAnimationFrame(step)
        }
        requestAnimationFrame(step)
      }),
    count
  )
}

function maskCount(page: Page): Promise<number> {
  return page.evaluate((rootId) => {
    const root = document.getElementById(rootId)
    return root ? root.childElementCount : 0
  }, REDACT_ROOT_ID)
}

// The per-fill path runs the full fill wrapper; disable simulated timings so the
// typing animation does not slow the suite. Scoped to this file (save/restore in
// afterEach) so it does not leak into other e2e files sharing the worker.
let prevTimingEnv: string | undefined

test.beforeEach(async ({ page }) => {
  prevTimingEnv = process.env.SCREENCI_DISABLE_RECORDING_TIMINGS
  process.env.SCREENCI_DISABLE_RECORDING_TIMINGS = 'true'
  resetRedactRuntimeState()
  await instrumentPage(page)
  await page.addInitScript(redactControllerBootstrap)
  await page.setContent(PAGE_HTML)
  const recorder = new EventRecorder()
  recorder.start()
  setActiveClickRecorder(recorder)
})

test.afterEach(() => {
  if (prevTimingEnv === undefined) {
    delete process.env.SCREENCI_DISABLE_RECORDING_TIMINGS
  } else {
    process.env.SCREENCI_DISABLE_RECORDING_TIMINGS = prevTimingEnv
  }
  setActiveClickRecorder(null)
})

function maskBackground(page: Page): Promise<string> {
  return page.evaluate((rootId) => {
    const div = document.getElementById(rootId)
      ?.firstElementChild as HTMLElement
    return div?.style.background ?? ''
  }, REDACT_ROOT_ID)
}

test('covers the element with an opaque sampled panel by default', async ({
  page,
}) => {
  const before = await page.locator('#secret').screenshot()

  await redact(page.locator('#secret'))
  await tickFrames(page)

  expect(await maskCount(page)).toBe(1)
  // The default panel samples a color from underneath (the white field).
  expect(await maskBackground(page)).not.toBe('')

  const after = await page.locator('#secret').screenshot()
  // The captured pixels actually changed: the secret is obscured in what would
  // be recorded, not merely covered by a separate compositing layer.
  expect(before.equals(after)).toBe(false)
})

test('uses a fixed color when one is given', async ({ page }) => {
  await redact(page.locator('#secret'), { style: { color: 'rgb(1, 2, 3)' } })
  await tickFrames(page)

  expect(await maskCount(page)).toBe(1)
  expect(await maskBackground(page)).toContain('rgb(1, 2, 3)')
})

test('applies custom css to the mask panel', async ({ page }) => {
  await redact(page.locator('#secret'), {
    style: { css: 'background: rgb(9, 8, 7)' },
  })
  await tickFrames(page)

  expect(await maskBackground(page)).toContain('rgb(9, 8, 7)')
})

test('the mask follows the element when the page scrolls', async ({ page }) => {
  await redact(page.locator('#secret'))
  await tickFrames(page)

  const topBefore = await page.evaluate((rootId) => {
    const div = document.getElementById(rootId)
      ?.firstElementChild as HTMLElement
    return div?.style.transform ?? ''
  }, REDACT_ROOT_ID)

  await page.evaluate(() => window.scrollTo(0, 500))
  await tickFrames(page)

  const topAfter = await page.evaluate((rootId) => {
    const div = document.getElementById(rootId)
      ?.firstElementChild as HTMLElement
    return div?.style.transform ?? ''
  }, REDACT_ROOT_ID)

  expect(topAfter).not.toBe('')
  expect(topAfter).not.toBe(topBefore)
})

test('unredact restores the element', async ({ page }) => {
  const handle = await redact(page.locator('#secret'))
  await tickFrames(page)
  expect(await maskCount(page)).toBe(1)

  await handle.unredact()
  await tickFrames(page)

  expect(await maskCount(page)).toBe(0)
})

test('a detached element loses its mask', async ({ page }) => {
  await redact(page.locator('#secret'))
  await tickFrames(page)
  expect(await maskCount(page)).toBe(1)

  await page.evaluate(() => document.getElementById('secret')?.remove())
  await tickFrames(page)

  expect(await maskCount(page)).toBe(0)
})

test('fill with redact masks the typed value', async ({ page }) => {
  await redactFill(page.locator('#secret-input')).fill('topsecret', {
    redact: true,
  })
  await tickFrames(page)

  expect(await page.locator('#secret-input').inputValue()).toBe('topsecret')
  expect(await maskCount(page)).toBeGreaterThanOrEqual(1)
})

test('config selectors mask from first paint', async ({ page }) => {
  await page.addInitScript(redactApplyConfigSelectors, {
    selectors: ['.cfg-secret'],
    style: resolveRedactStyle(),
  })
  // A real navigation re-runs the init scripts (the controller bootstrap then
  // the config selectors), mirroring how the fixture installs them before the
  // page is opened. `setContent` does not reliably re-fire init scripts.
  const html =
    '<div class="cfg-secret" style="width:120px;height:30px;background:#fff;color:#000;">TOKEN</div>'
  await page.goto('data:text/html,' + encodeURIComponent(html))
  await tickFrames(page)

  // The default auto mode hides the element from first paint (via the config
  // style rule) and covers it with a sampled panel.
  const visibility = await page.evaluate(() => {
    const el = document.querySelector('.cfg-secret')
    return el ? getComputedStyle(el).visibility : ''
  })
  expect(visibility).toBe('hidden')
  expect(await maskCount(page)).toBeGreaterThanOrEqual(1)
  const hasStyleRule = await page.evaluate(
    () => !!document.querySelector('style[data-screenci-redact="config"]')
  )
  expect(hasStyleRule).toBe(true)
})
