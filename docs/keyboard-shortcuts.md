# Keyboard Shortcuts

ScreenCI records keyboard shortcuts pressed with `page.keyboard.press` (and
`locator.press`) and shows them as animated keycap overlays at the bottom of
the rendered video. Each shortcut pops in with a small bounce, holds for a
moment, and fades out.

#### You will learn

- [how shortcuts are recorded](#recording-shortcuts)
- [which shortcuts are shown by default](#default-visibility)
- [how to control visibility per press](#per-press-visibility)
- [how to configure overlays globally](#global-render-options)

## Recording shortcuts

Press keys as you would in Playwright. Modifier combos and single keys are both
recorded:

```ts
import { video } from 'screenci'

video('Command palette', async ({ page }) => {
  await page.goto('/')

  // A modifier combo: shown as keycaps by default.
  await page.keyboard.press('ControlOrMeta+K')

  // A single key press: hidden by default.
  await page.keyboard.press('Enter')

  // Element-targeted presses are recorded too.
  await page.getByRole('textbox').press('Shift+Enter')
})
```

`ControlOrMeta` is resolved at record time to the key that was actually
pressed: `Meta` on macOS, `Control` elsewhere, so the rendered keycaps always
match the recording platform.

Presses inside `hide()` are never recorded.

## Default visibility

- Modifier combos (for example `Shift+A` or `ControlOrMeta+K`) are shown by
  default.
- Single keys (for example `A` or `Enter`) are hidden by default, since most
  single presses are incidental typing rather than a shortcut worth showing.

## Per-press visibility

Override the defaults per press with the `show` option:

```ts
// Show a single key that would be hidden by default.
await page.keyboard.press('F', { show: true })

// Hide a combo that would be shown by default.
await page.keyboard.press('Control+C', { show: false })
```

Each recorded shortcut also appears on the web editor timeline, where it can be
shown or hidden individually with a right click. Editor overrides win over the
`show` option and the global toggles.

## Global render options

Configure the overlays per video under `renderOptions.shortcuts`:

```ts
video.renderOptions({
  shortcuts: {
    // Show modifier combos. Default: true.
    show: true,
    // Show single key presses. Default: false.
    showSingle: false,
    // Keycap appearance: 'light' or 'dark'. Default: 'dark'.
    theme: 'dark',
  },
})
```

The same options are editable in the web editor's "Keyboard shortcuts" section,
next to the video preview.

Visibility is resolved per shortcut in this order:

1. an editor timeline override for that shortcut
2. the per-press `show` option
3. the global toggle (`show` for combos, `showSingle` for single keys)
