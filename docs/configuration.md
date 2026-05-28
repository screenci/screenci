# Configuration

`screenci.config.ts` is where project defaults live. Keep it small at first,
then add settings when you have a concrete need such as a shared `baseURL`, a
different video directory, a rendering default, or a Playwright integration
option.

ScreenCI builds on Playwright's config model, so most normal Playwright config
still works here. For the Playwright side of the file, see
[Configuration](https://playwright.dev/docs/test-configuration).

The config merges three layers:

1. ScreenCI defaults.
2. Your project-wide defaults from `screenci.config.ts`.
3. Per-file overrides from `video.use()`.

## Minimal config

```ts
import { defineConfig } from 'screenci'

export default defineConfig({
  // Used to identify this project in ScreenCI.
  projectName: 'my-product',
})
```

That is enough to get started.

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
- `envFile` points to the file that holds `SCREENCI_SECRET` and related
  variables.
- If `envFile` is omitted, ScreenCI falls back to the usual process environment.

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
- `mouse.size`

Use project-wide render defaults for branding and layout consistency, then
override only the files that need a different look.

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
- [Video Authoring API Overview](/docs/reference/video-authoring-api-overview)
  for the runtime helpers used inside scripts.
