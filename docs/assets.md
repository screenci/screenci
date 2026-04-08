---
title: Assets
description: Add image and video overlays to your recordings with createAssets — intro screens, logo bugs, presenter clips, and transition assets.
---

# Assets

`createAssets()` lets you overlay image and video files on top of your screen recording. The renderer places each asset at the exact point in the timeline where you await it and plays it for its natural duration — no manual timing required.

```ts
import { video, createAssets } from 'screenci'

const assets = createAssets({
  intro: { path: './assets/intro.mp4', audio: 1.0, fullScreen: true },
  logo: { path: './assets/logo.png', audio: 0, fullScreen: false },
})

video('Product demo', async ({ page }) => {
  await assets.intro
  await page.goto('/dashboard')
  await assets.logo
})
```

---

## `createAssets(map)`

Creates a typed set of asset controllers. Each key in the map becomes an awaitable controller on the returned object.

```ts
const assets = createAssets({
  [key]: {
    path: string       // path to the asset file (image or video)
    audio: number      // audio volume: 0 = muted, 1.0 = full volume
    fullScreen: boolean // true = fills the output frame, false = shown as an overlay
  },
  ...
})
```

### Parameters

| Field        | Type      | Description                                                                                                                    |
| ------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `path`       | `string`  | Relative or absolute path to the file. Validated before recording starts.                                                      |
| `audio`      | `number`  | Volume multiplier. `0` = silent, `1.0` = original volume. Any value in between works.                                          |
| `fullScreen` | `boolean` | `true` = asset covers the entire output frame. `false` = rendered as a corner overlay (position controlled by render options). |

### Supported file types

| Extension | Notes                                                  |
| --------- | ------------------------------------------------------ |
| `.mp4`    | Video with or without audio. Most common format.       |
| `.webm`   | Alternative video format.                              |
| `.mov`    | QuickTime video.                                       |
| `.png`    | Still image. Displayed for a fixed duration at render. |
| `.jpg`    | Still image.                                           |
| `.gif`    | Animated GIF.                                          |

---

## Awaiting an asset

```ts
await assets.intro
```

Awaiting an asset marks it in the recording timeline. The asset always plays fully before anything that follows — every subsequent action appears in the output video only after the asset has finished.

```ts
await assets.intro // intro plays in output (e.g. 4 seconds)
await page.goto('/dashboard') // appears after intro finishes — no waitForTimeout needed
await assets.logo
await page.locator('#new').click() // appears after logo finishes
```

---

## Full-screen assets

Set `fullScreen: true` to cover the entire output frame. The recording is paused and the asset plays over it. Use this for intro screens, transition clips, or any overlay that should fill the frame:

```ts
const assets = createAssets({
  splash: { path: './assets/splash.mp4', audio: 1.0, fullScreen: true },
})

video('Demo', async ({ page }) => {
  await assets.splash // splash plays in full before /app loads in output
  await page.goto('/app')
})
```

---

## Overlay assets

Set `fullScreen: false` to render the asset as a picture-in-picture overlay — positioned in a corner of the output frame. The screen recording continues to play behind it.

```ts
const assets = createAssets({
  logo: { path: './assets/logo.png', audio: 0, fullScreen: false },
})
```

The corner position, size, and padding are shared with voiceOver overlay settings and can be configured via `renderOptions`:

```ts
video.use({
  renderOptions: {
    voiceOvers: {
      corner: 'bottom-right',
      size: 0.15,
      padding: 0.02,
    },
  },
})
```

---

## Audio

The `audio` field controls the volume of the asset's audio track relative to the original:

| Value | Effect                           |
| ----- | -------------------------------- |
| `0`   | Muted — no audio from this asset |
| `0.5` | Half volume                      |
| `1.0` | Full original volume             |

Audio is mixed into the final render alongside any voiceover audio. Set `audio: 0` for silent overlays (logos, watermarks) or when you don't want the asset's audio in the output.

---

## Multiple assets in one recording

You can define and use as many assets as needed:

```ts
const assets = createAssets({
  intro: { path: './assets/intro.mp4', audio: 1.0, fullScreen: true },
  outro: { path: './assets/outro.mp4', audio: 1.0, fullScreen: true },
  logo: { path: './assets/logo.png', audio: 0, fullScreen: false },
  transition: { path: './assets/wipe.mp4', audio: 0, fullScreen: true },
})

video('Full demo', async ({ page }) => {
  await assets.intro // plays in full before dashboard loads
  await page.goto('/dashboard')
  await assets.logo

  // ... interactions ...

  await assets.transition // plays before settings page appears
  await page.goto('/settings')

  await assets.outro
})
```

---

## Type safety

`createAssets` is fully typed. TypeScript infers the keys from the map, so `assets.typo` is a compile error:

```ts
const assets = createAssets({
  logo: { path: './logo.png', audio: 0, fullScreen: false },
})

await assets.logo // ✓
await assets.typo // TypeScript error: Property 'typo' does not exist
```

---

## File validation

Asset paths are validated before the recording starts. If a file does not exist at the given path (resolved relative to the video file), ScreenCI throws before any browser automation runs:

```
Error: Asset file not found: ./assets/missing.mp4
```

This prevents silent failures where a missing file would only be discovered at render time.
