# Configuration

`screenci.config.ts` is where project defaults live. Keep it small at first, then add settings when you have a concrete need such as a shared `baseURL`, a different video directory, or a different recording default.

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
  // Directory containing your *.video.ts files (default: './videos')
  videoDir: './videos',

  record: {
    upload: 'passed-only',
  },

  use: {
    baseURL: 'https://staging.screenci.com',
    recordOptions: {
      aspectRatio: '16:9',
      quality: '1080p',
      fps: 60, // 24 | 30 | 60
    },
    trace: 'retain-on-failure',
  },
})
```

## Config areas

### Project identity

- `projectName` identifies the project in ScreenCI.
- `envFile` points to the file that holds `SCREENCI_SECRET` and related variables.

### File locations

- `videoDir` controls where ScreenCI discovers `*.video.ts` files.

### Recording behavior

- `record.upload: 'passed-only'` uploads successful recordings even if another one failed.
- `record.upload: 'all-or-nothing'` skips uploads when any recording fails.

### Rendering defaults

Set shared `recordOptions` under `use`:

- `aspectRatio`
- `quality`
- `fps`

### Playwright integration

ScreenCI passes through most normal Playwright config such as:

- `timeout`
- `reporter`
- `workers`
- `fullyParallel`
- `webServer`

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
})
```

## Default values

| Option                      | Default               |
| --------------------------- | --------------------- |
| `videoDir`                  | `'./videos'`          |
| `record.upload`             | `'passed-only'`       |
| `recordOptions.aspectRatio` | `'16:9'`              |
| `recordOptions.quality`     | `'1080p'`             |
| `recordOptions.fps`         | `60`                  |
| `trace`                     | `'retain-on-failure'` |

## ScreenCI-managed behavior

ScreenCI still owns a small set of Playwright behavior:

| Setting     | Value          | Reason                                     |
| ----------- | -------------- | ------------------------------------------ |
| `retries`   | `0`            | Retrying would overwrite the video         |
| `testMatch` | `**/*.video.*` | Scopes Playwright to video test files only |

Everything else should stay problem-driven. Add config only when it helps a real workflow.
