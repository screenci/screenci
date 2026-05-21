# screenci

Your UI changed. Your demo videos didn't. screenci fixes that.

Record product walkthroughs as code. When the UI ships, run `screenci record` and your videos regenerate. No clicky re-recordings, no stale screenshots, no passive-aggressive Slack messages from the docs team.

## Install

```bash
npm install screenci
```

## Init a new project

```bash
npx screenci init "My Project"
cd screenci
npm install
```

This scaffolds a ready-to-run project:

```
screenci/
  screenci.config.ts     ← video settings
  videos/
    example.video.ts     ← your first video script
  package.json
  .gitignore
```

## Write a video

Video scripts are Playwright test files with a `.video.ts` extension. If you already know Playwright, you already know 90% of this.

```ts
// videos/onboarding.video.ts
import { video } from 'screenci'

video('Onboarding flow', async ({ page }) => {
  await page.goto('https://app.example.com/signup')
  await page.fill('input[name="email"]', 'jane@example.com')
  await page.click('button[type="submit"]')
  await page.waitForURL('**/dashboard')
})
```

Each `video()` call → one `.mp4`. The title becomes the filename.

> **Full reference:** [Writing Video Tests](http://localhost:4321/reference/video-tests)

### `ScreenCIPage` — animated interactions

Inside `video()`, `page` is a `ScreenCIPage` — a Playwright `Page` with animated cursor and typing. You don't need to change anything; the animations happen automatically:

| Method          | Behaviour                                       |
| --------------- | ----------------------------------------------- |
| `click()`       | Bezier-curve cursor move, then click            |
| `fill()`        | Character-by-character typing                   |
| `hover()`       | Animated cursor move                            |
| `dragTo()`      | Animated move → mouseDown → drag → mouseUp      |
| `page.mouse`    | Smooth bezier moves instead of instant teleport |
| Everything else | Standard Playwright — unchanged                 |

All standard `page` methods (`goto`, `waitForURL`, `waitForLoadState`, `waitForTimeout`, `keyboard`, `screenshot`, `expect`, …) work exactly as documented in [Playwright's API](https://playwright.dev/docs/api/class-page).

`fill()` already moves to the field, clicks it, and types, so you do not need a separate `click()` first:

```ts
const searchBox = page.getByPlaceholder('Search')

await searchBox.fill('Item 1')
```

## Run it

```bash
# Dry-run: opens Playwright UI so you can verify selectors and pacing
npx screenci test --ui

# Record: captures the screen and writes .screenci/<name>/recording.mp4
npx screenci record
```

Or via the package scripts scaffolded by `init`:

```bash
npm run test    # → npx screenci test
npm run record  # → npx screenci record
```

Recordings land in `.screenci/<video-name>/recording.mp4` alongside a `data.json` with all the interaction events.

## Configure

```ts
// screenci.config.ts
import { defineConfig } from 'screenci'

export default defineConfig({
  projectName: 'my-project',
  videoDir: './videos',
  use: {
    baseURL: 'https://app.example.com',
    recordOptions: {
      aspectRatio: '16:9', // '16:9' | '9:16' | '1:1' | '4:3' | ...
      quality: '1080p', // '720p' | '1080p' | '1440p' | '2160p'
      fps: 30, // 24 | 30 | 60
    },
  },
})
```

screenci enforces `workers: 1`, `retries: 0`, and `fullyParallel: false` so each generated video has one deterministic timeline. Don't fight it.

## AI narration

`createNarration()` maps keys to narration text (or audio files). Define it once near the top of the file, then call `await narration.key.start()` wherever that spoken line should begin. The audio keeps playing while your next actions run. Use `await narration.key.finish()` when a line must be fully spoken before the next action, especially before visible navigation or the first on-screen action after the intro.

```ts
import { video, createNarration, voices } from 'screenci'

const narration = createNarration({
  voice: { name: voices.Aria },
  languages: {
    en: {
      cues: {
        intro: 'Welcome to the dashboard.',
        addButton: 'Click here to create a new project.',
      },
    },
  },
})

video('Dashboard walkthrough', async ({ page }) => {
  await page.goto('/dashboard')

  await narration.intro.start()
  await narration.intro.finish()
  await page.locator('#reports').click()

  await narration.addButton.start()
  await narration.addButton.finish()
  await page.locator('#new-project').click()
})
```

Use this pattern:

```ts
const narration = createNarration({ ... })

video('Example', async ({ page }) => {
  await narration.intro.start() // starts narration now
  await page.click('#filters') // runs while intro audio is still playing

  await narration.details.start() // auto-ends intro, then starts details
  await narration.details.finish() // use this before navigation or the next gated action
  await page.click('#confirm')
})
```

### Multi-language (type-safe)

TypeScript enforces that every language has the same keys. Missing a translation is a compile error.

```ts
import { createNarration, voices } from 'screenci'

const narration = createNarration({
  voice: { name: voices.Ava },
  languages: {
    en: {
      cues: {
        intro: 'Welcome to the dashboard.',
        addButton: 'Click here to create a new project.',
      },
    },
    fi: {
      voice: { name: voices.Nora },
      cues: {
        intro: 'Tervetuloa hallintapaneeliin.',
        addButton: 'Klikkaa tästä luodaksesi uuden projektin.',
      },
    },
  },
})
```

## Hide the boring parts

`hide()` cuts a section from the final video. Use it for logins, especially the initial page load, cookie banner dismissal, and other setup the viewer should not see.

```ts
import { video, hide } from 'screenci'

video('Dashboard demo', async ({ page }) => {
  await hide(async () => {
    // viewer never sees this
    await page.goto('/login')
    await page.fill('input[name="email"]', 'admin@example.com')
    await page.fill('input[name="password"]', 'hunter2')
    await page.click('button[type="submit"]')
    await page.waitForURL('**/dashboard')
  })

  // video starts here — dashboard is already open
  await page.locator('#reports').click()
})
```

## Zoom the camera

`autoZoom()` follows interactions with a smooth camera pan. Wrap a form or a page section, not individual clicks.

```ts
import { video, autoZoom } from 'screenci'

video('Profile settings', async ({ page }) => {
  await page.goto('/settings/profile')

  await autoZoom(
    async () => {
      await page.locator('#name').fill('Jane Doe')
      await page.locator('#bio').fill('Engineer')
      await page.locator('button[type="submit"]').click()
    },
    { duration: 400, amount: 0.4, easing: 'ease-in-out' }
  )
})
```

## API

| Export            | What it does                                                       |
| ----------------- | ------------------------------------------------------------------ |
| `defineConfig`    | Wraps Playwright config with screenci defaults                     |
| `video`           | Declares a video recording test                                    |
| `createNarration` | Creates typed narration controllers with AI-generated audio        |
| `hide`            | Cuts a section from the final video                                |
| `autoZoom`        | Smooth camera pan that follows interactions                        |
| `voices`          | Available voice constants (`voices.Ava`, `voices.elevenlabs(...)`) |

The `page` fixture inside `video()` is a `ScreenCIPage` — a Playwright `Page` with animated cursor support wired in on all locator methods.

## Output

```
.screenci/
  <video-name>/
    recording.mp4   ← the raw screen capture
    data.json       ← interaction events + cue metadata
```

Upload to screenci.com for rendering, narration generation, and the permanent embed link:

```bash
npm run retry
```
