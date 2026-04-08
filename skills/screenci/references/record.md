# `screenci record`

Use `screenci record` to capture ScreenCI videos from `.video.ts` scripts.

## Commands

```bash
npx screenci record
npx screenci record --no-container
npx screenci record -c screenci.config.ts
```

## What It Does

- Runs ScreenCI video tests
- Starts the recording pipeline
- Saves output under `.screenci/<video-name>/`
- Produces at least `recording.mp4` and `data.json`

## Runtime Behavior

- By default, recording runs in Podman or Docker.
- `--no-container` runs directly on the host.
- Playwright arguments can be passed through after the command.
- When API configuration and `SCREENCI_SECRET` are available, uploads may run after recording.

## Recommended Workflow

```bash
# first verify the flow
npx screenci dev

# then record
npx screenci record
```

## Constraints

- ScreenCI enforces single-worker recording behavior.
- Use `hide()` for login and loading sections.
- Use one `autoZoom()` block per form or page section rather than per click.
