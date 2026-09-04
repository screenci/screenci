# `screenci export`

Use `screenci export` to produce finished ScreenCI videos from `.screenci.ts` scripts.

Assume the ScreenCI project is already initialized. Add new video scripts under `recordings/`.
If you are creating new videos, remove the starter `recordings/example.screenci.ts` file.

## Commands

```bash
npx screenci export
npx screenci export "Video title"
npx screenci export -c screenci.config.ts
```

## What It Does

- Re-records only the videos whose sources changed since the last upload (local Playwright), saving output under `.screenci/<video-name>/` (`recording.mp4` and `data.json`)
- Dispatches server-side renders for up-to-date videos without re-recording them
- Waits for the renders to finish (polls every 5 seconds, up to 30 minutes)
- Downloads the outputs into `./exports/` (or `-o <dir>`), named `<title>.<lang>.mp4` (screenshots `.png`)
- Exits `0` only when every requested video rendered and downloaded

Positional arguments are title patterns; no patterns exports every video in every language. Other flags: `-g/--grep`, `--languages fi,en`, `--force` (re-record everything), `--remote` (dispatch the project's GitHub Actions workflow instead of running locally).

## Connecting to an Account (required for export)

`export` requires an account with an active paid subscription. Without a `SCREENCI_SECRET`, it refuses up front and prints a sign-up link; the anonymous trial is preview-only (use `screenci preview` for the free live preview). Signing up claims the trial and links the project automatically on the next run.

To connect an existing organization, get `SCREENCI_SECRET` into `screenci/.env` (it does not block authoring, testing, or anonymous editing):

- Pass it to `init` as an argument: `npm init screenci@latest <SCREENCI_SECRET> -- --yes`.
- Or ask the user to copy `SCREENCI_SECRET` from their secrets page into `screenci/.env`. The org secret is shared across projects.

## Runtime Behavior

- Recording runs with local Playwright.
- `export` needs an active paid subscription; renders and downloads land in `./exports/`.
- After a successful `export`, report the URL it printed back to the user so they can open it (a single video links its page, e.g. `https://app.screenci.com/project/<projectId>/video/<videoId>?export=...`; several videos link the run page `https://app.screenci.com/export/...`).

## Recommended Workflow

```bash
# first verify the flow
npx screenci test

# once green, preview and refine in the web editor
npx screenci preview "Video title"

# export when the finished videos are wanted
npx screenci export
```

## Workflow

Always run `npx screenci test` until it passes first. Fix failures and rerun until green.

Once tests pass, prefer `npx screenci preview "<title>"` over exporting right away: it records the live preview (free, no render), prints the video link, and exits. Report the link so the user can review the video. `preview` works with or without an account (without one it runs under the free anonymous trial).

Run `npx screenci export` when the user wants the finished videos: it records what changed, renders, and downloads them. Exporting requires an account with an active paid subscription.

```bash
npx screenci test          # verify selectors, flow, and narration
npx screenci preview "Title"  # record the live preview and open the web editor
npx screenci export        # record, render, and download the finished videos
```
