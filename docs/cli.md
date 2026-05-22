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
| `screenci record [args...]`       | Record videos with local Playwright                              |
| `screenci info`                   | Print remote project info as JSON                                |
| `screenci make-public <videoId>`  | Enable public URLs for a video                                   |
| `screenci make-private <videoId>` | Disable public URLs for a video                                  |

## `screenci init [name]`

Creates a new `screenci/` directory with a starter config, example video, and optional workflow file. The optional GitHub Actions workflow is written at `.github/workflows/screenci.yaml` in the current directory. `init` does not authenticate. If `SCREENCI_SECRET` is missing, `screenci record` will open a browser window and complete the login flow before recording starts.

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

Forwards Playwright test arguments in normal `playwright test` syntax while still resolving `screenci.config.ts`.

```bash
npx screenci test
npx screenci test --grep "checkout"
npx screenci test --project=chromium
npx screenci test tests/onboarding.video.ts --grep "step 2"
```

Use this when you want normal Playwright execution without recording.

By default, `screenci test` skips ScreenCI's recording-only pacing so it stays fast:

- cursor moves become instant instead of animated
- built-in sleeps for click, hide, and zoom timing are skipped
- no screen recording is started

That makes `test` the right command while you are iterating on selectors, app state, and assertions.

### `--mock-record`

Use `--mock-record` when you want `screenci test` to keep the same animated timing model as `screenci record` without starting the actual browser screen capture:

```bash
npx screenci test --mock-record
npx screenci test --mock-record --grep "checkout"
```

This is mainly a troubleshooting option. Reach for it when:

- `screenci test` passes, but `screenci record` fails
- a timing issue only shows up with animated cursor moves or ScreenCI's built-in pauses
- you want to debug recording-like pacing without paying the full cost of local recording

You can also pass normal Playwright test arguments through `screenci test`. That means you can run only some tests while iterating by using the same filters you would use with `playwright test`, such as a file path or `--grep`:

```bash
npx screenci test videos/onboarding.video.ts
npx screenci test --grep "checkout"
npx screenci test videos/onboarding.video.ts --grep "step 2"
```

Notes:

- Most arguments after `test` are passed through as-is to `playwright test`
- `screenci test` still injects your resolved `screenci.config.ts` automatically
- `--config` / `-c` are reserved for the `screenci` CLI itself, so use them to point to a different `screenci.config.ts`
- `--verbose` / `-v` are reserved for the `screenci` CLI itself for extra CLI logging, not forwarded to Playwright
- `--mock-record` is handled by `screenci` itself and is not forwarded to Playwright

## `screenci record [playwrightArgs...]`

Records videos with ScreenCI by running local Playwright with `SCREENCI_RECORDING=true`, then uploads results if `SCREENCI_SECRET` is set. If the secret is missing, `record` prompts for login before recording begins.

By default, if some recording tests fail, ScreenCI still uploads the successful recordings. To opt out, set `record.upload: 'all-or-nothing'` in `screenci.config.ts`.

```bash
npx screenci record
npx screenci record --project=chromium
```

Options:

- `-c, --config <path>` use a custom config path
- `-v, --verbose` show full command output during local development setup

Restrictions:

- `--retries` is rejected because ScreenCI forces retries to `0`

`--workers`, `-j`, and `--fully-parallel` pass through to Playwright unchanged.

During `screenci record`, ScreenCI now waits for deferred recording finalization at the end of the run and shows a `Finalizing recordings...` spinner before reporting `Recordings finalized`.

Troubleshooting:

- If `screenci test` works but `screenci record` fails, retry with `screenci test --mock-record` to reproduce recording-like timing without starting the real capture pipeline.

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
