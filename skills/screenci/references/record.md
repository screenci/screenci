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
npx screenci test --ui

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

These are not optional — every `.video.ts` file must follow all five:

### 1. Narration on every video (required, no exceptions)

Always add `createNarration({ ... })` to every video file. Videos without narration are not acceptable. Define the full narration map up front, then place `await narration.someKey()` when the whole line should finish before moving on. Use `await narration.key.start()` only when narration should overlap with the next action, and `await narration.key.end()` only to close that same active cue later. In practice, this often means awaiting `narration.key()` or `narration.key.end()` before the next navigation.

### 2. Hide initial setup

Always wrap initial setup in `hide()`, especially the initial page load: login flows, navigation to the starting page, loading states, cookie banners, and any other boilerplate that is not part of the feature being demonstrated. It is also a good place to click away cookie banners so they never appear in the final video. If it is not the point of the video, hide it.

### 3. Use autoZoom sparingly on large page areas

Add `autoZoom()` only for larger sections that benefit from camera guidance — for example a full form, full dialog, or broad list area. Use `autoZoom()` sparingly, and ensure each block includes multiple related interactions (typing, selecting, toggling, confirming, etc.), not just a single click.

### 4. End autoZoom before page changes

Let each `autoZoom()` block complete before navigation/page changes. Staying zoomed during a route transition is confusing for viewers. After the new page is ready, start a new `autoZoom()` block for that page section if needed.

### 5. Prefer default action options

Use ScreenCI's default options for `autoZoom()` and locator actions such as `click()`, `fill()`, `pressSequentially()`, `check()`, `uncheck()`, `selectOption()`, and `selectText()`. Do not add a separate `locator.click()` before `locator.fill()` or `locator.pressSequentially()` just to focus the field: those actions already move to the field, click it, and then type by default. Do not add custom `zoom`, `click`, `position`, timing, or other locator-action overrides unless the user explicitly asks for different behavior or the recording flow clearly needs a specific adjustment.

## Constraints

- ScreenCI enforces single-worker recording behavior.
- Playwright arguments can be passed through after the command.
