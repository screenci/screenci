# Configuration

`screenci.config.ts` is where project defaults live. Keep it small at first,
then add settings when you have a concrete need such as a shared `baseURL`, a
different video directory, a rendering default, or a Playwright integration
option.

## Minimal config

```ts
import { defineConfig } from 'screenci'

export default defineConfig({
  projectName: 'my-product',
})
```

That is enough to get started.

## Common full config

```ts
import { defineConfig } from 'screenci'

export default defineConfig({
  projectName: 'my-product',
  envFile: '.env',
  videoDir: './videos',

  test: {
    mockRecord: false,
  },

  record: {
    upload: 'passed-only',
  },

  use: {
    baseURL: 'https://staging.screenci.com',
    recordOptions: {
      aspectRatio: '16:9',
      quality: '1080p',
      fps: 60,
    },
    renderOptions: {
      output: {
        background: {
          backgroundCss: 'linear-gradient(135deg, #101820 0%, #16324f 100%)',
        },
      },
    },
    trace: 'retain-on-failure',
  },

  projects: [{ name: 'chromium' }],
})
```

## Config areas

### Project identity

- `projectName` identifies the project in ScreenCI.
- `envFile` points to the file that holds `SCREENCI_SECRET` and related
  variables.

### File locations

- `videoDir` controls where ScreenCI discovers `*.video.ts` files.

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

### Rendering defaults

Set shared `renderOptions` under `use` when you want consistent output styling:

- `output.background`
- `recording.size`, `recording.roundness`, `recording.dropShadow`
- `narration.corner`, `narration.padding`, `narration.size`
- `mouse.size`

### Playwright integration

ScreenCI passes through most normal Playwright config such as:

- `timeout`
- `reporter`
- `workers`
- `fullyParallel`
- `webServer`
- `projects`

For the Playwright side of the config model, see
[Configuration](https://playwright.dev/docs/test-configuration).

## Per-file overrides

Use `video.use()` when one file needs different defaults:

```ts
import { video } from 'screenci'

video.use({
  recordOptions: {
    aspectRatio: '9:16',
    quality: '1440p',
    fps: 60,
  },
  renderOptions: {
    narration: {
      corner: 'top-right',
    },
  },
})
```

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
