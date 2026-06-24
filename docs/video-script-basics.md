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

- copy the generated code into a `recordings/<flow>.screenci.ts` file
- change `test(...)` to `video.localize(...)(...)`
- add narration through `video.localize({ narration })` (see [Core ScreenCI APIs](#core-screenci-apis))

Then follow the usual `screenci test` and `screenci record` flow. If you only
have a deployed URL and want this automated, point a coding agent at it with the
`playwright-cli` skill, see [Agent integration](/docs/agent-integration).

## ScreenCI video vs Playwright test

The generated starter video keeps the same Playwright-style structure, but it
uses a ScreenCI-instrumented page and locators so visible interactions are
captured with the right metadata for recording. See [Page
Instrumentation](/docs/page-instrumentation). Use it as the baseline shape for
most ScreenCI videos, then adjust the visible flow, narration cues (via
`video.localize`), and zoom
behavior for your specific walkthrough.

<!-- screenci-doc-code-sample:starter-video:start -->

```ts
import { autoZoom, hide, video, voices } from 'screenci'

// The default voice (how narration is spoken) for every language.
video.use({ renderOptions: { narration: { voice: { name: voices.Sophie } } } })

video.localize({
  // Localized narration cues by language. The fixture exposes them as markers.
  narration: {
    en: {
      docs: 'Here is where to find ScreenCI [pronounce: screen see eye] docs.',
    },
    es: {
      docs: 'Aqui es donde encontrar la documentacion de ScreenCI [pronounce: screen see eye].',
    },
  },
})('How to find docs', async ({ page, narration }) => {
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
`.screenci.ts` files under `recordings/`.

## Configure ScreenCI

Project-wide defaults such as `projectName`, `recordingDir`, `baseURL`, and shared
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

Timeline helpers that decide whether a step is removed from the final video or
just retimed. Not every automated step belongs in the recording: use `hide()`
for non-viewer setup the viewer does not need to watch, such as signing in,
accepting cookies, waiting for app state, or opening the right screen before the
visible flow begins.

```ts
// hide(): run the step but remove it from the output.
// Use for navigation, sign-in, waiting, or dismissing banners.
await hide(async () => {
  await page.goto('/reports')
  await page.getByRole('button', { name: 'Accept cookies' }).click()
})

// speed(): keep the step visible, but play it faster or slower.
// 1 = real time, 0.5 = half-speed (2x longer), 2 = 2x speed (half as long).
await speed(0.5, async () => {
  await page.getByRole('button', { name: 'Preview invoice' }).click()
})

// time(): keep the step visible and make it occupy an exact duration.
// Here the visible block lasts exactly 1000ms in the output.
await time(1000, async () => {
  await page.getByRole('tab', { name: 'Analytics' }).click()
  await page.waitForLoadState('networkidle')
})

// Nesting rules:
// - hide() may sit inside speed() or time(), but not inside another hide().
// - speed() and time() may not be nested inside each other or themselves.
// - Narration cue audio is not retimed; these only remap the recording timeline.
```

API reference: [hide()](/docs/reference/api/functions/hide). See also [Page
Instrumentation](/docs/guides/page-instrumentation) for how visible actions are
captured.

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

### `video.localize()`

Use `video.localize()` to attach narration cues and language variants to a
video. The body receives `narration` markers (timing only) and, when used,
`text` values and the active `language`. See
[Narration and Localization](/docs/guides/narration-and-localization).

Common parts of the spec:

- a `narration` map keyed by language (`en`, `es`, `fi`, ...) of cue name to text
- an optional `text` map for localized strings injected into the page
- `languages: [...]` when the cues are name-only (Studio owns the text)
- short, sentence-sized cues instead of paragraph-sized narration blocks

Voice is configured separately as a render option in `renderOptions.narration`
(via `video.use(...)` or `screenci.config.ts`), with a default `voice` and
per-language `voices` overrides.

```ts
import { video, voices } from 'screenci'

// Voice is a render option (how narration is spoken).
video.use({
  renderOptions: { narration: { voice: { name: voices.Sophie } } },
})

video.localize({
  // Localized narration cues by language.
  narration: {
    en: { intro: 'Open settings and review the billing details.' },
    es: {
      intro: 'Abre la configuracion y revisa los detalles de facturacion.',
    },
  },
})('Billing walkthrough', async ({ page, narration }) => {
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

API reference: [voices](/docs/reference/api/variables/voices)
