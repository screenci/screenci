# `screenci record`

Use `screenci record` to capture ScreenCI videos from `.video.ts` scripts.

Assume the ScreenCI project is already initialized. Add new video scripts under `videos/`.
If you are creating new videos, remove the starter `videos/example.video.ts` file.

## Commands

```bash
npx screenci record
npx screenci record -c screenci.config.ts
```

## What It Does

- Runs ScreenCI video tests
- Starts the recording pipeline
- Saves output under `.screenci/<video-name>/`
- Produces at least `recording.mp4` and `data.json`

## Runtime Behavior

- Recording runs with local Playwright.
- Playwright arguments can be passed through after the command.
- When API configuration and `SCREENCI_SECRET` are available, uploads may run after recording.

## Recommended Workflow

```bash
# first verify the flow
npx screenci test

# then record
npx screenci record
```

## Workflow

Always run `npx screenci test` until it passes before running `npx screenci record`. Fix failures and rerun until green.

```bash
npx screenci test   # verify selectors, flow, and narration
npx screenci record # capture the final recording
```
