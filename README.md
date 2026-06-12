# screenci

Your UI changed. Your demo videos didn't. screenci fixes that.

Record product walkthroughs as code. When the UI ships, run
`npx screenci record` and your videos regenerate.

ScreenCI keeps the Playwright mental model, but the output is a maintainable
product video instead of a test report.

## Install and scaffold

```bash
npm init screenci@latest
pnpm create screenci
```

`init` creates a ready-to-run project in the current directory, installs
dependencies, and installs Chromium by default. When using `npm init`, pass
extra initializer flags after `--`, for example
`npm init screenci@latest -- --yes --package-manager pnpm`.

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
import { hide, speed, time, video } from 'screenci'

video('Onboarding flow', async ({ page }) => {
  await hide(async () => {
    await page.goto('https://app.example.com/signup')
  })

  await page.getByLabel('Email').fill('jane@example.com')
  await page.getByRole('button', { name: 'Create account' }).click()
  await speed(0.5, async () => {
    await page.getByRole('button', { name: 'Open dashboard tour' }).click()
  })
  await time(1000, async () => {
    await page.getByRole('button', { name: 'Skip tutorial' }).click()
  })
  await page.getByRole('heading', { name: 'Dashboard' }).waitFor()
})
```

Each `video()` call becomes one output video. The title becomes the filename
and the remote video identity.

Inside `video()`, `page` is a `ScreenCIPage`: a Playwright `Page` with animated
cursor movement and visible typing layered on top of normal Playwright
behavior.

`hide()` removes setup entirely. `speed()` and `time()` keep a section visible
but remap its rendered duration. Narration cue audio keeps its original
playback speed.

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

On the first run without `SCREENCI_SECRET`, `record` prints a one-time ScreenCI
link, waits for you to finish sign-in in the browser, saves the secret into the
project env file, and then continues. Pending auth state is cached in
`.screenci/link-session.json`, so rerunning `record` reuses the same link until
it expires or completes. Recorded artifacts still live in
`.screenci/<video-name>/`.

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

If you keep local runtime secrets in an env file, point `envFile` at it or use
the project `.env`. ScreenCI loads that file automatically for CLI commands.
That is also the right place for BYOK-style secrets such as
`ELEVENLABS_API_KEY`. ScreenCI does not store raw API keys from your env file.

## Authoring helpers

| Export            | What it does                                              |
| ----------------- | --------------------------------------------------------- |
| `defineConfig`    | Wraps Playwright config with ScreenCI defaults            |
| `video`           | Declares a video recording test                           |
| `createNarration` | Creates typed narration controllers                       |
| `hide`            | Cuts setup or cleanup out of the visible recording        |
| `autoZoom`        | Smooth camera follow for an interaction block             |
| `zoomTo`          | Manual camera framing for a locator or point              |
| `resetZoom`       | Returns from manual framing to the full viewport          |
| `createAssets`    | Inserts timed media overlays into the recording timeline  |
| `voices`          | Available voice constants such as `voices.Ava`            |
| `modelTypes`      | Narration model constants such as `modelTypes.consistent` |

## Output

```text
.screenci/
  <video-name>/
    recording.mp4
    data.json
```

When `SCREENCI_SECRET` is configured, `screenci record` uploads the output to
ScreenCI for rendering, narration generation, and hosted delivery.

For narration authoring, keep cues short and usually one sentence at a time.
That makes overlap timing easier to manage and should reduce TTS regeneration
cost when only one line changes.
