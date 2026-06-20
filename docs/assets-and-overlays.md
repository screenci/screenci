# Overlays

Overlays let you place additional media on top of the recording timeline. Use them for intros, transitions, corner branding, callouts, or short contextual clips that would be awkward to build inside the browser automation itself.

An overlay can come from a file (`.html`, `.svg`, `.png`, or `.mp4`), a React element, or an inline config object. HTML files and React elements are rendered to a transparent PNG at recording time and then behave exactly like an image overlay, or, with `animate: true`, are captured as a transparent animated clip (see [Animated overlays](#animated-overlays)).

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
- `.mp4` overlays may provide `audio` (a linear gain). `1` (the default) plays the source at its natural level, `0` mutes it, and values above `1` boost it (e.g. `2` is twice as loud, up to `4`).
- `.mp4` overlays use the file's natural duration and must not provide `durationMs`.
- `.mp4` overlays may provide `speed` or `time` to play the clip (and its audio) faster or slower. `speed` is a multiplier (`2` plays it twice as fast, `0.5` at half speed); `time` is a target playback duration in ms (the clip is sped up or slowed down to play over exactly that long). Set at most one. For a blocking call (`await overlays.intro()`) this also changes how long the overlay holds, so later content shifts; for a live overlay (`start()`/`end()`) the window stays put and only the playback rate changes. Image, HTML, and React overlays do not support `speed`/`time`.

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

### Animated overlays

By default an HTML or React overlay is captured as a single still frame. Set
`animate: true` to play its CSS/JS animation back in the video, with the
transparent background preserved. Only HTML files and React elements can
animate.

```tsx
const overlays = createOverlays({
  // A React element that fades/slides in via CSS.
  intro: {
    element: <Intro />,
    animate: true,
    durationMs: 1500,
    fullScreen: true,
  },
  // An animated .html overlay, captured at 60fps.
  hint: {
    path: 'assets/callout.html',
    animate: true,
    durationMs: 1200,
    fps: 60,
  },
})

await overlays.intro() // plays the 1.5s animation over a frozen frame
```

How the animation is triggered and how long it runs:

- **Trigger.** The animation starts from its first frame at the moment the
  overlay appears. Capture is deterministic (a virtual clock is advanced one
  frame at a time), so playback matches exactly what you author. Animate with
  `transform`/`opacity`; the overlay is captured at its initial layout box, so
  use `capturePadding` (below) to give the motion room.
- **Length.** You set the length explicitly: pass it to the blocking call
  (`await overlays.intro(2000)`) or set `durationMs` in the config. When you
  drive an animated overlay with `start()`/`end()`, `durationMs` is required in
  the config (the capture length is otherwise unknown); if the live window
  outlasts the clip, its last frame is held.
- **`fps`** sets the capture frame rate (defaults to `30`) and only applies with
  `animate: true`.

Capturing many frames is heavier than a single screenshot, so prefer short
durations for full-screen animations.

### Styling with className (and Tailwind)

By default an HTML/React overlay only sees a tiny CSS reset, so utility classes
do nothing. Inject a stylesheet with the `css` option (per overlay) or
`setOverlayCss` (once, for all overlays) and then style with `className`. Pass
your **compiled** CSS, for example Tailwind's build output:

```tsx
import { createOverlays, setOverlayCss } from 'screenci'
import { readFileSync } from 'node:fs'

// Compile once (e.g. `npx @tailwindcss/cli -i in.css -o overlay.css`) and inject:
setOverlayCss(readFileSync('./assets/overlay.css', 'utf-8'))

const overlays = createOverlays({
  badge: {
    element: (
      <div className="rounded-2xl bg-sky-500 px-6 py-4 text-white">New</div>
    ),
    durationMs: 1500,
  },
  // Or scope CSS to a single overlay:
  hint: { path: 'callout.html', css: '.callout{color:#fff}', durationMs: 1500 },
})
```

Per-overlay `css` is merged after the global `setOverlayCss`. CSS injection
works for both static and animated HTML/React overlays. (The Tailwind Play CDN
is not supported: it relies on runtime JS that the deterministic capture clock
does not drive.)

### Giving animations room: `capturePadding`

Overlays are captured at their initial layout box, so an animation that
translates, scales, or rotates beyond that box would be clipped. Set
`capturePadding` (CSS px) to add transparent padding around the content so the
motion stays inside the captured frame, instead of building a manual "stage"
wrapper:

```tsx
const overlays = createOverlays({
  intro: {
    element: <Intro />, // slides/rotates in
    animate: true,
    durationMs: 1500,
    capturePadding: 80, // room on every side for the motion
    width: 0.4, // placement sizes the padded box, so make it a bit wider
  },
})
```

The placement sizes the _padded_ box, so widen it to keep the content the size
you want. `capturePadding` applies to static and animated HTML/React overlays.

## Positioning

Placement fields are flat on the config and each defaults independently.
Coordinates are normalized `0`-`1` fractions of a reference box, with the
overlay anchored at its top-left corner. This is resolution-independent: the
same placement renders correctly at 720p, 1080p, 4K, or vertical.

```tsx
const overlays = createOverlays({
  // Top-left badge sized to 15% of the recording width.
  badge: {
    path: 'assets/badge.png',
    durationMs: 1500,
    x: 0.05,
    y: 0.05,
    width: 0.15,
  },
  // A banner across the full output frame, sized by height.
  label: {
    path: 'assets/label.svg',
    durationMs: 1500,
    relativeTo: 'screen',
    x: 0.1,
    y: 0.8,
    height: 0.1,
  },
})
```

- `relativeTo: 'recording'` (the default) positions against the composited recording area (which may be inset when `renderOptions.recording.size < 1`). Because the recording's final size is chosen later in the studio, a recording-relative box stays correct whatever output size you settle on.
- `relativeTo: 'screen'` positions against the full output frame.
- `x` and `y` are the top-left corner as fractions of the reference box. Both default to `0`.
- Provide one of `width` or `height`. The other is derived from the overlay's aspect ratio so it is never distorted. When neither is set, `width` defaults to `1`.

The default placement (no fields set) is therefore `{ relativeTo: 'recording', x: 0, y: 0, width: 1 }`, the recording area filled edge to edge. For a full-frame overlay use `fullScreen: true`.

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

Overlays can overlap. Several can be live at the same time, and a blocking
overlay can run while others stay live, so you can layer them freely:

```ts
await overlays.badge.start()
await overlays.logo.start() // both live now
await page.click('#next')
await overlays.tip(1500) // blocking overlay, badge and logo stay composited
await overlays.badge.end() // end each one independently, in any order
await overlays.logo.end()
```

Every overlay you `start()` must be `end()`ed before the video function returns,
and the same overlay cannot be started twice without ending it in between.
Leaving an overlay open, or restarting one that is already live, raises an error.

Narration runs independently of overlays, so you can narrate while an overlay is
on screen.

Other timing notes:

- video overlays (`.mp4`) use the media file's natural duration and play at their natural level (`audio` defaults to `1`); set `audio` to mute (`0`) or boost (above `1`, up to `4`)
- full-screen overlays take over the output frame
- overlays stay on top of the recording while the underlying screen continues

That means you do not need separate timing math just to line an intro clip up with the next step.

## Background music and audio

Overlays are visual. For sound that plays _under_ the recording (and any
narration), use `createAudio`. It takes a map of named tracks, each a file path
or a config object, and accepts `.mp3`, `.wav`, `.m4a`, `.aac`, or an
audio-only `.mp4`:

```ts
import { createAudio, video } from 'screenci'

const music = createAudio({
  theme: { path: 'assets/bg.mp3', volume: 0.3, repeat: true },
  sting: 'assets/celebrate.wav',
})

video('Overview', async ({ page }) => {
  await music.theme() // plays under the whole video, looping to fill
  await page.goto('/dashboard')

  await music.sting.start() // bound a track to a span
  await page.click('#celebrate')
  await music.sting.end()
})
```

Options:

- `volume` is a linear gain. `1` (the default) is the source's natural level,
  `0` is silent, and values above `1` boost it (e.g. `2` is twice as loud, up to
  `4`). Lower it (for example `0.2`-`0.4`) so music sits under narration.
- `repeat: true` loops a short track to fill its span. Omit it (the default) to
  play the source once and then fall silent.
- `speed` or `time` play the track faster or slower. `speed` is a multiplier
  (`2` plays it twice as fast, `0.5` at half speed); `time` is a target playback
  duration in ms (the source is sped up or slowed down to play over exactly that
  long). Set at most one. The track keeps its span and never shifts the
  recording: only the source is consumed faster or slower.

Timing:

- A bare call (`await music.theme()`) starts the track at that point and plays it
  for the **rest of the video**.
- `start()` / `end()` bound a track to a specific span, without freezing a frame.
- Tracks are **non-exclusive**: starting one never stops another, so music and a
  sound effect can overlap. Each track also runs independently of narration.

Unlike overlays, audio tracks have no placement and never hold a frozen frame:
they simply mix into the soundtrack.

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
