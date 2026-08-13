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

## Connecting to an Account (optional)

`export` needs no account or setup step: without a `SCREENCI_SECRET`, it records and renders under a local, anonymous trial session (with the trial watermark) and prints a link to view the result. Downloads require an account, so a trial run prints the export page URL and a sign-up hint instead of writing files.

To upload straight to an existing organization instead, get `SCREENCI_SECRET` into `screenci/.env` before the final export (it does not block authoring or testing):

- Pass it to `init` as an argument: `npm init screenci@latest <SCREENCI_SECRET> -- --yes`.
- Or ask the user to copy `SCREENCI_SECRET` from their secrets page into `screenci/.env`. The org secret is shared across projects.

## Runtime Behavior

- Recording runs with local Playwright.
- `export` uploads every successful recording, with or without `SCREENCI_SECRET` set.
- Without an account, or on the free tier, renders include a ScreenCI watermark.
- After a successful `export`, report the URL it printed (starts with the app's domain, e.g. `https://app.screenci.com/export/...`) back to the user so they can open it. Without a `SCREENCI_SECRET`, this is also how they view and claim the anonymous trial recording.

## Recommended Workflow

```bash
# first verify the flow
npx screenci test

# once green, preview and refine in the web editor
npx screenci edit "Video title"

# export when the finished videos are wanted
npx screenci export
```

## Workflow

Always run `npx screenci test` until it passes first. Fix failures and rerun until green.

Once tests pass, prefer `npx screenci edit "<title>"` over exporting right away: it records the live preview if stale (free, no render), prints the web editor link, and stays connected so browser edits are written back into the script. Report the link so the user can review the video. `edit` needs `SCREENCI_SECRET` and a personal `SCREENCI_EDIT_TOKEN` in `screenci/.env`; without them (for example on the anonymous trial), go straight to `export`.

Run `npx screenci export` when the user wants the finished videos: it records what changed, renders, and downloads them.

```bash
npx screenci test          # verify selectors, flow, and narration
npx screenci edit "Title"  # record the live preview and open the web editor
npx screenci export        # record, render, and download the finished videos
```
