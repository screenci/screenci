---
title: Configuration
description: Configure screenci with defineConfig — set defaults for video quality, FPS, trace recording, and more.
---

# Configuration

## `screenci.config.ts`

The config file is where you set global defaults for all your video tests. Create it at the root of your project (or wherever you run Playwright from).

### Minimal config

```ts
import { defineConfig } from 'screenci'

export default defineConfig({})
```

All options have sensible defaults — this is enough to get started.

### Full config with all options

```ts
import { defineConfig } from 'screenci'

export default defineConfig({
  // Directory containing your *.video.ts files (default: './videos')
  videoDir: './videos',

  // Control what happens after partial recording failures.
  // 'passed-only' uploads only successful recordings (default).
  // 'all-or-nothing' skips all uploads if any recording test fails.
  record: {
    upload: 'passed-only', // 'passed-only' | 'all-or-nothing'
  },

  // Global timeout per test in ms (Playwright default applies if omitted)
  timeout: 60_000,

  use: {
    videoOptions: {
      resolution: '1080p', // '720p' | '1080p' | '4k' | { width, height }
      fps: 60, // 24 | 30 | 60
      quality: 'high', // 'low' | 'medium' | 'high'
    },

    // Playwright trace recording
    trace: 'retain-on-failure', // 'on' | 'off' | 'retain-on-failure'

    // Any other Playwright 'use' options work here
    baseURL: 'https://staging.example.com',
  },
})
```

### Custom resolution

```ts
import { defineConfig } from 'screenci'

export default defineConfig({
  use: {
    videoOptions: {
      resolution: { width: 1440, height: 900 }, // Custom dimensions
    },
  },
})
```

## Per-test overrides

Options set via `video.use()` override the global config for all subsequent tests in that file:

```ts
import { video } from 'screenci'

// Apply 4K + 60fps to all tests in this file
video.use({
  videoOptions: {
    resolution: '4k',
    fps: 60,
  },
})

video('High resolution demo', async ({ page }) => {
  await page.goto('https://example.com')
})

video('Another 4K test', async ({ page }) => {
  await page.goto('https://example.com/features')
})
```

## Upload policy for `screenci record`

Use the top-level `record.upload` setting to control whether ScreenCI uploads recordings after a partial Playwright failure.

```ts
import { defineConfig } from 'screenci'

export default defineConfig({
  record: {
    upload: 'all-or-nothing',
  },
})
```

Options:

- `passed-only` (default): if some recording tests fail, ScreenCI still uploads the successful recordings
- `all-or-nothing`: if any recording test fails, ScreenCI skips all uploads

`record.upload` only affects the `screenci record` CLI command. It does not change how Playwright runs the tests themselves.

## Default values

| Option          | Default               |
| --------------- | --------------------- |
| `videoDir`      | `'./videos'`          |
| `record.upload` | `'passed-only'`       |
| `resolution`    | `'1080p'`             |
| `fps`           | `60`                  |
| `quality`       | `'high'`              |
| `trace`         | `'retain-on-failure'` |

## What `defineConfig` enforces

These Playwright settings are still managed automatically by ScreenCI:

| Setting     | Value          | Reason                                     |
| ----------- | -------------- | ------------------------------------------ |
| `retries`   | `0`            | Retrying would overwrite the video         |
| `testMatch` | `**/*.video.*` | Scopes Playwright to video test files only |

`workers` and `fullyParallel` now use normal Playwright behavior unless you set them yourself.
