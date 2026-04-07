---
title: Writing Video Tests
description: How ScreenCI video scripts differ from Playwright tests, and how to use ScreenCIPage, captions, assets, autoZoom, and hide.
---

# Writing Video Tests

## Video scripts vs. Playwright tests

ScreenCI video scripts look like Playwright tests but have a different goal. A Playwright test verifies that your app behaves correctly — it makes assertions and fails when something is wrong. A ScreenCI video script _records what your app looks like_ — it drives the browser to produce a polished video.

This means:

- You generally don't write `expect()` assertions (though nothing stops you).
- You control pacing — add `waitForTimeout()` to let the UI settle before the next action.
- You care about what the _viewer_ sees, not just whether the test passes.

Everything in [Playwright's page API](https://playwright.dev/docs/api/class-page) works as-is. ScreenCI extends it — it does not replace it.

A video script file must end in `.video.ts` (or `.video.js`, `.video.mts`, etc.). Each call to `video()` produces one recorded video:

```ts
// videos/demo.video.ts
import { video } from 'screenci'

video('Product demo', async ({ page }) => {
  await page.goto('https://example.com')
  await page.click('text=Get Started')
  await page.fill('input[name="email"]', 'user@example.com')
  await page.click('button[type="submit"]')
})
```

`video()` is a thin wrapper around Playwright's [`test()`](https://playwright.dev/docs/api/class-test) — it accepts the same title, optional details object, and async body.

---

## `ScreenCIPage` — not a plain `Page`

Inside `video()`, the `page` fixture is a `ScreenCIPage`, not a standard Playwright [`Page`](https://playwright.dev/docs/api/class-page). The difference is intentional:

| What               | Playwright `Page`   | `ScreenCIPage`                                    |
| ------------------ | ------------------- | ------------------------------------------------- |
| `page.locator()`   | Returns `Locator`   | Returns `ScreenCILocator` (animated interactions) |
| `page.getByRole()` | Returns `Locator`   | Returns `ScreenCILocator`                         |
| `page.mouse`       | `Mouse` (teleport)  | `ScreenCIMouse` (animated bezier-curve moves)     |
| All other `page.*` | Standard Playwright | Same — unchanged                                  |

All standard `page` methods (`goto`, `waitForURL`, `waitForLoadState`, `waitForTimeout`, `keyboard`, `screenshot`, etc.) work exactly as documented in [Playwright's API](https://playwright.dev/docs/api/class-page).

### `ScreenCILocator` — animated interactions

`ScreenCILocator` wraps Playwright's [`Locator`](https://playwright.dev/docs/api/class-locator) and overrides the interaction methods to produce realistic on-screen cursor and typing animations:

| Method         | Playwright `Locator`           | `ScreenCILocator`                                        |
| -------------- | ------------------------------ | -------------------------------------------------------- |
| `click()`      | Instant click, no visible path | Animated bezier-curve cursor move, then click            |
| `fill()`       | Fills value in one shot        | Types character-by-character using `pressSequentially`   |
| `hover()`      | Instant hover                  | Animated cursor move, then hover                         |
| `dragTo()`     | Immediate drag                 | Animated move → mouseDown → animated drag → mouseUp      |
| `selectText()` | Instant selection              | Animated move, triple-click animation                    |
| All others     | Standard Playwright            | Same — returns `ScreenCILocator` to keep the chain typed |

```ts
video('Settings demo', async ({ page }) => {
  await page.goto('/settings')

  // fill() types character-by-character — viewer sees each keystroke
  await page.locator('#name').fill('Jane Doe')

  // click() moves the cursor along a curve before clicking
  await page.locator('button[type="submit"]').click()
})
```

`fill()` accepts extra options:

```ts
await page.locator('#email').fill('jane@example.com', {
  duration: 1500, // total typing time in ms (default: 1000)
  click: 'before', // animate cursor to the field and click before typing
  hideMouse: true, // hide the cursor while typing
})
```

All chaining methods (`locator()`, `getByRole()`, `filter()`, `first()`, `last()`, etc.) return `ScreenCILocator` so the animated behaviour is preserved throughout the chain.

---

## Voiceovers

`createVoiceOvers()` defines typed voiceover text. At render time ScreenCI generates an AI voiceover for each entry and syncs it to the recording.

```ts
import { video, createVoiceOvers, voices } from 'screenci'

const voiceOvers = createVoiceOvers({
  voice: { name: voices.Aria },
  languages: {
    en: {
      captions: {
        intro: "Let's walk through the settings page.",
        save: 'Hit save to apply your changes.',
      },
    },
  },
})

video('Settings walkthrough', async ({ page }) => {
  await page.goto('/settings')

  await voiceOvers.intro.start()
  await page.waitForTimeout(2000)
  await voiceOvers.intro.end()

  await page.locator('#save').click()
  await voiceOvers.save.start()
  await voiceOvers.save.end()
})
```

### `.start()` — display and move on

Resolves after all words have appeared (0.5 s per word). The caption stays visible until `.end()` is called. Use this when you want voiceovers to run in parallel with page interactions:

```ts
await voiceOvers.intro.start()
await page.goto('https://example.com/signup')
await voiceOvers.intro.end()
```

### `.end()` — end the voiceover

Call it after every `.start()`. Calling it when no voiceover is active is a no-op.

### Multi-language voiceovers

Pass a language map and TypeScript will enforce that every language has the same keys:

```ts
import { createVoiceOvers, voices } from 'screenci'

const voiceOvers = createVoiceOvers({
  voice: { name: voices.Aria },
  languages: {
    en: {
      captions: { intro: 'Welcome.', save: 'Hit save.' },
    },
    fi: {
      voice: { name: voices.Nora },
      captions: { intro: 'Tervetuloa.', save: 'Tallenna.' },
    },
  },
})
```

Missing a translation key in any language is a TypeScript error.

---

## Assets

`createAssets()` defines image or video overlays that appear on top of the recording at render time. Use them for intro screens, logo bugs, or transition clips.

```ts
import { video, createAssets } from 'screenci'

const assets = createAssets({
  logo: { path: './logo.png', audio: 0, fullScreen: false },
  intro: { path: './intro.mp4', audio: 1.0, fullScreen: true },
})

video('Product demo', async ({ page }) => {
  await assets.logo.start()
  await page.goto('/dashboard')
  await assets.intro.start()
})
```

`start()` marks the asset in the recording timeline and returns immediately. The renderer places the asset at that point in the video and plays it for its natural duration — no timing config required.

---

## `autoZoom`

`autoZoom()` adds a camera zoom that follows interactions. The camera zooms in at the start of the callback and zooms back out when it resolves. All clicks and fills inside drive a pan that keeps the active element centred.

```ts
import { video, autoZoom } from 'screenci'

video('Settings demo', async ({ page }) => {
  await page.goto('/settings/profile')

  await autoZoom(
    async () => {
      await page.locator('#name').fill('Jane Doe')
      await page.locator('#email').fill('jane@example.com')
      await page.locator('button[type="submit"]').click()
      await page.waitForTimeout(600)
    },
    { duration: 400, easing: 'ease-in-out', amount: 0.4 }
  )
})
```

`autoZoom` cannot be nested — calling it inside another `autoZoom` throws.

### Options

| Option     | Type     | Default         | Description                                             |
| ---------- | -------- | --------------- | ------------------------------------------------------- |
| `duration` | `number` | `400`           | Zoom-in and zoom-out transition duration in ms          |
| `easing`   | `string` | `'ease-in-out'` | CSS easing for the zoom transitions                     |
| `amount`   | `number` | `0.5`           | Fraction of output dimensions visible when zoomed (0–1) |

### One `autoZoom` per section

Wrap entire page sections, not individual clicks. The camera zooms in when you start a form and zooms back out when you leave — one smooth motion:

```ts
video('Multi-section demo', async ({ page }) => {
  await page.goto('/settings/profile')

  await autoZoom(
    async () => {
      await page.locator('#name').fill('Jane')
      await page.locator('#email').fill('jane@example.com')
      await page.locator('button[type="submit"]').click()
      await page.waitForTimeout(600)
    },
    { duration: 400, easing: 'ease-in-out', amount: 0.4 }
  )

  await page.goto('/settings/security')

  await autoZoom(
    async () => {
      await page.locator('#password').fill('new-secret')
      await page.locator('button[type="submit"]').click()
      await page.waitForTimeout(600)
    },
    { duration: 400, easing: 'ease-in-out', amount: 0.4 }
  )
})
```

---

## `hide`

`hide()` cuts a section from the final video. Any actions inside the callback are invisible to viewers. Use it for logins, page loads, redirects, and any setup the viewer doesn't need to see.

```ts
import { video, hide } from 'screenci'

video('Dashboard demo', async ({ page }) => {
  await hide(async () => {
    await page.goto('/login')
    await page.fill('input[type="email"]', 'admin@example.com')
    await page.fill('input[type="password"]', 'secret')
    await page.click('[type="submit"]')
    await page.waitForURL('**/dashboard')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)
  })

  // Video starts here — dashboard is already open and ready
  await page.locator('#reports').click()
})
```

`hide` cannot be nested — calling it inside another `hide` throws.

### Hide between sections

`hide()` is also useful between page transitions so the viewer doesn't watch a loading spinner:

```ts
await hide(async () => {
  await page.locator('nav a[href="/reports"]').click()
  await page.waitForURL('**/reports')
})

await autoZoom(
  async () => {
    // interact with the reports page
  },
  { duration: 400, easing: 'ease-in-out', amount: 0.4 }
)
```

---

## Regular Playwright code

Because `ScreenCIPage` preserves the full `Page` interface, all regular Playwright patterns work exactly as you'd expect:

```ts
import { video } from 'screenci'

video('Checkout flow', async ({ page }) => {
  await page.goto('/checkout')
  await page.waitForURL('**/checkout')
  await page.waitForSelector('#cart-summary')
  await page.waitForLoadState('networkidle')
  await page.keyboard.press('Tab')
  await page.keyboard.type('4111111111111111')
  await expect(page.locator('#total')).toBeVisible()
  await page.screenshot({ path: 'checkout.png' })
})
```

See [Playwright's full API docs](https://playwright.dev/docs/api/class-page) for everything available on `page`.

---

## Authentication

Use Playwright's [`storageState`](https://playwright.dev/docs/auth) to reuse an authenticated session:

```ts
// screenci.config.ts
import { defineConfig } from 'screenci'

export default defineConfig({
  use: {
    storageState: 'auth.json',
  },
})
```

Generate `auth.json` with a [Playwright global setup script](https://playwright.dev/docs/auth).

---

## Output location

```
.screenci/
  <sanitized-test-title>/
    recording.mp4   ← the video
    data.json       ← click and mouse move events
```

| Test title               | Directory name         |
| ------------------------ | ---------------------- |
| `'Homepage walkthrough'` | `homepage-walkthrough` |
| `'Sign up (new user)'`   | `sign-up-new-user`     |
| `'Step 1 & 2 — Login'`   | `step-1-2-login`       |

---

## Running without recording

Run scripts without screen capture to verify selectors and logic quickly:

```bash
npx playwright test --config=screenci.config.ts
```

With recording:

```bash
SCREENCI_RECORD=true npx playwright test --config=screenci.config.ts
```
