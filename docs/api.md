---
title: API Overview
description: Reference for all exported functions and types in the screenci package.
---

# API Reference

For full auto-generated details including all type signatures, see the [API Reference](/reference/api/).

## `defineConfig(config)`

→ [Full details](/reference/api/functions/defineconfig/)

Defines the ScreenCI configuration. Wraps Playwright's config with ScreenCI defaults and enforces settings required for reliable video recording.

**Enforced settings (cannot be overridden):**

- `workers: 1` — sequential execution
- `fullyParallel: false`
- `retries: 0`
- `testMatch` — only `*.video.*` files

```ts
import { defineConfig } from 'screenci'

export default defineConfig({
  videoDir: './videos', // Directory containing video test files (default: './videos')
  use: {
    videoOptions: {
      resolution: '1080p', // '720p' | '1080p' | '4k' | { width, height }
      fps: 30, // 24 | 30 | 60
      quality: 'high', // 'low' | 'medium' | 'high'
    },
    trace: 'retain-on-failure', // 'on' | 'off' | 'retain-on-failure'
  },
})
```

Any other valid Playwright config options (e.g. `timeout`, `reporter`) are passed through, except options ScreenCI manages itself.

---

## `video(title, body)`

## `video(title, details, body)`

→ [Full details](/reference/api/variables/video/)

The test fixture for declaring a recorded video. Works like Playwright's `test()` with automatic screen recording and event tracking wired in.

```ts
import { video } from 'screenci'

video('Title of the video', async ({ page }) => {
  await page.goto('https://example.com')
})
```

With Playwright test details:

```ts
video('Checkout flow', { tag: '@critical' }, async ({ page }) => {
  await page.goto('https://example.com/checkout')
})
```

### Fixtures available inside `video()`

All standard Playwright fixtures are available (`page`, `context`, `browser`, `request`), plus:

The `page` fixture returns a [`ScreenCIPage`](/reference/api/type-aliases/screencipage/) — a thin wrapper whose `.locator()` and related methods return [`ScreenCILocator`](/reference/api/type-aliases/screencilocator/) instead of Playwright's `Locator`, adding animated cursor and typed input behaviour.

| Fixture        | Type            | Description                     |
| -------------- | --------------- | ------------------------------- |
| `videoOptions` | `RecordOptions` | Current video recording options |

### Overriding options per test

```ts
video.use({ videoOptions: { resolution: '4k', fps: 60 } })

video('4K demo', async ({ page }) => {
  await page.goto('https://example.com')
})
```

---

## `autoZoom(fn, options?)`

→ [Full details](/reference/api/functions/autozoom/)

Zooms in on each interaction inside the callback, panning to follow clicks and fills. The camera zooms back out after the callback resolves.

For locator-based zooming, ScreenCI compares two framing targets and keeps the larger one: the fixed `amount` viewport and a locator-sized fit expanded by `padding`. The padded fit preserves the recording aspect ratio, using the more limiting side to decide how far to zoom out. Point targets `{ x, y }` continue to use only `amount`.

Cannot be nested — calling `autoZoom()` inside another `autoZoom()` throws.

```ts
import { video, autoZoom } from 'screenci'

video('Settings demo', async ({ page }) => {
  await page.goto('https://example.com/settings')

  await autoZoom(
    async () => {
      await page.locator('#name').fill('Jane')
      await page.locator('#email').fill('jane@example.com')
      await page.locator('button[type="submit"]').click()
    },
    { duration: 400, easing: 'ease-in-out', amount: 0.4 }
  )
})
```

### Options

| Option     | Type     | Default         | Description                                              |
| ---------- | -------- | --------------- | -------------------------------------------------------- |
| `duration` | `number` | `400`           | Zoom-in and zoom-out transition duration in milliseconds |
| `easing`   | `string` | `'ease-in-out'` | CSS easing for the zoom transitions                      |
| `amount`   | `number` | `0.5`           | Fraction of output dimensions visible when zoomed (0–1)  |
| `padding`  | `number` | `0.2`           | Extra locator framing as a uniform scale-up (0–1)        |

---

## `zoomTo(target, options?)`

→ See the [Zooming guide](/guides/zooming/) for manual zoom usage patterns.

Frames a locator or an explicit point without needing a click event first.

For locator targets, ScreenCI keeps the larger of the fixed `amount` viewport and the locator-sized fit expanded by `padding`. The padded fit preserves the recording aspect ratio, using the more limiting side to decide how far to zoom out. Point targets `{ x, y }` keep the existing `amount` behavior.

```ts
import { video, zoomTo } from 'screenci'

video('Chart demo', async ({ page }) => {
  await page.goto('https://example.com/dashboard')

  await zoomTo(page.locator('#chart'), {
    duration: 500,
    easing: 'ease-in-out',
    amount: 0.45,
    centering: 1,
  })
})
```

### Supported targets

- `Locator`
- `{ x: number, y: number }`

### Options

| Option      | Type     | Default      | Description                                             |
| ----------- | -------- | ------------ | ------------------------------------------------------- |
| `duration`  | `number` | `1600`       | Zoom transition duration in milliseconds                |
| `easing`    | `string` | `'ease-out'` | Easing for the zoom transition                          |
| `amount`    | `number` | `0.65`       | Fraction of output dimensions visible when zoomed (0–1) |
| `padding`   | `number` | `0.2`        | Extra locator framing as a uniform scale-up (0–1)       |
| `centering` | `number` | `1`          | Visibility bias inside the zoomed viewport (0–1)        |

Manual zoom and `autoZoom()` cannot be active at the same time.

---

## `resetZoom(options?)`

→ See the [Zooming guide](/guides/zooming/) for examples.

Returns from the current manual zoom state back to the full recording viewport.

```ts
import { resetZoom, video, zoomTo } from 'screenci'

video('Manual zoom demo', async ({ page }) => {
  await zoomTo({ x: 1200, y: 680 })
  await page.waitForTimeout(800)
  await resetZoom({ duration: 400, easing: 'ease-in-out' })
})
```

### Options

| Option     | Type     | Default      | Description                        |
| ---------- | -------- | ------------ | ---------------------------------- |
| `duration` | `number` | `1600`       | Zoom-out transition duration in ms |
| `easing`   | `string` | `'ease-out'` | Easing for the zoom-out transition |

---

## `hide(fn)`

→ [Full details](/reference/api/functions/hide/)

Hides recording events (mouse movements, clicks) while the callback runs. The hidden section is cut from the final video, making navigation and setup steps invisible to viewers.

Cannot be nested — calling `hide()` inside another `hide()` throws.

```ts
import { video, hide } from 'screenci'

video('Dashboard demo', async ({ page }) => {
  await hide(async () => {
    await page.goto('https://example.com/dashboard')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)
  })

  // Recording resumes here — viewer sees the dashboard ready to go
  await page.locator('#reports').click()
})
```

---

## Narration cues

ScreenCI does not expose a separate plain `cue()` API. Use `createNarration()` to define named narration cues and control them through the returned `narration.key` controllers.

Use:

- `await narration.key()` for the common full-cue path
- `await narration.key.start()` to begin narration and continue immediately
- `await narration.key.end()` only to close that same active cue later

See [Writing Video Tests](./video-tests.md) and [Localization & Narrations](./localization.md) for the public narration API and examples.

---

## Types

### `RecordOptions`

→ [Full type details](/reference/api/type-aliases/recordoptions/)

```ts
type RecordOptions = {
  resolution?: Resolution // default: '1080p'
  fps?: FPS // default: 30
  quality?: Quality // default: 'high'
}
```

### `RenderOptions`

→ [Full type details](/reference/api/type-aliases/renderoptions/)

Rendering options written as-is to `data.json`. Mirrors the `renderOptions` shape consumed by the rendering pipeline.

```ts
type RenderOptions = {
  recording?: {
    size?: number // 0-1: 1=one side touches background edge
    roundness?: number // 0-1: 0=sharp corners, 1=shorter side is half circle
    shape?: 'rounded'
    dropShadow?: string // CSS drop-shadow filter
  }
  narration?: {
    size?: number // 0-1: 1=mask size equals shorter side of output
    roundness?: number // 0-1: 0=square, 1=circle
    shape?: 'rounded'
    dropShadow?: string // CSS drop-shadow filter
    corner?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
    padding?: number // 0-1
  }
  cursor?: {
    size?: number // 0-1: 0=missing, 1=height of video
  }
  zooms?: {
    easing?: string
    duration?: number
  }
  output?: {
    resolution?: '1280x720' | '1920x1080' | '3840x2160' | `${number}x${number}` // ...
    background?: { assetPath: string } | { backgroundCss: string }
  }
}
```

### `Resolution`

```ts
type Resolution =
  | '720p' // 1280×720
  | '1080p' // 1920×1080
  | '4k' // 3840×2160
  | { width: number; height: number } // custom
```

### `FPS`

→ [Full type details](/reference/api/type-aliases/fps/)

```ts
type FPS = 24 | 30 | 60
```

| Value | Use case                                                        |
| ----- | --------------------------------------------------------------- |
| `24`  | Cinematic look, smallest file size                              |
| `30`  | Standard — good balance of smoothness and size                  |
| `60`  | Smooth motion, best for fast interactions or scroll-heavy demos |

### `Quality`

→ [Full type details](/reference/api/type-aliases/quality/)

```ts
type Quality = 'low' | 'medium' | 'high'
```

| Value      | CRF | Description                          |
| ---------- | --- | ------------------------------------ |
| `'low'`    | 28  | Smaller files, lower visual fidelity |
| `'medium'` | 23  | Balanced                             |
| `'high'`   | 18  | Best quality, larger files           |

### `Trace`

→ [Full type details](/reference/api/type-aliases/trace/)

```ts
type Trace = 'on' | 'off' | 'retain-on-failure'
```

Controls Playwright trace recording. `'retain-on-failure'` keeps traces only when tests fail.

### `ClickBeforeFillOption`

→ [Full type details](/reference/api/type-aliases/clickbeforefilloption/)

Controls the animated cursor move that happens before `fill()`, `pressSequentially()`, `check()`, `uncheck()`, `setChecked()`, or `selectOption()`.

```ts
type ClickBeforeFillOption = {
  moveDuration?: number // cursor move duration in ms (default: 1000)
  beforeClickPause?: number // pause between cursor arrival and click in ms (default: 50)
  moveEasing?: Easing // easing for the cursor move (default: 'ease-in-out')
  postClickPause?: number // pause after the click in ms
  postClickMove?: PostClickMove // optional camera pan after click
}
```

Pass `click` as a named option on the method:

```ts
await page.locator('input').fill('Jane', { click: { moveDuration: 500 } })
await page.locator('#checkbox').check({ click: { moveDuration: 500 } })
```

**`position` is always at the top level** (not inside `click`), matching Playwright's own convention:

```ts
// Point relative to the element's top-left corner to click before acting.
await page.locator('input').fill('Jane', {
  click: { moveDuration: 500 },
  position: { x: 10, y: 5 },
})

await page.locator('#checkbox').check({
  click: { moveDuration: 500 },
  position: { x: 1, y: 1 },
})
```

### `ScreenCIConfig`

→ [Full type details](/reference/api/type-aliases/screenciconfig/)

The config shape accepted by `defineConfig`. Extends Playwright's config — the following fields are managed by ScreenCI and cannot be set directly: `fullyParallel`, `workers`, `retries`, `testDir`, `testMatch`.

```ts
type ScreenCIConfig = {
  videoDir?: string
  use?: {
    videoOptions?: RecordOptions
    trace?: Trace
    // ...all other Playwright use options
  }
  // ...all other Playwright config options
}
```
