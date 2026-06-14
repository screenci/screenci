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

When the viewer should still see the step, but at a different pace, use
`speed()` or `time()` instead:

- `hide()` removes the enclosed section from the output completely.
- `speed(1)` is real-time.
- `speed(0.5)` is half-speed, so the visible block takes 2x longer in output.
- `time(1000)` fits the visible block to exactly 1 second in output.
- `hide()` can be placed inside `speed()` or `time()`, but other nesting is
  not supported.
- Narration cue audio is not retimed.

```ts
import { hide, speed, time, video } from 'screenci'

video('Billing walkthrough', async ({ page }) => {
  await hide(async () => {
    await page.goto('/settings')
    await page.getByRole('button', { name: 'Accept all cookies' }).click()
  })

  await speed(0.5, async () => {
    await page.getByRole('button', { name: 'Open usage chart' }).click()
  })

  await time(1000, async () => {
    await page.getByRole('button', { name: 'Expand invoice preview' }).click()
  })

  await page.getByRole('link', { name: 'Billing' }).click()
})
```

## Cursor animation options

Every locator action that moves the cursor accepts the same flat set of
animation options. Mix and match as needed:

| Option             | Type            | Default         | Description                                                     |
| ------------------ | --------------- | --------------- | --------------------------------------------------------------- |
| `moveDuration`     | `number` (ms)   | 900             | Duration of the cursor move to the element.                     |
| `moveSpeed`        | `number` (px/s) | none            | Speed-based alternative to `moveDuration` (mutually exclusive). |
| `moveEasing`       | `Easing`        | `'ease-in-out'` | Easing curve for the cursor move animation.                     |
| `beforeClickPause` | `number` (ms)   | 50              | Pause after the cursor arrives, before the action fires.        |
| `postClickPause`   | `number` (ms)   | 500             | Pause after the action completes.                               |

```ts
// Slow the cursor move and add a brief pause before the click
await page.getByRole('button', { name: 'Save' }).click({
  moveDuration: 1200,
  moveEasing: 'ease-out',
  beforeClickPause: 100,
})

// Speed-based cursor movement for a fill
await page.getByLabel('Company name').fill('ScreenCI Labs', {
  moveSpeed: 500,
})

// Slower hover with a longer dwell time
await page.getByTestId('tooltip-trigger').hover({
  moveDuration: 600,
  hoverDuration: 2000,
})

// Drag with separate move and drag animations
await page.getByTestId('card').dragTo(page.getByTestId('column'), {
  moveDuration: 400,
  moveEasing: 'ease-in',
  dragDuration: 800,
  dragEasing: 'ease-out',
})
```

### fill and pressSequentially

`fill` and `pressSequentially` animate a click before typing by default.
The click is skipped automatically when the element is already focused.
Pass `forceClick: true` to always show the click animation:

```ts
await page.getByLabel('Search').fill('product tour', { forceClick: true })
```

### selectText

`selectText` shows a triple-click animation. Control its total duration:

```ts
await page.getByTestId('code-block').selectText({ selectDuration: 900 })
```

### page.mouse.move

`page.mouse.move` uses `duration` and `speed` without the `move` prefix
(since the call itself is already a mouse move):

```ts
await page.mouse.move(400, 300, { duration: 600, easing: 'ease-in-out' })
```

## Related pages

- [Video Script Basics](/docs/write-video-scripts)
- [Camera and Zooming](/docs/guides/camera-and-zooming)
- [Narration and Localization](/docs/guides/narration-and-localization)
