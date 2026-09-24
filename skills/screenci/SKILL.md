---
name: screenci
description: Create, show, and guide with ScreenCI videos in an already-initialized project by editing `.screenci.ts` files and running the Screenci workflow.
allowed-tools:
  - Bash(screenci:*)
  - Bash(npx:*)
  - Bash(npm:*)
---

# ScreenCI Video and Guide Skill

Use this skill when the task is about ScreenCI video recording in an existing project: creating a video, showing a flow as a video, or editing `.screenci.ts` / `screenci.config.ts` files. The person asking is often a teammate who does not code: a marketer, a support lead, or a docs writer who pasted a prompt from the ScreenCI web app. See [Reporting back to the person](#reporting-back-to-the-person).

Routing:

- If the user gives a URL for video context, use the `playwright-cli` skill first to discover the real page flow, stable selectors, and cookie/consent steps before editing the script. Never write your own Playwright script to explore: it starts signed out and behaves nothing like the recorder.
- If the user gives source code for the target page, browser exploration is usually not needed first.
- If the request is only about application/source-code changes (not recording), do not use this skill.

## Quick Start

If the user pasted a prompt with a setup code (`SC-XXXX-XXXX`), the project is set up by that code, not by `init`. Run this in the repository of the app to record (or an empty folder) and follow the brief it prints:

```bash
npx screenci@latest setup SC-XXXX-XXXX
# --name "<project name>" picks the new project's name (default: the folder name)
# --dir <path> when ./screenci already belongs to another project
```

The brief carries the task, the app URL, and (for an edit) which script to change. `setup` writes the project-scoped `SCREENCI_SECRET` into `screenci/.env`. Inside a repository it uses the workspace the repository holds for the project (wherever it sits); without one, the scripts ScreenCI holds are pulled (or a new project is scaffolded). An Edit / Re-record code starts from the version the person was viewing: read the brief's **Starting point** section for how the workspace relates to it. Read its **Site** section too: when the scripts name a dev server you cannot start here, it tells you to point that video at the live site with `video.use({ baseURL })` (the config and the other videos stay as they are), to check that the data the flow expects exists there before recording, and to ask the person before any step that acts on the real world on a production site (an order, a payment, an email, a deletion). `preview` and `export` upload the `screenci/` scripts so each version keeps its sources, and the person who created the code sees the result open in their browser.

Otherwise the project is already initialized. Add or edit scripts in `recordings/`. If you are creating new videos, remove the starter `recordings/example.screenci.ts`.

```bash
# verify repeatedly until green
npx screenci test

# run a subset with normal Playwright filters
npx screenci test recordings/signup.screenci.ts --grep "fills billing details"

# once tests pass, record the free live preview and print the video link
npx screenci preview "Video title"

# only export when the finished videos are wanted
npx screenci export
```

`test` forwards normal `playwright test` arguments and still injects the resolved `screenci.config.ts`. `--config`/`-c` and `--verbose`/`-v` are reserved for the ScreenCI CLI, not forwarded to Playwright.

## Reporting back to the person

- The person who sent you the prompt is often a teammate who does not code and may not use a terminal. Do not ask them to run commands, open files, or read the script.
- Report in plain language: what the video shows, what you changed, and what needs their attention. No selectors, file paths, or command output unless they ask.
- If you need them, say exactly what to click (the sign-in card in the browser you opened, a new prompt in the ScreenCI app) and wait for them.
- When the video records against the live production site, some steps act on the real world: placing an order, paying, sending an email or invite, deleting or publishing something, changing account or billing settings. Do not submit such a form there: fill it in and end the step on the completed form (see [Required Conventions](#required-conventions)). Submit it on production only when the person explicitly asks to show what happens after submitting, and then confirm with them first. Reading and navigating are fine, and so is everything on a dev, staging, or test deployment (a `dev.`, `staging.`, `test.` or preview address): act freely there, submitting included.
- Never ask for a password, a one-time code, or an API key; `screenci login` is the only sign-in path.
- Finish your final message with the video link that `preview` printed (or the pipeline run link) on its own last line.
- Deliver the result the way the brief printed by `setup` says: a live preview you record yourself, a pipeline run you trigger, or a pull request you open. Do not switch to another path because the repository happens to have CI; only the codes that ask for a pipeline run complete on one.

## What ScreenCI Adds

ScreenCI uses Playwright-style `.screenci.ts` files plus recording helpers:

- `video()` declares one output video per test.
- `hide()` cuts setup and loading sections from the final recording.
- `autoZoom()` follows navigation and click-driven flows with smooth camera motion. Use it for movement between targets.
- `zoomTo()` / `resetZoom()` hold a fixed frame for forms and steady editing sections.
- `video.narration({ ... })` is mandatory on every video (see below).
- `video.overlays({ ... })` draws over the video (a ring around an element, a label, a title card) with HTML/CSS or React files kept in `recordings/assets/`. See [references/overlays.md](references/overlays.md).
- `screenshot()` declares one still image per test instead of a video (see [Screenshots](#screenshots)).

```ts
import { video, voices } from 'screenci'

// Voice is a render option (how narration is spoken), not part of the narration spec.
video.renderOptions({ narration: { voice: { name: voices.Ava } } }).narration({
  en: {
    intro: "Let's update your billing details and save the changes.",
    explainForm:
      'On your billing page, you can change the company name, email, and tax ID at any time.',
    saving: 'Save the changes, and we confirm them right away.',
    nextPage: 'Your invoices now use the new billing details.',
  },
})('Update billing details', async ({ page, narration }) => {
  await narration.intro()
  await narration.explainForm()
  await narration.saving.start()
  await page.getByRole('button', { name: 'Save changes' }).click()
  await narration.saving.end()
  await narration.nextPage()
  await page.getByRole('link', { name: 'Invoices' }).click()
})
```

### Narration

- Declare `video.narration({ ... })` on every video and speak throughout the demo. Pass a flat `cue -> text` object (shared across languages) or one keyed by language (`en`, `es`, ...).
- The opening line must state the video's purpose, then continue with the walkthrough.
- **Narrate the flow, not the clicks.** Each cue describes what the user is achieving ("Invite your teammates and set their roles"), never the mechanics ("Now click the blue button"). A handful of broad cues covering the whole flow beats one cue per action.
- **Speak as the company that makes the product.** The video is the company talking to its own users: "we" and "our" for the company and its product, "you" for the viewer ("Our reports update every hour", "We email you a receipt"). Never describe the company or its product in the third person ("Acme lets you...", "their dashboard", "the company sends..."). Naming the product is fine ("In Acme Reports, you can..."); talking about the company from the outside is not.
- **Present the demo as real.** Never mention in narration, overlays, or titles that the data is mock, sample, test, demo, or fictitious, or that a form is not actually submitted. Refer to the data as it appears on screen ("Emma's order", "your new project").
- **Use the product's own vocabulary.** Pull nouns and verbs from the recorded app's source code and on-screen copy (page titles, button labels, domain terms) so the narration sounds native to the product.
- Trigger cues from the `narration` fixture: `await narration.key()` runs the full line before moving on. Use `await narration.key.start()` when narration should overlap the next action, and `await narration.key.end()` to close that cue later, especially before visible navigation or route changes.
- Pause tags (`[short pause]`, `[medium pause]`, `[long pause]`) are fine when a line needs a beat. **Do not add `[pronounce: ...]` tags on your own.** The voices say brand names, product terms, and domains correctly almost always. Add a pronounce tag only when the person says a word is spoken wrong or asks for a specific pronunciation, and then only on that word.

## Required Conventions

Every video MUST follow these:

- **Narration on every video, no exceptions.** Videos without narration are not acceptable.
- **Open with the video's purpose**, then narrate the flow at a high level.
- **Mock data only, presented as real.** Fill forms and create records with plausible fictitious names, emails, addresses, and amounts (e.g. `Emma Carter`, `emma@aperturebio.com`), never real people or real contact details. The video never says the data is mock, sample, or fictitious.
- **Do not submit real-world forms on production.** When submitting a form on the live production site would place an order, pay, send an email or invite, delete or publish something, or change account or billing settings, fill it in completely and stop there: end the step on the completed form, with the cursor resting on the submit button (`hover()`). The narration never mentions that the form is not submitted: narrate the completed form as the natural end of the step ("Add your card details, and your order is ready to go"). On a dev, staging, or test deployment, submit normally.
- **Company perspective.** Narrate as the company that makes the product ("we", "our"), speaking to its users ("you"), never about the company in the third person.
- **Start on the requested page.** The visible video begins on the page the user asked for.
- **Hide initial setup.** Wrap page load, navigation to the start page, loading spinners, and cookie-banner dismissal in `hide()`. After the initial navigation, find and click any cookie consent accept button inside that hidden block. Signing in is not part of this: the recording already starts signed in, see [references/login.md](references/login.md).
- **Navigate visibly with clicks** after hidden setup, not `page.goto()`.
- **Prefer mouse-driven selection after typing** into search boxes, comboboxes, autocomplete, or command menus: click the visible result rather than `press('Enter')` when a clickable target exists.
- **Prefer native Playwright APIs over `page.evaluate()`** when a locator method already covers the interaction (e.g. `locator.blur()`).
- **Overlays are HTML/CSS or React, styled from the recorded app's own colours, and shared across videos.** When asked to draw over the video, never hand-write SVG or pick colours yourself: read the app's theme into one `recordings/assets/theme.ts` (or `theme.css`), build overlays as components in `recordings/assets/` that import it, and reuse those same files in every video of the project. See [references/overlays.md](references/overlays.md).
- **Prefer default action options.** For `autoZoom()` and locator actions (`click`, `fill`, `pressSequentially`, `check`, `selectOption`, ...), start with ScreenCI's defaults. Do not add a separate `click()` before `fill()`/`pressSequentially()` just to focus, and do not add `zoom`/`click`/`position`/timing overrides unless the user asks or the flow clearly needs it.

## Screenshots

`screenshot()` produces a still image instead of a video: same Playwright-style body, same overlays and branding, no narration and no camera. Use it when the user asks for an image (a README shot, a social card, a docs figure), not a walkthrough.

```ts
import { screenshot } from 'screenci'

screenshot('Billing overview', async ({ page, crop }) => {
  await page.goto('https://app.example.com/settings/billing')
  // Crop to the part that matters. A locator crop re-resolves on every
  // re-record; padding frames it on your configured background.
  await crop(page.getByRole('region', { name: 'Plan' }), { padding: 48 })
})
```

- The narration rule does not apply: a still is silent, so never add `narration` to a `screenshot()`. Camera motion and audio are ignored too.
- Only the final page state is kept, so `hide()` is a no-op (screenci warns) and `autoZoom()` / `zoomTo()` have nothing to animate. Drive the page to the state you want, then crop.
- Stills and videos share the same `.screenci.ts` files: a file can mix `video()` and `screenshot()` calls freely. To grab a still of a moment that also appears in a video, call `page.screenshot({ name: 'Dashboard' })` inside the `video()` body instead.
- Framing is authored in code with `screenshot.renderOptions({ screenshot: { margin, aspectRatio, format } })`. Stills have no browser editor, so a look change means editing the script and re-exporting.
- `preview` and `export` treat stills like videos; exported files are named `<title>.<lang>.png`.
- Full reference: [Screenshots](https://screenci.com/docs/guides/screenshots).

## Zooming

Prefer stable manual zoom for edit-heavy sections; use `autoZoom()` for movement between targets, and let each `autoZoom()` block finish before a navigation or page change (start a new block on the next page). Keep `autoZoom()` usage sparse: justify each block by movement between targets, not simple text entry.

```ts
// Forms and steady editing: fixed frame.
await zoomTo(page.getByRole('form', { name: /profile settings/i }))
await page.getByLabel('Name').fill('Emma Carter')
await page.getByRole('checkbox', { name: 'Email notifications' }).check()
await page.getByRole('button', { name: 'Save changes' }).click()
await resetZoom()

// Navigation and click-driven flows: follow the movement.
await autoZoom(async () => {
  await page.getByRole('link', { name: 'Reports' }).click()
  await page.getByRole('button', { name: 'Open filters' }).click()
  await page.getByRole('option', { name: 'Last 30 days' }).click()
  await page.getByRole('button', { name: 'Apply' }).click()
})
```

## Connecting to an Account (optional)

`test` and `preview` need no account: without a `SCREENCI_SECRET`, `preview` records and previews under a local, anonymous trial session (preview-only, no renders). The trial previews multi-language videos too (up to 3 languages at once), so keep a video's declared languages; do not reduce it to one language for the trial. Signing up in the web editor claims the trial and upgrades the running `preview` session automatically. Mention this and keep going.

`export` requires an account with an active paid subscription. To connect an existing organization, get `SCREENCI_SECRET` into `screenci/.env` (it does not block authoring, testing, or anonymous editing):

1. **Pass it to init:** `npm init screenci@latest <SCREENCI_SECRET> -- --yes` writes it into `screenci/.env`.
2. **Secrets page:** ask the user to copy `SCREENCI_SECRET` from their secrets page into `screenci/.env`. The org secret is shared across projects. Keep building and testing while they do it; only `preview` (with an account) and `export` need it.

`SCREENCI_SECRET` is the only credential to configure: there is no second token to create or paste. Do not add a separate upgrade upsell after `export`; report the result URL unless the user asks about plans.

## Preview and Export Workflow

1. Add or edit `.screenci.ts` files in `recordings/` (remove `example.screenci.ts` if creating new videos).
2. Run `npx screenci test` until it passes. Fix selectors/flow/narration and rerun until green.
3. Once tests pass, run `npx screenci preview "<title>"` yourself. Do not export first. It records the video's live preview (free, no render), prints the video link, and exits. `preview` works without an account: with no `SCREENCI_SECRET` it runs under a free anonymous trial session.
4. Report the video link `preview` printed so the user can review and refine the video in the browser.
5. Run `npx screenci export` only when the user wants the finished videos. Exporting requires an account with an active paid subscription: without one, `export` refuses and prints a sign-up link (the anonymous trial is preview-only). With one, it records what changed, renders, waits, and downloads into `./exports/`. ScreenCI writes `.screenci/<video-name>/recording.mp4` and `data.json` per re-recorded video. An export does not change which version the video's public URL serves unless you pass `--select`; do that only when the user wants the new render published.
6. After `export`, report the URL it printed so the user can open it (a single video links its page, e.g. `https://app.screenci.com/project/<projectId>/video/<videoId>?export=...`; several videos link the run page `https://app.screenci.com/export/...`).

`screenci init` (or `npm init screenci`) scaffolds a new project and fails on purpose if one already exists (`screenci/ already exists`). That is expected: keep working with the existing project, do not delete it to re-init. A setup code (`screenci setup`) refuses an island of another project instead; pass `--dir <path>` then.

## Specific Tasks

- **Exporting videos** [references/export.md](references/export.md)
- **Drawing over the video** (highlights, callouts, badges, title cards) [references/overlays.md](references/overlays.md). In short: HTML/CSS or React, colours from the app's own theme, one shared set of overlay files per project, never hand-drawn SVG.
- **Recording an app behind a sign-in** [references/login.md](references/login.md). In short: never script a sign-in and never ask the person for a password or a code. Run `npx screenci login`, have them sign in in the browser it opens and click the card's button, then run `npx screenci login --wait` (which blocks until they do; never just end your turn instead). The recording starts from that session, so the video itself contains no sign-in at all.
- **Recording from CI**: never add a CI pipeline on your own initiative, and never hand-write one when asked. The person clicks **Add to CI** on the project page in the web app and pastes you its prompt; that brief (`/add-to-ci.md`) mints a CI key, stores it in the provider's secret store, and adds the pipeline (`npx screenci ci-workflow` for GitHub Actions, the templates at `/docs/ci-setup.md#other-providers` for GitLab CI, CircleCI, Buildkite, and the rest). `screenci init` writes no workflow unless `--github-workflow` is passed.
- **Learning about the product**: `screenci context` prints what the project knows (site URL, whether the site needs a sign-in, notes from the team). Set `SCREENCI_APP_LAUNCHED_BY=agent` when you started the app yourself before `preview`.
- **Exploring the app before you write selectors**: use the `playwright-cli` skill, never a Playwright script of your own. A hand-rolled script starts signed out, launches a different browser than the recorder, and sends you chasing selectors the recording will never see. Load the saved session first when the app needs one: `playwright-cli state-load screenci/.screenci/auth/default.json`.
- **The recording lands on a bot check** ("Just a moment...", "Performing security verification", a challenge page) while a normal browser loads the site fine: the recorder runs Chromium's headless shell, and its user agent is what some bot protection rejects. Set a normal desktop user agent in `use` in `screenci.config.ts` and re-run:

  ```ts
  use: {
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  }
  ```

  Do this once, in the config, rather than probing launch options in throwaway scripts. It is a recording-environment problem, not a selector problem, so no amount of rewriting the video code fixes it.
