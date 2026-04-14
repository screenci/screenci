---
title: Introduction
description: Welcome to ScreenCI documentation
---

# Welcome to ScreenCI

ScreenCI is the first **Deployment Automation** platform for product videos. We treat your product walkthroughs, documentation clips, and marketing videos as code—allowing them to be recorded, rendered, and updated automatically whenever your UI changes.

## Why ScreenCI?

Manual screen recording is brittle. Every time you change a button color or move a menu item, your documentation videos become obsolete. ScreenCI solves this by automating the entire lifecycle:

- **Write Once**: Write `.video.ts` files — almost regular Playwright e2e tests that are easy to write or AI-generate — and let ScreenCI record and render them with cues automatically on every update.
- **Re-record Automatically**: Trigger recordings in your own CI on every deployment.
- **Update via Text**: Change cues by simply typing. No reshoots required.
- **Embed Permanently**: Use a single link that always points to the latest version of your video.

## Playwright tests vs ScreenCI videos

| Topic                   | Playwright                                                                                              | ScreenCI                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Test file + import      | [`.test.ts` + `import { test } from '@playwright/test'`](https://playwright.dev/docs/writing-tests)     | [`.video.ts` + `import { video } from 'screenci'`](/reference/video-tests)                                                                                                                                                                                                                                                                                                                                                            |
| Project config          | Playwright config                                                                                       | [`screenci.config.ts`](/reference/configuration) with [`recordOptions`](/reference/api/type-aliases/screenciconfig/#recordoptions) and [`renderOptions`](/reference/api/type-aliases/screenciconfig/#renderoptions)                                                                                                                                                                                                                   |
| Setup command           | `playwright init`                                                                                       | [`screenci init`](/reference/cli)                                                                                                                                                                                                                                                                                                                                                                                                     |
| Run command             | `playwright test`                                                                                       | [`screenci test`](/reference/cli)                                                                                                                                                                                                                                                                                                                                                                                                     |
| Agentic script creation | Source-code-driven and tool-driven (for example [playwright-cli](https://playwright.dev/docs/test-cli)) | Same support, plus [AI-supported editing](/guides/ai-editing) for video workflows                                                                                                                                                                                                                                                                                                                                                     |
| Video-first concepts    | Standard test interactions                                                                              | [`click()`](/reference/video-tests#screencilocator--animated-interactions), [`hover()`](/reference/video-tests#screencilocator--animated-interactions), [`mouse.move()`](/reference/video-tests#screencipage--not-a-plain-page), [`createNarration()`](/reference/video-tests#narration), [`createAssets()`](/reference/video-tests#assets), [`hide()`](/reference/video-tests#hide), [`autoZoom()`](/reference/video-tests#autozoom) |

## Ready to start?

```bash
npx screenci init
```

Then follow the guides:

- [Getting started](/guides/getting-started) — install, init, first recording
- [Recording flows](/guides/recording) — `hide()`, `autoZoom()`, `createNarration()`
- [Automating with CI/CD](/guides/automation)
- [Localization & Narrations](/guides/localization)
