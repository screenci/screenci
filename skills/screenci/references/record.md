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

## Sign In Early

Sign-in only blocks the final recording, not authoring or testing. Get it going up front: surface the sign-in link to the user early (printed by `screenci init`, or by running `npx screenci record` once, or read from `screenci/.screenci/link-session.json`) and ask them to sign in while you build the video. The link is valid for 24 hours. For the final recording, prefer `npx screenci record --poll-auth` so it records as soon as sign-in completes. Attempting it before they finish does no harm: it reprints the link and times out cleanly, so re-prompt and run again.

## Runtime Behavior

- Recording runs with local Playwright.
- When `SCREENCI_SECRET` is missing in an interactive terminal, `screenci record` prints a one-time auth link, waits for browser sign-in, saves the secret, and then continues.
- When `SCREENCI_SECRET` is missing in a non-interactive session (no terminal, or `SCREENCI_NONINTERACTIVE=1`), `screenci record` does not wait: it prints the sign-in link and exits cleanly with exit code 0 without recording. A clean exit here is a handoff, not a finished recording, so do not treat exit code 0 as "recording done" when the output contains a sign-in link. Surface that link to whoever can sign in and choose a plan; rerunning `record` afterwards detects the completed session and continues. The link can be retried until it completes or expires. Set `SCREENCI_SECRET` ahead of time to skip sign-in entirely.
- Use `npx screenci record --poll-auth` to print the link once and keep polling (every 5 seconds, for up to 5 minutes by default) until sign-in completes, then continue recording automatically in the same run, instead of exiting and waiting for a manual rerun. If the timeout elapses first, it exits cleanly with the link still valid so it can be rerun. Override the timeout with `SCREENCI_POLL_AUTH_TIMEOUT_MS` (milliseconds).
- Pending auth state is cached in `.screenci/link-session.json`, so rerunning `record` reuses the same link until it expires or completes.
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
