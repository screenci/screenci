# Assets and Overlays

Assets let you place additional media on top of the recording timeline. Use them for intros, transitions, corner branding, or short contextual clips that would be awkward to build inside the browser automation itself.

Supported asset formats are limited to `.svg`, `.png`, and `.mp4`.

#### You will learn

- [how to define assets](#define-assets)
- [when to use full-screen versus overlay assets](#full-screen-vs-overlay)
- [how timing and ordering work](#timing-behavior)
- [how to organize files for maintainable projects](#file-organization)

## Define assets

```ts
import { createAssets, video } from 'screenci'

const assets = createAssets({
  intro: { path: './assets/intro.mp4', fullScreen: true },
  logo: { path: './assets/logo.png', durationMs: 1200, fullScreen: false },
})

video('Overview', async ({ page }) => {
  await assets.intro()
  await page.goto('/dashboard')
  await assets.logo()
})
```

Each key becomes a callable asset controller.

Rules:

- `.svg` and `.png` assets require `durationMs`
- `.svg` and `.png` assets do not support `audio`
- `.mp4` assets may provide `audio`; if omitted it defaults to `1`
- `.mp4` assets use the file's natural duration and must not provide `durationMs`

## Full-screen vs overlay

Use `fullScreen: true` for:

- intro clips
- transition clips
- end cards

Use `fullScreen: false` for:

- corner logos
- picture-in-picture presenter clips
- lightweight callout overlays

## Timing behavior

Asset timing is explicit in the script:

- `await assets.intro()` inserts the asset at that point in the timeline
- image assets (`.svg`, `.png`) stay visible for the recorded `durationMs`
- video assets (`.mp4`) stay visible for the media file's natural duration and play at full volume unless `audio` is specified
- full-screen assets take over the output frame
- overlay assets stay on top of the recording while the underlying screen continues

That means you do not need separate timing math just to line an intro clip up with the next step.

## File organization

A simple structure is usually enough:

```text
assets/
  intro.mp4
  transition.mp4
  badge.svg
  logo.png
```

Keep reusable brand assets separate from throwaway experiment files so the project stays readable.

## Authoring advice

- Use overlays sparingly.
- Mute assets that should not compete with narration.
- Keep intros and transitions short.
- Prefer short `durationMs` values for image overlays so they do not stall the timeline longer than needed.
- Prefer consistent placement and sizing across videos in the same series.

for the exported `createAssets()` API.
