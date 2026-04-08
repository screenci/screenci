---
title: CLI Commands
description: Complete reference for the screenci CLI, including recording, testing, upload, project info, and public URL commands.
---

# CLI Commands

The `screenci` CLI wraps the Playwright workflow used by ScreenCI projects and adds project-aware commands for uploads and public URLs.

Most commands look for `screenci.config.ts` in the current directory. Use `--config <path>` when your config lives elsewhere.

## Commands overview

| Command                           | What it does                                                     |
| --------------------------------- | ---------------------------------------------------------------- |
| `screenci init [name]`            | Scaffold a new ScreenCI project                                  |
| `screenci dev [args...]`          | Run Playwright in UI mode for fast iteration                     |
| `screenci test [args...]`         | Forward directly to `playwright test` using your ScreenCI config |
| `screenci record [args...]`       | Record videos, usually in a container                            |
| `screenci retry`                  | Upload the newest local recording in `.screenci/`                |
| `screenci info`                   | Print remote project info as JSON                                |
| `screenci make-public <videoId>`  | Enable public URLs for a video                                   |
| `screenci make-private <videoId>` | Disable public URLs for a video                                  |

## `screenci init [name]`

Creates a new ScreenCI project directory with a starter config, example video, Dockerfile, and workflow files.

```bash
npx screenci init
npx screenci init my-product
```

Options:

- `--local` uses the local package path when developing ScreenCI itself
- `-v, --verbose` prints underlying command output instead of spinners

## `screenci dev [playwrightArgs...]`

Runs Playwright against your ScreenCI config in local development mode. By default this starts Playwright UI mode.

```bash
npx screenci dev
npx screenci dev --project=chromium
npx screenci dev --headed
```

Notes:

- `--headed` disables Playwright UI mode and runs headed instead
- any additional args are forwarded to `playwright test`

## `screenci test [playwrightArgs...]`

Forwards directly to `playwright test` while still resolving `screenci.config.ts`.

```bash
npx screenci test
npx screenci test --grep "checkout"
npx screenci test --project=chromium
```

Use this when you want normal Playwright execution without recording and without the Playwright UI shortcut from `screenci dev`.

## `screenci record [playwrightArgs...]`

Records videos with ScreenCI. On the host this normally builds and runs the project inside a container, then uploads results if `SCREENCI_SECRET` is configured.

```bash
npx screenci record
npx screenci record --project=chromium
npx screenci record --no-container --headed
```

Options:

- `-c, --config <path>` use a custom config path
- `--no-container` run locally instead of in Podman or Docker
- `--podman` force Podman
- `--docker` force Docker
- `--tag <tag>` pull and use a specific `ghcr.io/screenci/record:<tag>` image
- `-v, --verbose` show full build output

Restrictions:

- `--workers`, `-j`, `--retries`, and `--fully-parallel` are rejected because ScreenCI records sequentially with one worker

## `screenci retry`

Uploads the newest recording from `.screenci/` to ScreenCI.

```bash
npx screenci retry
```

Requirements:

- `SCREENCI_SECRET` must be available, usually via the `envFile` configured in `screenci.config.ts`

## `screenci info`

Fetches the current remote project info for the local `projectName` and prints it as 2-space-formatted JSON.

```bash
npx screenci info
```

Example output:

```json
{
  "projectName": "my-project",
  "videos": [
    {
      "name": "Onboarding",
      "id": "video_123",
      "isPublic": true,
      "videoURL": "https://api.screenci.com/public/video_123/en/video",
      "thumbnailURL": "https://api.screenci.com/public/video_123/en/thumbnail",
      "subtitlesURL": "https://api.screenci.com/public/video_123/en/subtitle"
    },
    {
      "name": "Settings",
      "id": "video_456",
      "isPublic": false
    }
  ]
}
```

Requirements:

- `SCREENCI_SECRET` must be set
- the CLI uses your local `projectName` from `screenci.config.ts`

## `screenci make-public <videoId>`

Turns on public URLs for a video and publishes the currently selected versions.

```bash
npx screenci make-public video_123
```

Get `<videoId>` from `screenci info`.

Requirements:

- `SCREENCI_SECRET` must be set
- `<videoId>` must belong to the organisation associated with that secret

## `screenci make-private <videoId>`

Disables public URLs for a video and removes the public manifest.

```bash
npx screenci make-private video_123
```

Get `<videoId>` from `screenci info`.

Requirements:

- `SCREENCI_SECRET` must be set
- `<videoId>` must belong to the organisation associated with that secret

## Shared `--config` option

These commands support `--config <path>`:

- `dev`
- `test`
- `record`
- `retry`
- `info`
- `make-public`
- `make-private`

## Environment

### `SCREENCI_SECRET`

Used for authenticated ScreenCI API actions:

- upload recordings
- fetch project info
- make videos public
- make videos private

If your config sets `envFile`, the CLI loads it automatically before these commands run.
