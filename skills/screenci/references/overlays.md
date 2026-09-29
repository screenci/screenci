# Drawing over the video (overlays)

Overlays are content drawn on top of the recording: a ring around a button, a callout next to a field, a step number, a keyboard shortcut, a title card. Declare them with `video.overlays({...})` (or `screenshot.overlays({...})`) and drive them from the `overlays` fixture. Full reference: [Overlays](https://screenci.com/docs/guides/overlays).

## Use the built-in kit first

The kit is a small set of primitives that already look like the product: their colours, radius and font are read from the recorded app at recording time (its primary button, root CSS variables, body font, light or dark scheme), they are placed for you (a callout flips to the other side of an element near the page edge, keeps its pointer facing the element, and stays in frame where it can), and they are captured pixel-exact, never rescaled. Reach for a custom component only when the kit cannot draw what the person asked for.

| Primitive   | Config                                                         | Use it for                                  |
| ----------- | -------------------------------------------------------------- | ------------------------------------------- |
| `ring`      | `{ kit: 'ring', anchor: locator }`                             | "Highlight the Save button"                 |
| `callout`   | `{ kit: 'callout', anchor: locator, text: 'Work email only' }` | A short hint beside a field or button       |
| `step`      | `{ kit: 'step', number: 1, anchor: locator }`                  | Numbered steps across a form or a page      |
| `spotlight` | `{ kit: 'spotlight', anchor: locator }`                        | Dim everything except one element           |
| `badge`     | `{ kit: 'badge', text: 'New', anchor: locator }` or `x`/`y`    | A small label ("New", "Beta", "Admin only") |
| `keys`      | `{ kit: 'keys', keys: ['Cmd', 'K'], x: 96, y: 96 }`            | A keyboard shortcut                         |
| `title`     | `{ kit: 'title', title: 'Invite your team', subtitle: '...' }` | A full-recording title or section card      |

A locator is only known while the test runs, so any primitive with an `anchor` is declared as a factory and called with the locator (and any text) inside the test body:

```ts
import type { Locator } from '@playwright/test'
import { video } from 'screenci'

video.overlays({
  ring: (t: Locator) => ({ kit: 'ring', anchor: t }),
  hint: (p: { target: Locator; text: string }) => ({
    kit: 'callout',
    anchor: p.target,
    text: p.text,
  }),
  step: (p: { n: number; target: Locator }) => ({
    kit: 'step',
    number: p.n,
    anchor: p.target,
  }),
  intro: {
    kit: 'title',
    title: 'Invite your team',
    subtitle: 'Settings > Members',
  },
})('Invite a teammate', async ({ page, overlays }) => {
  await overlays.intro.for(1800)

  const email = page.getByLabel('Email address')
  const hint = overlays.hint({ target: email, text: 'Work email only' })
  await hint.start()
  await email.fill('emma@aperturebio.com')
  await hint.end()

  const invite = page.getByRole('button', { name: 'Send invite' })
  const ring = overlays.ring(invite)
  await ring.start()
  await invite.click()
  await ring.end()
})
```

Placement options for anchored primitives: `side` (`'top'`, `'bottom'` (callout default), `'left'` (step default), `'right'`), `align` (`'start'`, `'center'`, `'end'`), and `gap` (px). Leave them at their defaults unless the element sits somewhere the default reads badly (a callout below a bottom toolbar flips on its own, so that is not a reason).

Every primitive also takes `duration`, `fadeIn` / `fadeOut` (default 180 ms), `pinToScreen` (ignore zoom, for HUD badges) and `overMouse`.

## Rules

1. **Only when it helps.** Draw over the video when the person asks for it, or when the narration cannot point at the thing on its own (a small control on a busy page, a "which of these" moment). The camera (`zoomTo()`, `autoZoom()`) directs attention first. One overlay visible at a time, one per step, a handful per video at most. Overlays are guidance, never decoration.
2. **The kit before anything custom.** A ring is `{ kit: 'ring' }`, a label is `{ kit: 'callout' }` or `{ kit: 'badge' }`, steps are `{ kit: 'step' }`. Do not rebuild these as components.
3. **Theme comes from the app, not from you.** The kit extracts it. Override a token (`theme: { accent: '...' }`) only when the person asks for a specific colour, and then put the override in one shared factory so every video uses it.
4. **Consistent geometry across the project.** Keep the same primitives, sides and gaps in every video. Recurring elements sit in the same place (badges in one corner, one `title` card style).
5. **Timing.** `start()` before the action and `end()` right after it; `.for(...)` for cards. Short windows.

## When the kit is not enough: custom overlays

A custom overlay is a web page (`.tsx`, `.html`, or an inline fragment) rendered by a real browser and burned in as pixels, so anything CSS can draw, an overlay can draw. Keep these rules so custom overlays match the kit and the product:

- **HTML/CSS or React, never hand-drawn SVG.** Shapes come from CSS: `border`, `border-radius`, `box-shadow`, a rotated square for a pointer. Do not write `<svg>` with `<path>` data and do not author `.svg` files by hand. If the app ships an icon library the overlay can import (for example `lucide-react` in its `package.json`), use that; otherwise use text or no icon.
- **Colours, radius and font come from the recorded app.** Read its CSS variables (`--primary`, `--accent`, `--radius`), the Tailwind config, or the computed styles of its primary button (the `playwright-cli` skill can read them), and put the values in one shared `recordings/assets/theme.ts` that every component imports. In a project without React (`.html` page overlays), keep the same values as a `:root { --accent: ... }` block pasted into each page: a page overlay is loaded as a standalone document with no base URL, so it cannot link a stylesheet. Keep `font-family: inherit` unless the app's font is installed on the recording machine.
- **One shared set of overlay files per project**, parameterised with `props`, never a copy per video.
- **Place with `anchor`, not with hand-computed coordinates.** `anchor: locator` plus `side`/`align`/`gap` places the content at its natural size beside the element, flips it away from the viewport edge and keeps it in frame; the capture is placed 1:1, so text stays crisp. Add `bleed` (px) for a shadow or pointer that extends outside the content, and read the landed side from `html[data-screenci-anchor-side]` in CSS when drawing a pointer. Use `overlayRect(locator)` only when a component needs the element's geometry as a prop (for example to draw around it).
- **Covering an element:** `over: locator` plus `margin`. The page is sized to the element's box and only that box is captured, so the content must fill it (`width: 100%; height: 100%`); add `bleed` for an outer glow.

```ts
// recordings/assets/theme.ts
// Values from the recorded app's own theme. Change them here, never in a
// component.
export const theme = {
  accent: '#2563eb',
  surface: '#0f172a',
  text: '#f8fafc',
  radius: 12,
  fontFamily: 'inherit',
} as const
```

```tsx
// recordings/assets/Pill.tsx: a custom label the kit does not offer
import { theme } from './theme'

export default function Pill({ text }: { text: string }) {
  return (
    <div
      style={{
        display: 'inline-block',
        padding: '6px 12px',
        borderRadius: 999,
        background: theme.surface,
        color: theme.text,
        fontFamily: theme.fontFamily,
        fontSize: 16,
        fontWeight: 600,
        boxShadow: '0 6px 18px rgba(0, 0, 0, 0.25)',
      }}
    >
      {text}
    </div>
  )
}
```

```ts
import type { Locator } from '@playwright/test'
import { video } from 'screenci'

video.overlays({
  pill: (p: { target: Locator; text: string }) => ({
    path: './assets/Pill.tsx',
    props: { text: p.text },
    anchor: p.target,
    side: 'right',
    gap: 12,
    bleed: 20, // room for the shadow
    fadeIn: 180,
    fadeOut: 180,
  }),
})('Roles', async ({ page, overlays }) => {
  const role = page.getByLabel('Role')
  const pill = overlays.pill({ target: role, text: 'Admins only' })
  await pill.start()
  await role.selectOption('admin')
  await pill.end()
})
```

## Checklist before `preview`

- Every highlight, callout, step, badge, shortcut and title card uses the kit.
- No `<svg>`, `<path>`, or hand-authored `.svg` in `recordings/assets/`.
- Custom overlays import `theme.ts` (or share one `:root` block), use `anchor` or `over` (never hand-computed `x`/`y` for something beside an element), and set `bleed` when they draw a shadow or pointer.
- At most one overlay visible at a time, each fading in and out.
