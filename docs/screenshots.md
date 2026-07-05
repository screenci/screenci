# Screenshots

Alongside videos, ScreenCI can produce **still screenshots**. You author them
with the same Playwright-like API you already use for videos and drive the page
to the state you want. Three things make them worth reaching for:

- **Crop** to any component or region, so the shot is exactly the part that
  matters, optionally framed on your background with no manual editing.
- **Overlays** (badges, callouts, annotations) layered on with the same assets
  as your videos, so stills and videos share one visual language.
- **Delivery from a static, CDN-backed URL** you can drop straight into a page,
  README, or social card. It stays fast and cacheable, and updates when you
  re-render.
- **Automatic updates** when the product changes: re-record locally, in CI, or
  from the ScreenCI UI, and every hosted URL serves the latest accepted shot.
- **Web editable** like videos: every render option (crop padding, background,
  frame, overlays) is adjustable later in Studio in the browser, with no
  re-recording needed.

A screenshot is captured directly from the page (no video is recorded), then
served from that hosted URL with the same versioning and Studio editing as
videos. By default the output is the bare crop. Add a `margin` and/or an output
`aspectRatio` and the shot is composited on your configured background with a
rounded frame and shadow (see [Render options](#render-options)).

## Two ways to capture

**1. A standalone `screenshot()` test** drives the page and captures the final
state (no video recorded):

```ts
import { screenshot } from 'screenci'

screenshot('Dashboard', async ({ page }) => {
  await page.goto('https://app.example.com/dashboard')
})
```

**2. `page.screenshot()` inside a `video()`** grabs a still of a moment that also
appears in the video. Each call becomes its own screenshot recording named by the
`name` you pass:

```ts
import { video } from 'screenci'

video('Product demo', async ({ page }) => {
  await page.goto('https://app.example.com/dashboard')
  await page.screenshot({ name: 'Dashboard' }) // -> screenshot named "Dashboard"
})
```

Both produce the same still, framed and hosted identically. The rest of this
guide applies to either. The sections below detail each.

Screenshots live in the same `*.screenci.ts` files as videos (the `recordingDir`), so
a file can contain any mix of `video()` and `screenshot()` calls. A `screenshot()`
body runs just like a video body; when it returns, the final page state is
captured. Narration, audio, and camera motion do not apply to a still and are
ignored. `hide()` is likewise a no-op: a still keeps only the final frame, so
there is no timeline to cut a hidden section from (the wrapped setup still runs,
and screenci warns if you use it). Because only the final frame is kept, cursor
moves are instant during a screenshot (the cursor still lands at its target);
the smooth gliding animation is for videos.

#### You will learn

- [how to crop to a component or a region](#cropping)
- [how to add overlays](#overlays)
- [how to set quality and dark mode](#quality-and-appearance)
- [how to set the background, frame, and output format](#render-options)

## Cropping

The `screenshot()` fixture provides a `crop` argument. Call it to frame a single
component or an explicit region. The crop is applied by the renderer, which
places the cropped region (plus any `padding`) on the canvas (framed on the
background once you add a `margin` or output `aspectRatio`).

```ts
import { screenshot } from 'screenci'

screenshot('Revenue card', async ({ page, crop }) => {
  await page.goto('https://app.example.com/dashboard')

  // Crop to a component, with 48 px of breathing room around it.
  await crop(page.getByTestId('revenue-card'), { padding: 48 })
})
```

`crop` also accepts an explicit region in CSS px of the recording viewport:

```ts
await crop({ x: 128, y: 160, width: 1024, height: 768 })
```

Inside a `video()`, pass the same crop to `page.screenshot()` via its `crop`
option, which takes either a locator or an explicit region:

```ts
import { video } from 'screenci'

video('Product demo', async ({ page }) => {
  await page.goto('https://app.example.com/dashboard')

  // Crop the still to a component...
  await page.screenshot({
    name: 'Revenue card',
    crop: page.getByTestId('revenue-card'),
  })

  // ...or to an explicit region in CSS px of the recording viewport.
  await page.screenshot({
    name: 'Chart region',
    crop: { x: 128, y: 160, width: 1024, height: 768 },
  })
})
```

### Padding

`padding` is the breathing room around the target, in CSS px. Pass a single number
to pad every side equally, or an object for **uneven padding** (omitted sides
default to `0`):

```ts
// 24 px on every side except a roomier bottom for a caption.
await crop(page.getByTestId('chart'), {
  padding: { top: 24, right: 24, bottom: 64, left: 24 },
})
```

The crop comes only from your `crop()` call (or `page.screenshot({ crop })` inside
a video). It is recorded as `renderOptions.screenshot.crop` and edited in Studio,
not set in config. How it edits depends on the target:

- A **locator** crop is bound to the element: its box is locked in Studio (it
  re-resolves from the locator every time you re-render), while the `padding`
  around it stays adjustable.
- An **explicit region** crop has no element to track, so it is a free rectangle
  you can drag and resize in Studio.

To force a fixed output shape (a square or social card), set the output
`aspectRatio` in [render options](#render-options) rather than reshaping the crop.

## Overlays

Overlays work exactly as they do for videos, so a screenshot and a video from the
same project share one visual language. Declare overlays with
[`screenshot.overlays(...)`](/docs/guides/overlays) for badges and annotations,
and start them in the screenshot body.

```ts
import { screenshot } from 'screenci'

screenshot.overlays({
  newBadge: { path: '../assets/new-badge.png', x: 1382, y: 65, width: 384 },
})('Dashboard', async ({ page, crop, overlays }) => {
  await page.goto('https://app.example.com/dashboard')
  // In a screenshot, start an overlay and leave it open: it stays in the still.
  await overlays.newBadge.start()
  await crop(page.getByTestId('revenue-card'), { padding: 48 })
})
```

A still has no timeline, so an overlay you `start()` is simply shown in the image,
with no matching `end()` needed. The equivalent `video()` must close the overlay
before the recording stops:

```ts
video.overlays({
  newBadge: { path: '../assets/new-badge.png', x: 1382, y: 65, width: 384 },
})('Dashboard', async ({ page, overlays }) => {
  await page.goto('https://app.example.com/dashboard')
  // In a video, an overlay you start() must be ended.
  await overlays.newBadge.start()
  await page.getByTestId('revenue-card').hover()
  await overlays.newBadge.end()
})
```

### Highlight a locator

A common still is one element framed by a ring. Give a
[programmatic overlay](/docs/guides/overlays#positioning-over-a-live-element)
an `over` locator and a `margin` (CSS px): screenci sizes the ring to the
element's box plus that margin and lands it exactly around the element. In a
still you `start()` it and leave it open.

<!-- screenci-doc-screenshot:docs/guides/screenshots -->

The [Overlays guide](/docs/guides/overlays#positioning-over-a-live-element)
shows the same ring animated in a video.

## Cursor

A still does not show the mouse cursor by default, so polished product shots stay
clean. When the shot is meant to demonstrate an interaction (a hover or a click
target), turn the cursor on with `renderOptions.screenshot.mouse.show`. It is
drawn at the cursor's final position, the same spot the cursor lands after your
last `move`/`click`/`hover` in the body.

```ts
import { screenshot } from 'screenci'

screenshot('Hover state', async ({ page }) => {
  await page.goto('https://app.example.com/dashboard')
  // Land the cursor where you want it shown.
  await page.getByRole('button', { name: 'Upgrade' }).hover()
})

screenshot.use({
  renderOptions: {
    screenshot: {
      mouse: { show: true }, // default is false (no cursor)
    },
  },
})
```

The cursor reuses the same assets and styling as the video cursor: its colour
comes from `renderOptions.mouse.style` (`'white'` or `'black'`) and its size from
`renderOptions.mouse.size` (a fraction of the output height). Setting `show: true`
has no effect when the body never moved the cursor (there is no position to draw),
so a still that never touches the mouse never shows one. Like every render option,
`show` is editable later in Studio without re-recording.

## Quality and appearance

The viewport comes from `recordOptions.aspectRatio` and `recordOptions.quality`,
the same as videos. Screenshots capture at `recordOptions.deviceScaleFactor`,
which **defaults to `2`** so stills are crisp; lower it to `1` for smaller files,
or raise it for extra-high-DPI captures. Any Playwright `use` option (such as
`colorScheme: 'dark'`) is honored too.

```ts
screenshot.use({
  colorScheme: 'dark',
  recordOptions: {
    aspectRatio: '16:9',
    quality: '1440p',
    deviceScaleFactor: 2, // the default; set to 1 for smaller files
  },
})
```

A still captured inside a `video()` (via `page.screenshot()`) uses the video's
viewport resolution (the video pipeline does not upscale device pixels), so record
at a higher `recordOptions.quality` for crisp stills, or use a standalone
`screenshot()` test when you need a higher DPI than the video.

## Animations and speed

A still keeps only the final frame, so screenci does no animating to reach it.
Its own interaction animations (the cursor glide, the typing effect, the click
press, and the pacing pauses between actions) are all made instant for
screenshots, so a still runs as fast as the raw page interactions rather than
paying for motion that is never seen. Videos keep their pacing.

screenci also disables the **app's own** CSS animations and transitions while the
body drives the page. This is controlled by `recordOptions.disableAnimations`,
which **defaults to `true` for screenshots** and `false` for video (where motion
is usually the point). Override it either way: set `false` on a screenshot that
needs a mid-animation state, or `true` on a video to strip its animations.

```ts
screenshot.use({
  recordOptions: {
    disableAnimations: false, // keep the app's animations while capturing
  },
})
```

## Render options

Every visual choice is a render option, editable later in Studio. The
configurable screenshot-only options (`format`, `margin`, `aspectRatio`) live
under `renderOptions.screenshot`; the background, frame roundness, and shadow are
shared with video and stay under `renderOptions.output` and
`renderOptions.recording`. The comments below are the reference for each field.

There is no resolution preset for screenshots: the pixel size comes from the
captured crop scaled by the capture device pixel density
(`recordOptions.deviceScaleFactor`). Raise that for sharper stills. The crop is
not configurable here (it is recorded from `crop()` / `page.screenshot({ crop })`).

The background (and the frame shadow and rounded corners) appear only when there
is canvas area around the shot for them to fill, which is created by `margin`
and/or an explicit `aspectRatio`. With neither, the output is the bare crop and
the `output`/`recording` styling below has nowhere to render.

```ts
screenshot.use({
  renderOptions: {
    screenshot: {
      // Gap between the framed shot and the canvas edge, in CSS px. A value > 0
      // creates a background gutter (and gives the shadow and rounded corners room
      // to render). Defaults to 0: the canvas hugs the shot, no background.
      margin: 64,
      // Output canvas aspect ratio. 'auto' (the default) hugs the shot plus the
      // margin. An explicit ratio ('16:9', '1:1', '9:16', ...) centers the shot in
      // that canvas and fills the surround with the background, for social cards.
      aspectRatio: '1:1',
      // PNG by default (lossless). JPEG is smaller for photo-heavy shots; its
      // `quality` (1-100, default 90) is the compression level. Low values are
      // allowed if you want a smaller file.
      format: { type: 'jpeg', quality: 82 },
      // Show the cursor at its final recorded position. Defaults to false (no
      // cursor). Colour/size come from `mouse.style` / `mouse.size` below.
      mouse: { show: true },
    },
    output: {
      // Anything behind the framed shot: a CSS color, gradient, or image.
      background: {
        backgroundCss:
          'linear-gradient(135deg, #0f172a 0%, #1e293b 60%, #0f3460 100%)',
      },
    },
    recording: {
      // Corner radius of the framed shot, as a fraction (0-1) of its shorter side.
      roundness: 0.04,
      // Drop shadow behind the frame (any CSS `drop-shadow(...)` filter).
      dropShadow: 'drop-shadow(0 12px 32px rgba(0,0,0,0.55))',
    },
  },
})
```
