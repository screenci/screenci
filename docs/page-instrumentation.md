# Page Instrumentation

ScreenCI instruments the Playwright `page` used inside `video()` so visible
browser interactions behave like a recording instead of a robotic test run.

#### You will learn

- [which interactions are animated](#animated-interactions)
- [what stays the same from Playwright](#playwright-apis-still-work)
- [when to hide setup instead of showing it](#hide-non-viewer-setup)

## Animated interactions

Common visible actions are animated automatically:

- mouse movement
- clicks
- typing
- scrolling

```ts
import { video } from 'screenci'

video('Open billing', async ({ page }) => {
  await page.goto('/settings')

  // Clicks are animated.
  await page.getByRole('link', { name: 'Billing' }).click()

  // Typing is animated.
  await page.getByLabel('Company name').fill('ScreenCI Labs')

  // Mouse movement is animated.
  await page.getByRole('button', { name: 'Save changes' }).hover()

  // Scrolling into view is animated.
  await page.getByTestId('invoices-table').scrollIntoViewIfNeeded()
})
```

This is what makes a ScreenCI video feel like a guided product walkthrough
instead of a hidden automation script.

## Playwright APIs still work

Most normal Playwright APIs still work as expected, including:

- navigation
- locators
- waiting
- keyboard input
- assertions from `@playwright/test`

That means you can keep using standard Playwright guides for locator strategy,
page structure, waiting, and shared setup patterns.

## Hide non-viewer setup

Not every automated step should be visible in the final video. Use `hide()` for
setup the viewer does not need to watch, such as signing in, accepting cookies,
or opening the right screen before the visible flow begins.

```ts
import { hide, video } from 'screenci'

video('Billing walkthrough', async ({ page }) => {
  await hide(async () => {
    await page.goto('/settings')
    await page.getByRole('button', { name: 'Accept all cookies' }).click()
  })

  await page.getByRole('link', { name: 'Billing' }).click()
})
```

## Related pages

- [Video Script Basics](/docs/write-video-scripts)
- [Camera and Zooming](/docs/guides/camera-and-zooming)
- [Narration and Localization](/docs/guides/narration-and-localization)
