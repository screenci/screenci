# Installation

ScreenCI is a Playwright-based workflow for producing product videos as code.
If you already know Playwright, the startup path should feel familiar:
initialize a project, run the generated script locally, then record the final
output when the visible flow looks right.

<video controls crossorigin="anonymous" poster="https://api.screenci.com/public/kh7dq5rk3vabtxya45w6zm1fmd871jdx/en/thumbnail" style="max-width:100%; border: 1px solid #ccc;">
  <source src="https://api.screenci.com/public/kh7dq5rk3vabtxya45w6zm1fmd871jdx/en/video" type="video/mp4" />
  <track kind="subtitles" src="https://api.screenci.com/public/kh7dq5rk3vabtxya45w6zm1fmd871jdx/en/subtitle" srclang="en" label="English" default />
</video>

<details>
<summary>Show source</summary>

```ts
import { autoZoom, createNarration, hide, video, voices } from 'screenci'

const narration = createNarration({
  voice: { name: voices.Sophie, style: 'Clear, friendly product walkthrough' },
  languages: {
    en: {
      cues: {
        intro:
          'This video shows how to get started with ScreenCI [pronounce: screen see eye].',
        docs: 'You can find the documentation linked right on the front page.',
      },
    },
  },
})

video('How to get started', async ({ page }) => {
  await hide(async () => {
    await page.goto('https://screenci.com/')
    await page.getByText('ScreenCI').first().waitFor()
  })

  await narration.intro()
  await narration.docs()

  await autoZoom(async () => {
    await page.getByRole('link', { name: 'View Documentation' }).click()
  })
})
```

</details>

#### You will learn

- [how to install ScreenCI](#install-screenci)
- [what `screenci init` creates](#what-gets-created)
- [how to run the starter script locally](#run-the-example)
- [how to record the first final video](#record-the-final-result)

## Install ScreenCI

Before you start, make sure Node.js and npm are available:

```bash
node --version
npm --version
```

If either command is missing or too old, install Node.js from the
[official Node.js download page](https://nodejs.org/en/download). Node.js 20 or
newer is recommended.

Then initialize a new ScreenCI project:

```bash
npx screenci@latest init
```

`init` writes a ScreenCI project into the current directory, installs
dependencies, and installs Playwright Chromium by default.

If you already know Playwright, the closest mental model is Playwright's own
[Getting started](https://playwright.dev/docs/intro): ScreenCI uses the same
browser automation stack, but the output is a maintained video instead of a
test suite.

## What gets created

The generated project includes the files you need for a first usable run:

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

You do not need to understand every file before the first run. The main ones
are:

- `videos/example.video.ts` for the starter video script.
- `screenci.config.ts` for project-wide defaults.
- `.env` for `SCREENCI_SECRET` and other environment variables.
- `.github/workflows/screenci.yaml` for CI recording, if you accepted the
  generated GitHub Actions workflow.

If you want the full command surface next, jump to [CLI](/docs/reference/cli).

## Run the example

Run the starter script locally from the same directory:

```bash
npx screenci test
```

This is the fast authoring loop. It runs the `.video.ts` file with ScreenCI's
Playwright base but skips the final recording pipeline so you can iterate on
selectors, timing, and app state quickly.

Useful next commands:

```bash
npx screenci test --ui
npx screenci test --mock-record
```

- `--ui` opens Playwright UI Mode for local debugging. See
  [Playwright UI Mode](https://playwright.dev/docs/test-ui-mode).
- `--mock-record` keeps recording-style pacing enabled without starting the
  final recording pipeline. See
  [Run and Debug Videos](/docs/run-and-debug-videos).

## Record the final result

When the starter script behaves correctly, record it:

```bash
npx screenci record
```

`record` captures the browser session locally and writes artifacts into
`.screenci/`. If `SCREENCI_SECRET` is configured, ScreenCI also uploads the
recordings for rendering, narration, subtitles, zooms, and hosted delivery.

## What's next

- [Write Video Scripts](/docs/write-video-scripts) to learn the authoring
  model.
- [Run and Debug Videos](/docs/run-and-debug-videos) for the local loop.
- [Record and Publish](/docs/record-and-publish) for final-output behavior.
