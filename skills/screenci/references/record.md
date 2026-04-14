# `screenci record`

Use `screenci record` to capture ScreenCI videos from `.video.ts` scripts.

Assume the ScreenCI project is already initialized. Add new video scripts under `videos/`.
If you are creating new videos, remove the starter `videos/example.video.ts` file.

## Commands

```bash
npx screenci record
npx screenci record --no-container
npx screenci record -c screenci.config.ts
```

## What It Does

- Runs ScreenCI video tests
- Starts the recording pipeline
- Saves output under `.screenci/<video-name>/`
- Produces at least `recording.mp4` and `data.json`

## Runtime Behavior

- By default, recording runs in Podman or Docker.
- `--no-container` runs directly on the host.
- Playwright arguments can be passed through after the command.
- When API configuration and `SCREENCI_SECRET` are available, uploads may run after recording.

## Recommended Workflow

```bash
# first verify the flow
npx screenci dev

# then record
npx screenci record
```

## Workflow

Always run `npx screenci test` until it passes before running `npx screenci record`. Fix failures and rerun until green.

```bash
npx screenci test   # verify selectors, flow, and narration
npx screenci record # capture the final recording
```

## Required Conventions

These are not optional — every `.video.ts` file must follow all three:

### 1. Narration on every video (required, no exceptions)

Always add `createNarration({ ... })` to every video file. Videos without narration are not acceptable. Define the full narration map up front, then place `await narration.someKey` at the exact point in the script where each line should begin. `await narration.key` resolves immediately while audio plays in the background — only use `await narration.wait()` when the very next action must wait for the line to finish speaking.

### 2. Hide initial setup

Always wrap initial setup in `hide()`: login flows, navigation to the starting page, loading states, cookie banners, and any other boilerplate that is not part of the feature being demonstrated. If it is not the point of the video, hide it.

### 3. Use autoZoom sparingly on large page areas

Add `autoZoom()` only for larger sections that benefit from camera guidance — for example a full form, full dialog, or broad list area. Use `autoZoom()` sparingly, and ensure each block includes multiple related interactions (typing, selecting, toggling, confirming, etc.), not just a single click.

## Constraints

- ScreenCI enforces single-worker recording behavior.
- Playwright arguments can be passed through after the command.
