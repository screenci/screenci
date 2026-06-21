# Screenshots

Alongside videos, ScreenCI can produce **branded still screenshots**. You author
them with the same Playwright-like API you already use for videos, drive the page
to the state you want, and ScreenCI captures it and frames it on your configured
background, with a rounded frame, an optional crop to a component, and overlays.

A screenshot is captured directly from the page (no video is recorded), then
composited at render time, and delivered through the same hosting, versioning,
and Studio editing.

## Two ways to capture

**1. A standalone `screenshot()` test** drives the page and captures the final
state (no video recorded):

```ts
import { screenshot } from 'screenci'

screenshot('Dashboard hero', async ({ page }) => {
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
  await page.screenshot({ name: 'Dashboard hero' }) // -> screenshot named "Dashboard hero"
})
```

Both produce the same branded still, framed and hosted identically. The rest of
this guide applies to either. The sections below detail each.

#### You will learn

- [how a screenshot script differs from a video](#screenshot-vs-video)
- [how to crop to a component or a region](#cropping)
- [how to capture stills during a video](#stills-during-a-video)
- [how to set quality and dark mode](#quality-and-appearance)
- [how to add overlays and a background](#overlays-and-background)

## Screenshot vs video

Screenshots live in the same `*.screenci.ts` files as videos (the `videoDir`); a
file can contain any mix of `video()` and `screenshot()` calls. Use the
`screenshot()` fixture instead of `video()`:

```ts
import { screenshot } from 'screenci'

screenshot('Dashboard hero', async ({ page }) => {
  await page.goto('https://app.example.com/dashboard')
  await page.getByRole('button', { name: 'Reports' }).click()
  await page.getByText('Monthly revenue').waitFor()
})
```

The body runs just like a video body. When it returns, the final page state is
captured. Narration, audio, and camera motion do not apply to a still and are
ignored.

## Cropping

The `screenshot()` fixture provides a `crop` argument. Call it to frame a single
component or an explicit region. The crop is applied by the renderer, which
places the cropped region (plus any `padding`) on the background with the branded
frame.

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

### Padding and aspect ratio

`padding` is in CSS px. Pass a single number to pad every side equally, or an
object for **uneven padding** (omitted sides default to `0`):

```ts
// 24 px on every side except a roomier bottom for a caption.
await crop(page.getByTestId('chart'), {
  padding: { top: 24, right: 24, bottom: 64, left: 24 },
})
```

`aspectRatio` (`width / height`) **forces the crop to a fixed shape**, applied
after padding, so the framed region includes the padding and still hits the ratio
exactly. The crop grows along its deficient axis around its centre (capped to the
viewport), which is handy for consistent social cards:

```ts
// A 16:9 crop around the card, with breathing room, regardless of its shape.
await crop(page.getByTestId('revenue-card'), {
  padding: 48,
  aspectRatio: 16 / 9,
})
```

(This is the shape of the captured region. The output canvas shape is set
separately by `renderOptions.screenshot.aspectRatio`, which defaults to `'auto'`
and hugs the crop.)

The crop is stored as a render option (`renderOptions.screenshot.crop`), so it is
editable in Studio afterward. You can also set a default crop in config; a `crop()`
call (or `page.screenshot({ crop })` inside a video) overrides that default.

## Stills during a video

You do not need a separate `screenshot()` test to grab a still of a moment that
already appears in a video. Inside a `video()`, call `page.screenshot()` to
capture a branded still at that point. It is delivered as its own screenshot
recording named by the `name` you pass, framed and hosted exactly like a
standalone screenshot, and the call still returns the captured bytes.

```ts
import { video } from 'screenci'

video('Product demo', async ({ page }) => {
  await page.goto('https://app.example.com/dashboard')
  await page.screenshot({ name: 'Dashboard hero' }) // -> screenshot named "Dashboard hero"

  await page.getByRole('button', { name: 'Reports' }).click()
  await page.screenshot({
    name: 'reports',
    crop: page.getByTestId('chart'), // a locator or a pixel region
  })
})
```

Each call produces one still, so give each a distinct `name` (names must be unique
across your recordings, like video titles). A still captured
this way is taken at the video's viewport resolution (the video pipeline does not
upscale device pixels), so record at a higher `recordOptions.quality` for crisp
stills, or use a standalone `screenshot()` test when you need a higher DPI than
the video.

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

## The screenshot render group

All screenshot-only render options live under `renderOptions.screenshot`:
`format`, `quality`, `aspectRatio`, `margin`, and `crop`. (Background, frame
roundness, and shadow are shared with video and stay under `renderOptions.output`
and `renderOptions.recording`.) Every field here is editable later in Studio.

```ts
screenshot.use({
  renderOptions: {
    screenshot: {
      aspectRatio: 'auto', // or '1:1', '16:9', ... (fixed)
      quality: '1440p',
      margin: 0.08,
      format: { type: 'jpeg', quality: 82 }, // or 'png' (the default)
    },
  },
})
```

### Framing: margin and aspect ratio

`margin` is the gap between the framed shot and the canvas edge, as a fraction
(0-1) of the shorter output side; the shot scales to fit the canvas minus that
margin, centered. `aspectRatio` sets the canvas shape: a fixed ratio (`'1:1'`,
`'16:9'`, ...) for a social card, or `'auto'` to let the canvas hug the shot plus
a uniform margin (no letterbox bars).

### Output format

Screenshots are PNG by default (lossless). Choose JPEG for smaller, photo-heavy
shots; its `quality` is the JPEG compression quality (1-100, default 90),
separate from `screenshot.quality`, which is the resolution.

## Overlays and background

Overlays and the background are configured exactly as they are for videos, so a
screenshot and a video from the same project share one visual language. Use
[`createOverlays`](/docs/guides/assets-and-overlays) for badges and annotations,
and `renderOptions` for the background, frame roundness, and shadow.

```ts
import { screenshot, createOverlays } from 'screenci'

const overlays = createOverlays({
  newBadge: { path: '../assets/new-badge.png', x: 1382, y: 65, width: 384 },
})

screenshot.use({
  renderOptions: {
    output: {
      background: {
        backgroundCss:
          'linear-gradient(135deg, #0f172a 0%, #1e293b 60%, #0f3460 100%)',
      },
    },
    recording: {
      roundness: 0.04,
      dropShadow: 'drop-shadow(0 12px 32px rgba(0,0,0,0.55))',
    },
  },
})

screenshot('Dashboard hero', async ({ page, crop }) => {
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
video('Dashboard hero', async ({ page }) => {
  await page.goto('https://app.example.com/dashboard')
  // In a video, an overlay you start() must be ended.
  await overlays.newBadge.start()
  await page.getByTestId('revenue-card').hover()
  await overlays.newBadge.end()
})
```
