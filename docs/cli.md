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
| `screenci test [args...]`         | Forward directly to `playwright test` using your ScreenCI config |
| `screenci record [args...]`       | Record videos, usually in a container                            |
| `screenci retry`                  | Upload the newest local recording in `.screenci/`                |
| `screenci info`                   | Print remote project info as JSON                                |
| `screenci make-public <videoId>`  | Enable public URLs for a video                                   |
| `screenci make-private <videoId>` | Disable public URLs for a video                                  |

## `screenci init [name]`

Creates a new `screenci/` directory with a starter config, example video, Dockerfile, and optional workflow file. The optional GitHub Actions workflow is written at `.github/workflows/screenci.yaml` in the current directory. `init` does not authenticate. If `SCREENCI_SECRET` is missing, `screenci record` will open a browser window and complete the login flow before recording starts.

```bash
npx screenci@latest init
# or: npx screenci@latest init "My Product"
# or: npx screenci@latest init "My Product" --yes
cd screenci
```

The optional `[name]` is the ScreenCI project display name, not the directory name.
Because init writes ScreenCI files into `screenci/` and the optional workflow into `.github/workflows/screenci.yaml`, it works well inside existing projects without mixing generated files into your app source.

Options:

- `-v, --verbose` prints underlying command output instead of spinners
- `--install` install ScreenCI skills, npm dependencies, and Chromium without prompting
- `--ci` add GitHub Action CI without prompting
- `--skill` answer yes to the AI authoring question and include `playwright-cli`
- `-y, --yes` answer yes to all init prompts

## `screenci test [playwrightArgs...]`

Forwards directly to `playwright test` while still resolving `screenci.config.ts`.

```bash
npx screenci test
npx screenci test --grep "checkout"
npx screenci test --project=chromium
```

Use this when you want normal Playwright execution without recording.

## `screenci record [playwrightArgs...]`

Records videos with ScreenCI. On the host this pulls and uses `ghcr.io/screenci/record:latest`, then uploads results if `SCREENCI_SECRET` is set. If the secret is missing, `record` prompts for login before the recording begins.

```bash
npx screenci record
npx screenci record --project=chromium
```

Options:

- `-c, --config <path>` use a custom config path
- `--podman` force Podman
- `--docker` force Docker
- `-v, --verbose` show full container runtime output

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
