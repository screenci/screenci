---
title: Introduction
description: Welcome to ScreenCI documentation
---

# Welcome to ScreenCI

ScreenCI is the first **Deployment Automation** platform for product videos. We treat your product walkthroughs, documentation clips, and marketing videos as code, allowing them to be recorded, rendered, and updated whenever your UI changes.

## Why ScreenCI?

Manual screen recording is brittle. Every time you change a button color or move a menu item, your documentation videos drift further out of date. ScreenCI solves this by automating the entire lifecycle:

- **Write Once**: Write `.video.ts` files, almost regular Playwright e2e tests that are easy to write or AI-generate, and let ScreenCI record and render them with cues automatically on every update.
- **Re-record Whenever You Want**: Re-record manually or trigger recordings in your own CI on every update.
- **Update via Text**: Change narration by simply typing. No reshoots required.
- **Embed Permanently**: Use a single link that always points to the latest accepted version of your video.

## Playwright tests vs ScreenCI videos

| Topic              | Playwright                                                                                          | ScreenCI                                                                   |
| ------------------ | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Test file + import | [`.test.ts` + `import { test } from '@playwright/test'`](https://playwright.dev/docs/writing-tests) | [`.video.ts` + `import { video } from 'screenci'`](/reference/video-tests) |
| Project config     | `playwright.config.ts`                                                                              | [`screenci.config.ts`](/reference/configuration)                           |
| Setup command      | `playwright init`                                                                                   | [`screenci init`](/reference/cli)                                          |
| Run command        | `playwright test`                                                                                   | [`screenci test`](/reference/cli) + [`screenci record`](/reference/cli)    |

## Ready to start?

```bash
npx screenci@latest init
```

Then follow the guides:

- [Getting started](/guides/getting-started) — install, init, first recording
- [Recording flows](/guides/recording) — `hide()`, `autoZoom()`, `createNarration()`
- [Automating with CI/CD](/guides/automation)
- [Localization & Narrations](/guides/localization)
