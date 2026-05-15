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

  // Global timeout per test in ms (Playwright default applies if omitted)
  timeout: 60_000,

  use: {
    videoOptions: {
      resolution: '1080p', // '720p' | '1080p' | '4k' | { width, height }
      fps: 30, // 24 | 30 | 60
      quality: 'high', // 'low' | 'medium' | 'high'
    },

    // Playwright trace recording
    trace: 'retain-on-failure', // 'on' | 'off' | 'retain-on-failure'

    // Any other Playwright 'use' options work here
    baseURL: 'https://staging.example.com',
  },

  // Playwright's webServer option works as normal
  webServer: {
    command: 'npm run start',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
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

## Default values

| Option       | Default               |
| ------------ | --------------------- |
| `videoDir`   | `'./videos'`          |
| `resolution` | `'1080p'`             |
| `fps`        | `30`                  |
| `quality`    | `'high'`              |
| `trace`      | `'retain-on-failure'` |

## What `defineConfig` enforces

These Playwright settings are set automatically and cannot be overridden — they are required for correct video recording:

| Setting         | Value          | Reason                                                   |
| --------------- | -------------- | -------------------------------------------------------- |
| `workers`       | `1`            | FFmpeg records one display; parallel tests would overlap |
| `fullyParallel` | `false`        | Same as above                                            |
| `retries`       | `0`            | Retrying would overwrite the video                       |
| `testMatch`     | `**/*.video.*` | Scopes Playwright to video test files only               |
