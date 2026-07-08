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

Playwright options in `screenci.config.ts` (like `baseURL`) merge with per-file
`video.use()` overrides. Record and render options are not set in the config:
they are declared per video with `video.recordOptions()` and
`video.renderOptions()`, starting from the system defaults. Any value you omit
falls back to those defaults.

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
  },

  // ScreenCI currently records with Chromium, so start with a Chromium project.
  projects: [{ name: 'chromium' }],
})
```

Use this as a menu, not a template you must fill out. Most projects only need
`projectName` plus one or two shared defaults. Record and render options are not
set here: declare them per video with `video.recordOptions(...)` and
`video.renderOptions(...)` (see [Capture defaults](#capture-defaults) and
[Rendering defaults](#rendering-defaults)).

## Config areas

### Project identity

- `projectName` identifies the project in ScreenCI.
- `envFile` points to the file that holds `SCREENCI_SECRET` and other local
  runtime variables your ScreenCI workflow needs.
- If `envFile` is configured, ScreenCI loads it automatically.
- If `envFile` is omitted, ScreenCI falls back to the project `.env`.
- `envFile` is resolved by evaluating the config the same way Playwright does,
  so it can be dynamic (e.g. a ternary that picks `.env.local` when
  `SCREENCI_ENVIRONMENT === 'local'` and `.env` otherwise).

For example, keep `SCREENCI_SECRET` there. Your ElevenLabs key is not stored in
your env file: add it on the Secrets page in the app instead (see
[Narration](/docs/guides/narration#elevenlabs-voices)).

### Example: `.env` file

A typical local env file looks like this:

```bash
SCREENCI_SECRET=sc_live_your_project_secret
YOUR_PRIVATE_SECRET=your_own_app_secret
```

Common cases:

- `SCREENCI_SECRET` authenticates `screenci record`, `screenci info`, and
  public visibility commands.
- Any other variables (for example `YOUR_PRIVATE_SECRET`) are yours to use
  inside your own app or test setup. ScreenCI reads them from the env file into
  `process.env` like any normal environment variable, but never transmits them.

### What ScreenCI sends to the service

Only `SCREENCI_SECRET` is ever sent to the ScreenCI service, as the
`X-ScreenCI-Secret` header on upload and command calls, to authenticate your
project. Your ElevenLabs key is never sent from your machine: it is stored
encrypted in the app and used server-side at render time.

No other environment variable is forwarded. Your app secrets, database URLs, and
any other entries in the env file stay on your machine. ScreenCI does not store
raw API keys from your env file.

The uploaded `recording.mp4` is a screen capture, so secrets that are visible
**on the page** would be uploaded with it. To keep on-screen secrets out of the
recording, mask them with
[`redact`](/docs/guides/redact), which
hides the content in the browser before the frame is captured. List
always-secret elements under `recordOptions.redact` to mask them from the first
frame.

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

Declare `recordOptions` per video with `video.recordOptions(...)`:

- `aspectRatio`
- `quality`
- `fps`
- `performance` (see below)
- `encoder` (see below)
- `redact`: CSS selectors masked from the first frame so on-screen secrets never
  enter the recording. See
  [redacting sensitive content](/docs/guides/redact).

```ts
import { video } from 'screenci'

video.recordOptions({
  // Capture landscape video.
  aspectRatio: '16:9',
  // Record at 1080p unless a file opts into something else.
  quality: '1080p',
  // Use 60 fps for smoother cursor and animation capture.
  fps: 60,
})('My video', async ({ page }) => {
  await page.goto('/')
})
```

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
video.recordOptions({
  // Lightest encode on constrained CI runners; full quality locally.
  encoder: process.env.CI ? 'fast' : 'sharp', // default: 'fast'
})('My video', async ({ page }) => {
  /* ... */
})
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
video.recordOptions({
  // Defaults: dispatch the cursor sparingly (render-time), scroll every frame.
  performance: { mouseFrameSkip: 5, scrollFrameSkip: 0 },
})('My video', async ({ page }) => {
  /* ... */
})
```

By default the cursor skips 5 frames (~10fps at 60fps), since it is re-drawn at
render time; the scroll skips none (every frame), since it is real footage.
Lower the cursor's skip only if a flow depends on hovering elements along the
cursor's path.

### Rendering defaults

Declare `renderOptions` per video with `video.renderOptions(...)` when you want
consistent output styling. It also accepts a per-language form,
`video.renderOptions({ default: {...}, fi: {...} })`, so one language can differ
from the rest:

- `output.background`
- `recording.size`, `recording.roundness`, `recording.dropShadow`
- `recording.clip` (crop the recording at render time, see below)
- `narration.corner`, `narration.padding`, `narration.size`, `narration.roundness` (0 = square, 1 = circle; defaults to 0.2)
- `mouse.size`, `mouse.style` (`'white'` or `'black'` cursor)
- `mouse.image` (custom cursor image, see below)
- `mouse.motionBlur` and `zoom.motionBlur` (motion blur strength, see below)

### Cropping the recording

`recording.clip` shows only a region of the recorded screen in the final video,
following Playwright's `clip` shape. The recording is always captured at the
full configured resolution and the crop is applied at render time, so you can
change or remove the clip and re-render without re-recording. Coordinates are
CSS pixels of the recording viewport (top-left origin):

```ts
video.renderOptions({
  recording: {
    clip: { x: 200, y: 120, width: 960, height: 600 },
  },
})('My video', async ({ page }) => {
  /* ... */
})
```

The recording tile takes the clip's aspect ratio, and cursor movement and zoom
follow the clipped region. The clip is also editable visually on the Editor
page (a crop selection on top of the video preview).

### Custom mouse

By default the cursor is the built-in arrow, coloured by `mouse.style`
(`'white'` or `'black'`). To use your own cursor graphic instead, point
`mouse.image` at a local image, relative to your config directory:

```ts
video.renderOptions({
  mouse: { image: './assets/my-cursor.png', size: 0.05 },
})('My video', async ({ page }) => {
  /* ... */
})
```

The image is uploaded alongside the recording, and drawn in both video and
screenshot output. It replaces the built-in cursor entirely, so `mouse.style`
is ignored when `image` is set. A few things to know:

- Use a **PNG**.
- The image's **top-left corner is the pointer hotspot**, matching the
  built-in cursors.
- `mouse.size` scales it (as a fraction of the output height, aspect ratio
  preserved), and `mouse.motionBlur` and the click animation still apply.

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
video.renderOptions({
  mouse: { motionBlur: 0.5 },
  zoom: { motionBlur: 0.5 },
})('My video', async ({ page }) => {
  /* ... */
})
```

Reuse the same render options across videos for branding and layout
consistency, then override only the files that need a different look.

The web Editor is the source of truth for render and record options. Values
declared in code (per video with `video.renderOptions(...)` and
`video.recordOptions(...)`) are the starting point, and web edits override them.
Omit them entirely to start from the system defaults. See
[Editor](/docs/guides/editor).

### Example: shared `use` defaults

Use `use` for Playwright options that multiple videos share, such as a common
`baseURL` for navigation:

```ts
import { defineConfig } from 'screenci'

export default defineConfig({
  projectName: 'my-product',
  envFile: '.env',
  use: {
    baseURL: 'https://staging.example.com',
  },
})
```

Record and render options are not set here. Declare them per video, and reuse
the same object across files when you want a shared baseline:

```ts
import { video } from 'screenci'

video
  .recordOptions({ aspectRatio: '16:9', quality: '1080p', fps: 60 })
  .renderOptions({
    narration: {
      corner: 'bottom-left',
      size: 'medium',
    },
    output: {
      background: {
        backgroundCss: 'linear-gradient(135deg, #0f172a 0%, #1d4ed8 100%)',
      },
    },
  })('My video', async ({ page }) => {
  await page.goto('/')
})
```

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

#### `webServer` in CI

When your videos navigate to a locally-running app, use a static serve command
in CI instead of the dev server. The dev server's dependencies live in the root
`node_modules`, which the generated CI workflow does not install by default.

```ts
webServer: {
  command: process.env.CI ? 'npm run preview' : 'npm run dev',
  cwd: '..', // path from screenci/ to the project root
  url: process.env.CI ? 'http://localhost:4173' : 'http://localhost:5173',
  reuseExistingServer: !process.env.CI,
  timeout: 120_000,
},
use: {
  baseURL: process.env.CI ? 'http://localhost:4173' : 'http://localhost:5173',
},
```

You also need to add root-app install and build steps to `.github/workflows/screenci.yaml`.
See [Recording your own app](/docs/ci-setup#recording-your-own-app) in the CI setup guide.

## Per-file overrides

Use `video.recordOptions()` / `video.renderOptions()` when one file needs
different defaults. They return a chainable builder, so chain them into the test
registration (or into `video.narration(...)` and the other builder methods):

```ts
import { video } from 'screenci'

video
  .recordOptions({
    // Switch this file to portrait output.
    aspectRatio: '9:16',
    // Capture at a higher resolution for this specific video.
    quality: '1440p',
    fps: 60,
  })
  .renderOptions({
    narration: {
      // Move narration away from UI that appears in the lower-right corner.
      corner: 'top-right',
    },
  })('Portrait walkthrough', async ({ page }) => {
  await page.goto('/dashboard')
})
```

Reach for these builder methods when a single script has a different layout or
output format than the rest of the project. For plain Playwright options
(such as `colorScheme`) use `video.use()` the same way.

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
- [Narration](/docs/guides/narration) for cue and voice authoring.
