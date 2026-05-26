# CLI

The `screenci` CLI keeps the workflow small: initialize a project, iterate
locally, record final output, and manage public delivery when needed. Most
commands resolve `screenci.config.ts` from the current directory unless you
pass `--config <path>`.

## Command overview

| Command                            | Purpose                                               |
| ---------------------------------- | ----------------------------------------------------- |
| `screenci init [name]`             | Scaffold a ScreenCI project                           |
| `screenci test [playwrightArgs]`   | Run `.video.ts` files locally without final recording |
| `screenci record [playwrightArgs]` | Record videos and upload results when configured      |
| `screenci info`                    | Print remote project info as JSON                     |
| `screenci make-public <videoId>`   | Enable public delivery for a video                    |
| `screenci make-private <videoId>`  | Disable public delivery for a video                   |

## `screenci init [name]`

Create a new ScreenCI project in the current directory:

```bash
npx screenci@latest init
npx screenci@latest init "My Product"
```

Common options:

- `-y, --yes` accepts all defaults
- `--agent <name>` passes an agent name to the selected skills install command
- `-v, --verbose` prints underlying command output

Interactive defaults create the GitHub Actions workflow, install npm
dependencies, install Chromium, skip OS dependency installation, install the
ScreenCI skill, and install optional `playwright-cli` support.

Use this command in [Installation](/docs).

## `screenci test [playwrightArgs...]`

<!-- screenci-doc-video:docs/reference/cli -->

Run videos locally without the final recording pipeline:

```bash
npx screenci test
npx screenci test videos/onboarding.video.ts
npx screenci test --grep "billing"
npx screenci test --ui
```

Use this during normal authoring. Most trailing arguments are forwarded to
Playwright.

Common Playwright examples that also work here:

```bash
npx screenci test --project=chromium
npx screenci test --grep "onboarding"
npx screenci test --ui
```

### `--mock-record`

```bash
npx screenci test --mock-record
```

This keeps recording-like pacing enabled without starting the real recording
capture path. Use it when `test` passes but `record` exposes timing
differences.

If you want that behavior by default for a project, set
`test.mockRecord: true` in `screenci.config.ts`.

## `screenci record [playwrightArgs...]`

Record final output:

```bash
npx screenci record
npx screenci record videos/onboarding.video.ts
npx screenci record --grep "billing"
npx screenci record --project=chromium
```

`record` forwards normal Playwright file filters and `--grep`, so you can limit
recording to only some videos just like with `screenci test`.

Behavior:

- enables recording timing
- writes local output into `.screenci/`
- uploads successful recordings when `SCREENCI_SECRET` is available
- prints a project URL after upload when rendering has been started remotely

Relevant options:

- `-c, --config <path>`
- `-v, --verbose`

Important restriction:

- `--retries` is not supported because ScreenCI forces retries to `0`

Use this command in [Record and Publish](/docs/record-and-publish).

## `screenci info`

```bash
npx screenci info
```

Prints remote project data for the current `projectName`, including video IDs
and whether public delivery is enabled.

Use this before public-delivery changes when you need the remote `videoId`:

```json
{
  "projectName": "My Product",
  "videos": [
    {
      "id": "video_123",
      "name": "Onboarding",
      "isPublic": true,
      "language": "en",
      "hasSubtitles": true
    }
  ]
}
```

## `screenci make-public <videoId>`

```bash
npx screenci make-public video_123
```

Enables public delivery for a video. Get the ID from `screenci info`.

When you make a video public, ScreenCI starts it in the same mode as the app:

- public delivery is enabled for the video
- auto-select latest is enabled
- the latest finished render for each language becomes the active public output

That means `make-public` is the CLI equivalent of turning on **Enable public
URL** in the dashboard.

## `screenci make-private <videoId>`

```bash
npx screenci make-private video_123
```

Disables public delivery for a video.

This is the CLI equivalent of turning off **Enable public URL** in the
dashboard.

## What the CLI does not do

The CLI currently covers:

- local iteration with `test`
- final capture and upload with `record`
- remote inspection with `info`
- public visibility changes with `make-public` and `make-private`

Manual version pinning is currently handled in the app UI:

- turn off **Auto-select latest version**
- open a language section
- choose the version to mark as **Selected**

## Shared environment and config behavior

These commands support `--config <path>`:

- `test`
- `record`
- `info`
- `make-public`
- `make-private`

`SCREENCI_SECRET` is used for:

- uploads
- project info
- public delivery changes

If `envFile` is configured in `screenci.config.ts`, the CLI loads it
automatically.

## Related pages

- [Run and Debug Videos](/docs/run-and-debug-videos) for the local loop.
- [Configuration](/docs/reference/configuration) for `screenci.config.ts`.
