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
- `autoZoom()` follows a larger form or page area with smooth camera motion. Use it sparingly, and start with its default options unless the user explicitly asks for different zoom behavior or the flow clearly needs a targeted override.
- `createNarration()` is mandatory for every video: define it in every `.video.ts` file and include spoken narration throughout the demo. The opening narration should first state the purpose of the video, then continue with the explanation or walkthrough. Define the map once, then call `await narration.key()` for the common case where the full line should run before moving on. Use `await narration.key.start()` when narration should overlap with the next action, and `await narration.key.end()` only to close that same active cue later, especially before visible navigation or route changes.
- Narration text can include inline speech-control tags such as `[pronounce: screen see eye]`, `[short pause]`, `[medium pause]`, and `[long pause]` when a word needs guided pronunciation or an intentional pause. When narration includes a URL or domain name, add a pronunciation guide or rewrite the line so it will be spoken clearly. Example: `screenci.com [pronounce: screen see eye dot com]`.

## Required Conventions

**Every video MUST follow these conventions:**

- **Narration on every video (required, no exceptions)** — always define `createNarration({ ... })` and add narration to every `.video.ts` file. Videos without narration are not acceptable.
- **Open with the video's purpose** — the first spoken narration should clearly state what the video is for before moving into the step-by-step explanation.
- **Guide pronunciation for URLs and domains** — if narration says a URL, domain, product name, or other term that a voice model might read incorrectly, add a `[pronounce: ...]` hint or phrase it in a clearly spoken way.
- **Start on the requested page** — the visible video should always begin on the page the user requested.
- **Hide initial setup** — the initial page load should almost always be wrapped in `hide()`. Keep authentication, navigation to the starting page, loading spinners, cookie banner dismissal, and any other non-demo boilerplate inside that hidden block so they are cut from the final recording.
- **Navigate visibly with clicks** — after hidden setup, move through the demo by clicking real links and buttons instead of calling `page.goto()`.
- **Prefer mouse-driven selection after typing** — when typing into search boxes, comboboxes, autocomplete fields, command menus, or similar UI, prefer clicking the visible result or CTA with the mouse instead of submitting with keyboard actions like `press('Enter')` when a clickable target is available. Example: after `await searchBox.fill('product')`, prefer `await page.getByRole('link', { name: 'Specific Product' }).click()`.
- **Use autoZoom sparingly on large page areas** — add `autoZoom()` only for larger sections that benefit from camera guidance (e.g. a full form, a full dialog, or a broad list area). Keep usage sparse, and make sure each `autoZoom()` block includes multiple related interactions (typing, selecting, toggling, confirming, etc.), not just a single click.
- **End autoZoom before page changes** — it is better to let an `autoZoom()` block finish before a navigation/page change. Staying zoomed during navigation is confusing. Start a new `autoZoom()` block on the next page/section when needed.
- **Prefer default action options** — for `autoZoom()` and locator actions such as `click()`, `fill()`, `pressSequentially()`, `check()`, `uncheck()`, `selectOption()`, `selectText()`, and similar helpers, start with ScreenCI's default options. In particular, do not add a separate `locator.click()` before `locator.fill()` or `locator.pressSequentially()` just to focus the field: those actions already move to the field, click it, and then type by default. Do not add custom `zoom`, `click`, `position`, timing, or other locator-action overrides unless the user asks for them or the recording flow clearly needs a specific adjustment.

## Command Notes

- `screenci record` runs the recording flow with local Playwright.
- `screenci test --ui` runs Playwright in UI mode for fast iteration without screen capture.
- `screenci retry` uploads the latest `.screenci` output when API configuration is available.

## Recording Workflow

1. Start from the existing initialized ScreenCI package.
2. Add or edit `.video.ts` files in `videos/`.
   Remove `videos/example.video.ts` if you are creating new videos and do not need the starter video.
   For narration, define `const narration = createNarration({ ... })` near the top of the file and trigger lines with `await narration.someKey()` when the full line should finish before moving on. Use `await narration.someKey.start()` only when narration should overlap with the next action, and `await narration.someKey.end()` only to close that same active cue later. This is especially important before visible navigation or page changes. Use inline tags like `[pronounce: ...]` and `[short pause]` inside cue text when needed, especially for URLs and domains such as `screenci.com [pronounce: screen see eye dot com]`.
3. Run `npx screenci test --ui` to validate selectors and flow.
4. Run `npx screenci test` until it passes.
5. Run `npx screenci record` to produce `.screenci/<video-name>/recording.mp4` and `data.json`.

## Specific Tasks

- **Recording videos** [references/record.md](references/record.md)
