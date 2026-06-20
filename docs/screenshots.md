# Screenshots

Alongside videos, ScreenCI can produce **branded still screenshots**. You author
them with the same Playwright-like API you already use for videos, drive the page
to the state you want, and ScreenCI captures it and frames it on your configured
background, with a rounded frame, an optional crop to a component, and overlays.

A screenshot is captured directly from the page (no video is recorded), then
composited at render time. Screenshots are cheaper to render than videos and are
delivered through the same hosting, versioning, and Studio editing.

#### You will learn

- [how a screenshot script differs from a video](#screenshot-vs-video)
- [how to crop to a component or a region](#cropping)
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

Use `crop()` to frame a single component or an explicit region. The crop is
applied by the renderer, which places the cropped region (plus any `padding`) on
the background with the branded frame.

```ts
import { screenshot, crop } from 'screenci'

screenshot('Revenue card', async ({ page }) => {
  await page.goto('https://app.example.com/dashboard')

  // Crop to a component, with 6% breathing room around it.
  await crop(page.getByTestId('revenue-card'), { padding: 0.06 })
})
```

`crop()` also accepts an explicit region as fractions (0..1) of the viewport:

```ts
await crop({ x: 0.1, y: 0.2, width: 0.8, height: 0.6 })
```

## Quality and appearance

The viewport comes from `recordOptions.aspectRatio` and `recordOptions.quality`,
the same as videos. For a sharper, higher-DPI still, set
`recordOptions.deviceScaleFactor` (the easy way to ask for higher quality). Any
Playwright `use` option (such as `colorScheme: 'dark'`) is honored too.

```ts
screenshot.use({
  colorScheme: 'dark',
  recordOptions: {
    aspectRatio: '16:9',
    quality: '1440p',
    deviceScaleFactor: 2,
  },
})
```

## Framing: margin and aspect ratio

Control the framing the way you would in CSS. `recording.margin` is the gap
between the framed shot and the canvas edge, as a fraction (0-1) of the shorter
output side; the shot scales to fit the canvas minus that margin, centered. It
supersedes `recording.size` for screenshots.

`output.aspectRatio` sets the canvas shape. Use a fixed ratio (`'1:1'`,
`'16:9'`, ...) for a social card, or `'auto'` to let the canvas hug the shot
plus a uniform margin (no letterbox bars).

```ts
screenshot.use({
  renderOptions: {
    recording: { margin: 0.08 },
    output: { aspectRatio: 'auto' }, // or '1:1', '16:9', ...
  },
})
```

## Output format

Screenshots are PNG by default (lossless). Choose JPEG for smaller, photo-heavy
shots; `quality` is the JPEG compression quality (1-100, default 90) and is
separate from `recordOptions.quality`, which is the resolution.

```ts
screenshot.use({
  renderOptions: {
    output: { format: { type: 'jpeg', quality: 82 } }, // or 'png'
  },
})
```

## Overlays and background

Overlays and the background are configured exactly as they are for videos, so a
screenshot and a video from the same project share one visual language. Use
[`createOverlays`](/docs/guides/assets-and-overlays) for badges and annotations,
and `renderOptions` for the background, frame roundness, and shadow.

```ts
import { screenshot, crop, createOverlays } from 'screenci'

const overlays = createOverlays({
  newBadge: { path: '../assets/new-badge.png', x: 0.72, y: 0.06, width: 0.2 },
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

screenshot('Dashboard hero', async ({ page }) => {
  await page.goto('https://app.example.com/dashboard')
  await overlays.newBadge()
  await crop(page.getByTestId('revenue-card'), { padding: 0.06 })
})
```
