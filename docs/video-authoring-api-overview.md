# Video Authoring API Overview

This page is the curated bridge into the full typedoc. Use it when you want a
quick reminder of what the main ScreenCI authoring primitives are for, then
jump into the generated API reference for exhaustive signatures.

## `video()`

Declare one recorded video:

```ts
import { video } from 'screenci'

video('Checkout flow', async ({ page }) => {
  await page.goto('/checkout')
})
```

Full reference: [/docs/reference/api/variables/video](/docs/reference/api/variables/video)

## `createNarration()`

Define typed narration cues:

```ts
import { createNarration, voices } from 'screenci'

const narration = createNarration({
  voice: { name: voices.Sophie },
  languages: {
    en: { cues: { intro: 'Open the dashboard.' } },
  },
})
```

Use it with [Narration and Localization](/docs/guides/narration-and-localization).

## `hide()`

Cut setup or cleanup out of the visible recording:

```ts
await hide(async () => {
  await page.goto('/login')
})
```

Full reference: [/docs/reference/api/functions/hide](/docs/reference/api/functions/hide)

## `autoZoom()`

Let ScreenCI follow a focused interaction block:

```ts
await autoZoom(async () => {
  await page.getByLabel('Name').fill('Jane Doe')
})
```

Full reference: [/docs/reference/api/functions/autozoom](/docs/reference/api/functions/autozoom)

## `zoomTo()` and `resetZoom()`

Take manual control of framing:

```ts
await zoomTo(page.getByText('Net revenue'))
await resetZoom()
```

Use these when the camera should follow your direction instead of the next interaction.

## `createAssets()`

Add timed media overlays:

```ts
const assets = createAssets({
  intro: { path: './assets/intro.mp4', audio: 1, fullScreen: true },
})

await assets.intro()
```

Use it with [Assets and Overlays](/docs/guides/assets-and-overlays).

## Voices and helpers

ScreenCI also exports:

- `voices`
- `modelTypes`
- `languageRegions`
- `getDimensions`

These help you define narration behavior without falling back to raw strings everywhere.

## Full API reference

For the exhaustive generated reference, go to [Full API Reference](/docs/reference/api).
