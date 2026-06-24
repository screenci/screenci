# Configuration

`screenci.config.ts` is where project defaults live. Keep it small at first,
then add settings when you have a concrete need such as a shared `baseURL`, a
different video directory, a rendering default, or a Playwright integration
option.

ScreenCI builds on Playwright's config model, so most normal Playwright config
still works here. For the Playwright side of the file, see
[Configuration](https://playwright.dev/docs/test-configuration).

`screenci.config.ts` lives inside the self-contained `screenci/` directory that
`init` creates, and paths like `recordingDir` and `envFile` are resolved relative
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
  // Look for *.screenci.ts files here.
  recordingDir: './recordings',

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
YOUR_PRIVATE_SECRET=your_own_app_secret
```

Common cases:

- `SCREENCI_SECRET` authenticates `screenci record`, `screenci info`, and
  public visibility commands.
- `ELEVENLABS_API_KEY` is required when your narration uses
  `voices.elevenlabs({ voiceId })` or custom voice assets.
- Any other variables (for example `YOUR_PRIVATE_SECRET`) are yours to use
  inside your own app or test setup. ScreenCI reads them from the env file into
  `process.env` like any normal environment variable, but never transmits them.

### What ScreenCI sends to the service

Only two values are ever sent to the ScreenCI service, and only as request
headers on upload and command calls:

- `SCREENCI_SECRET`, as the `X-ScreenCI-Secret` header, to authenticate your
  project.
- `ELEVENLABS_API_KEY`, as the `X-ElevenLabs-Api-Key` header, and only when your
  narration actually uses ElevenLabs voices.

No other environment variable is forwarded. Your app secrets, database URLs, and
any other entries in the env file stay on your machine. ScreenCI does not store
raw API keys from your env file.

Keep adding local runtime secrets here as needed. `screenci.config.ts` only
points to the env file. The actual secret values belong in `.env` or whatever
file you set via `envFile`.

### File locations

- `recordingDir` controls where ScreenCI discovers `*.screenci.ts` files.
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
- `performance` (see below)
- `encoder` (see below)

These values determine the recording viewport, so they are the supported way to
control recording size.

### Recording encoder

`recordOptions.encoder` selects how the screen capture is encoded:

- `'fast'` (default) is the lightest possible encode. It never falls behind the
  capture stream, so it is the safe baseline on any runner. (When the encoder
  falls behind it drops frames and shortens the recording.)
- `'sharp'` is tuned for text-heavy UI, so labels, code, and small type stay
  crisp. It uses a little more CPU; on most machines it still encodes above
  realtime.

The `init`-scaffolded config opts into `'sharp'` locally and keeps `'fast'` in
CI, which is the recommended setup:

```ts
recordOptions: {
  // Lightest encode on constrained CI runners; full quality locally.
  encoder: process.env.CI ? 'fast' : 'sharp', // default: 'fast'
}
```

### Recording performance

`recordOptions.performance` controls how many output frames screenci skips
between cursor and scroll dispatches while recording. On a busy page or a slow CI
runner, each dispatch queues behind the page's own work, so dispatching on every
frame can stall an interaction. The cursor is re-drawn at render time from a
single move event, so skipping cursor frames does not make it choppy; scroll is
real footage, so skipping scroll frames does.

Pass an object of frame-skip counts to tune each stream independently
(`0` = every frame). Intervals are derived from the recording `fps`:

```ts
recordOptions: {
  // Defaults: dispatch the cursor sparingly (render-time), scroll every frame.
  performance: { mouseFrameSkip: 5, scrollFrameSkip: 0 },
}
```

By default the cursor skips 5 frames (~10fps at 60fps), since it is re-drawn at
render time; the scroll skips none (every frame), since it is real footage.
Lower the cursor's skip only if a flow depends on hovering elements along the
cursor's path.

### Rendering defaults

Set shared `renderOptions` under `use` when you want consistent output styling:

- `output.background`
- `recording.size`, `recording.roundness`, `recording.dropShadow`
- `narration.corner`, `narration.padding`, `narration.size`
- `mouse.size`, `mouse.style` (`'white'` or `'black'` cursor)
- `mouse.motionBlur` and `zoom.motionBlur` (motion blur strength, see below)

### Motion blur

ScreenCI adds screen.studio-style motion blur so fast cursor moves and camera
pans/zooms smear naturally instead of jumping frame to frame.

- `mouse.motionBlur` blurs the cursor along its path.
- `zoom.motionBlur` blurs the camera viewport during pans and zooms.

Both take a value from `0` to `1` and default to `0.5`. The value is the shutter
open time as a fraction of one output frame interval: `0` disables the effect,
`1` is a full-frame shutter (maximum smear). The blur is adaptive, so slow or
static frames cost nothing. The two settings are independent: you can blur the
camera without blurring the cursor, or the reverse.

```ts
renderOptions: {
  mouse: { motionBlur: 0.5 },
  zoom: { motionBlur: 0.5 },
}
```

Use project-wide render defaults for branding and layout consistency, then
override only the files that need a different look.

On the Business tier you can defer render options to the web app entirely with
`video.studio({ renderOptions: true })` (and the record options with
`recordOptions: true`). They are then managed on the Studio page. See
[Studio](/docs/guides/studio).

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

| Option                      | Default          |
| --------------------------- | ---------------- |
| `test.mockRecord`           | `false`          |
| `recordingDir`              | `'./recordings'` |
| `record.upload`             | `'passed-only'`  |
| `recordOptions.aspectRatio` | `'16:9'`         |
| `recordOptions.quality`     | `'1080p'`        |
| `recordOptions.fps`         | `60`             |
| `recordOptions.encoder`     | `'fast'`         |
| `timeout`                   | `1800000`        |
| `actionTimeout`             | `30000`          |
| `navigationTimeout`         | `30000`          |

## ScreenCI-managed behavior

ScreenCI still owns a small set of Playwright behavior:

| Setting     | Value             | Reason                                     |
| ----------- | ----------------- | ------------------------------------------ |
| `retries`   | `0`               | Retrying would overwrite the video         |
| `testMatch` | `**/*.screenci.*` | Scopes Playwright to video test files only |
| `testDir`   | `recordingDir`    | ScreenCI discovers videos from this path   |

It also rejects `viewport` in `use` or project `use`, because ScreenCI derives
viewport dimensions from `recordOptions`.

Everything else should stay problem-driven. Add config only when it helps a
real workflow.

## Related pages

- [CLI](/docs/reference/cli) for how config is discovered and loaded.
- [Narration and Localization](/docs/guides/narration-and-localization) for cue and
  voice authoring.
