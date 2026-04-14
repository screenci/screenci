---
name: screenci
description: Record ScreenCI videos in an already-initialized project by editing `.video.ts` files and running the Screenci workflow.
allowed-tools:
  - Bash(screenci:*)
  - Bash(npx:*)
  - Bash(npm:*)
---

# ScreenCI

Use this skill when the task is about ScreenCI video recording workflows in an existing project, or updating `.video.ts` files and `screenci.config.ts`.

## Quick Start

Assume the project is already initialized. Add or edit video scripts in `videos/`.

If you are creating new videos, remove the starter `videos/example.video.ts` file.

```bash
# iterate locally without recording
npx screenci dev

# verify repeatedly until green
npx screenci test

# only record after tests pass
npx screenci record
```

## What ScreenCI Adds

ScreenCI uses Playwright-style `.video.ts` files and adds recording-specific helpers:

- `video()` declares one output video per test.
- `hide()` removes setup and loading sections from the final recording.
- `autoZoom()` follows a larger form or page area with smooth camera motion. Use it sparingly.
- `createNarration()` is mandatory for every video: define it in every `.video.ts` file and include spoken narration throughout the demo. Define the map once, then `await narration.key` where each line should begin. Use `await narration.wait()` only when the next action must wait for audio to finish.

## Required Conventions

**Every video MUST follow these conventions:**

1. **Narration on every video (required, no exceptions)** — always define `createNarration({ ... })` and add narration to every `.video.ts` file. Videos without narration are not acceptable.
2. **Hide initial setup** — wrap authentication, navigation to the starting page, loading spinners, and any other non-demo boilerplate in `hide()` so they are cut from the final recording.
3. **Use autoZoom sparingly on large page areas** — add `autoZoom()` only for larger sections that benefit from camera guidance (e.g. a full form, a full dialog, or a broad list area). Keep usage sparse, and make sure each `autoZoom()` block includes multiple related interactions (typing, selecting, toggling, confirming, etc.), not just a single click.

## Command Notes

- `screenci record` runs the recording flow. By default it uses Podman or Docker unless `--no-container` is used.
- `screenci dev` runs Playwright in UI mode for fast iteration without screen capture.
- `screenci retry` uploads the latest `.screenci` output when API configuration is available.

## Recording Workflow

1. Start from the existing initialized ScreenCI package.
2. Add or edit `.video.ts` files in `videos/`.
   Remove `videos/example.video.ts` if you are creating new videos and do not need the starter video.
   For narration, define `const narration = createNarration({ ... })` near the top of the file and trigger lines with `await narration.someKey` inside the test body.
3. Run `npx screenci dev` to validate selectors and flow.
4. Run `npx screenci test` until it passes.
5. Run `npx screenci record` to produce `.screenci/<video-name>/recording.mp4` and `data.json`.

## Specific Tasks

- **Recording videos** [references/record.md](references/record.md)
