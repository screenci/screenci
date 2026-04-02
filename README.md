# screenci

Your UI changed. Your demo videos didn't. screenci fixes that.

Record product walkthroughs as code. When the UI ships, run `screenci record` and your videos regenerate. No clicky re-recordings, no stale screenshots, no passive-aggressive Slack messages from the docs team.

## Install

```bash
npm install screenci
```

## Init a new project

```bash
npx screenci init my-project
cd my-project
npm install
```

This scaffolds a ready-to-run project:

```
my-project/
  screenci.config.ts     ← video settings
  videos/
    example.video.ts     ← your first video script
  Dockerfile             ← container image for CI recording
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

## Run it

```bash
# Dry-run: opens Playwright UI so you can see what you're recording
npm run dev

# Record: actually captures the screen
cd my-project && npm run record
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

screenci enforces `workers: 1`, `retries: 0`, and `fullyParallel: false` — FFmpeg records one screen at a time. Don't fight it.

## Captions & AI voiceovers

`createCaptions()` maps caption keys to text. At render time screenci sends the text through ElevenLabs and lines up the audio with your recording.

```ts
import { video, createCaptions } from 'screenci'

const captions = createCaptions({
  intro: 'Welcome to the dashboard.',
  addButton: 'Click here to create a new project.',
})

video('Dashboard walkthrough', async ({ page }) => {
  await page.goto('/dashboard')

  await captions.intro.start()
  // ...anything you do here plays over the voiceover...
  await captions.intro.end()

  await page.locator('#new-project').click()
  await captions.addButton.start()
  await captions.addButton.end()
})
```

### With a voice

```ts
import { createCaptions, voices } from 'screenci'

const captions = createCaptions(
  { voice: voices.en.Jude },
  {
    intro: 'Welcome to the dashboard.',
    addButton: 'Click here to create a new project.',
  }
)
```

### Multi-language (type-safe)

TypeScript will yell at you if any language is missing a key. That's a feature.

```ts
import { createCaptions, voices } from 'screenci'

const captions = createCaptions({
  en: {
    voice: voices.en.Jude,
    captions: {
      intro: 'Welcome to the dashboard.',
      addButton: 'Click here to create a new project.',
    },
  },
  fi: {
    voice: voices.fi.Martti,
    captions: {
      intro: 'Tervetuloa hallintapaneeliin.',
      addButton: 'Klikkaa tästä luodaksesi uuden projektin.',
    },
  },
})
```

## Hide the boring parts

`hide()` cuts a section from the final video. Perfect for logins, page loads, and test setup.

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

| Export           | What it does                                         |
| ---------------- | ---------------------------------------------------- |
| `defineConfig`   | Wraps Playwright config with screenci defaults       |
| `video`          | Declares a video recording test                      |
| `createCaptions` | Creates typed caption controllers with AI voiceovers |
| `hide`           | Cuts a section from the final video                  |
| `autoZoom`       | Smooth camera pan that follows interactions          |
| `voices`         | Available voice constants (`voices.en.Jude`, etc.)   |

The `page` fixture inside `video()` is a `ScreenCIPage` — a Playwright `Page` with animated cursor support wired in on all locator methods.

## Output

```
.screenci/
  <video-name>/
    recording.mp4   ← the raw screen capture
    data.json       ← interaction events + caption metadata
```

Upload to screenci.com for rendering, voiceover generation, and the permanent embed link:

```bash
npm run upload-latest
```
