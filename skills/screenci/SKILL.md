---
name: screenci
description: Create, show, and guide with ScreenCI videos in an already-initialized project by editing `.video.ts` files and running the Screenci workflow.
allowed-tools:
  - Bash(screenci:*)
  - Bash(npx:*)
  - Bash(npm:*)
---

# ScreenCI Video and Guide Skill

Use this skill when the task is about ScreenCI video recording workflows in an existing project, or updating `.video.ts` files and `screenci.config.ts`.

Trigger this skill when the user asks to:

- create a video
- show a flow as a video
- create a guide/demo video

Routing rules:

- If the user provides a URL, always use the `playwright-cli` skill first to inspect the real page flow and selectors before editing the ScreenCI script.
- If the user provides source code for the target page/component, that usually means browser exploration is not required first.
- If the request is only about application/source-code changes (not recording or `.video.ts` updates), do not use this skill.

## Quick Start

Assume the project is already initialized. Add or edit video scripts in `videos/`.

If you are creating new videos, remove the starter `videos/example.video.ts` file.

```bash
# iterate locally without recording
npx screenci test --ui

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
2. **Start on the requested page** — the visible video should always begin on the page the user requested.
3. **Hide initial setup** — the initial page load should almost always be wrapped in `hide()`. Keep authentication, navigation to the starting page, loading spinners, cookie banner dismissal, and any other non-demo boilerplate inside that hidden block so they are cut from the final recording.
4. **Use autoZoom sparingly on large page areas** — add `autoZoom()` only for larger sections that benefit from camera guidance (e.g. a full form, a full dialog, or a broad list area). Keep usage sparse, and make sure each `autoZoom()` block includes multiple related interactions (typing, selecting, toggling, confirming, etc.), not just a single click.
5. **End autoZoom before page changes** — it is better to let an `autoZoom()` block finish before a navigation/page change. Staying zoomed during navigation is confusing. Start a new `autoZoom()` block on the next page/section when needed.

## Command Notes

- `screenci record` runs the recording flow in Podman or Docker.
- `screenci test --ui` runs Playwright in UI mode for fast iteration without screen capture.
- `screenci retry` uploads the latest `.screenci` output when API configuration is available.

## Recording Workflow

1. Start from the existing initialized ScreenCI package.
2. Add or edit `.video.ts` files in `videos/`.
   Remove `videos/example.video.ts` if you are creating new videos and do not need the starter video.
   For narration, define `const narration = createNarration({ ... })` near the top of the file and trigger lines with `await narration.someKey` inside the test body.
3. Run `npx screenci test --ui` to validate selectors and flow.
4. Run `npx screenci test` until it passes.
5. Run `npx screenci record` to produce `.screenci/<video-name>/recording.mp4` and `data.json`.

## Specific Tasks

- **Recording videos** [references/record.md](references/record.md)
