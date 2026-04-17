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
    sendTraces: true,
  },
})
```

Any other valid Playwright config options (e.g. `timeout`, `reporter`, `webServer`) are passed through.

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

## `cue(content)`

→ [Full details](/reference/api/functions/createcues/)

Displays a text cue on the video. Returns a `CueHandle` with methods to control timing. Only one cue can be active at a time — a second `start()`/`until()` call queues behind the first and waits for it to be ended.

Cue text appears word by word, with each word taking 0.5 seconds. Starting a cue emits a `cueStart` event; ending one emits a `cueEnd` event.

### `cue(text).start()`

Resolves after all words have appeared (0.5s per word). The cue stays visible until `cue.end()` is called.

```ts
import { video, cue } from 'screenci'

video('Docs walkthrough', async ({ page }) => {
  await cue('Navigating to the docs').start()
  await page.goto('https://example.com/docs')
  await cue.end()

  await cue('Reading the introduction').start()
  await page.waitForTimeout(3000)
  await cue.end()
})
```

Awaiting is optional — if you don't need to wait for the animation to finish before continuing, just call it without `await`.

### `cue(text).until(percent)`

Resolves when the given percentage of the animation has elapsed. The full animation always runs to completion and the cue stays visible until `cue.end()` is called.

`percent` must be a `Percentage` string (`\`${number}%\``). The editor will show a type error for anything else.

```ts
video('Feature walkthrough', async ({ page }) => {
  // Resolves after 50% of words have appeared, then continues immediately
  await cue('Clicking get started').until('50%')
  await page.getByRole('link', { name: 'Get started' }).click()
  await cue.end()

  // Resolves immediately, cue animates in the background
  cue('Loading dashboard').until('0%')
  await page.waitForURL('**/dashboard')
  await cue.end()
})
```

| Value    | Resolves when                                      |
| -------- | -------------------------------------------------- |
| `'0%'`   | Immediately, before any word appears               |
| `'50%'`  | After half the words have appeared                 |
| `'100%'` | After all words have appeared (same as `.start()`) |

Throws at runtime if the value is not a finite number between 0 and 100.

### `cue.end()`

Ends the currently active cue and emits a `cueEnd` event. Call it after every `.start()` or `.until()`.

```ts
await cue('Step one').start()
await page.goto('https://example.com')
await cue.end()
```

Calling `cue.end()` when no cue is active is a no-op.

### Queuing

A second cue call queues behind the first — its animation does not begin until the previous cue's `end()` has been called:

```ts
cue('First cue').start()   // begins immediately
cue('Second cue').start()  // waits for first's end()

// ... do some work ...

await cue.end()  // ends first, second begins
await vi.advanceTimersByTimeAsync(...)
await cue.end()  // ends second
```

### Behavior

- **One at a time**: only one cue is active at a time. A second call queues rather than interrupting.
- **Word timing**: each word takes 0.5 seconds to appear.
- **Awaiting is optional**: all methods return promises but do not need to be awaited.

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
  beforeClickPause?: number // pause between cursor arrival and click in ms
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
    sendTraces?: boolean
    // ...all other Playwright use options
  }
  // ...all other Playwright config options
}
```
