# screenci

Your UI changed. Your demo videos didn't. screenci fixes that.

Record product walkthroughs as code. When the UI ships, run
`npx screenci record` and your videos regenerate. You keep the Playwright
mental model, but the output is a maintainable product video instead of a
test report.

Learn more at [screenci.com](https://screenci.com).

## Get started

```bash
npm init screenci@latest
# or
pnpm create screenci
```

This scaffolds a self-contained `screenci/` directory with its own
dependencies and installs Chromium. The directory is isolated from the
surrounding workspace, which keeps installation reliable inside monorepos.

Then write a video, run it locally, and record the final output:

```bash
npx screenci test      # author the video
npx screenci record    # render and upload the final video
```

Full docs:

- [Getting started](https://screenci.com/docs)
- [Writing scripts](https://screenci.com/docs/write-video-scripts)
- [CLI reference](https://screenci.com/docs/reference/cli)

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
and the remote video identity. Inside `video()`, `page` is a `ScreenCIPage`: a
Playwright `Page` with animated cursor movement and visible typing layered on
top of normal Playwright behavior.

`hide()` removes setup entirely. `speed()` and `time()` keep a section visible
but remap its rendered duration.

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
| `createOverlays`  | Inserts timed media overlays into the recording timeline |
| `voices`          | Available voice constants such as `voices.Ava`           |
| `modelTypes`      | Narration model constants                                |

See the [docs](https://screenci.com/docs) for configuration, narration,
camera, and CI setup.

## Community

Questions, ideas, or want to show off your videos? Join us on
[Discord](https://discord.gg/DyjSRFzeBc).
