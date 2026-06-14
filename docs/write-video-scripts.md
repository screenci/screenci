# Video Script Basics

ScreenCI videos use the same syntax, guides, and general best practices as
[Playwright tests](https://playwright.dev/docs/writing-tests). The main
difference is that video scripts usually do not need assertions, and instead
focus on viewer-facing behavior such as narration and camera movement.

Need a faster way to get a first draft? Generate one with
[Playwright codegen](#generate-a-first-draft-with-codegen) (or let a coding agent
do it, see [Agent integration](/docs/agent-integration)), then come back here to
refine the script structure and ScreenCI-specific APIs.

#### You will learn

- [how to generate a first draft with codegen](#generate-a-first-draft-with-codegen)
- [how a ScreenCI video differs from a Playwright test](#screenci-video-vs-playwright-test)
- [how to configure ScreenCI](#configure-screenci)
- [which core ScreenCI APIs to use](#core-screenci-apis)

## Generate a first draft with codegen

Writing a script from scratch is optional. Playwright's
[test generator (codegen)](https://playwright.dev/docs/codegen) lets you click
through the exact flow in a browser and have the actions written for you. Run:

```bash
npx playwright codegen https://your-app.example.com
```

This opens a browser window and the Playwright Inspector. As you click, type, and
navigate, it generates Playwright actions for the flow. The output is not a
ScreenCI video yet. To turn it into one:

- copy the generated code into a `videos/<flow>.video.ts` file
- change `test(...)` to `video(...)`
- add narration with `createNarration()` (see [Core ScreenCI APIs](#core-screenci-apis))

Then follow the usual `screenci test` and `screenci record` flow. If you only
have a deployed URL and want this automated, point a coding agent at it with the
`playwright-cli` skill, see [Agent integration](/docs/agent-integration).

## ScreenCI video vs Playwright test

The generated starter video keeps the same Playwright-style structure, but it
uses a ScreenCI-instrumented page and locators so visible interactions are
captured with the right metadata for recording. See [Page
Instrumentation](/docs/page-instrumentation). Use it as the baseline shape for
most ScreenCI videos, then adjust the visible flow, narration cues, and zoom
behavior for your specific walkthrough.

<!-- screenci-doc-code-sample:starter-video:start -->

```ts
import { autoZoom, createNarration, hide, video, voices } from 'screenci'

const narration = createNarration({
  // Default voice settings for all languages.
  voice: { name: voices.Sophie },
  // Localized narration cues by language.
  en: {
    docs: 'Here is where to find ScreenCI [pronounce: screen see eye] docs.',
  },
  es: {
    docs: 'Aqui es donde encontrar la documentacion de ScreenCI [pronounce: screen see eye].',
  },
})

video('How to find docs', async ({ page }) => {
  // Run setup without showing these actions in the final recording.
  await hide(async () => {
    await page.goto('https://screenci.com/')
    await page.waitForLoadState('networkidle')
  })

  // Play the matching narration line for this step.
  await narration.docs()

  // Automatically zoom into interactions so they are easier to follow.
  await autoZoom(async () => {
    await page.getByRole('link', { name: 'View Documentation' }).click()
  })
})
```

<!-- screenci-doc-code-sample:starter-video:end -->

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

### `hide()`, `speed()`, and `time()`

Use these timeline helpers to decide whether a step should be removed from the
final video or just retimed:

- Use `hide()` when the viewer should not see the step at all. This is useful
  for navigation, sign-in, waiting for app state, or dismissing a cookie
  banner before the real flow begins.
- Use `speed()` when the viewer should still see the step, but faster or
  slower than real time.
- Use `time()` when the viewer should still see the step, and you want the
  whole visible block to occupy an exact duration in the output.

See [Page Instrumentation](/docs/guides/page-instrumentation) for how visible
actions are captured.

`hide()` takes just the function to run. It removes the enclosed recording
range from the final output.

```ts
await hide(async () => {
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Accept all cookies' }).click()
  await page.getByRole('button', { name: 'Open billing' }).click()
})
```

Use `speed()` and `time()` when a step should stay visible but play at a
different pace in the rendered output.

- `speed(1, fn)` keeps real-time playback.
- `speed(0.5, fn)` plays the enclosed visible content at half-speed, so it
  takes 2x longer in the output.
- `speed(2, fn)` plays the enclosed visible content at 2x speed, so it takes
  half as long in the output.
- `time(1000, fn)` makes the enclosed visible content occupy exactly `1000`
  milliseconds in the output.
- `hide()` may be used inside `speed()` or `time()`, but not inside another
  `hide()`.
- `speed()` and `time()` may not be nested inside each other or inside
  themselves.
- Narration cue audio is not retimed. These blocks only remap the main
  recording timeline.

```ts
await hide(async () => {
  await page.goto('/reports')
  await page.getByRole('button', { name: 'Accept cookies' }).click()
})

await speed(0.5, async () => {
  await page.getByRole('button', { name: 'Preview invoice' }).click()
})

await time(1000, async () => {
  await page.getByRole('tab', { name: 'Analytics' }).click()
  await page.waitForLoadState('networkidle')
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
[Narration and Localization](/docs/guides/narration-and-localization).

Common options:

- top-level `voice` for the default voice configuration
- language keys such as `en`, `es`, or `fi`
- per-language `voice` overrides when one language needs a different voice
- cue entries as text or file-based entries, depending on how you want to
  source narration
- short, sentence-sized cues instead of paragraph-sized narration blocks

```ts
const narration = createNarration({
  // Default voice settings for all languages.
  voice: { name: voices.Sophie },
  // Localized narration cues by language.
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

Prefer one sentence per cue. Split longer narration into separate named cues and
place them where they belong in the flow. That gives you cleaner overlap
control, makes revisions less brittle, and should save API cost when a TTS
provider such as ElevenLabs only needs to regenerate one changed sentence.

API reference: [createNarration()](/docs/reference/api/functions/createnarration),
[voices](/docs/reference/api/variables/voices)
