# Configuration

`screenci.config.ts` is where project defaults live. Keep it small at first,
then add settings when you have a concrete need such as a shared `baseURL`, a
different video directory, a rendering default, or a Playwright integration
option.

ScreenCI builds on Playwright's config model, so most normal Playwright config
still works here. For the Playwright side of the file, see
[Configuration](https://playwright.dev/docs/test-configuration).

`screenci.config.ts` lives inside the self-contained `screenci/` directory that
`init` creates, and paths like `videoDir` and `envFile` are resolved relative
to it. ScreenCI couples to your app only through a `baseURL` (and optional
`storageState`). It does not need to live in, or share dependencies with, the
app it records, which is what keeps it isolated in a monorepo.

The config merges three layers:

1. ScreenCI defaults.
2. Your project-wide defaults from `screenci.config.ts`.
3. Per-file overrides from `video.use()`.

## Common full config

This example focuses on the ScreenCI-specific options you are most likely to
add first. Most normal Playwright config still works in the same file.

```ts
import { defineConfig } from 'screenci'

export default defineConfig({
  // Used to identify the project in ScreenCI.
  projectName: 'my-product',
  // Load SCREENCI_SECRET and related env vars from this file.
  envFile: '.env',
  // Look for *.video.ts files here.
  videoDir: './videos',

  test: {
    // Keep local test runs paced like real recording runs.
    mockRecord: false,
  },

  record: {
    // Upload successful recordings even if some files fail.
    upload: 'passed-only',
  },

  use: {
    // Shared base URL for page.goto('/path') style navigation.
    baseURL: 'https://staging.screenci.com',
    recordOptions: {
      // Capture landscape video by default.
      aspectRatio: '16:9',
      // Record at 1080p unless a file opts into something else.
      quality: '1080p',
      // Use 60 fps for smoother cursor and animation capture.
      fps: 60,
    },
    renderOptions: {
      output: {
        background: {
          // Apply a consistent background behind the recorded browser area.
          backgroundCss: 'linear-gradient(135deg, #101820 0%, #16324f 100%)',
        },
      },
    },
  },

  // ScreenCI currently records with Chromium, so start with a Chromium project.
  projects: [{ name: 'chromium' }],
})
```

Use this as a menu, not a template you must fill out. Most projects only need
`projectName` plus one or two shared defaults.

## Config areas

### Project identity

- `projectName` identifies the project in ScreenCI.
- `envFile` points to the file that holds `SCREENCI_SECRET` and other local
  runtime variables your ScreenCI workflow needs.
- If `envFile` is configured, ScreenCI loads it automatically.
- If `envFile` is omitted, ScreenCI falls back to the project `.env`.

For example, keep `SCREENCI_SECRET` there, and keep any local BYOK secrets such
as `ELEVENLABS_API_KEY` there when your local ScreenCI or backend setup depends
on them. ScreenCI does not store raw API keys from your env file.

### Example: `.env` file

A typical local env file looks like this:

```bash
SCREENCI_SECRET=sc_live_your_project_secret
ELEVENLABS_API_KEY=sk_your_elevenlabs_key
GOOGLE_CLOUD_API_KEY=your_google_cloud_key
GOOGLE_VERTEX_SERVICE_ACCOUNT={"project_id":"my-project","client_email":"...","private_key":"..."}
GOOGLE_VERTEX_LOCATION=us-central1
```

Common cases:

- `SCREENCI_SECRET` authenticates `screenci record`, `screenci info`, and
  public visibility commands.
- `ELEVENLABS_API_KEY` is required when your narration uses
  `voices.elevenlabs({ voiceId })` or custom voice assets.
- `GOOGLE_CLOUD_API_KEY` is used for consistent model-backed narration.
- `GOOGLE_VERTEX_SERVICE_ACCOUNT` and `GOOGLE_VERTEX_LOCATION` are used for
  expressive Gemini narration.

Keep adding local runtime secrets here as needed. `screenci.config.ts` only
points to the env file. The actual secret values belong in `.env` or whatever
file you set via `envFile`.

### File locations

- `videoDir` controls where ScreenCI discovers `*.video.ts` files.
- ScreenCI also maps Playwright `testDir` to this directory automatically.

### Recording behavior

- `test.mockRecord: true` makes `screenci test` keep recording-like pacing by
  default. This is the config equivalent of `screenci test --mock-record`.
- `record.upload: 'passed-only'` uploads successful recordings even if another
  one failed.
- `record.upload: 'all-or-nothing'` skips uploads when any recording fails.

### Capture defaults

Set shared `recordOptions` under `use`:

- `aspectRatio`
- `quality`
- `fps`

These values determine the recording viewport, so they are the supported way to
control recording size.

### Rendering defaults

Set shared `renderOptions` under `use` when you want consistent output styling:

- `output.background`
- `recording.size`, `recording.roundness`, `recording.dropShadow`
- `narration.corner`, `narration.padding`, `narration.size`
- `mouse.size`, `mouse.style` (`'white'` or `'black'` cursor)

Use project-wide render defaults for branding and layout consistency, then
override only the files that need a different look.

On the Business tier you can defer render options to the web app entirely by
setting `renderOptions: STUDIO_RENDER_OPTIONS`. They are then managed on the
Studio page. See [Studio](/docs/guides/studio).

### Example: shared `use` defaults

Use `use` when multiple videos should share the same recording, navigation, or
rendering defaults:

```ts
import { defineConfig } from 'screenci'

export default defineConfig({
  projectName: 'my-product',
  envFile: '.env',
  use: {
    baseURL: 'https://staging.example.com',
    recordOptions: {
      aspectRatio: '16:9',
      quality: '1080p',
      fps: 60,
    },
    renderOptions: {
      narration: {
        corner: 'bottom-left',
        size: 'medium',
      },
      output: {
        background: {
          backgroundCss: 'linear-gradient(135deg, #0f172a 0%, #1d4ed8 100%)',
        },
      },
    },
  },
})
```

This keeps every video in the project on the same baseline, so individual files
only need to override the few things that are actually different.

### Playwright integration

ScreenCI passes through most normal Playwright config such as:

- `timeout`
- `reporter`
- `workers`
- `fullyParallel`
- `webServer`
- `projects`

That means you can keep using familiar Playwright options like `baseURL`,
`storageState`, `trace`, `launchOptions`, `webServer`, and browser-specific
projects in the same file.

For the Playwright side of the config model, see
[Configuration](https://playwright.dev/docs/test-configuration).

## Per-file overrides

Use `video.use()` when one file needs different defaults:

```ts
import { video } from 'screenci'

video.use({
  recordOptions: {
    // Switch this file to portrait output.
    aspectRatio: '9:16',
    // Capture at a higher resolution for this specific video.
    quality: '1440p',
    fps: 60,
  },
  renderOptions: {
    narration: {
      // Move narration away from UI that appears in the lower-right corner.
      corner: 'top-right',
    },
  },
})
```

Reach for `video.use()` when a single script has a different layout, output
format, or staging target than the rest of the project.

## Default values

| Option                      | Default         |
| --------------------------- | --------------- |
| `test.mockRecord`           | `false`         |
| `videoDir`                  | `'./videos'`    |
| `record.upload`             | `'passed-only'` |
| `recordOptions.aspectRatio` | `'16:9'`        |
| `recordOptions.quality`     | `'1080p'`       |
| `recordOptions.fps`         | `60`            |
| `timeout`                   | `1800000`       |
| `actionTimeout`             | `30000`         |
| `navigationTimeout`         | `30000`         |

## ScreenCI-managed behavior

ScreenCI still owns a small set of Playwright behavior:

| Setting     | Value          | Reason                                     |
| ----------- | -------------- | ------------------------------------------ |
| `retries`   | `0`            | Retrying would overwrite the video         |
| `testMatch` | `**/*.video.*` | Scopes Playwright to video test files only |
| `testDir`   | `videoDir`     | ScreenCI discovers videos from this path   |

It also rejects `viewport` in `use` or project `use`, because ScreenCI derives
viewport dimensions from `recordOptions`.

Everything else should stay problem-driven. Add config only when it helps a
real workflow.

## Related pages

- [CLI](/docs/reference/cli) for how config is discovered and loaded.
- [Narration and Localization](/docs/guides/narration-and-localization) for cue and
  voice authoring.
