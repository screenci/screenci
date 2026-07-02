# `screenci record`

Use `screenci record` to capture ScreenCI videos from `.screenci.ts` scripts.

Assume the ScreenCI project is already initialized. Add new video scripts under `recordings/`.
If you are creating new videos, remove the starter `recordings/example.screenci.ts` file.

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

## Connect Before Recording

`record` needs `SCREENCI_SECRET`, and there is no browser sign-in. Get it in place before the final recording (it does not block authoring or testing):

- If the user has a one-time setup token (`scotp_...`), run `npm init screenci@latest <token> -- --yes`; init writes `SCREENCI_SECRET` into `screenci/.env`.
- Otherwise ask the user to copy `SCREENCI_SECRET` from their secrets page into `screenci/.env`.

## Runtime Behavior

- Recording runs with local Playwright.
- `SCREENCI_SECRET` is required (from `screenci/.env` or the environment). If it is missing, `screenci record` prints guidance (pointing at the secrets page) and exits **non-zero** without recording. Get the secret in place and rerun. This is a setup step, not a code problem.
- New accounts start on the free tier; free renders include a ScreenCI watermark, and after upload `record` prints an upgrade link that removes it.
- Playwright arguments can be passed through after the command.
- When API configuration and `SCREENCI_SECRET` are available, uploads run after recording.

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
