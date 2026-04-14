---
title: Getting Started
description: Set up a screenci project in under five minutes.
---

# Getting Started

screenci records product videos from code. Scripts are Playwright test files — you write interactions, screenci handles the camera, cues, and narration.

## Prerequisites

You need **Node.js** and **Podman** (or Docker) installed. Node.js runs screenci scripts; Podman or Docker provides the isolated environment for recording. **Node.js 20+** is recommended, as well as **Podman 5+** or **Docker 28+**.

<!-- OS_SPECIFIC_PREREQUISITES_HERE -->

## Init a project

```bash
npx screenci init
```

You'll be prompted for a project name. screenci then opens a browser window to authenticate you and fetch your `SCREENCI_SECRET`, which is saved to `.env` automatically. After that it creates the directory, scaffolds the project, and prints what to do next.

```
my-project/
  screenci.config.ts     ← recording settings (edit this)
  videos/
    example.video.ts     ← starter script (edit this too)
  Dockerfile             ← for CI recording in a container
  package.json
  .gitignore
  .env                   ← contains SCREENCI_SECRET (gitignored)
```

## Write a video

Open `videos/example.video.ts`. You'll see:

```ts
import { video } from 'screenci'

video('Example video', async ({ page }) => {
  await page.goto('https://example.com')
  await page.waitForTimeout(3000)
})
```

This is a Playwright test. Everything in Playwright's `page` API works as-is. Replace `https://example.com` with your app, write the interactions, done.

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
npm run dev
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

- [Writing video tests](/reference/video-tests) — `hide()`, `autoZoom()`, `createNarration()`
- [Configuration reference](/reference/configuration) — all config options
- [API reference](/reference/api-overview) — full function signatures
- [CLI command reference](/reference/cli) — all CLI commands and options
