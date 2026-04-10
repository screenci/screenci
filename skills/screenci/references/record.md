# `screenci record`

Use `screenci record` to capture ScreenCI videos from `.video.ts` scripts.

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

Always run `npx screenci test` to verify the video works before running `npx screenci record`. Fix any failures before recording.

```bash
npx screenci test   # verify selectors, flow, and voice overs
npx screenci record # capture the final recording
```

## Required Conventions

These are not optional — every `.video.ts` file must follow all three:

### 1. Voice overs on every video

Always add `createVoiceOvers({ ... })` to every video file. No video should be silent. Define the full narration map up front, then place `await voiceOvers.someKey` at the exact point in the script where each line should begin. `await voiceOvers.key` resolves immediately while audio plays in the background — only use `await voiceOvers.waitEnd()` when the very next action must wait for the line to finish speaking.

### 2. Hide initial setup

Always wrap initial setup in `hide()`: login flows, navigation to the starting page, loading states, cookie banners, and any other boilerplate that is not part of the feature being demonstrated. If it is not the point of the video, hide it.

### 3. autoZoom every logical section

Wrap each distinct UI section in its own `autoZoom()` block — one block per form, dialog, list, or page area. Do not add one `autoZoom()` per individual click; group all actions within a logical section under a single `autoZoom()`.

## Constraints

- ScreenCI enforces single-worker recording behavior.
- Playwright arguments can be passed through after the command.
