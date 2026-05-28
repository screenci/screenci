# Video Script Basics

ScreenCI videos use the same syntax, guides, and general best practices as
[Playwright tests](https://playwright.dev/docs/writing-tests). The main
difference is that video scripts usually do not need assertions, and instead
focus on viewer-facing behavior such as narration and camera movement.

Need a faster way to get a first draft? Start with
[Generating Videos](/docs/generating-videos), then come back here to refine the
script structure and ScreenCI-specific APIs.

#### You will learn

- [how a ScreenCI video differs from a Playwright test](#screenci-video-vs-playwright-test)
- [how to configure ScreenCI](#configure-screenci)
- [which core ScreenCI APIs to use](#core-screenci-apis)

## ScreenCI video vs Playwright test

Unlike a regular `playwright/test` test, `video()` gives you an instrumented
Playwright `page` so visible interactions look like a recording instead of a
robotic test:

- cursor moves are animated
- typing is visible

Most standard Playwright APIs still work as expected, including navigation,
locators, waiting, keyboard input, and assertions from `@playwright/test`.

For more on how ScreenCI animates visible page actions, see
[Page Instrumentation](/docs/guides/page-instrumentation).

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

You can define multiple `video()` calls in the same file, or create multiple
`.video.ts` files under `videos/`.

## Configure ScreenCI

Project-wide defaults such as `projectName`, `videoDir`, `baseURL`, and shared
recording or rendering options live in `screenci.config.ts`.

```ts
import { defineConfig } from 'screenci'

export default defineConfig({
  // Used to identify this project in ScreenCI.
  projectName: 'my-product',
})
```

See [Configuration](/docs/reference/configuration).

## Core ScreenCI APIs

### `hide()`

Use `hide()` to keep setup out of the visible recording. This is useful for
steps the viewer does not need to watch, such as navigating to the right page,
signing in, or dismissing a cookie banner before the real flow begins. See
[Setup vs visible sequence](#setup-vs-visible-sequence) and [Generating
Videos](/docs/generating-videos).

`hide()` takes just the function to run. It does not have separate timing or
camera options.

```ts
await hide(async () => {
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Accept all cookies' }).click()
  await page.getByRole('button', { name: 'Open billing' }).click()
})
```

API reference: [hide()](/docs/reference/api/functions/hide)

### `autoZoom()`

Use `autoZoom()` when the camera should follow a visible interaction
automatically. See [Camera and Zooming](/docs/camera-and-zooming).

Common options:

- `duration` to control how fast the zoom moves
- `easing` to control motion feel
- `amount` to control how tightly ScreenCI zooms in
- `padding` to keep more space around the target area
- `centering` to bias framing within the viewport
- `preZoomDelay` and `postZoomDelay` to add breathing room before or after the
  zoomed sequence

```ts
await autoZoom(async () => {
  await page.getByRole('button', { name: 'Create project' }).click()
})
```

API reference: [autoZoom()](/docs/reference/api/functions/autozoom)

### `zoomTo()`

Use `zoomTo()` when you want exact manual framing, and `resetZoom()` when you
want to return to the default view afterward. See [Camera and
Zooming](/docs/camera-and-zooming).

`zoomTo()` accepts either:

- a locator, when you want framing tied to a real UI element
- `{ x, y }`, when you want to frame an exact point manually

Common options for `zoomTo()` and `resetZoom()`:

- `duration`
- `easing`
- `amount`
- `padding`
- `preZoomDelay`
- `postZoomDelay`

```ts
await zoomTo(page.getByTestId('pricing-card-pro'))
await page.getByRole('button', { name: 'Upgrade' }).click()
await resetZoom()
```

API reference: [zoomTo()](/docs/reference/api/functions/zoomto),
[resetZoom()](/docs/reference/api/functions/resetzoom)

### `createNarration()`

Use `createNarration()` to define narration cues and language variants. See
[Narration and Localization](/docs/narration-and-localization).

Common options:

- top-level `voice` for the default voice configuration
- language keys such as `en`, `es`, or `fi`
- per-language `voice` overrides when one language needs a different voice
- cue entries as text or file-based entries, depending on how you want to
  source narration

```ts
const narration = createNarration({
  // Define one cue key and provide the matching text for each language.
  voice: { name: voices.Sophie },
  en: {
    intro: 'Open settings and review the billing details.',
  },
  es: {
    intro: 'Abre la configuracion y revisa los detalles de facturacion.',
  },
})

video('Billing walkthrough', async ({ page }) => {
  // Play the full cue before continuing.
  await narration.intro()

  // Or use start/end when narration should overlap with the visible actions.
  await narration.intro.start()
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Open billing' }).click()
  await narration.intro.end()
})
```

API reference: [createNarration()](/docs/reference/api/functions/createnarration),
[voices](/docs/reference/api/variables/voices)
