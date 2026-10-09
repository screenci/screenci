---
name: screenci
description: Create, show, and guide with ScreenCI videos in an already-initialized project by editing `.screenci.ts` files and running the Screenci workflow.
allowed-tools:
  - Bash(screenci:*)
  - Bash(npx:*)
  - Bash(npm:*)
---

# ScreenCI Video Skill

For recording videos or stills in a ScreenCI project (`.screenci.ts`, `screenci.config.ts`). Not for app source changes alone. Load a reference only when the task needs it.

Routing:

- Given a URL, explore it first: `npx screenci explore <url> --click "<name>"`, or the `playwright-cli` skill for longer flows, never a Playwright script of your own. Signed-in app: `playwright-cli state-load screenci/.screenci/auth/default.json`.
- Given the page source, exploring is usually not needed.
- **The recorder and the exploration browser differ.** If a step works in `playwright-cli` but fails or hits a bot check in `npx screenci test`, or the bundled Chromium cannot start (missing system libraries, e.g. NixOS), the browser is the cause, not the selector: set `use: { channel: 'chrome' }` in `screenci.config.ts` and re-run.

## Quick Start

- Setup code (`SC-XXXX-XXXX`): run `npx screenci@latest setup SC-XXXX-XXXX` (add `--name "<project name>"` for a new project, `--dir <path>` if `./screenci` belongs to another) and follow the brief it prints. A later Edit prompt for a project you already set up may say to skip setup: then edit the workspace directly.
- Otherwise the project exists: edit `recordings/*.screenci.ts`, remove the starter `example.screenci.ts`. `init` failing with `screenci/ already exists` is expected; never delete it to re-init.
- `npx screenci context` prints what the project knows (site, sign-in, team notes).

## Conventions (every video)

- **Narration on every video**, opening with the video's purpose; narrate the flow, not the clicks. Details: [references/narration.md](references/narration.md).
- **Company voice**: we/our/you, as the company that makes the product.
- **Mock data only, presented as real.** Plausible fictitious names and emails; the video never says the data is mock, sample, or fictitious.
- **Do not submit real-world forms on production** (orders, payments, emails, invites, deletes, publishing, account or billing changes): fill it in, end on the completed form with `hover()` on the submit button. The narration never mentions that the form is not submitted. On a dev, staging, or test deployment, submit normally.
- **Start on the page from the prompt.** When the copied prompt names a page or URL, the video opens there (`page.goto` that URL), not on the site's home page; otherwise start on the requested page. Wrap load, navigation, spinners and cookie banners in `hide()`; after the initial navigation, find and click any cookie consent accept button inside that hidden block. No sign-in steps: see login below.
- **Navigate visibly with clicks** after setup, not `page.goto()`; click visible results after typing rather than `press('Enter')`.
- **Default action options.** No extra `click()` before `fill()`, no `zoom`/`position`/timing overrides unless asked or clearly needed.
- **Overlays from the built-in kit** (`{ kit: 'callout', anchor, text }`, `ring`, `step`, `spotlight`, `badge`, `keys`, `title`). Custom HTML/React only when the kit cannot draw it: never hand-write SVG or pick colours yourself; use `recordings/shared/theme.ts`.

## Common edits

| Task                                       | Read                                                                                         |
| ------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Narration text, cues, voice, pronunciation | [references/narration.md](references/narration.md)                                           |
| Zoom, camera, cursor speed, `speed()`      | [references/zoom-and-timing.md](references/zoom-and-timing.md)                               |
| Highlights, callouts, steps, title cards   | [references/overlays.md](references/overlays.md)                                             |
| Still images (`screenshot()`)              | [references/screenshots.md](references/screenshots.md)                                       |
| App behind a sign-in                       | [references/login.md](references/login.md)                                                   |
| Account, trial, `SCREENCI_SECRET`, export  | [references/account.md](references/account.md), [references/export.md](references/export.md) |

Sign-in in short: never script one and never ask the person for a password or a code; run `npx screenci login`, then `npx screenci login --wait`.

## Commands

- `npx screenci test recordings/<file>.screenci.ts [--grep "<title>"]` to debug; pauses take no time.
- `npx screenci preview "<title>"` records and uploads the free live preview: the single verify step once the flow works. Report its link; do not open the video.
- `npx screenci export` only when the person asks for finished files.
- CI: never add a pipeline yourself; the person uses **Add to CI** in the web app.

## Reporting back to the person

- They are often a teammate who does not code. Do not ask them to run commands or read the script. Report in plain language: what the video shows, what changed, what needs them.
- When the video records against the live production site, steps that act on the real world (order, pay, send, delete, publish, account or billing changes) stay unsent. Do not submit such a form there unless they explicitly ask, and confirm first. Reading, navigating, and anything on a dev, staging, or test deployment are fine.
- Never ask for a password, a one-time code, or an API key.
- Deliver the way the setup brief says (live preview, pipeline run, or pull request); only the codes that ask for a pipeline run complete on one.
- End with the video link `preview` printed (or the pipeline run link) on its own last line.
