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

# run only some tests with normal Playwright filters
npx screenci test videos/signup.video.ts --grep "fills billing details"

# only record after tests pass
npx screenci record
```

`npx screenci test` accepts normal `playwright test` argument syntax after `test`. ScreenCI still injects its resolved `screenci.config.ts` automatically. `--config` / `-c` and `--verbose` / `-v` are reserved for the ScreenCI CLI itself rather than being forwarded to Playwright.

## What ScreenCI Adds

ScreenCI uses Playwright-style `.video.ts` files and adds recording-specific helpers:

- `video()` declares one output video per test.
- `hide()` removes setup and loading sections from the final recording.
- `autoZoom()` follows navigation, click-driven, and broader interaction sequences with smooth camera motion. Use it sparingly, and start with its default options unless the user explicitly asks for different zoom behavior or the flow clearly needs a targeted override.
- `zoomTo()` and `resetZoom()` are better for forms and other steady editing sections where the camera should stay fixed while the user types, selects, toggles, and confirms within one area.
- `createNarration()` is mandatory for every video: define it in every `.video.ts` file and include spoken narration throughout the demo. The opening narration should first state the purpose of the video, then continue with the explanation or walkthrough. Define the map once, then call `await narration.key()` for the common case where the full line should run before moving on. Use `await narration.key.start()` when narration should overlap with the next action, and `await narration.key.end()` only to close that same active cue later, especially before visible navigation or route changes.
- Narration text can include inline speech-control tags such as `[pronounce: screen see eye]`, `[short pause]`, `[medium pause]`, and `[long pause]` when a word needs guided pronunciation or an intentional pause. When narration includes a URL or domain name, add a pronunciation guide or rewrite the line so it will be spoken clearly. Example: `screenci.com [pronounce: screen see eye dot com]`.

## Required Conventions

**Every video MUST follow these conventions:**

- **Narration on every video (required, no exceptions)** — always define `createNarration({ ... })` and add narration to every `.video.ts` file. Videos without narration are not acceptable.
- **Open with the video's purpose** — the first spoken narration should clearly state what the video is for before moving into the step-by-step explanation.
- **Guide pronunciation for URLs and domains** — if narration says a URL, domain, product name, or other term that a voice model might read incorrectly, add a `[pronounce: ...]` hint or phrase it in a clearly spoken way.
- **Start on the requested page** — the visible video should always begin on the page the user requested.
- **Hide initial setup** — the initial page load should almost always be wrapped in `hide()`. Keep authentication, navigation to the starting page, loading spinners, cookie banner dismissal, and any other non-demo boilerplate inside that hidden block so they are cut from the final recording. After the initial navigation, explicitly try to find and click any cookie consent or cookie policy accept button there if one appears.
- **Navigate visibly with clicks** — after hidden setup, move through the demo by clicking real links and buttons instead of calling `page.goto()`.
- **Prefer mouse-driven selection after typing** — when typing into search boxes, comboboxes, autocomplete fields, command menus, or similar UI, prefer clicking the visible result or CTA with the mouse instead of submitting with keyboard actions like `press('Enter')` when a clickable target is available. Example: after `await searchBox.fill('product')`, prefer `await page.getByRole('link', { name: 'Specific Product' }).click()`.
- **Prefer native Playwright APIs over `page.evaluate()`** — when Playwright or locator methods already support an interaction, use them directly instead of DOM scripting. For example, prefer `await locator.blur()` over `await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) { document.activeElement.blur() } })`.
- **Prefer manual zoom for forms and steady editing sections** — when the demo focuses on filling a form, editing settings, or working within one stable panel, prefer `zoomTo()` before the sequence and `resetZoom()` after it instead of `autoZoom()`. This keeps the framing stable while the user types, selects, toggles, and saves.
- **Use autoZoom for navigation and click-driven flows** — prefer `autoZoom()` for visible navigation, opening menus, moving across lists, stepping through dialogs, clicking through dashboards, or other flows where the camera should follow movement between targets.
- **Use autoZoom sparingly on large page areas** — do not default to `autoZoom()` for every form or page section. Keep usage sparse, and make sure each `autoZoom()` block is justified by movement between targets rather than by simple text entry alone.
- **End autoZoom before page changes** — it is better to let an `autoZoom()` block finish before a navigation/page change. Staying zoomed during navigation is confusing. Start a new `autoZoom()` block on the next page/section when needed.
- **Prefer default action options** — for `autoZoom()` and locator actions such as `click()`, `fill()`, `pressSequentially()`, `check()`, `uncheck()`, `selectOption()`, `selectText()`, and similar helpers, start with ScreenCI's default options. In particular, do not add a separate `locator.click()` before `locator.fill()` or `locator.pressSequentially()` just to focus the field: those actions already move to the field, click it, and then type by default. Do not add custom `zoom`, `click`, `position`, timing, or other locator-action overrides unless the user asks for them or the recording flow clearly needs a specific adjustment.

## Zooming Guide

Prefer stable manual zoom for edit-heavy sections:

```ts
await zoomTo(page.getByRole('form', { name: /profile settings/i }))
await page.getByLabel('Name').fill('Jane Doe')
await page.getByLabel('Email').fill('jane@example.com')
await page.getByRole('checkbox', { name: 'Email notifications' }).check()
await page.getByRole('button', { name: 'Save changes' }).click()
await resetZoom()
```

Prefer `autoZoom()` for movement between targets:

```ts
await autoZoom(async () => {
  await page.getByRole('link', { name: 'Reports' }).click()
  await page.getByRole('button', { name: 'Open filters' }).click()
  await page.getByRole('option', { name: 'Last 30 days' }).click()
  await page.getByRole('button', { name: 'Apply' }).click()
})
```

## Command Notes

- `screenci record` runs the recording flow with local Playwright.
- `screenci test --ui` runs Playwright in UI mode for fast iteration without screen capture.
- `screenci test <playwright args...>` forwards most Playwright test arguments unchanged, while still using `screenci.config.ts`.

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
