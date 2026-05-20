---
title: Playwright vs ScreenCI
description: Understand how Playwright tests compare with ScreenCI videos, and what ScreenCI adds for recording product videos.
---

# Playwright vs ScreenCI

ScreenCI is built on top of Playwright. You still write browser automation with familiar Playwright patterns, but the test file becomes a video script and ScreenCI adds recording-focused behavior around it.

Use Playwright when you want to verify that an application works. Use ScreenCI when you want to turn those same kinds of browser interactions into product videos with camera movement, narration, subtitles, and overlays.

## Playwright tests vs ScreenCI videos

| Topic              | Playwright                                                                                          | ScreenCI                                                                   |
| ------------------ | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Test file + import | [`.test.ts` + `import { test } from '@playwright/test'`](https://playwright.dev/docs/writing-tests) | [`.video.ts` + `import { video } from 'screenci'`](/reference/video-tests) |
| Project config     | `playwright.config.ts`                                                                              | [`screenci.config.ts`](/reference/configuration)                           |
| Setup command      | `playwright init`                                                                                   | [`screenci init`](/reference/cli)                                          |
| Run command        | `playwright test`                                                                                   | [`screenci test`](/reference/cli) + [`screenci record`](/reference/cli)    |

The structure is intentionally close to Playwright. A ScreenCI video script still opens pages, finds locators, clicks elements, fills fields, and waits for UI changes. The difference is that the output is not only a pass or fail result: ScreenCI also records the browser session and prepares the data needed to render the final video.

## What ScreenCI adds

The `page` fixture inside `video()` is a `ScreenCIPage`: a wrapper whose `.locator()` and related methods return animated versions of Playwright's locators. Clicks move the cursor along a bezier curve; `fill()` types character-by-character.

On top of that, screenci adds:

| API                 | What it does                                                               |
| ------------------- | -------------------------------------------------------------------------- |
| `hide(fn)`          | Cuts the section from the final video (logins, page loads, setup)          |
| `autoZoom(fn)`      | Smooth camera zoom that follows clicks and fills                           |
| `createNarration()` | Typed narration markers: `await narration.key.start()` where a line starts |
| `createAssets()`    | Image or video overlays shown during the recording                         |

All of these are composable with normal [Playwright](https://playwright.dev/docs/api/class-page) code. No rewrites required.

## Development workflow

Run ScreenCI scripts without recording when you are checking selectors or iterating on the flow:

```bash
npx screenci test
```

Record when the script is ready:

```bash
npx screenci record
```

That split lets you use the fast Playwright feedback loop while developing, then record the final video only when the script, narration markers, and visual timing are ready.

---

## Next steps

- [Writing video tests](/reference/video-tests) — `hide()`, `autoZoom()`, `createNarration()`
- [Configuration reference](/reference/configuration) — all config options
- [CLI command reference](/reference/cli) — all CLI commands and options
