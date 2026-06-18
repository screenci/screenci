# Overlays

Overlays let you place additional media on top of the recording timeline. Use them for intros, transitions, corner branding, callouts, or short contextual clips that would be awkward to build inside the browser automation itself.

An overlay can come from a file (`.html`, `.svg`, `.png`, or `.mp4`), a React element, or an inline config object. HTML files and React elements are rendered to a transparent PNG at recording time and then behave exactly like an image overlay.

#### You will learn

- [how to define overlays](#define-overlays)
- [how to position and size overlays](#positioning)
- [how blocking and start/end timing work](#timing-and-control-flow)
- [how to organize files for maintainable projects](#file-organization)

## Define overlays

`createOverlays` takes a map. Each value is one of:

- a **file path** string (`.html`, `.svg`, `.png`, `.mp4`),
- a **React element**, or
- a **config object** (`{ path | element, ...placement }`).

```tsx
import { createOverlays, video } from 'screenci'
import { Badge } from './Badge'

const overlays = createOverlays({
  intro: { path: 'assets/intro.mp4', fullScreen: true }, // full-frame video
  hint: 'assets/callout.html', // HTML file
  badge: <Badge label="New" />, // React element
  logo: { path: 'assets/logo.png', x: 0.05, y: 0.05, width: 0.15 },
})

video('Overview', async ({ page }) => {
  await overlays.intro()
  await page.goto('/dashboard')
  await overlays.logo(1200)
})
```

Each key becomes a callable overlay controller.

On the Business tier you can also declare overlay keys with
`createStudioOverlays('intro', 'logo')` and upload the files plus display
options on the Studio page instead of keeping them in the repository. See
[Studio](./studio.md#studio-overlays-from-code).

Rules:

- HTML, React, `.svg`, and `.png` overlays need a `durationMs` for the blocking call form (set it in the config or pass it to the call, for example `await overlays.logo(1200)`). You can omit it when driving the overlay with `start()`/`end()`.
- Image, HTML, and React overlays do not support `audio`.
- `.mp4` overlays may provide `audio`. If omitted it defaults to `1`.
- `.mp4` overlays use the file's natural duration and must not provide `durationMs`.

### HTML and React overlays

HTML overlays are authored as `.html` files; pass the path like any other file.
React overlays are passed straight in as elements. `react` and `react-dom` are
optional peer dependencies imported lazily, so installing screenci never pulls
React into your project unless you actually use an element. `screenci init`
offers to set this up for you (it installs `react`/`react-dom`, enables
`"jsx": "react-jsx"` in the scaffolded `tsconfig.json`, and adds a `.tsx`
example). To wire it up by hand, install the packages, set `"jsx": "react-jsx"`
in your tsconfig, and author the overlay in a `.video.tsx` file.

```tsx
const overlays = createOverlays({
  // From an .html file.
  hint: { path: 'assets/callout.html', x: 0.4, y: 0.8, width: 0.2 },
  // From a React element.
  badge: { element: <Badge label="New" />, x: 0.7, y: 0.1, width: 0.15 },
})
```

## Positioning

Placement fields are flat on the config and each defaults independently.
Coordinates are normalized `0`-`1` fractions of a reference box, with the
overlay anchored at its top-left corner. This is resolution-independent: the
same placement renders correctly at 720p, 1080p, 4K, or vertical.

```tsx
const overlays = createOverlays({
  // Top-left badge sized to 15% of the full output frame width.
  badge: {
    path: 'assets/badge.png',
    durationMs: 1500,
    x: 0.05,
    y: 0.05,
    width: 0.15,
  },
  // A label pinned over the recording area, sized by height.
  label: {
    path: 'assets/label.svg',
    durationMs: 1500,
    relativeTo: 'recording',
    x: 0.1,
    y: 0.8,
    height: 0.1,
  },
})
```

- `relativeTo: 'screen'` (the default) positions against the full output frame.
- `relativeTo: 'recording'` positions against the composited recording area (which may be inset when `renderOptions.recording.size < 1`).
- `x` and `y` are the top-left corner as fractions of the reference box. Both default to `0`.
- Provide one of `width` or `height`. The other is derived from the overlay's aspect ratio so it is never distorted. When neither is set, `width` defaults to `1`.

The default placement (no fields set) is therefore `{ relativeTo: 'screen', x: 0, y: 0, width: 1 }`, the full output width anchored at the top-left. For a full-frame overlay use `fullScreen: true`.

## Timing and control flow

Every controller supports two timing styles.

**Blocking** holds the overlay over a frozen frame for a fixed duration, then the
script continues:

```ts
await overlays.badge() // uses the config durationMs
await overlays.badge(2000) // or override the duration in milliseconds
```

**`start()` / `end()`** keeps the overlay on screen while the page keeps being
driven underneath, so it stays live over your real interactions:

```ts
await overlays.badge.start()
await page.click('#next')
await page.fill('#email', 'demo@example.com')
await overlays.badge.end()
```

Only one overlay is visible at a time. Starting a new overlay (with a blocking
call or `start()`) automatically ends the previous one.

Other timing notes:

- video overlays (`.mp4`) use the media file's natural duration and play at full volume unless `audio` is specified
- full-screen overlays take over the output frame
- overlays stay on top of the recording while the underlying screen continues

That means you do not need separate timing math just to line an intro clip up with the next step.

## File organization

A simple structure is usually enough:

```text
assets/
  intro.mp4
  transition.mp4
  callout.html
  badge.svg
  logo.png
```

Keep reusable brand assets separate from throwaway experiment files so the project stays readable.

## Authoring advice

- Use overlays sparingly.
- Mute overlays that should not compete with narration.
- Keep intros and transitions short.
- Prefer short `durationMs` values for image overlays so they do not stall the timeline longer than needed.
- Prefer consistent placement and sizing across videos in the same series.
