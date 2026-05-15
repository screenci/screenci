---
title: Introduction
description: Welcome to ScreenCI documentation
---

# Welcome to ScreenCI

ScreenCI is the first **Deployment Automation** platform for product videos. We treat your product walkthroughs, documentation clips, and marketing videos as code, allowing them to be recorded, rendered, and updated whenever your UI changes.

## Why ScreenCI?

Manual screen recording is brittle. Every time you change a button color or move a menu item, your documentation videos drift further out of date. ScreenCI solves this by automating the entire lifecycle:

- **Videos as Code**: Define videos as code in `.video.ts` files, using an API close to Playwright e2e tests.
- **Re-record Whenever You Want**: Own the recording setup like your e2e tests: re-record manually or in your own CI on every update.
- **Keep Your Code Private**: The ScreenCI service never sees your source code, only the screen recording and timing data used to render animations and add narration.
- **Optional Embeds**: Use a single link that always points to the latest accepted version of your video.

## Ready to start?

```bash
npx screenci@latest init
```

Then follow the guides:

- [Getting started](/guides/getting-started) — install, init, first recording
- [Recording flows](/guides/recording) — `hide()`, `autoZoom()`, `createNarration()`
- [Automating with CI/CD](/guides/automation)
- [Localization & Narrations](/guides/localization)
