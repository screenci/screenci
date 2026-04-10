---
name: screenci
description: Scaffold and record ScreenCI video projects. Use when creating a new screenci project, running screenci recordings, or editing screenci video scripts and config.
allowed-tools:
  - Bash(screenci:*)
  - Bash(npx:*)
  - Bash(npm:*)
---

# ScreenCI

Use this skill when the task is about ScreenCI project setup, video recording workflows, or updating `.video.ts` files and `screenci.config.ts`.

## Quick Start

```bash
# scaffold a new project
npx screenci init my-project
cd my-project
npm install

# iterate locally without recording
npx screenci dev

# capture recordings
npx screenci record
```

## What ScreenCI Adds

ScreenCI uses Playwright-style `.video.ts` files and adds recording-specific helpers:

- `video()` declares one output video per test.
- `hide()` removes setup and loading sections from the final recording.
- `autoZoom()` follows a form or page section with smooth camera motion.
- `createVoiceOvers()` creates typed narration and caption markers. Define the map once, then `await voiceOvers.key` where each line should begin. Use `await voiceOvers.waitEnd()` only when the next action must wait for audio to finish.

## Command Notes

- `screenci init` scaffolds a project with `screenci.config.ts`, a starter `videos/example.video.ts`, `Dockerfile`, and `package.json`.
- `screenci record` runs the recording flow. By default it uses Podman or Docker unless `--no-container` is used.
- `screenci dev` runs Playwright in UI mode for fast iteration without screen capture.
- `screenci retry` uploads the latest `.screenci` output when API configuration is available.

## Recording Workflow

1. Start from a generated project or an existing package using ScreenCI.
2. Edit `.video.ts` files like Playwright tests.
   For narration, define `const voiceOvers = createVoiceOvers({ ... })` near the top of the file and trigger lines with `await voiceOvers.someKey` inside the test body.
3. Run `npx screenci dev` to validate selectors and flow.
4. Run `npx screenci record` to produce `.screenci/<video-name>/recording.mp4` and `data.json`.

## Specific Tasks

- **Project scaffolding** [references/init.md](references/init.md)
- **Recording videos** [references/record.md](references/record.md)
