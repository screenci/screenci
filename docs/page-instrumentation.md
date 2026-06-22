# Page Instrumentation

ScreenCI instruments the Playwright `page` used inside `video()` so visible
browser interactions behave like a recording instead of a robotic test run.

#### You will learn

- [which interactions are animated](#animated-interactions)
- [what stays the same from Playwright](#playwright-apis-still-work)
- [how to hide or retime steps](#hide-or-retime-steps)

## Animated interactions

Common visible actions are animated automatically:

- mouse movement
- clicks
- typing
- scrolling

```ts
// Import `video` from 'screenci' instead of `test` from '@playwright/test'.
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

## Hide or retime steps

Not every instrumented step belongs in the final video. To remove non-viewer
setup (signing in, accepting cookies, navigating into place) or to retime a
visible step, use the `hide()`, `speed()`, and `time()` timeline helpers. See
[`hide()`, `speed()`, and `time()`](/docs/video-script-basics#hide-speed-and-time)
in Video Script Basics.

## Cursor animation options

Every locator action that moves the cursor accepts the same flat set of
animation options. Mix and match as needed:

| Option             | Type            | Default         | Description                                                     |
| ------------------ | --------------- | --------------- | --------------------------------------------------------------- |
| `moveDuration`     | `number` (ms)   | 900             | Duration of the cursor move to the element.                     |
| `moveSpeed`        | `number` (px/s) | none            | Speed-based alternative to `moveDuration` (mutually exclusive). |
| `moveEasing`       | `Easing`        | `'ease-in-out'` | Easing curve for the cursor move animation.                     |
| `beforeClickPause` | `number` (ms)   | 50              | Pause after the cursor arrives, before the action fires.        |
| `postClickPause`   | `number` (ms)   | 300             | Pause after the action completes.                               |

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

- [Video Script Basics](/docs/video-script-basics)
- [Camera and Zooming](/docs/guides/camera-and-zooming)
- [Narration and Localization](/docs/guides/narration-and-localization)
