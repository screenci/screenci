# Overlays

Overlays let you place additional media on top of the recording timeline. Use them for intros, transitions, corner branding, callouts, or short contextual clips that would be awkward to build inside the browser automation itself.

An overlay always comes from a **file `path`**, and the extension selects what it is:

- **`.tsx`** — a full React page rendered client-side in the browser (hooks, effects, class lifecycle all run). The only variant that accepts `props`. See [.tsx and .html page overlays](#tsx-and-html-page-overlays).
- **`.html`** — a full standalone HTML document, loaded as-is (its own `<style>`/`<script>` run).
- **`.svg` / `.png`** — an image.
- **`.mp4`** — a video.

A `.tsx` or `.html` page is rendered to a transparent PNG at recording time and then behaves exactly like an image overlay, or, with `animate: true`, is captured as a transparent animated clip (see [Animated overlays](#animated-overlays)).

Overlays can be owned by code or handed to [Editor](./editor.md) (the web app where non-developers swap the assets); see [the three ways to declare overlays](#three-ways-to-declare-overlays) below.

#### You will learn

- [how to declare overlays (code- or Editor-owned)](#three-ways-to-declare-overlays)
- [how to define overlays](#define-overlays)
- [how to position and size overlays](#positioning)
- [how blocking and start/end timing work](#timing-and-control-flow)
- [how to embed another render as an overlay](#render-dependencies)
- [how to organize files for maintainable projects](#file-organization)

## Three ways to declare overlays

There are three ways to declare overlays. The same three forms apply to [`narration`](./narration.md), [`values`](./values.md), and [`audio`](./audio.md). See the [Editor guide](./editor.md) for how the web editing works.

**1. Code-owned.** You point each overlay at a file, element, or config.

```ts
video.overlays({ logo: { path: 'assets/logo.png', x: 96, y: 96, width: 288 } })
```

**2. Editor-owned (blank).** Wrap the overlay names in `editable([...])`: the names exist in code (so the body can call `overlays.logo`), but [Editor](./editor.md) owns the files and display options.

```ts
import { video, editable } from 'screenci'

video.overlays(editable(['intro', 'logo']))
```

**3. Editor-owned (seeded).** Pass overlays to `editable({...})`: Editor starts from them but owns them, so an edit in Editor always wins over the seed.

```ts
video.overlays(editable({ logo: { path: 'assets/logo.png', width: 288 } }))
```

## Define overlays

`video.overlays(...)` takes a map. Each value is one of:

- a **file path** string (`.tsx`, `.html`, `.svg`, `.png`, `.mp4`),
- a **config object** (`{ path, ...placement }`, plus `props` for a `.tsx` page),
- a **factory** `(props) => config` (see [Programmatic overlays](#programmatic-overlays-props)), or
- a **`selected(name)`** render dependency, which embeds another video or screenshot's output (see [Render dependencies](./dependencies.md)).

Content always comes from `path`; the extension selects the variant. Only a `.tsx` page accepts `props`; only `.mp4`/image files accept the video/crop fields.

```tsx
import { video } from 'screenci'

video.overlays({
  intro: { path: 'assets/intro.mp4', fill: 'screen' }, // full-frame video
  hint: 'assets/callout.html', // full HTML page
  badge: {
    path: 'overlays/Badge.tsx',
    props: { label: 'New' },
    x: 1340,
    y: 110,
  }, // React page
  logo: { path: 'assets/logo.png', x: 96, y: 96, width: 288 }, // image
})('Overview', async ({ page, overlays }) => {
  await overlays.intro()
  await page.goto('/dashboard')
  await overlays.logo.for('1.2s')
})
```

`video.overlays({...})` returns a builder you call with the usual
`(title, body)` arguments. Each key becomes a callable overlay controller,
delivered to the body through the injected `overlays` fixture. The same pattern
works for screenshots:
`screenshot.overlays({...})('Title', async ({ page, crop, overlays }) => {...})`.

You can also declare overlay names by wrapping them in `editable([...])`
(imported from `screenci`) and upload the files plus display options on the
Editor page instead of keeping them in the repository:
`video.overlays(editable(['intro', 'logo']))`. This form leaves the file and
placement for each name configured in the ScreenCI web app. You can also seed the
web app with starting files and options by passing an object to `editable({...})`:
the web app starts from those values but owns them, so a seed is used only until
the overlay is edited in Editor. See
[Editor](./editor.md#editor-overlays-from-code).

For per-language overlay files (e.g. a translated badge image), see
[Languages](/docs/guides/languages).

Overlay files (`.png`, `.mp4`, `.svg`) are uploaded the first time you record
with them present and reused on later runs, so you do not have to commit the
files. If a file is missing locally, ScreenCI reuses the version uploaded for
this video (matched by the overlay's name). See
[Asset files do not need to be committed](/docs/ci-setup#asset-files-do-not-need-to-be-committed).

Rules:

- `.tsx`, `.html`, `.svg`, and `.png` overlays need a length: give them a relative `.for('1.2s')` / `.for(1200)`, an absolute `.until('0:05')`/`.until('56%')`, a `duration` config string or millisecond number, or drive them with `start()`/`end()`. A bare `overlays.logo()` is invalid for these (it only works for a video or render dependency, which holds for its natural length).
- `.tsx`, `.html`, and image overlays do not support `volume`.
- `.mp4` overlays may provide `volume` (a linear gain). `1` (the default) plays the source at its natural level, `0` mutes it, and values above `1` boost it (e.g. `2` is twice as loud, up to `4`).
- `.mp4` overlays use the file's natural duration and must not provide a `duration`.
- `.mp4` overlays may provide `speed` or `time` to play the clip (and its audio) faster or slower. `speed` is a multiplier (`2` plays it twice as fast, `0.5` at half speed); `time` is a target playback duration in ms (the clip is sped up or slowed down to play over exactly that long). Set at most one. This sets how long the (sped) clip plays for, since both a blocking call (`await overlays.intro()`) and a live `start()`/`end()` window play the clip out to its end; later content shifts to make room. Use it (or trimming) to make a clip run shorter. `.tsx`, `.html`, and image overlays do not support `speed`/`time`.

### Cropping a file overlay

Image (`.svg`/`.png`) and video (`.mp4`) overlays accept a `crop` rectangle that selects a region of the **source file**, in the source's own pixels (top-left origin), just like Playwright's `page.screenshot({ clip })`. The cropped region is then placed and scaled like any other overlay. `crop` is not supported for `.tsx`/`.html` page overlays.

```ts
const overlays = createOverlays({
  // Show only the left panel of a wide screen recording.
  panel: { path: 'demo.mp4', crop: { x: 0, y: 0, width: 960, height: 1080 } },
  // Crop a badge out of a sprite sheet and place it top-right.
  badge: {
    path: 'sprites.png',
    crop: { x: 128, y: 0, width: 96, height: 96 },
    x: 1740,
    y: 64,
    width: 96,
  },
})
```

`x`, `y` must be `>= 0` and `width`, `height` `> 0`.

### Trimming a video overlay (`start` / `end`)

`.mp4` overlays accept `start` and `end` time strings to play only a slice of the source: a late start and/or an early end. Both are absolute positions in the **source clip**, expressed as a time string: `'2s'`/`'1.5s'`, a `'0:02'`/`'0:02.5'` timecode, or `'50%'` of the source duration. `start` must come before `end`. Trimming shortens how long the overlay occupies the timeline (before any `speed`/`time`).

```ts
const overlays = createOverlays({
  // Play seconds 2 through the halfway point of the source clip.
  clip: { path: 'demo.mp4', start: '0:02', end: '50%' },
})
```

`start`/`end` apply to `.mp4` overlays only (images have no timeline).

### .tsx and .html page overlays

A custom overlay is a full page you author, in one of two forms:

- **A `.tsx` page** (`path` ends in `.tsx`): a module that default-exports a React
  component, rendered **client-side in the browser** during capture. The full
  React runtime runs, so hooks and effects, class components with lifecycle and
  state, inline styles, and `className` all work. It is the only overlay that
  accepts **`props`**. screenci bundles it with `esbuild` (an optional peer
  dependency, resolved from your project's `react`/`react-dom`).
- **A `.html` page** (`path` ends in `.html`): a complete standalone HTML
  document, loaded as-is. Its own `<style>` and `<script>` run (the script is
  advanced by the virtual clock when `animate: true`).

Both render to a transparent PNG (or, with `animate: true`, an animated clip),
then place exactly like an image overlay.

```tsx
video.overlays({
  // A React page, parameterized by props.
  badge: {
    path: './overlays/Badge.tsx',
    props: { label: 'New' },
    x: 1340,
    y: 96,
    width: 240,
  },
  // A full HTML page.
  hint: { path: './overlays/callout.html', x: 768, y: 864, width: 384 },
})('Overview', async ({ overlays }) => {
  await overlays.badge.for('1.5s')
  await overlays.hint.for('1.2s')
})
```

**Transparent background.** A page overlay owns its whole document, so make its
background transparent (otherwise it paints an opaque rectangle over the
recording):

```html
<!-- callout.html -->
<!doctype html>
<html>
  <head>
    <style>
      html,
      body {
        margin: 0;
        background: transparent;
      }
      .callout {
        /* ... */
      }
    </style>
  </head>
  <body>
    <div class="callout">Saved</div>
  </body>
</html>
```

A `.tsx` page's generated host document is already transparent; just avoid an
opaque root element.

**Sizing.** The overlay is captured content-sized: screenci screenshots the
element with `id="screenci-overlay-root"` if the page has one, else the document
`<body>`. A `.tsx` page mounts into that root for you. For a `.html` page, wrap
your content in `<div id="screenci-overlay-root">…</div>` for tight sizing (or
let it fall back to the body box). The `width`/`height` placement then scales that
captured image onto the frame, so the output size never has to be known when you
author.

**A `.tsx` page is a full React component.** Author it exactly as you would an app
component: import React, hooks, helpers, child components. Only serializable
`props` cross into it (they are JSON-encoded), so pass plain data, not functions
or elements.

```tsx
// overlays/Counter.tsx — hooks and effects run during capture
import { useEffect, useState } from 'react'

export default function Counter({ to }: { to: number }) {
  const [n, setN] = useState(0)
  useEffect(() => {
    const start = Date.now()
    let raf = 0
    const tick = () => {
      const t = Math.min(1, (Date.now() - start) / 2000)
      setN(Math.round(t * to))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [to])
  return <div className="counter">{n}</div>
}
```

```tsx
// the recording
video.overlays({
  counter: {
    path: './overlays/Counter.tsx',
    props: { to: 100 },
    animate: true,
    duration: '2s',
  },
})('Overview', async ({ overlays }) => {
  await overlays.counter() // counts 0 -> 100 over 2s
})
```

Class components work identically (`this.props`, `this.state`,
`componentDidMount`, etc.). A `.tsx` page needs `react`, `react-dom`, and
`esbuild` installed in your project.

### Programmatic overlays (props)

Instead of a static value, an overlay can be a **factory** `(props) => config`.
The factory runs each time you call the overlay, so its `path`, `props`, and
placement can depend on values you only know at runtime. Call `overlays.name(...)`
to get a controller, then drive it the usual way (`.for(...)`, `.until(...)`,
`start()`, `end()`):

```tsx
video.overlays({
  // Props select the .tsx page's content and its placement.
  badge: (p: { label: string; x: number }) => ({
    path: './overlays/Badge.tsx',
    props: { label: p.label },
    x: p.x,
    y: 110,
    width: 288,
  }),
})('Overview', async ({ page, overlays }) => {
  await overlays.badge({ label: 'Saved', x: 1340 }).for('1.2s')

  // For start()/end(), capture the controller so the props appear once.
  const badge = overlays.badge({ label: 'New', x: 1340 })
  await badge.start()
  await page.click('#next')
  await badge.end()
})
```

To position an overlay over a live element, combine a factory with an `over`
locator (see [Positioning over a live element](#positioning-over-a-live-element)):
screenci reads the element's box at recording time and sizes the overlay to it.

> Page overlays are rasterized **after** the test body finishes, not inline while
> it runs. The resolved page (and, for `.tsx`, its bundle and props) is captured
> during the test; overlays with identical content are then rasterized just once
> (and unchanged overlays are served from a cross-run cache). You do not need to
> record the same overlay repeatedly.

### Animated overlays

By default a page overlay is captured as a single still frame. Set `animate: true`
to play its animation back in the video, with the transparent background
preserved.

```tsx
video.overlays({
  // A .tsx page whose effect/CSS animates in.
  intro: {
    path: './overlays/Intro.tsx',
    animate: true,
    duration: '1.5s',
    fill: 'screen',
  },
  // An animated .html page, captured at 60fps.
  hint: {
    path: './overlays/callout.html',
    animate: true,
    duration: '1.2s',
    fps: 60,
  },
})('Overview', async ({ overlays }) => {
  await overlays.intro() // plays the 1.5s animation over a frozen frame
})
```

How the animation is driven and how long it runs:

- **Deterministic clock.** Capture advances a virtual clock one frame at a time,
  so everything time-based is reproducible: CSS animations/transitions, and a
  page's `setTimeout`/`setInterval`, `requestAnimationFrame`, `Date.now()`/
  `performance.now()`, and the Web Animations API (including React effects in a
  `.tsx` page). Schedule an edit at `t` ms and it lands on the matching frame,
  every run.
- **Length.** You set the length explicitly: use `.for('2s')` on the call or set
  `duration` in the config. When you drive an animated overlay with
  `start()`/`end()`, `duration` is required in the config (the capture length is
  otherwise unknown). If the live window outlasts the clip, its last frame is
  held; if the clip outlasts the window, `end()` plays the remaining animation out
  over a frozen frame before the timeline continues.
- **`fps`** sets the capture frame rate (defaults to `30`) and only applies with
  `animate: true`.
- **Reserve room for growth.** The overlay is captured at its initial layout box.
  If the animation grows the content (adds lines, expands a panel) or moves beyond
  its box (a `transform` that translates/scales out), size the page's root to its
  final dimensions up front (or add your own padding), so nothing is clipped.
  Animating `transform`/`opacity` within the box is free.

Capturing many frames is heavier than a single screenshot, so prefer short
durations for full-screen animations.

## Positioning

Placement fields are flat on the config and each defaults independently.
Coordinates are **CSS pixels of the recording viewport**, the same space
Playwright's `boundingBox()`, `page.mouse`, and `viewportSize()` use, with the
overlay anchored at its top-left corner. The renderer maps these recording-viewport
pixels into the final output frame, so the output size never has to be known when
you author: the same placement renders correctly at 720p, 1080p, 4K, or vertical.

```tsx
video.overlays({
  // Top-left badge, 288 px wide (on a 1920x1080 recording).
  badge: {
    path: 'assets/badge.png',
    duration: '1.5s',
    x: 96,
    y: 96,
    width: 288,
  },
  // A banner across the full output frame, sized by height.
  label: {
    path: 'assets/label.svg',
    duration: '1.5s',
    relativeTo: 'screen',
    x: 192,
    y: 864,
    height: 108,
  },
})('Overview', async ({ page, overlays }) => {
  // ...
})
```

- `relativeTo: 'recording'` (the default) positions against the composited recording area (which may be inset when `renderOptions.recording.size < 1`). Pixels are measured in the recording viewport, so the box stays correct whatever output size you settle on later in the studio.
- `relativeTo: 'screen'` positions against the full output frame, using the same recording-pixel scale measured from the output's top-left.
- `x` and `y` are the top-left corner in CSS px. Both default to `0`.
- Provide one of `width` or `height` (in CSS px). The other is derived from the overlay's intrinsic aspect ratio (or from `aspectRatio`, given as `width / height`) so it is never distorted.

When no placement field is set, the overlay fills the recording area (the renderer resolves this, since it knows the recording size). To fill explicitly, set `fill`: `'recording'` fills the recording area (the same as omitting placement), and `'screen'` fills the entire output frame.

### Overlays and zoom (`pinToScreen`)

By default an overlay is "burned" into the scene: when the camera zooms or pans (a `zoomTo`, an auto-zoom, or a `selected()` clip's own motion), the overlay moves and scales with the recording underneath it. So a ring placed `over` an element stays glued to that element as you zoom into it, and a badge anchored to part of the recording tracks that part.

Set `pinToScreen: true` to keep an overlay stuck to the screen instead: it holds a fixed position and size in the output frame, unaffected by zoom. Use it for HUD-style elements that should stay put, such as a persistent corner logo or a watermark-like badge:

```tsx
video.overlays({
  // Stays in the corner at a fixed size, even while the recording zooms.
  cornerLogo: (p: { x: number; y: number }) => ({
    path: 'assets/logo.png',
    relativeTo: 'screen',
    x: p.x,
    y: p.y,
    width: 120,
    pinToScreen: true,
  }),
})('Overview', async ({ page, overlays }) => {
  // ...
})
```

`pinToScreen` is orthogonal to placement: it works with `relativeTo: 'recording'` / `'screen'`, a `fill` overlay, or an `over` element. It only affects how the overlay behaves under zoom (whether it is burned into the scene or fixed to the screen).

### Drawing above the cursor (`overMouse`)

Set `overMouse: true` to draw an overlay **above** the mouse cursor, so the cursor passes underneath it instead of on top. The cursor stays visible everywhere else in the frame; only where the overlay sits does the overlay cover it. This is handy for full-screen intro or outro cards (the cursor disappears behind the card) and for HUD elements like a corner logo the cursor should slide under:

```tsx
video.overlays({
  logo: {
    path: 'assets/logo.png',
    fill: 'screen',
    duration: '2s',
    overMouse: true,
  },
})('Product demo', async ({ page, overlays }) => {
  // The cursor slides under the 2s card, then sits on top again for the walkthrough.
  await overlays.logo.for('2s')
  // ...
})
```

`overMouse` works for both blocking overlays (`.for()` / `.until()`) and live overlays driven with `start()` / `end()`. It is placement-agnostic, so it applies to every overlay variant. A few details:

- The overlay keeps its placement: a `pinToScreen` overlay stays fixed in screen space, a burned overlay still moves and scales with the camera during zoom. `overMouse` only changes its stacking order relative to the cursor.
- Overlapping `overMouse` overlays each draw above the cursor.
- It has no effect on screenshots, whose cursor is hidden by default (see `renderOptions.screenshot.mouse.show`).

### Positioning over a live element

To frame or circle a real element, give a [programmatic overlay](#programmatic-overlays-props)
an `over` locator (and an optional `margin` in CSS px). screenci reads the
element's box at recording time, sizes the overlay to it (plus the margin), and
positions it over the element. Your overlay content fills that box, so a ring
lands exactly around the element:

```tsx
import type { Locator } from '@playwright/test'
import { video } from 'screenci'

video.overlays({
  // A .html page whose content fills the element's box (width/height: 100%).
  ring: (target: Locator) => ({
    path: './overlays/ring.html',
    over: target,
    margin: 8, // optional breathing room around the element
  }),
})('Overview', async ({ page, overlays }) => {
  const save = page.getByRole('button', { name: 'Save' })
  const ring = overlays.ring(save) // capture the controller, then drive it
  await ring.start()
  await save.click()
  await ring.end()
})
```

```html
<!-- overlays/ring.html -->
<!doctype html>
<html>
  <head>
    <style>
      html,
      body {
        margin: 0;
        background: transparent;
      }
      .ring {
        width: 100%;
        height: 100%;
        box-sizing: border-box;
        border: 4px solid #ec4899;
        border-radius: 12px;
      }
    </style>
  </head>
  <body>
    <div class="ring"></div>
  </body>
</html>
```

`over` works with `.tsx` and `.html` page overlays. It is always
recording-relative and overrides `x`/`y`/`width`/`height`/`relativeTo`/`fill`.
Make the content fill its box (`width:100%;height:100%`). Repeated calls with the
same element box rasterize only once.

Add [`animate: true`](#animated-overlays) and the ring plays its CSS animation
back in the video while the page keeps being driven underneath. Here is that same
margin ring, pulsing around a live element (the
[Screenshots guide](/docs/guides/screenshots#highlight-a-locator) shows the
still version):

<!-- screenci-doc-video:docs/guides/overlays -->

#### `overlayRect` (lower-level)

If you need the element's coordinates yourself (for example to pass into a
component that draws relative to the element), call `overlayRect(locator, opts?)`.
It returns the box in CSS px of the recording viewport:

```tsx
const rect = await overlayRect(page.getByRole('button', { name: 'Save' }), {
  margin: 8,
})
// rect.x / rect.y / rect.width are CSS px; rect.pixels -> the full CSS-px box.
// Top-level relativeTo/x/y/width spread into a placement: { ...rect }
```

Options: `margin` (px around the element), `dimension` (`'width'` by default, or
`'height'` to expose that axis at the top level), and `relativeTo` (`'recording'`
by default; `'screen'` is only meaningful when the recording fills the output
frame). Make sure the element is visible first; it throws if the locator has no
box.

## Timing and control flow

Every controller supports two timing styles.

**Blocking** holds the overlay over a frozen frame for a fixed duration, then the
script continues:

```ts
await overlays.badge() // uses the config duration
await overlays.badge.for('2s') // or override the duration
```

**Until a position** keeps the overlay on a frozen frame until an absolute point
in the finished video, instead of a relative duration. Pass a string position:

```ts
await overlays.tip.until('0:10') // visible until 10 seconds in
await overlays.tip.until('2s') // seconds (fractions allowed: '5.51s')
await overlays.tip.until('1:02:03.5') // h:mm:ss(.f) timecode
await overlays.tip.until('56%') // until 56% through the video
```

Positions are resolved against the finished render, so they line up with the
actual video. Supported for image, HTML, and React (static) overlays, and for
embedded-render overlays. They are not supported for `.mp4` or animated overlays,
whose length is fixed (use `start()`/`end()` for those). A position at or before
where the overlay appears is ignored with a warning.

**`start()` / `end()`** keeps the overlay on screen while the page keeps being
driven underneath, so it stays live over your real interactions:

```ts
await overlays.badge.start()
await page.click('#next')
await page.fill('#email', 'demo@example.com')
await overlays.badge.end()
```

For an overlay with an intrinsic length (a `.mp4` video, an embedded video
dependency, or an [animated](#animated-overlays) HTML/React clip), `end()` lets
the clip finish: if the media is longer than the live window, the remainder plays
out over a frozen frame before the timeline continues, so the clip is never cut
short by ending early. To show less of such a clip, trim it (`start`/`end`,
`speed`/`time`, or `selected(..., { end })`) instead of calling `end()` sooner.
Length-less overlays (image, `.html`, `.tsx`) end exactly at `end()`.

Overlays can overlap. Several can be live at the same time, and a blocking
overlay can run while others stay live, so you can layer them freely:

```ts
await overlays.badge.start()
await overlays.logo.start() // both live now
await page.click('#next')
await overlays.tip.for('1.5s') // blocking overlay, badge and logo stay composited
await overlays.badge.end() // end each one independently, in any order
await overlays.logo.end()
```

Every overlay you `start()` must be `end()`ed before the video function returns,
and the same overlay cannot be started twice without ending it in between.
Leaving an overlay open, or restarting one that is already live, raises an error.

Narration runs independently of overlays, so you can narrate while an overlay is
on screen.

Other timing notes:

- video overlays (`.mp4`) use the media file's natural duration and play at their natural level (`volume` defaults to `1`); set `volume` to mute (`0`) or boost (above `1`, up to `4`)
- full-screen overlays take over the output frame
- overlays stay on top of the recording while the underlying screen continues

That means you do not need separate timing math just to line an intro clip up with the next step.

## Render dependencies

Instead of a file, an overlay value can be `selected(name)`, which embeds another video or screenshot's rendered output as the overlay. Use it to reuse a separately-maintained intro clip or logo still across many renders and keep them in sync: when the embedded render's selection changes, every render that depends on it re-renders automatically.

```ts
import { video, selected } from 'screenci'

video.overlays({ intro: selected('Intro Clip') })(
  'Full Demo',
  async ({ page, overlays }) => {
    await overlays.intro() // embeds the "Intro Clip" render
    await page.goto('/dashboard')
  }
)
```

A `selected(...)` overlay is driven and positioned like any other overlay, but reads no local file: the medium and concrete output are resolved by the service at render time. Screenshots may only embed other screenshots; videos may embed either, one level deep. Render dependencies are a Business tier feature.

See [Render dependencies](./dependencies.md) for the full guide: declaring dependencies, selection and automatic re-renders, the waiting state, language matching, and edge cases.

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
- Prefer short `.for(...)` (or `duration`) values for image overlays so they do not stall the timeline longer than needed.
- Prefer consistent placement and sizing across videos in the same series.
