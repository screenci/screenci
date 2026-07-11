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
- [how to mock API requests safely in SPAs](#mock-api-requests-in-spas)
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
- change `test(...)` to `video.narration(...)(...)`
- add narration through `video.narration({...})` (see [Core ScreenCI APIs](#core-screenci-apis))

Then follow the usual `screenci test` and `screenci record` flow. If you only
have a deployed URL and want this automated, point a coding agent at it with the
`playwright-cli` skill, see [Agent integration](/docs/agent-integration).

## ScreenCI video vs Playwright test

The generated starter video keeps the same Playwright-style structure, but it
uses a ScreenCI-instrumented page and locators so visible interactions are
captured with the right metadata for recording. See [Animated
Interactions](/docs/guides/animated-interactions). Use it as the baseline shape for
most ScreenCI videos, then adjust the visible flow, narration cues (via
`video.narration`), and zoom
behavior for your specific walkthrough.

<!-- screenci-doc-code-sample:starter-video:start -->

```ts
import { autoZoom, hide, video } from 'screenci'

video
  .overlays({
    logo: {
      path: './assets/logo.png',
      duration: 2000,
      overMouse: true,
      fill: 'recording',
    },
  })
  .narration({
    docs: 'Here is where to find ScreenCI [pronounce: screen see eye] docs.',
  })('How to find docs', async ({ page, narration, overlays }) => {
  // Run setup without showing these actions in the final recording.
  await hide(async () => {
    await page.setContent(landingPageHtml())
  })

  // Open with a brief brand intro card before the walkthrough begins.
  await overlays.logo.for(2000)

  // Play the narration line for this step.
  await narration.docs()

  // Automatically zoom into interactions so they are easier to follow.
  await autoZoom(async () => {
    await page.getByRole('link', { name: 'View Documentation' }).click()
  })
})

function landingPageHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>ScreenCI smoke page</title>
    <style>
      body { margin: 0; font-family: Inter, system-ui, sans-serif; background: #111827; color: white; }
      main { min-height: 100vh; display: grid; place-items: center; text-align: center; }
      a { color: #111827; background: #fbbf24; padding: 14px 18px; border-radius: 8px; text-decoration: none; font-weight: 700; }
    </style>
  </head>
  <body>
    <main>
      <div>
        <h1>ScreenCI</h1>
        <p>Record docs, onboarding, and changelog walkthroughs from code.</p>
        <a href="https://screenci.com/docs">View Documentation</a>
      </div>
    </main>
  </body>
</html>`
}
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

## Mock API requests in SPAs

When a video mocks API calls with `page.route()`, prefer exact API URLs or
absolute URL prefixes instead of broad globs. In Vite and other SPA dev servers,
module files are also normal browser requests; a broad route can accidentally
match `/src/...` module URLs and fulfill them with JSON, leaving React with an
empty root and little browser output.

```ts
const apiBase = 'http://localhost:5173/api'

await page.route(`${apiBase}/recipes`, async (route) => {
  await route.fulfill({
    json: [{ id: 'pasta', name: 'Pasta' }],
  })
})
```

If you must use a broad matcher, let non-API browser resources continue:

```ts
await page.route('**/*recipes*', async (route, request) => {
  if (request.resourceType() !== 'fetch' && request.resourceType() !== 'xhr') {
    await route.fallback()
    return
  }

  await route.fulfill({ json: [{ id: 'pasta', name: 'Pasta' }] })
})
```

ScreenCI also fails fast if a route fulfills a document, stylesheet, or script
request with the wrong content type, which usually means a mock intended for an
API endpoint intercepted an app asset.

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

All three accept a trailing options object with `delay` (milliseconds), which
shifts the recorded START of the block forward while the end still lands when
the callback finishes. That lets the effect begin partway into the first
wrapped interaction, for example `await speed(2, async () => { ... }, { delay:
400 })`. See [Mid-Video Overlay
Updates](./overlay-updates.md#delaying-an-update-into-an-interaction) for the
time-order rules delayed events must follow.

API reference: [hide()](/docs/reference/api/functions/hide). See also [Animated
Interactions](/docs/guides/animated-interactions) for how visible actions are
captured.

### Positions: holding narration and overlays until a point in the video

Narration cues and overlays can take a string position so they land at an
absolute point in the finished video, instead of a relative duration. This is
handy in long stretches (for example a recorded playback) where hand-computing
`page.waitForTimeout` deltas is brittle.

```ts
// Narration: start the line and hold its window until the position.
await narration.intro.until('0:10') // until 10 seconds in
await narration.outro.until('56%') // until 56% through the video

// Overlays: keep the (static) overlay on screen until the position.
await overlays.tip.until('0:10') // until 10 seconds in
await overlays.tip.until('2s') // seconds (fractions allowed: '5.51s')
```

Accepted forms for `.until(...)`: `'<n>s'` seconds, `'m:ss(.f)'` /
`'h:mm:ss(.f)'` timecodes, and `'<n>%'` percentages. For a relative length
instead, use `.for('<n>s')` or `.for(<ms>)`. Positions are resolved against the
finished render, so they are correct against the actual video, and narration
audio is never cut (the window extends to let a line finish). Percentages are
not supported on `.mp4` or animated overlays, whose length is fixed. See
[Narration](/docs/guides/narration) and [Overlays](/docs/guides/overlays).

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

### `video.narration()`, `video.values()`, and `video.overlays()`

Use the per-feature builders to attach narration cues, localized strings, and
overlay controllers to a video. Each builder returns the same chainable `video`,
so you can combine them and end with a `(title, body)` call. The body receives
the fixtures matching the features you declared: `narration` markers (timing
only), `values` field values, `overlays` controllers, and the active `language`. See
[Narration](/docs/guides/narration).

`video.narration({...})` accepts either form:

- an object keyed by language (`en`, `es`, `fi`, ...) of cue name to text =
  per-language narration
- a flat object of cue name to text (for example `{ intro: 'Hi' }`) = shared
  across all languages
- a bare array of cue names (for example `['intro']`) = name-only cues where
  Editor (the web editor) owns the text. Object forms supply code values that
  stay editable in Editor; an Editor edit wins over the code value.

Other parts of the spec:

- chain `video.values({...})` for localized strings injected into the page
- chain `video.overlays({...})` to declare overlay controllers (see below)
- short, sentence-sized cues instead of paragraph-sized narration blocks

Voice is configured separately as a render option in `renderOptions.narration`
(via `video.renderOptions(...)` or `screenci.config.ts`), with a default `voice`
and per-language `voices` overrides.

```ts
import { video, voices } from 'screenci'

// Voice is a render option (how narration is spoken).
video
  .renderOptions({ narration: { voice: { name: voices.Ava } } })
  // Localized narration cues by language.
  .narration({
    en: { intro: 'Open settings and review the billing details.' },
    es: {
      intro: 'Abre la configuracion y revisa los detalles de facturacion.',
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

To control which languages are recorded, chain `video.languages(...)` (call it
with no argument for a fully web-owned set, a plain array of language codes as
a seed, or `{ languages, mode }`). The recorded set is the union of the web
app's selection, the code seed, and per-feature language keys. For example,
`video.narration({...}).languages({ mode: 'shared' })` records a single shared
narration track instead of one per language. A video with no `.languages(...)`
call records one language-agnostic round pinned to the `en-US` browser locale.

#### Overlays

Use `video.overlays({...})` to declare overlay controllers for a video. The
controllers are exposed through the `overlays` fixture in the body:

```ts
import { video } from 'screenci'

video.overlays({
  logo: { path: 'logo.png', x: 1560, y: 96, width: 288 },
})('Branded intro', async ({ page, overlays }) => {
  await overlays.logo.start()
  await page.goto('/dashboard')
  await overlays.logo.end()
})
```

For Editor-owned overlays (declared by name, with the web editor owning their
content), pass a bare array of names: `video.overlays(['logo'])`. You can
combine this with the bare-array form of narration, for example
`video.narration(['intro']).overlays(['logo'])`. Object forms supply code
values that stay editable in Editor; an Editor edit wins over the code value.

Render options work the same way: values declared per video with
`video.renderOptions(...)` are the starting point, and web edits override
them. Every recording also
tracks which option values its Playwright actions used (for example
`move.duration` or `position`) and whether each was explicit in code or a
default, so the web editor can present and override them; see
[Action parameter tracking and overrides](./editor.md#action-parameter-tracking-and-overrides).

API reference: [voices](/docs/reference/api/variables/voices)
