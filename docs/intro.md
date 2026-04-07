---
title: Introduction
description: Welcome to ScreenCI documentation
---

# Welcome to ScreenCI

ScreenCI is the first **Deployment Automation** platform for product videos. We treat your product walkthroughs, documentation clips, and marketing videos as code—allowing them to be recorded, rendered, and updated automatically whenever your UI changes.

## Why ScreenCI?

Manual screen recording is brittle. Every time you change a button color or move a menu item, your documentation videos become obsolete. ScreenCI solves this by automating the entire lifecycle:

- **Write Once**: Write `.video.ts` files — almost regular Playwright e2e tests that are easy to write or AI-generate — and let ScreenCI record and render them with captions automatically on every update.
- **Re-record Automatically**: Trigger recordings in your own CI on every deployment.
- **Update via Text**: Change captions by simply typing. No reshoots required.
- **Embed Permanently**: Use a single link that always points to the latest version of your video.

## Ready to start?

```bash
npx screenci init
```

Then follow the guides:

- [Getting started](/guides/getting-started) — install, init, first recording
- [Recording flows](/guides/recording) — `hide()`, `autoZoom()`, `createVoiceOvers()`
- [Automating with CI/CD](/guides/automation)
- [Localization & Voiceovers](/guides/localization)
