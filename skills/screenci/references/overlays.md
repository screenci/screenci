# Drawing over the video (overlays)

Overlays are content drawn on top of the recording: a ring around a button, a label next to a field, a step badge, a title card. They are declared with `video.overlays({...})` (or `screenshot.overlays({...})`) and driven from the `overlays` fixture. Full reference: [Overlays](https://screenci.com/docs/guides/overlays).

An overlay is authored as a web page (a `.tsx` React component, a `.html` page, or an inline fragment), rendered by a real browser at record time, and burned into the video as pixels. So anything CSS can draw, an overlay can draw. That is also why the rules below exist: an agent that hand-writes SVG paths and picks its own colours produces overlays that look nothing like the product and differ from video to video.

## When to draw over the video

- Only when the person asks for it, or when the narration cannot point at the thing on its own (a small control on a busy page, a "which of these" moment).
- Prefer the camera first: `zoomTo()` and `autoZoom()` already direct attention. An overlay is for the case where zoom is not enough.
- One overlay visible at a time, one per step, and a handful per video at most. Overlays are guidance, never decoration.

## Rules

1. **HTML/CSS or React, never hand-drawn SVG.** Shapes come from CSS: `border`, `border-radius`, `box-shadow`, `outline`, a gradient, a rotated square for a pointer, a huge `box-shadow` for a dimmed backdrop with a hole. Do not write `<svg>` with `<path>` data, do not author `.svg` files by hand, and do not paste in icon markup. If the recorded app ships an icon library the overlay can import (for example `lucide-react` in its `package.json`), use that; otherwise use text or no icon.
2. **Colours, radius, and font come from the recorded app, never from you.** Before the first overlay, read the app's own theme: CSS variables (`--primary`, `--accent`, `--ring`), the Tailwind config, a theme file, or the computed styles of its primary button (the `playwright-cli` skill can read them). Put those values in **one** shared file, `recordings/assets/theme.ts`, and import it from every overlay. In a project without React (`.html` page overlays), keep the same values as a `:root { --accent: ... }` block: a page overlay is loaded as a standalone document with no base URL, so it cannot link a stylesheet. Paste the block into each page and keep it identical everywhere. Never hardcode a colour inside a component. Keep `font-family: inherit` unless the app's font is installed on the recording machine; the overlay page already carries a clean sans-serif stack.
3. **One shared set of overlay files per project.** Overlay components live in `recordings/assets/` and every video in the project imports the same files. Before writing a new component, list that folder and extend an existing one with a prop. Never inline a one-off `html:` string beyond a plain rectangle, and never copy a component into a second file with different colours.
4. **Consistent geometry across the project.** The same ring width, radius, margin, fade, label size, and pointer side in every video. Recurring elements sit in the same place (badges in one corner, title cards `fill: 'recording'`). If a project already has overlays, match them exactly.
5. **Look like the product.** A highlight is a 2 to 4 px ring in the app's accent colour, optionally with a soft inset glow (an outer glow is clipped by the `over` box), not a thick red rectangle. A label is a small pill in the app's surface colour with the app's text colour. Nothing pulses unless the person asks for animation.
6. **Timing.** `fadeIn` / `fadeOut` of 150 to 250 ms on everything, short `.for(...)` values, `start()` before the action and `end()` right after it.

## Placement, and what the renderer captures

- **Ring or highlight around an element:** `over: locator` plus a `margin`. The overlay page is sized to the element's box and only that box is captured, so the content must fill it (`width: 100%; height: 100%`). Anything drawn outside the box is cut off.
- **Label or callout beside an element:** the box-clipping above means a label cannot hang outside an `over` overlay. Use `overlayRect(locator, { margin })` inside a factory and place the label with explicit `x` / `y` / `width` computed from the rect.
- **HUD-like badge that must ignore zoom:** `pinToScreen: true`.
- **Full-frame title card:** `fill: 'recording'` with a transparent background so the page shows through.

## Examples

Shared theme, filled from the recorded app's stylesheet (values below are placeholders to replace):

```ts
// recordings/assets/theme.ts
// Single source of truth for overlay styling. Taken from the recorded app's
// own theme (CSS variables / Tailwind config). Change values here, never in a
// component.
export const theme = {
  accent: '#2563eb', // the app's primary / accent colour
  accentSoft: 'rgba(37, 99, 235, 0.18)', // the same colour at low alpha
  surface: '#0f172a', // background for labels and cards
  text: '#f8fafc', // text on `surface`
  radius: 12, // the app's control radius, in px
  ringWidth: 3,
  calloutWidth: 320, // labels render and place at this width (no scaling)
  fontFamily: 'inherit',
} as const
```

A ring that fills its box, declared with `over`:

```tsx
// recordings/assets/Ring.tsx
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

```ts
// recordings/save-settings.screenci.ts
import type { Locator } from '@playwright/test'
import { video } from 'screenci'

video.overlays({
  ring: (target: Locator) => ({
    path: './assets/Ring.tsx',
    over: target,
    margin: 8,
    fadeIn: 200,
    fadeOut: 200,
  }),
})('Save settings', async ({ page, overlays }) => {
  const save = page.getByRole('button', { name: 'Save changes' })
  const ring = overlays.ring(save)
  await ring.start()
  await save.click()
  await ring.end()
})
```

A callout placed next to an element with `overlayRect`, parameterised by props so one component serves every video:

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
  // Sits 16px below the element's box; `x`/`y` are CSS px of the recording.
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

Project without React: the same ring as a plain page. The `:root` block holds the theme values (identical in every page, since a page overlay cannot link a stylesheet), and the background must be transparent because the page owns its whole document.

```html
<!-- recordings/assets/ring.html -->
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      /* Theme values from the recorded app: keep this block identical in
         every overlay page of the project. */
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

## Checklist before `preview`

- No `<svg>`, `<path>`, or hand-authored `.svg` in `recordings/assets/`.
- Every colour, radius, and font in an overlay comes from `theme.ts` (or the shared `:root` block in `.html` pages), and those values came from the recorded app.
- Page overlays (`.html`) have a transparent background and fill their box when used with `over`.
- New videos reuse the components the project already has, with the same margins, sizes, and fades.
- At most one overlay visible at a time, each fading in and out.
