# Overlays

Overlays let you place additional media on top of the recording timeline. Use them for intros, transitions, corner branding, callouts, or short contextual clips that would be awkward to build inside the browser automation itself.

An overlay's content comes from **exactly one source**: a file `path`, an inline React `element`, inline `jsx`/`solidJsx` component source, or an inline `html` fragment.

For a file `path`, the extension selects what it is:

- **`.tsx`**: a React component module rendered client-side in the browser (hooks, effects, class lifecycle all run). See [Component page overlays](#component-and-html-page-overlays).
- **`.solid.tsx`**: a Solid component module, same treatment with Solid's compiler.
- **`.vue`**: a Vue single-file component (its `<style>` block included).
- **`.svelte`**: a Svelte component (its `<style>` block included).
- **`.html`**: a full standalone HTML document, loaded as-is (its own `<style>`/`<script>` run).
- **`.svg` / `.png`**: an image.
- **`.mp4`**: a video.

The inline variants keep small overlays in the recording file itself (see [Inline overlays](#inline-overlays)):

- **`element`**: a React element (`element: <Badge label="New" />`), rendered in-process to static markup.
- **`jsx` / `solidJsx`**: the source of a component module as a string, bundled and mounted client-side like a `.tsx`/`.solid.tsx` file.
- **`html`**: an HTML fragment placed in the overlay root.

Every rendered variant (everything except image/video files) is rendered to a transparent PNG at recording time and then behaves exactly like an image overlay, or, with `animate: true`, is captured as a transparent animated clip (see [Animated overlays](#animated-overlays)).

Overlays can be owned by code or handed to Editor (the web app where non-developers swap the assets); see [the two ways to declare overlays](#two-ways-to-declare-overlays) below.

#### You will learn

- [how to declare overlays (code values or Editor-owned)](#two-ways-to-declare-overlays)
- [how to make overlays look like the product](#designing-overlays)
- [how to define overlays](#define-overlays)
- [how to position and size overlays](#positioning)
- [how blocking and start/end timing work](#timing-and-control-flow)
- [how to organize files for maintainable projects](#file-organization)

## Two ways to declare overlays

There are two ways to declare overlays, and both are editable in the web app. The same two forms apply to [`narration`](./narration.md).

**1. Code values.** You point each overlay at a file, element, or config. The code values are used until the overlay is edited in Editor, and from then on the Editor value wins.

```ts
video.overlays({ logo: { path: 'assets/logo.png', x: 96, y: 96, width: 288 } })
```

**2. Editor-owned (blank).** Pass a bare array of overlay names: the names exist in code (so the body can call `overlays.logo`), but Editor owns the files and display options.

```ts
import { video } from 'screenci'

video.overlays(['intro', 'logo'])
```

You can also mark a single overlay as editor-owned inside a map with `{ editor: '<name>' }`. The overlay is an explicit part of the video (unlike a whole-array declaration), but its uploaded file lives in the ScreenCI backend, not in a local file. The `editor` string names the backend asset (conventionally the same as the key). Upload the file in the editor, then reference it from the script with this form.

```ts
video.overlays({
  logo: { editor: 'logo' }, // backend-hosted, uploaded in the editor
  hint: { path: 'assets/callout.html' }, // local file
})
```

**3. A shared branding asset.** Pass `{ branding: '<name>' }` to use an image or
video from the [Branding](./branding.md) page. The name is a live reference: the
export resolves it to whatever file the Branding page holds then, so replacing
the logo there updates every video that uses it on its next export. Nothing is
uploaded from your machine.

```ts
video.overlays({
  logo: { branding: 'logo', x: 1560, y: 960, width: 288 },
  intro: { branding: 'intro-clip', fill: 'screen' },
})
```

A branding **image** needs a length (`duration`, `.for()`, `.until()`, or a live
`start()`/`end()` window); a branding **video** plays its own length and takes
the video options (`volume`, `speed`, `time`, `start`, `end`). `over` is not
available: a stored file has no live element to size against. A name that is not
on the Branding page fails the record before the upload, and an export whose
asset was deleted fails with the same message rather than quietly dropping the
overlay.

## Designing overlays

An overlay is rendered by a real browser and burned in as pixels, so anything CSS can draw, an overlay can draw. The overlays that look professional follow a few rules, and coding agents that write videos for you follow the same ones (they are part of the ScreenCI skill).

**Build shapes with HTML/CSS or React, not hand-drawn SVG.** Rings, pills, pointers, and dimmed backdrops are `border`, `border-radius`, `box-shadow`, gradients, and a rotated square for an arrow head. Hand-written `<svg>` path data is hard to keep consistent and rarely matches the product. If the app ships an icon library the overlay can import, use it; otherwise use text.

**Take colours, radius, and font from the recorded app.** Read its CSS variables, Tailwind config, or theme file and put the values in one shared file, `recordings/assets/theme.ts`. Every overlay imports it, so a rebrand is one edit. (A `.html` page overlay is loaded as a standalone document with no base URL, so it cannot link a stylesheet: without React, keep the same values as a `:root` variables block pasted into each page.) Leave `font-family` as `inherit` unless the app's font is installed on the recording machine: the overlay host page already carries a clean sans-serif stack.

```ts
// recordings/assets/theme.ts (values from the recorded app's own theme)
export const theme = {
  accent: '#2563eb',
  accentSoft: 'rgba(37, 99, 235, 0.18)',
  surface: '#0f172a',
  text: '#f8fafc',
  radius: 12,
  ringWidth: 3,
  calloutWidth: 320, // labels render and place at this width (no scaling)
  fontFamily: 'inherit',
} as const
```

**One shared set of overlay files per project.** Keep components in `recordings/assets/` and parameterise them with `props` (`Callout.tsx` with a `text` prop) instead of copying a file per video. Every video in the project then shares the same ring width, radius, margin, fade, and label size, and recurring elements sit in the same place.

**Respect what the renderer captures.** With `over`, the page is sized to the element's box and only that box is captured, so the content fills it (`width: 100%; height: 100%`) and a label cannot hang outside. For a label beside an element, read the box with [`overlayRect`](#overlayrect-lower-level) and place the overlay with explicit `x`/`y`/`width`:

```tsx
// recordings/assets/Callout.tsx
import { theme } from './theme'

export default function Callout({ text }: { text: string }) {
  return (
    <div
      style={{
        // Rendered at the same width the placement uses, so the capture is
        // placed 1:1 instead of being scaled.
        width: theme.calloutWidth,
        boxSizing: 'border-box',
        padding: '10px 16px',
        borderRadius: theme.radius,
        background: theme.surface,
        color: theme.text,
        fontFamily: theme.fontFamily,
        fontSize: 20,
        fontWeight: 600,
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.25)',
      }}
    >
      {text}
    </div>
  )
}
```

```ts
import type { OverlayRect } from 'screenci'
import { overlayRect, video } from 'screenci'
import { theme } from './assets/theme'

video.overlays({
  callout: (p: { rect: OverlayRect; text: string }) => ({
    path: './assets/Callout.tsx',
    props: { text: p.text },
    x: p.rect.x,
    y: p.rect.y + p.rect.pixels.height + 16,
    width: theme.calloutWidth,
    fadeIn: 200,
    fadeOut: 200,
  }),
})('Invite a teammate', async ({ page, overlays }) => {
  const email = page.getByLabel('Email address')
  const rect = await overlayRect(email, { margin: 8 })
  const hint = overlays.callout({ rect, text: 'Work email only' })
  await hint.start()
  await email.fill('emma@aperturebio.com')
  await hint.end()
})
```

**Use them sparingly.** One overlay visible at a time, one per step, each fading in and out over 150 to 250 ms. The camera (`zoomTo`, `autoZoom`) directs attention first; an overlay is for the moment zoom is not enough.

## Define overlays

`video.overlays(...)` takes a map. Each value is one of:

- a **file path** string (`.tsx`, `.solid.tsx`, `.vue`, `.svelte`, `.html`, `.svg`, `.png`, `.mp4`),
- a **React element** (`badge: <Badge label="New" />`, shorthand for `{ element: ... }`),
- a **config object** (`{ path, ...placement }`, or one of the inline sources `element`/`jsx`/`solidJsx`/`html`),
- `{ editor: '<name>' }` for a **backend-hosted** (editor-uploaded) overlay,
- `{ branding: '<name>' }` for a **shared branding asset** (resolved at export), or
- a **factory** `(props) => config` (see [Programmatic overlays](#programmatic-overlays-props)), or

A config draws its content from exactly one source. Component overlays (`.tsx`/`.solid.tsx`/`.vue`/`.svelte` files, `jsx`/`solidJsx` source) accept serializable `props`; only `.mp4`/image files accept the video/crop fields.

Every config object also declares **exactly one placement** (see [Positioning](#positioning)): `fill: 'recording' | 'screen'`, an `over` locator, or an explicit box with exactly one of `width`/`height` (plus optional `x`/`y`/`relativeTo`/`aspectRatio`). The variants' fields cannot be mixed, and a config with no placement is an error. Only the bare shorthands (a path string like `hint: 'assets/callout.html'` or a bare React element) carry an implicit `fill: 'recording'`.

```tsx
import { video } from 'screenci'

video.overlays({
  intro: { path: 'assets/intro.mp4', fill: 'screen' }, // full-frame video
  hint: 'assets/callout.html', // full HTML page (shorthand: fills the recording)
  badge: {
    path: 'overlays/Badge.tsx',
    props: { label: 'New' },
    x: 1340,
    y: 110,
    width: 288,
  }, // React component page
  note: { html: '<div class="note">Tip</div>', x: 1340, y: 320, width: 380 }, // inline fragment
  stamp: <Stamp label="Beta" />, // inline React element
  logo: { path: 'assets/logo.png', x: 96, y: 96, width: 288 }, // image
})('Overview', async ({ page, overlays }) => {
  await overlays.intro()
  await page.goto('/dashboard')
  await overlays.logo.for(1200)
})
```

`video.overlays({...})` returns a builder you call with the usual
`(title, body)` arguments. Each key becomes a callable overlay controller,
delivered to the body through the injected `overlays` fixture. The same pattern
works for screenshots:
`screenshot.overlays({...})('Title', async ({ page, crop, overlays }) => {...})`.

You can also declare overlay names alone with a bare array and upload the files
plus display options on the Editor page instead of keeping them in the
repository: `video.overlays(['intro', 'logo'])`. This form leaves the file and
placement for each name configured in the ScreenCI web app. Overlays declared
with code values stay editable too: the code values are used until the overlay
is edited in Editor, and from then on the Editor value wins.

Overlays are shared across every language (they do not take a language-major
form). For a language-specific asset (e.g. a translated badge image), swap the
overlay file per language in the web editor.

Overlay files (`.png`, `.mp4`, `.svg`) are uploaded the first time you record
with them present and reused on later runs, so you do not have to commit the
files. If a file is missing locally, ScreenCI reuses the version uploaded for
this video (matched by the overlay's name). See
[Asset files do not need to be committed](/docs/ci-setup#asset-files-do-not-need-to-be-committed).

Rules:

- every overlay except `.mp4` needs a length: give it a relative `.for(1200)` / `.for(1200)`, an absolute `.until('0:05')`/`.until('56%')`, a `duration` config string or millisecond number, or drive it with `start()`/`end()`. A bare `overlays.logo()` is invalid for these (it only works for a video or render dependency, which holds for its natural length).
- rendered page and image overlays do not support `volume`.
- `.mp4` overlays may provide `volume` (a linear gain). `1` (the default) plays the source at its natural level, `0` mutes it, and values above `1` boost it (e.g. `2` is twice as loud, up to `4`).
- `.mp4` overlays use the file's natural duration and must not provide a `duration`.
- `.mp4` overlays may provide `speed` or `time` to play the clip (and its audio) faster or slower. `speed` is a multiplier (`2` plays it twice as fast, `0.5` at half speed); `time` is a target playback duration in ms (the clip is sped up or slowed down to play over exactly that long). Set at most one. This sets how long the (sped) clip plays for, since both a blocking call (`await overlays.intro()`) and a live `start()`/`end()` window play the clip out to its end; later content shifts to make room. Use it (or trimming) to make a clip run shorter. Rendered page and image overlays do not support `speed`/`time`.

### Cropping a file overlay

Image (`.svg`/`.png`) and video (`.mp4`) overlays accept a `crop` rectangle that selects a region of the **source file**, in the source's own pixels (top-left origin), just like Playwright's `page.screenshot({ clip })`. The cropped region is then placed and scaled like any other overlay. `crop` is not supported for rendered page overlays.

```ts
video.overlays({
  // Show only the left panel of a wide screen recording.
  panel: {
    path: 'demo.mp4',
    fill: 'recording',
    crop: { x: 0, y: 0, width: 960, height: 1080 },
  },
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
video.overlays({
  // Play seconds 2 through the halfway point of the source clip.
  clip: { path: 'demo.mp4', fill: 'recording', start: '0:02', end: '50%' },
})
```

`start`/`end` apply to `.mp4` overlays only (images have no timeline).

### Component and .html page overlays

A custom overlay is a full page you author, in one of two forms:

- **A component page** (`path` ends in `.tsx`, `.solid.tsx`, `.vue`, or
  `.svelte`): a module that default-exports a component, rendered
  **client-side in the browser** during capture. The full framework runtime
  runs, so hooks/effects/signals, lifecycle and state, styles, and class
  bindings all work, and Vue/Svelte `<style>` blocks are carried into the
  overlay. Component overlays accept serializable **`props`** (declare them
  with `defineProps` in Vue, `$props()` in Svelte). screenci bundles them with
  `vite` (an optional peer dependency, resolved from your project together
  with the framework itself: `react`/`react-dom` for `.tsx`,
  `solid-js` + `vite-plugin-solid` for `.solid.tsx`,
  `vue` + `@vitejs/plugin-vue` for `.vue`, and
  `svelte` (v5+) + `@sveltejs/vite-plugin-svelte` for `.svelte`).
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
  await overlays.badge.for(1500)
  await overlays.hint.for(1200)
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
// overlays/Counter.tsx: hooks and effects run during capture
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
    duration: 2000,
    x: 1340,
    y: 110,
    width: 288,
  },
})('Overview', async ({ overlays }) => {
  await overlays.counter() // counts 0 -> 100 over 2s
})
```

Class components work identically (`this.props`, `this.state`,
`componentDidMount`, etc.). A `.tsx` page needs `react`, `react-dom`, and
`vite` installed in your project.

The same pattern works in the other frameworks; only the module changes:

```vue
<!-- overlays/Badge.vue -->
<script setup>
defineProps({ label: { type: String, default: 'New' } })
</script>
<template>
  <div class="badge">{{ label }}</div>
</template>
<style>
.badge {
  /* carried into the overlay automatically */
}
</style>
```

A `.solid.tsx` module default-exports a Solid component (the compound
extension keeps Solid's JSX compiler away from React `.tsx` files), and a
`.svelte` module is a regular Svelte 5 component using `$props()`.

### Inline overlays

Small overlays do not need their own file. Three inline sources keep the
content in the recording file itself:

**`element`** takes a React element and renders it in-process to static
markup. Because it renders in your recording process, props are baked into the
JSX and you can close over any test-scope value directly; there is no separate
`props` field. No client JS runs (hooks and effects do not fire), but CSS
animations still play under the virtual clock with `animate: true`. A bare
element is shorthand for the config form:

```tsx
const label = await page.textContent('#plan') // close over runtime values

video.overlays({
  badge: <Badge label="New" />, // shorthand
  plan: { element: <PlanCard name={label} />, x: 1340, y: 110, width: 288 },
})
```

**`jsx`** (React) and **`solidJsx`** (Solid) take the source of a component
module as a string, bundled and mounted client-side exactly like a
`.tsx`/`.solid.tsx` file, so the full runtime runs (hooks, effects,
`requestAnimationFrame`). The source is compiled in isolation for the browser:
it **cannot close over test variables**; pass data through the serializable
`props` instead. Imports inside the string resolve relative to the recording
file's directory.

```tsx
video.overlays({
  counter: {
    jsx: `
      import { useEffect, useState } from 'react'
      export default function Counter({ to }) {
        const [n, setN] = useState(0)
        useEffect(() => { /* animate n towards to */ }, [to])
        return <div className="counter">{n}</div>
      }
    `,
    props: { to: 100 },
    animate: true,
    duration: 2000,
    x: 1340,
    y: 110,
    width: 288,
  },
})
```

**`html`** takes an HTML fragment and places it in the overlay root. Include a
`<style>` tag in the fragment for styling; scripts are not executed (use a
`.html` file overlay for a page that owns its own scripts).

```tsx
video.overlays({
  note: {
    html: '<div class="note"><style>.note{padding:8px}</style>Tip</div>',
    x: 1340,
    y: 110,
    width: 380,
  },
})
```

Which variant runs client JS:

| Variant                                          | Client JS (hooks/effects) | Closes over test scope | `props` |
| ------------------------------------------------ | ------------------------- | ---------------------- | ------- |
| `.tsx` / `.solid.tsx` / `.vue` / `.svelte` files | yes                       | no                     | yes     |
| `jsx` / `solidJsx` source                        | yes                       | no                     | yes     |
| `element`                                        | no (static render)        | yes                    | no      |
| `html` fragment                                  | no (styles only)          | yes (via template)     | no      |
| `.html` file                                     | yes (its own scripts)     | no                     | no      |

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
  await overlays.badge({ label: 'Saved', x: 1340 }).for(1200)

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
> it runs. The resolved page (and, for a component overlay, its bundle and props) is captured
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
    duration: 1500,
    fill: 'screen',
  },
  // An animated .html page, captured at 60fps.
  hint: {
    path: './overlays/callout.html',
    animate: true,
    duration: 1200,
    fps: 60,
    x: 768,
    y: 864,
    width: 384,
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
- **Length.** You set the length explicitly: use `.for(2000)` on the call or set
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

Each animated overlay is encoded twice at capture time: a render clip for the
video pipeline, plus a browser-playable preview clip that keeps the transparent
background, so the web editor's live preview shows the animation over your app
instead of a black card. Both are uploaded with the recording automatically.

## Positioning

Placement is **mandatory on every config object**, and a config picks exactly
one of three variants:

- **`fill: 'recording' | 'screen'`** fills a frame: `'recording'` fills the
  recording area, `'screen'` fills the entire output frame, including any
  padding around the recording.
- **`over: <locator>`** (optional `margin`) sizes and positions the overlay
  over a live element; see
  [Positioning over a live element](#positioning-over-a-live-element).
- **An explicit box** with exactly one of `width`/`height`, plus optional
  `x`/`y`/`relativeTo`/`aspectRatio`.

The variants' fields cannot be mixed: `fill` combined with `x`/`y`/`width`/
`height` is an error, as is a box with both `width` and `height`, or a config
with no placement at all. The only exception is the bare shorthands, a path
string (`logo: './logo.png'`) or a bare React element, which mean
`fill: 'recording'`.

Box placement fields are flat on the config and each defaults independently.
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
    duration: 1500,
    x: 96,
    y: 96,
    width: 288,
  },
  // A banner across the full output frame, sized by height.
  label: {
    path: 'assets/label.svg',
    duration: 1500,
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
- Provide exactly one of `width` or `height` (in CSS px). The other is derived from the overlay's intrinsic aspect ratio (or from `aspectRatio`, given as `width / height`) so it is never distorted.

To fill a frame instead of placing a box, set `fill`: `'recording'` fills the recording area and `'screen'` fills the entire output frame. `fill` cannot be combined with the box fields, and a config object with no placement at all is rejected. Only the bare shorthands (a path string or a bare React element) fill the recording implicitly.

### Overlays and zoom (`pinToScreen`)

By default an overlay is "burned" into the scene: when the camera zooms or pans (a `zoomTo` or an auto-zoom), the overlay moves and scales with the recording underneath it. So a ring placed `over` an element stays glued to that element as you zoom into it, and a badge anchored to part of the recording tracks that part.

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
    duration: 2000,
    overMouse: true,
  },
})('Product demo', async ({ page, overlays }) => {
  // The cursor slides under the 2s card, then sits on top again for the walkthrough.
  await overlays.logo.for(2000)
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
  // A component whose content fills the element's box (width/height: 100%).
  ring: (target: Locator) => ({
    path: './assets/Ring.tsx',
    over: target,
    margin: 8, // optional breathing room around the element
    fadeIn: 200,
    fadeOut: 200,
  }),
})('Overview', async ({ page, overlays }) => {
  const save = page.getByRole('button', { name: 'Save' })
  const ring = overlays.ring(save) // capture the controller, then drive it
  await ring.start()
  await save.click()
  await ring.end()
})
```

```tsx
// recordings/assets/Ring.tsx: the app's accent colour from the shared theme
import { theme } from './theme'

export default function Ring() {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        border: `${theme.ringWidth}px solid ${theme.accent}`,
        borderRadius: theme.radius,
        boxShadow: `inset 0 0 0 4px ${theme.accentSoft}`,
      }}
    />
  )
}
```

The same ring as a plain `.html` page (no React) carries the theme values as
CSS variables. A page overlay owns its whole document, so its background must
be transparent:

```html
<!-- recordings/assets/ring.html -->
<!doctype html>
<html>
  <head>
    <style>
      /* Theme values from the recorded app, identical in every page overlay. */
      :root {
        --accent: #2563eb;
        --accent-soft: rgba(37, 99, 235, 0.18);
        --radius: 12px;
        --ring-width: 3px;
      }
      html,
      body {
        margin: 0;
        background: transparent;
      }
      .ring {
        width: 100%;
        height: 100%;
        box-sizing: border-box;
        border: var(--ring-width) solid var(--accent);
        border-radius: var(--radius);
        box-shadow: inset 0 0 0 4px var(--accent-soft);
      }
    </style>
  </head>
  <body>
    <div class="ring"></div>
  </body>
</html>
```

`over` works with every rendered page overlay (component files, `.html`,
`element`, `jsx`/`solidJsx`, and inline `html`). It is always
recording-relative and is a placement of its own: combining `over` with
`fill` or the box fields (`x`/`y`/`width`/`height`/`relativeTo`) is an error.
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

### Position overlays in the web app

Overlay placement is also editable visually in the editor. Placement edits are
stored in the editor and applied when the video renders, so your script stays
as you wrote it:

- **Drag in the live preview.** Drag an overlay on the video to move it, or
  drag a corner to resize. For an element-locked overlay, dragging adjusts its
  margin instead.
- **Fill select.** The overlay panel's Fill control switches between
  **Screen**, **Recording**, and **Custom (drag in preview)** placement.
- Files, image duration, and video audio/speed/time controls are editable in
  the same panel.

## Timing and control flow

Every controller supports two timing styles.

**Blocking** holds the overlay over a frozen frame for a fixed duration, then the
script continues:

```ts
await overlays.badge() // uses the config duration
await overlays.badge.for(2000) // or override the duration
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

`start()` accepts a `delay` (milliseconds) that offsets the recorded start
into the future, so an overlay written before an interaction can appear during
it: `await overlays.badge.start({ delay: 500 })`. Delayed overlay starts must
stay in time order; see
[Mid-Video Overlay Updates](./overlay-updates.md#delaying-an-update-into-an-interaction).

For an overlay with an intrinsic length (a `.mp4` video, an embedded video
dependency, or an [animated](#animated-overlays) HTML/React clip), `end()` lets
the clip finish: if the media is longer than the live window, the remainder plays
out over a frozen frame before the timeline continues, so the clip is never cut
short by ending early. To show less of such a clip, trim it (`start`/`end` or
`speed`/`time`) instead of calling `end()` sooner.
Length-less overlays (images and non-animated rendered pages) end exactly at `end()`.

Overlays can overlap. Several can be live at the same time, and a blocking
overlay can run while others stay live, so you can layer them freely:

```ts
await overlays.badge.start()
await overlays.logo.start() // both live now
await page.click('#next')
await overlays.tip.for(1500) // blocking overlay, badge and logo stay composited
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

## Fade in and out

Any overlay fades in or out with `fadeIn` / `fadeOut` (milliseconds) in its
config. Omitted fades keep the instant appearance.

```ts
const overlays = video.overlays({
  logo: {
    path: './logo.png',
    width: 200,
    x: 24,
    y: 24,
    fadeIn: 250,
    fadeOut: 250,
  },
})
```

## File organization

A simple structure is usually enough:

```text
recordings/
  assets/
    theme.ts        # colours, radius, font: the one place styling lives
    Ring.tsx        # highlight around an element (over + margin)
    Callout.tsx     # label beside an element (overlayRect), text via props
    intro.mp4
    logo.png
  signup.screenci.ts
  billing.screenci.ts
```

Every video imports the same components, so the project's overlays stay identical from video to video. Keep reusable brand assets separate from throwaway experiment files so the project stays readable.

## Authoring advice

- Use overlays sparingly: one visible at a time, one per step, and let the camera do most of the pointing.
- Build them with HTML/CSS or React from the shared theme, never hand-drawn SVG or ad hoc colours (see [Designing overlays](#designing-overlays)).
- Reuse the project's existing overlay components with different `props` before adding a new file, and never copy a component to change its colours.
- Fade everything in and out (150 to 250 ms) and keep `.for(...)` (or `duration`) values short so image overlays do not stall the timeline.
- Mute overlays that should not compete with narration, and keep intros and transitions short.
- Keep placement and sizing identical across videos in the same project: same margins, same corner, same label size.
