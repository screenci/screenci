# Overlays

Overlays let you place additional media on top of the recording timeline. Use them for intros, transitions, corner branding, callouts, or short contextual clips that would be awkward to build inside the browser automation itself.

An overlay can come from a file (`.html`, `.svg`, `.png`, or `.mp4`), a React element, an inline HTML fragment, or an inline config object. HTML (file or inline) and React elements are rendered to a transparent PNG at recording time and then behave exactly like an image overlay, or, with `animate: true`, are captured as a transparent animated clip (see [Animated overlays](#animated-overlays)).

Overlays can be owned by code or handed to [Studio](./studio.md) (the web app where non-developers swap the assets); see [the three ways to declare overlays](#three-ways-to-declare-overlays) below.

#### You will learn

- [how to declare overlays three ways](#three-ways-to-declare-overlays)
- [how to define overlays](#define-overlays)
- [how to position and size overlays](#positioning)
- [how blocking and start/end timing work](#timing-and-control-flow)
- [how to embed another render as an overlay](#render-dependencies)
- [how to organize files for maintainable projects](#file-organization)

## Three ways to declare overlays

There are three ways to declare overlays. The same three forms apply to [`narration`](./narration.md), [`values`](./values.md), and [`audio`](./audio.md). See the [Studio guide](./studio.md) for how the web editing works.

**1. Code-owned.** You point each overlay at a file, element, or config.

```ts
video.overlays({ logo: { path: 'assets/logo.png', x: 96, y: 96, width: 288 } })
```

**2. Studio-owned (blank).** Wrap the overlay names in `studio([...])`: the names exist in code (so the body can call `overlays.logo`), but [Studio](./studio.md) owns the files and display options.

```ts
import { video, studio } from 'screenci'

video.overlays(studio(['intro', 'logo']))
```

**3. Studio-owned (seeded).** Pass overlays to `studio({...})`: Studio starts from them but owns them, so an edit in Studio always wins over the seed.

```ts
video.overlays(studio({ logo: { path: 'assets/logo.png', width: 288 } }))
```

## Define overlays

`video.overlays(...)` takes a map. Each value is one of:

- a **file path** string (`.html`, `.svg`, `.png`, `.mp4`),
- a **React element**,
- a **config object** (`{ path | element | html, ...placement }`), or
- a **`selected(name)`** render dependency, which embeds another video or screenshot's output (see [Render dependencies](./dependencies.md)).

A config object draws its content from exactly one source: a file `path`, a React `element`, or an inline `html` fragment.

```tsx
import { video } from 'screenci'
import { Badge } from './Badge'

video.overlays({
  intro: { path: 'assets/intro.mp4', fill: 'screen' }, // full-frame video
  hint: 'assets/callout.html', // HTML file
  badge: <Badge label="New" />, // React element
  note: { html: '<div class="note">Tip</div>', x: 1340, y: 110, width: 380 }, // inline HTML
  logo: { path: 'assets/logo.png', x: 96, y: 96, width: 288 },
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

On the Business tier you can also declare overlay names by wrapping them in
`studio([...])` (imported from `screenci`) and upload the files plus display
options on the Studio page instead of keeping them in the repository:
`video.overlays(studio(['intro', 'logo']))`. This form leaves the file and
placement for each name configured in the ScreenCI web app. You can also seed the
web app with starting files and options by passing an object to `studio({...})`:
the web app starts from those values but owns them, so a seed is used only until
the overlay is edited in Studio. See
[Studio](./studio.md#studio-overlays-from-code).

For per-language overlay files (e.g. a translated badge image), see
[Languages](/docs/guides/languages).

Overlay files (`.png`, `.mp4`, `.svg`) are uploaded the first time you record
with them present and reused on later runs, so you do not have to commit the
files. If a file is missing locally, ScreenCI reuses the version uploaded for
this video (matched by the overlay's name). See
[Asset files do not need to be committed](/docs/ci-setup#asset-files-do-not-need-to-be-committed).

Rules:

- HTML, React, `.svg`, and `.png` overlays need a length: give them a relative `.for('1.2s')`, an absolute `.until('0:05')`/`.until('56%')`, a `duration` config string, or drive them with `start()`/`end()`. A bare `overlays.logo()` is invalid for these (it only works for a video or render dependency, which holds for its natural length).
- Image, HTML, and React overlays do not support `volume`.
- `.mp4` overlays may provide `volume` (a linear gain). `1` (the default) plays the source at its natural level, `0` mutes it, and values above `1` boost it (e.g. `2` is twice as loud, up to `4`).
- `.mp4` overlays use the file's natural duration and must not provide a `duration`.
- `.mp4` overlays may provide `speed` or `time` to play the clip (and its audio) faster or slower. `speed` is a multiplier (`2` plays it twice as fast, `0.5` at half speed); `time` is a target playback duration in ms (the clip is sped up or slowed down to play over exactly that long). Set at most one. This sets how long the (sped) clip plays for, since both a blocking call (`await overlays.intro()`) and a live `start()`/`end()` window play the clip out to its end; later content shifts to make room. Use it (or trimming) to make a clip run shorter. Image, HTML, and React overlays do not support `speed`/`time`.

### Cropping a file overlay

Image (`.svg`/`.png`) and video (`.mp4`) overlays accept a `crop` rectangle that selects a region of the **source file**, in the source's own pixels (top-left origin), just like Playwright's `page.screenshot({ clip })`. The cropped region is then placed and scaled like any other overlay. `crop` is not supported for `.html`/inline `html`/React `element`/`over` overlays.

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

### HTML and React overlays

You can build the same overlay three ways, and all of them honor the same
[placement](#positioning) fields (`x`, `y`, `width`/`height`, `relativeTo`),
`duration`, `animate`, `css`, and `capturePadding`:

- **An `.html` file** (`path`): authored in a separate file and passed like any
  other file path. The file contains the overlay markup body, not a full browser
  document; screenci reads the file and injects its contents into the same
  overlay wrapper used for inline `html`.
- **A React element** (`element`): passed straight in as JSX. `react` and
  `react-dom` are optional peer dependencies imported lazily, so installing
  screenci never pulls React into your project unless you actually use an
  element. `screenci init` offers to set this up for you (it installs
  `react`/`react-dom`, enables `"jsx": "react-jsx"` in the scaffolded
  `tsconfig.json`, and adds a `.tsx` example). To wire it up by hand, install the
  packages, set `"jsx": "react-jsx"` in your tsconfig, and author the overlay in
  a `.screenci.tsx` file.
- **An inline HTML fragment** (`html`): a string of plain HTML, with no React
  dependency and no separate file. Use it for small, one-off overlays you would
  rather keep next to the script.

```tsx
video.overlays({
  // From an .html file.
  hint: { path: 'assets/callout.html', x: 768, y: 864, width: 384 },
  // From a React element.
  badge: { element: <Badge label="New" />, x: 1340, y: 110, width: 288 },
  // From an inline HTML fragment.
  note: { html: '<div class="note">Saved</div>', x: 1340, y: 110, width: 380 },
})('Overview', async ({ page, overlays }) => {
  // ...
})
```

For both `.html` files and inline `html`, write a **single-rooted fragment**, not
a full document. screenci wraps your markup in its own document before
rasterizing, so do not include `<!doctype>`, `<html>`, `<head>`, or `<body>` tags
(a full document would nest documents and break the capture). Inline `html` is
validated and rejects those tags; `.html` file contents are read from disk and
wrapped the same way, so keep them to the same fragment shape even though the
file path variant is not pre-validated. The fragment must also contain exactly
one top-level element (wrap multiple nodes in one container), so it sizes and
positions predictably. Write only the content, exactly as you would inside a
React element:

```tsx
// Good: a single-rooted fragment.
{
  html: '<div class="badge"><span>New</span></div>'
}

// Rejected: a full document.
{
  html: '<!doctype html><html><body><div>New</div></body></html>'
}

// Rejected: two top-level elements. Wrap them in one container.
{
  html: '<div>New</div><div>!</div>'
}
```

The same fragment rule applies when the markup lives in a file:

```html
<!-- assets/callout.html -->
<div class="callout">Saved</div>
```

Because an `.html` overlay file is read and inserted into screenci's wrapper, it
is not loaded as a page URL from its own directory. Prefer inline styles, the
`css` option, `setOverlayCss`, or absolute/data URLs for referenced assets;
relative `<link>`, `<script>`, and `<img>` URLs are not resolved relative to the
`.html` file path.

To style a fragment with `className`, inject a stylesheet with `css` or
`setOverlayCss`, exactly as for `.html` files and React elements (see
[Styling with className](#styling-with-classname-and-tailwind)).

### Programmatic overlays (props)

Instead of a static value, an overlay can be a **factory** `(props) => config`.
The factory runs each time you call the overlay, so its content **and** its
placement can depend on values you only know at runtime. Call
`overlays.name(props)` to get a controller, then drive it the usual way
(`.for(...)`, `.until(...)`, `start()`, `end()`):

```tsx
video.overlays({
  // Props build the markup. Works for inline html (template literal)...
  note: (p: { text: string }) => ({
    html: `<div class="note">${p.text}</div>`,
    x: 1340,
    y: 110,
    width: 380,
  }),
  // ...and for React elements.
  badge: (p: { label: string }) => ({
    element: <Badge label={p.label} />,
    x: 1340,
    y: 110,
    width: 288,
  }),
})('Overview', async ({ page, overlays }) => {
  await overlays.note({ text: 'Saved' }).for('1.2s') // blocking, 1.2s

  // For start()/end(), capture the controller so the props appear once.
  const badge = overlays.badge({ label: 'New' })
  await badge.start()
  await page.click('#next')
  await badge.end()
})
```

This is how an overlay receives props: the factory closes over them and returns
the config. Calling the overlay (`overlays.badge({ label: 'New' })`) runs the
factory once and returns a controller; capture that controller and reuse it for
`start()` and `end()` rather than calling the overlay again, so the props appear
only once. To position an overlay over a live element, combine a factory with
[`overlayRect`](#positioning-over-a-live-element) below, which captures a
locator's position and spreads into the placement (and can be passed as a prop
so the component draws relative to the element, for example a circle around it).

> Rendered (HTML/React) and animated overlays are rasterized **after** the test
> body finishes, not inline while it runs. The resolved markup and parameters are
> captured during the test; overlays with identical content are then rasterized
> just once (and unchanged overlays are still served from a cross-run cache). You
> do not need to record the same overlay repeatedly.

### Animated overlays

By default an HTML or React overlay is captured as a single still frame. Set
`animate: true` to play its CSS/JS animation back in the video, with the
transparent background preserved. Only rendered overlays (HTML files, inline
`html` fragments, and React elements) can animate.

```tsx
video.overlays({
  // A React element that fades/slides in via CSS.
  intro: {
    element: <Intro />,
    animate: true,
    duration: '1.5s',
    fill: 'screen',
  },
  // An animated .html overlay, captured at 60fps.
  hint: {
    path: 'assets/callout.html',
    animate: true,
    duration: '1.2s',
    fps: 60,
  },
})('Overview', async ({ page, overlays }) => {
  await overlays.intro() // plays the 1.5s animation over a frozen frame
})
```

How the animation is triggered and how long it runs:

- **Trigger.** The animation starts from its first frame at the moment the
  overlay appears. Capture is deterministic (a virtual clock is advanced one
  frame at a time), so playback matches exactly what you author. Animate with
  `transform`/`opacity`; the overlay is captured at its initial layout box, so
  use `capturePadding` (below) to give the motion room.
- **Length.** You set the length explicitly: use `.for('2s')` on the call or set
  `duration` in the config. When you drive an animated overlay with
  `start()`/`end()`, `duration` is required in the config (the capture length is
  otherwise unknown). If the live window outlasts the clip, its last frame is
  held; if the clip outlasts the window, `end()` plays the remaining animation out
  over a frozen frame before the timeline continues.
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
import { video, setOverlayCss } from 'screenci'
import { readFileSync } from 'node:fs'

// Compile once (e.g. `npx @tailwindcss/cli -i in.css -o overlay.css`) and inject:
setOverlayCss(readFileSync('./assets/overlay.css', 'utf-8'))

video.overlays({
  badge: {
    element: (
      <div className="rounded-2xl bg-sky-500 px-6 py-4 text-white">New</div>
    ),
    duration: '1.5s',
  },
  // Or scope CSS to a single overlay:
  hint: { path: 'callout.html', css: '.callout{color:#fff}', duration: '1.5s' },
})('Overview', async ({ page, overlays }) => {
  // ...
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
video.overlays({
  intro: {
    element: <Intro />, // slides/rotates in
    animate: true,
    duration: '1.5s',
    capturePadding: 80, // room on every side for the motion
    width: 768, // placement sizes the padded box, so make it a bit wider
  },
})('Overview', async ({ page, overlays }) => {
  // ...
})
```

The placement sizes the _padded_ box, so widen it to keep the content the size
you want. `capturePadding` applies to static and animated HTML/React overlays.

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
  // The overlay is sized to the element's box; fill it (width/height: 100%).
  ring: (target: Locator) => ({
    html: '<div style="width:100%;height:100%;box-sizing:border-box;border:4px solid #ec4899;border-radius:12px"></div>',
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

`over` works with React elements, inline `html`, and `.html` files. It is always
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
Length-less overlays (image, inline `html`, React) end exactly at `end()`.

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
