# Installation

ScreenCI is a Playwright-based workflow for producing product videos as code.
If you already know Playwright, the startup path should feel familiar:
initialize a project and run the generated E2E tests locally using `test` command.
The exact same code works for ScreenCI, just use `video(...)` instead of `test(...)`.
Then ScreenCI allows converting these tests into product videos with `record` command.

#### You will learn

- [how to install ScreenCI](#install-screenci)
- [what `screenci init` creates](#what-gets-created)
- [how to run the starter script locally](#run-the-example)
- [how to record the first final video](#record-the-final-result)

## Install ScreenCI

Initialize a new ScreenCI project:

```bash
npx screenci@latest init
```

If that does not work, install [Node.js](https://nodejs.org/en/download),
which comes with npm and provides `npx`.

`init` works both in an existing repository and as a standalone setup. It
writes a ScreenCI project into the current directory, for example in a
`/screenci` directory if that is where you run it, installs dependencies,
installs Playwright Chromium by default, and can also add a GitHub Actions
workflow at `.github/workflows/screenci.yaml`.

If you already know Playwright, the closest mental model is Playwright's own
[Getting started](https://playwright.dev/docs/intro): ScreenCI uses the same
browser automation stack, but the output is a maintained video instead of a
test suite.

## What gets created

The generated project includes the files you need for a first usable run:

```text
screenci.config.ts
package.json
README.md
.gitignore
videos/
  example.video.ts
.github/workflows/screenci.yaml (optional)
```

The starter video source looks like this:

```ts
import { autoZoom, createNarration, hide, video, voices } from 'screenci'

const narration = createNarration({
  voice: { name: voices.Sophie },
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
    await page.goto('https://screenci.com')
    await page.getByText('ScreenCI').first().waitFor()
  })

  await narration.intro()
  await narration.docs()

  await autoZoom(async () => {
    await page.getByRole('link', { name: 'View Documentation' }).click()
  })

  await page
    .getByRole('heading', { level: 1, name: 'Installation' })
    .first()
    .waitFor()
})
```

You do not need to understand every file before the first run. The main ones
are:

- `videos/example.video.ts` for the starter video script.
- `screenci.config.ts` for project-wide defaults.
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

`npx screenci test` accepts the same arguments as `npx playwright test`. For
example, to debug the videos visually, you could use `npx screenci test --ui`
to open [Playwright UI Mode](https://playwright.dev/docs/test-ui-mode).

## Record the final result

When you are ready to record the videos in the `videos/` directory, run:

```bash
npx screenci record
```

This prompts you to log in to ScreenCI the first time, then records the videos,
uploads them, and renders the final output.

<!-- screenci-doc-video:docs -->

## What's next

- [Write Video Scripts](/docs/write-video-scripts) to learn the authoring
  model.
- [Run and Debug Videos](/docs/run-and-debug-videos) for the local loop.
- [Record and Publish](/docs/record-and-publish) for final-output behavior.
