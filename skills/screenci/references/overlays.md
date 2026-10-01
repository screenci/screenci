# Drawing over the video (overlays)

Declare overlays with `video.overlays({...})` (or `screenshot.overlays`) and drive them from the `overlays` fixture. Full reference: [Overlays](https://screenci.com/docs/guides/overlays).

## Use the built-in kit first

Kit primitives take colours, radius and font from the recorded app, place themselves (flip away from edges, stay in frame), and are captured pixel-exact.

| Config                                                         | Use it for                      |
| -------------------------------------------------------------- | ------------------------------- |
| `{ kit: 'ring', anchor: locator }`                             | Highlight a button              |
| `{ kit: 'callout', anchor: locator, text: 'Work email only' }` | A short hint beside an element  |
| `{ kit: 'step', number: 1, anchor: locator }`                  | Numbered steps                  |
| `{ kit: 'spotlight', anchor: locator }`                        | Dim everything except one thing |
| `{ kit: 'badge', text: 'New', anchor: locator }` or `x`/`y`    | A small label                   |
| `{ kit: 'keys', keys: ['Cmd', 'K'], x: 96, y: 96 }`            | A keyboard shortcut             |
| `{ kit: 'title', title: 'Invite your team', subtitle: '...' }` | A title or section card         |

Anchored primitives are factories, called with the locator inside the test:

```ts
import type { Locator } from '@playwright/test'
import { video } from 'screenci'

video.overlays({
  hint: (p: { target: Locator; text: string }) => ({
    kit: 'callout',
    anchor: p.target,
    text: p.text,
  }),
  intro: { kit: 'title', title: 'Invite your team' },
})('Invite a teammate', async ({ page, overlays }) => {
  await overlays.intro.for(1800)
  const email = page.getByLabel('Email address')
  const hint = overlays.hint({ target: email, text: 'Work email only' })
  await hint.start()
  await email.fill('emma@aperturebio.com')
  await hint.end()
})
```

Options: `side`, `align`, `gap` (leave defaults unless it reads badly), `duration`, `fadeIn`/`fadeOut` (180 ms), `pinToScreen`, `overMouse`.

## Rules

1. **Only when it helps**: when asked, or when narration and camera cannot point at it alone. One visible at a time, a handful per video.
2. **The kit before anything custom.** Never rebuild a ring, label, or step as a component.
3. **Theme comes from the app.** Override a token (`theme: { accent }`) only when asked, in one shared factory.
4. **Consistent geometry** across all videos.
5. **Timing**: `start()` before the action, `end()` right after; `.for(ms)` for cards.

## Custom overlays (only when the kit cannot draw it)

- **HTML/CSS or React, never hand-drawn SVG.** Shapes come from CSS (`border`, `border-radius`, `box-shadow`). No `<svg>`/`<path>`, no hand-authored `.svg`. Use the app's icon library if it has one.
- **Colours, radius, font from the app** (its CSS variables or primary button), stored once in `recordings/assets/theme.ts` and imported everywhere. `.html` page overlays have no base URL, so paste the same values as a `:root { ... }` block instead.
- **One shared set of files**, parameterised with `props`.
- **Place with `anchor`** plus `side`/`align`/`gap`, not hand-computed coordinates; add `bleed` for shadows or pointers. Use `overlayRect(locator)` only when a component needs the element's geometry as a prop.
- **Covering an element**: `over: locator` plus `margin`; only that box is captured, so fill it (`width: 100%; height: 100%`).

```ts
// recordings/assets/theme.ts: values from the recorded app
export const theme = {
  accent: '#2563eb',
  surface: '#0f172a',
  text: '#f8fafc',
  radius: 12,
} as const
```

```tsx
// recordings/assets/Pill.tsx
import { theme } from './theme'

export default function Pill({ text }: { text: string }) {
  return (
    <div
      style={{
        padding: '6px 12px',
        borderRadius: 999,
        background: theme.surface,
        color: theme.text,
      }}
    >
      {text}
    </div>
  )
}
```

```ts
video.overlays({
  pill: (p: { target: Locator; text: string }) => ({
    path: './assets/Pill.tsx',
    props: { text: p.text },
    anchor: p.target,
    side: 'right',
    bleed: 20,
  }),
})
```
