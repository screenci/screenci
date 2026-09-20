# screenci

Product videos your whole team makes with one prompt.

Anyone on the team describes the video they want in the
[ScreenCI web app](https://app.screenci.com), pastes one prompt into a coding
agent, and gets back a narrated, auto-zoomed walkthrough of the real app. They
edit narration, voices, and languages in the browser. Engineers keep the
videos in the repository, where each one is a Playwright E2E test: when the
UI ships, CI runs `npx screenci export` and the videos regenerate, and a flow
that broke fails the run. This package is the CLI and the authoring API behind
all of it.

Learn more at [screenci.com](https://screenci.com), or start from
[Make videos by prompt](https://screenci.com/docs/make-videos) (no
repository needed) and [Repository and CI](https://screenci.com/docs/repository-and-ci)
(the engineering hand-off).

## Get started

```bash
npm init screenci@latest
# or
pnpm create screenci
```

This scaffolds a self-contained `screenci/` directory with its own
dependencies and installs Chromium. The directory is isolated from the
surrounding workspace, which keeps installation reliable inside monorepos.

Then write a video, run it locally, refine it, and export the final output:

```bash
npx screenci test      # author the video
npx screenci preview   # record live previews and print the link
npx screenci export    # render and download the finished video
```

Full docs:

- [Overview](https://screenci.com/docs)
- [Start in a repository](https://screenci.com/docs/agent-integration)
- [Writing scripts](https://screenci.com/docs/video-script-basics)
- [CLI reference](https://screenci.com/docs/reference/cli)

## Write a video

Video scripts are Playwright-style files with a `.screenci.ts` extension. If you
already know Playwright locators, navigation, and waiting, you already know
most of the automation layer.

```ts
// recordings/onboarding.screenci.ts
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

| Export            | What it does                                                 |
| ----------------- | ------------------------------------------------------------ |
| `defineConfig`    | Wraps Playwright config with ScreenCI defaults               |
| `video`           | Declares a video recording test                              |
| `video.narration` | Declares narration cues (per language or shared) for a video |
| `hide`            | Cuts setup or cleanup out of the visible recording           |
| `autoZoom`        | Smooth camera follow for an interaction block                |
| `zoomTo`          | Manual camera framing for a locator or point                 |
| `resetZoom`       | Returns from manual framing to the full viewport             |
| `video.overlays`  | Draws timed overlays (rings, callouts, media) over the video |
| `voices`          | Available voice constants such as `voices.Ava`               |
| `modelTypes`      | Narration model constants                                    |

See the [docs](https://screenci.com/docs) for configuration, narration,
camera, and CI setup.

## Community

Questions, ideas, or want to show off your videos? Join us on
[Discord](https://discord.gg/DyjSRFzeBc).
