# screenci

Your UI changed. Your demo videos didn't. screenci fixes that.

Record product walkthroughs as code. When the UI ships, run
`npx screenci record` and your videos regenerate.

ScreenCI keeps the Playwright mental model, but the output is a maintainable
product video instead of a test report.

## Install and scaffold

```bash
npx screenci@latest init
```

`init` creates a ready-to-run project in the current directory, installs
dependencies, and installs Chromium by default.

```text
screenci.config.ts
package.json
tsconfig.json
README.md
.gitignore
.env
videos/
  example.video.ts
.github/workflows/screenci.yaml
```

Docs:

- Getting started: `https://screenci.com/docs`
- Writing scripts: `https://screenci.com/docs/write-video-scripts`
- CLI reference: `https://screenci.com/docs/reference/cli`

## Write a video

Video scripts are Playwright-style files with a `.video.ts` extension. If you
already know Playwright locators, navigation, and waiting, you already know
most of the automation layer.

```ts
// videos/onboarding.video.ts
import { hide, video } from 'screenci'

video('Onboarding flow', async ({ page }) => {
  await hide(async () => {
    await page.goto('https://app.example.com/signup')
  })

  await page.getByLabel('Email').fill('jane@example.com')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.getByRole('heading', { name: 'Dashboard' }).waitFor()
})
```

Each `video()` call becomes one output video. The title becomes the filename
and the remote video identity.

Inside `video()`, `page` is a `ScreenCIPage`: a Playwright `Page` with animated
cursor movement and visible typing layered on top of normal Playwright
behavior.

## Run locally

```bash
npx screenci test
npx screenci test --ui
```

Use `test` for the normal authoring loop. It runs the video scripts through
Playwright without starting the final recording and upload path.

## Record the final output

```bash
npx screenci record
```

`record` writes local artifacts into `.screenci/<video-name>/` and uploads them
when `SCREENCI_SECRET` is configured.

## Configure

```ts
// screenci.config.ts
import { defineConfig } from 'screenci'

export default defineConfig({
  projectName: 'my-project',
  envFile: '.env',
  videoDir: './videos',
  use: {
    baseURL: 'https://app.example.com',
    recordOptions: {
      aspectRatio: '16:9',
      quality: '1080p',
      fps: 60,
    },
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium' }],
})
```

ScreenCI manages `testDir`, `testMatch`, and `retries` for you. Most other
Playwright config still passes through.

## Authoring helpers

| Export            | What it does                                             |
| ----------------- | -------------------------------------------------------- |
| `defineConfig`    | Wraps Playwright config with ScreenCI defaults           |
| `video`           | Declares a video recording test                          |
| `createNarration` | Creates typed narration controllers                      |
| `hide`            | Cuts setup or cleanup out of the visible recording       |
| `autoZoom`        | Smooth camera follow for an interaction block            |
| `zoomTo`          | Manual camera framing for a locator or point             |
| `resetZoom`       | Returns from manual framing to the full viewport         |
| `createAssets`    | Inserts timed media overlays into the recording timeline |
| `voices`          | Available voice constants such as `voices.Ava`           |
| `languageRegions` | Region constants such as `languageRegions.en.US`         |

## Output

```text
.screenci/
  <video-name>/
    recording.mp4
    data.json
```

When `SCREENCI_SECRET` is configured, `screenci record` uploads the output to
ScreenCI for rendering, narration generation, and hosted delivery.
