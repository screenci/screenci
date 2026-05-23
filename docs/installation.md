# Installation

ScreenCI is a Playwright-based workflow for producing viewer-facing product videos as code. If you already know Playwright, the setup will feel familiar: install, scaffold a project, run the generated script locally, then record the final output when the flow looks right.

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
- [how to test the starter script](#run-the-example)
- [how to record the first final video](#record-the-final-result)

## Install ScreenCI

Before you start, make sure Node.js and npm are available:

```bash
node --version
npm --version
```

If either command is missing or too old, install Node.js from the [official Node.js download page](https://nodejs.org/en/download). Node.js 20 or newer is recommended.

Initialize a new ScreenCI project with:

```bash
npx screenci@latest init
```

`init` writes ScreenCI files into the current directory.

## What gets created

The generated project includes the files you need for the first recording:

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

You do not need to understand every file before the first run. The main ones are:

- `videos/example.video.ts` for the starter script.
- `screenci.config.ts` for project-wide defaults.

## Run the example

Run the starter script locally from the same directory:

```bash
npx screenci test
```

This is the fast authoring loop. It runs the `.video.ts` file with ScreenCI's Playwright base but skips the final recording pipeline so you can iterate on selectors, timing, and app state quickly.

## Record the final result

When the starter script behaves correctly, record it:

```bash
npx screenci record
```

`record` captures the browser session locally, uploads the raw recording and metadata, and lets ScreenCI render the final viewer-facing output with narration, subtitles, zooms, and overlays.
