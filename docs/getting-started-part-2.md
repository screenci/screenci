---
title: Getting Started Part 2
description: Write your first video, record it, configure it, and upload it.
---

# Getting Started Part 2

Continue from [Getting started](/guides/getting-started) after you have initialized your project.

## Write a video

Open `videos/example.video.ts`. You'll see:

```ts
import { createNarration, hide, video, voices } from 'screenci'

const narration = createNarration({
  voice: { name: voices.Sophie, style: 'Clear, friendly product walkthrough' },
  languages: {
    en: {
      cues: {
        intro:
          'Here is how to find instructions for starting to create your own ScreenCI [pronounce: screen see eye] videos. [short pause] Start on the homepage, then open the documentation from the hero section.',
        docs: 'The documentation opens with the guide sidebar on the left. In the Guides group, choose AI-Supported Editing.',
      },
    },
    es: {
      cues: {
        intro:
          'Aqui se muestra como encontrar instrucciones para empezar a crear tus propios videos de ScreenCI [pronounce: screen see eye]. [short pause] Comienza en la pagina principal y abre la documentacion desde la seccion principal.',
        docs: 'La documentacion se abre con la barra lateral de guias a la izquierda. En el grupo Guias, elige Edicion asistida por IA.',
      },
    },
  },
})

video('Navigate to AI editing documentation', async ({ page }) => {
  await hide(async () => {
    await page.goto('https://screenci.com/')
    await page.getByText('ScreenCI', { exact: true }).first().waitFor()
  })

  await narration.intro
  await page.getByRole('link', { name: 'View Documentation' }).click()

  await narration.docs
  await page
    .getByRole('link', { name: 'AI-Supported Editing', exact: true })
    .click()
})
```

This is a simple ScreenCI video file built on top of Playwright, with two language versions for narration. Replace the starter flow with your app, keep the Playwright interactions, and add narration where each spoken line should begin.

## Playwright tests vs ScreenCI videos

| Topic              | Playwright                                                                                          | ScreenCI                                                                   |
| ------------------ | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Test file + import | [`.test.ts` + `import { test } from '@playwright/test'`](https://playwright.dev/docs/writing-tests) | [`.video.ts` + `import { video } from 'screenci'`](/reference/video-tests) |
| Project config     | `playwright.config.ts`                                                                              | [`screenci.config.ts`](/reference/configuration)                           |
| Setup command      | `playwright init`                                                                                   | [`screenci init`](/reference/cli)                                          |
| Run command        | `playwright test`                                                                                   | [`screenci test`](/reference/cli) + [`screenci record`](/reference/cli)    |

### What ScreenCI adds

The `page` fixture inside `video()` is a `ScreenCIPage` — a wrapper whose `.locator()` and related methods return animated versions of Playwright's locators. Clicks move the cursor along a bezier curve; `fill()` types character-by-character.

On top of that, screenci adds:

| API                 | What it does                                                        |
| ------------------- | ------------------------------------------------------------------- |
| `hide(fn)`          | Cuts the section from the final video (logins, page loads, setup)   |
| `autoZoom(fn)`      | Smooth camera zoom that follows clicks and fills                    |
| `createNarration()` | Typed narration markers — `await narration.key` where a line starts |
| `createAssets()`    | Image or video overlays shown during the recording                  |

All of these are composable with normal [Playwright](https://playwright.dev/docs/api/class-page) code. No rewrites required.

## Develop without recording

```bash
npm run test -- --ui
```

Opens the Playwright UI. Run your scripts, verify selectors work, iterate fast. No screen capture, no Docker, no FFmpeg. Just Playwright.

## Record

```bash
cd my-project && npm run record
```

Runs in a container (Docker/podman), starts a virtual display, launches a headless browser, captures the screen with FFmpeg, and saves:

```
.screenci/
  example-video/
    recording.mp4
    data.json
```

## Test without recording

```bash
npx screenci test
```

This forwards to `playwright test` with your `screenci.config.ts`. Use it when you want ordinary Playwright execution without recording.

## Configure

Edit `screenci.config.ts` to set your target URL, aspect ratio, and quality:

```ts
import { defineConfig } from 'screenci'

export default defineConfig({
  projectName: 'my-project',
  videoDir: './videos',
  use: {
    baseURL: 'https://app.example.com',
    recordOptions: {
      aspectRatio: '16:9',
      quality: '1080p',
      fps: 30,
    },
  },
})
```

## Upload and render

Once you have a recording you're happy with, upload it to screenci.com for rendering, narration generation, and your permanent embed link:

```bash
npm run retry
```

Cloud rendering is limited to 30 minutes per render. If a render exceeds that wall-clock limit, ScreenCI marks it as failed.

Set `apiUrl` in your config (or `SCREENCI_URL` env var) to point at the API.

## Inspect project info and public URLs

With `SCREENCI_SECRET` configured, you can inspect the remote project linked to your local `projectName`:

```bash
npx screenci info
```

Make a video public or private with its `id` from that JSON:

```bash
npx screenci make-public video_123
npx screenci make-private video_123
```

---

## Next steps

- [Getting started](/guides/getting-started) — prerequisites and project initialization
- [Writing video tests](/reference/video-tests) — `hide()`, `autoZoom()`, `createNarration()`
- [Configuration reference](/reference/configuration) — all config options
- [API reference](/reference/api-overview) — full function signatures
- [CLI command reference](/reference/cli) — all CLI commands and options
