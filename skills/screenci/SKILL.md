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

- If the user provides a URL for video context, always use the `playwright-cli` skill first. It drives a real browser from the CLI (navigate, snapshot, click, type) so you can discover the actual page flow, stable selectors, and cookie/consent steps before editing the ScreenCI script.
- If the user provides source code for the target page/component, that usually means browser exploration is not required first.
- If the request is only about application/source-code changes (not recording or `.video.ts` updates), do not use this skill.

## Quick Start

Assume the project is already initialized. Add or edit video scripts in `videos/`.

If you are creating new videos, remove the starter `videos/example.video.ts` file.

```bash
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

Example:

```ts
const narration = createNarration({
  intro:
    'This video shows how to update your billing details and save the changes.',
  explainForm:
    'We start on the billing page and update the company name, email, and tax ID.',
  saving: 'Now we save the changes and wait for the confirmation message.',
  nextPage:
    'Next, we open the invoices section to confirm the new billing details are in use.',
})

await narration.intro()
await narration.explainForm()
await narration.saving.start()
await page.getByRole('button', { name: 'Save changes' }).click()
await narration.saving.end()
await narration.nextPage()
await page.getByRole('link', { name: 'Invoices' }).click()
```

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

- `screenci init` (or `npm init screenci`) scaffolds a new project. It can be run at any time, but if the project is already initialized it fails on purpose: it exits with an error like `screenci/ already exists`. That is expected, not a problem to fix. Do not delete the existing project to force a re-init. Continue working with the project that is already there. On a fresh init it also prints a sign-in link (valid for 24 hours) so the user can sign in early, before any recording.
- `screenci record` runs the recording flow with local Playwright.
- `screenci test <playwright args...>` forwards most Playwright test arguments unchanged, while still using `screenci.config.ts`.

### Sign in early (do this first)

Signing in does not block writing or testing the video, only the final recording. So get it started up front, in parallel with your work:

1. Find the sign-in link. A fresh `screenci init` prints one (valid for 24 hours). If you did not just init (the project already exists), run `npx screenci record` once to print the link, or `cat screenci/.screenci/link-session.json` if a session is already cached.
2. Surface that link to the user verbatim and ask them to open it, sign in, and choose a plan while you build and test the video. Tell them it just needs to be done before the final recording.
3. Build and test the video as normal (`npx screenci test`) while they sign in.
4. For the final recording, run `npx screenci record --poll-auth`: if they already signed in it records immediately; otherwise it polls and records automatically once they finish. There is no harm in attempting it before they are done: if it has not happened yet, it just reprints the link (and times out cleanly after a few minutes). Re-prompt the user to sign in and run it again.

### Signing in, and why a clean exit may not mean a recording happened

`screenci record` needs a `SCREENCI_SECRET`. If one is not set, it does not record yet. Instead it bootstraps sign-in:

- When the session is **interactive** (a terminal), `screenci record` prints a one-time auth link, waits for browser sign-in, saves the secret into the configured `envFile` or project `.env`, and then continues recording automatically.
- When the session is **non-interactive** (no terminal, for example run from an automated agent, a pipe, or CI; or `SCREENCI_NONINTERACTIVE=1`), `screenci record` does **not** wait. It prints the sign-in link and exits cleanly with exit code 0 **without recording**. A clean exit here is a handoff, not a finished recording. Whenever the output contains a sign-in link, treat the run as "needs sign-in," not "done," even though the exit code is 0.

How to handle the non-interactive case (this is the common case for agents):

1. Surface the printed sign-in link to the user verbatim and ask them to open it, sign in, and choose a plan.
2. After the user confirms they have signed in, rerun `npx screenci record`. It detects the completed session, saves the secret, and continues recording. The same link can be retried as many times as needed until it completes or expires.
3. Alternatively, run `npx screenci record --poll-auth` to print the link once and keep polling (every 5 seconds, for up to 5 minutes by default) until sign-in completes, then continue recording automatically in the same run. Use this when you can leave the command running while the user signs in. If the timeout elapses before sign-in, it exits cleanly with the link still valid, so rerun it (or plain `record`) to continue.

- To skip sign-in entirely, set `SCREENCI_SECRET` ahead of time (env var or project `.env`).
- Pending auth state is cached in `.screenci/link-session.json`, so rerunning `record` reuses the same link until it expires or completes.

## Recording Workflow

1. Start from the existing initialized ScreenCI package. Early on, surface the sign-in link to the user (printed by `screenci init`, or by running `npx screenci record` once, or from `screenci/.screenci/link-session.json`) and ask them to sign in while you build the video. The link is valid for 24 hours and only needs to be used before the final recording.
2. Add or edit `.video.ts` files in `videos/`.
   Remove `videos/example.video.ts` if you are creating new videos and do not need the starter video.
   For narration, define `const narration = createNarration({ ... })` near the top of the file and trigger lines with `await narration.someKey()` when the full line should finish before moving on. Use `await narration.someKey.start()` only when narration should overlap with the next action, and `await narration.someKey.end()` only to close that same active cue later. This is especially important before visible navigation or page changes. Use inline tags like `[pronounce: ...]` and `[short pause]` inside cue text when needed, especially for URLs and domains such as `screenci.com [pronounce: screen see eye dot com]`.
   Example:

   ```ts
   const narration = createNarration({
     intro: 'This video shows how to export a monthly sales report.',
     filters:
       'First, we set the report range and select the sales channel filters.',
     export: 'Then we export the report and wait for the download to start.',
   })

   await narration.intro()
   await narration.filters()
   await narration.export.start()
   await page.getByRole('button', { name: 'Export CSV' }).click()
   await narration.export.end()
   ```

3. Run `npx screenci test` until it passes.
4. For the final recording, run `npx screenci record --poll-auth`. If the user already signed in (via the link from step 1) it records immediately; otherwise it polls and continues automatically once they finish, then times out cleanly after a few minutes with the link still valid. A clean exit that printed a sign-in link (exit code 0) does not mean a recording was made: if that happens, re-prompt the user to sign in and run the command again. The link can be retried until it completes.
5. ScreenCI writes `.screenci/<video-name>/recording.mp4` and `data.json` for each recorded video.

## Specific Tasks

- **Recording videos** [references/record.md](references/record.md)
