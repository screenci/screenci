# Animated Interactions

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

You can drag to a point inside the target rather than its center with
`targetPosition` (and `sourcePosition` for where the drag begins), which is how
you drive a slider by dragging its thumb to a spot along the track:

```ts
const track = thumb.locator('xpath=ancestor::*[@data-slot="slider"][1]')
const box = (await track.boundingBox())!
await thumb.dragTo(track, {
  targetPosition: { x: box.width * 0.62, y: box.height / 2 },
})
```

Throughout the drag, screenci dispatches a dense stream of real cursor moves so
the browser tracks the gesture (a slider thumb follows the pointer, drag-and-drop
hit testing fires). The default is `dragSteps: 24` spread across the drag; raise
it for a longer or more sensitive drag.

### fill and pressSequentially

`fill` and `pressSequentially` animate a click before typing by default.
The click is skipped automatically when the element is already focused.
Pass `forceClick: true` to always show the click animation:

```ts
await page.getByLabel('Search').fill('product tour', { forceClick: true })
```

Both spread the typing over a `duration` (total milliseconds), editable in the
web app. `fill` defaults to a fixed 1000ms regardless of length. Because
`pressSequentially` types key by key, its default total scales with the text
length (about 60ms per character), so longer text types for longer; pass an
explicit `duration` to override, or a per-key `delay` (read as the per-character
cadence when no `duration` is given):

```ts
await page.getByLabel('Bio').pressSequentially('Hello there') // ~660ms (11 chars)
await page.getByLabel('Bio').pressSequentially('Hello there', { duration: 300 })
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

A bare `page.mouse.move` (no `duration`/`speed`) animates by default so the
cursor glides to the target instead of teleporting. Pass `duration: 0` for an
explicit instant jump:

```ts
await page.mouse.move(400, 300) // animated
await page.mouse.move(400, 300, { duration: 0 }) // instant
```

### page.mouse press methods

`page.mouse.down`, `page.mouse.up`, `page.mouse.click`, and `page.mouse.dblclick`
are also animated and recorded. `click` and `dblclick` move the cursor to the
given coordinates first, then press; `down` and `up` press and release at the
current cursor position, so you can compose a gesture by hand:

```ts
await page.mouse.move(200, 200)
await page.mouse.down()
await page.mouse.move(400, 300)
await page.mouse.up()
```

Inside an [`autoZoom()`](/docs/guides/camera-and-zooming#automatic-zoom) block these cursor moves also drive the camera: it pans to follow the cursor (and zooms in on the first move), so a hand-built gesture like a slider drag stays framed instead of leaving the camera on the last element.

Each accepts a `duration` (press animation length, default 100ms) and `easing`.
`click` and `dblclick` also accept the `moveDuration` / `moveSpeed` / `moveEasing`
cursor-move options.

#### Mock (fake) clicks

Pass `fake: true` to record the cursor press for the video **without** dispatching
a real browser event. The page is never actually clicked, but the recorded data
(and therefore the rendered video) is identical to a real call. This is handy for
showing an interaction whose real effect you do not want, such as a click that
would navigate away:

```ts
// The cursor moves and presses on screen, but nothing is actually clicked.
await page.mouse.click(640, 360, { fake: true })
```

## Related pages

- [Video Script Basics](/docs/video-script-basics)
- [Redact Sensitive Content](/docs/guides/redact)
- [Camera and Zooming](/docs/guides/camera-and-zooming)
- [Narration](/docs/guides/narration)
