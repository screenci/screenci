# Mid-Video Overlay Updates

Move, resize, hide, and show the narration bubble and the recording frame
mid-video, and change the background, all animated. Each function records a
timestamped event at the moment it is called inside `video()`, so the change
lands exactly where it happens in your script.

#### You will learn

- [how to move and resize the narration bubble](#move-and-resize-the-narration)
- [how to resize or hide the recording frame](#resize-and-hide-the-recording)
- [how to change the background mid-video](#change-the-background)
- [how to fade overlays in and out](#fades)
- [the rules and current limits](#rules-and-limits)

## Move and resize the narration

`moveNarration(corner, options)` moves the narration bubble to another corner.
Pass `duration` to animate the move; omit it for an instant switch.

```ts
import { moveNarration, resizeNarration } from 'screenci'

await moveNarration('top-left', { duration: 600, easing: 'ease-in-out' })
```

`padding` sets a per-axis inset from the anchor corner as a fraction of the
shorter output side, so the two axes can differ. A set axis overrides the
global `renderOptions.narration.padding` from that point on; an omitted axis
keeps its current value. Negative values push the bubble past the edge.

```ts
await moveNarration('bottom-left', {
  padding: { x: 0.02, y: 0.08 },
  duration: 400,
})
```

Move and resize together in one synchronized animation by setting `size` in
the same call, or resize alone with `resizeNarration`:

```ts
await moveNarration('top-right', { size: 0.2, duration: 500 })
await resizeNarration(0.35, { duration: 500 })
```

`size` is a fraction of the shorter output side, like
`renderOptions.narration.size`. Once any update sets `size`, the
`sizeZoomed` render option is ignored from that point on (the explicit size
wins).

`hideNarration()` and `showNarration()` now take the same options, so the
bubble can fade out and back in instead of cutting:

```ts
import { hideNarration, showNarration } from 'screenci'

await hideNarration({ duration: 300 })
// ... a step best seen unobstructed ...
await showNarration({ duration: 300 })
```

## Resize and hide the recording

`resizeRecording(size, options)` animates the recording frame's size
(`renderOptions.recording.size` semantics, 0 to 1); the frame stays centered.

```ts
import { resizeRecording, hideRecording, showRecording } from 'screenci'

await resizeRecording(0.6, { duration: 600, easing: 'ease-in-out' })
```

`hideRecording()` hides only the browser capture: the background, narration,
overlays, and the timeline keep running. This is different from `hide()`,
which cuts the footage out of the video entirely.

```ts
await hideRecording({ duration: 300 })
// ... narration keeps talking over the bare background ...
await showRecording({ duration: 300 })
```

## Change the background

`setBackground(background, options)` switches the video background mid-video.
Pass a CSS background or an image file. With a `duration` the backgrounds
crossfade; without one the switch is an instant cut.

```ts
import { setBackground } from 'screenci'

await setBackground({ backgroundCss: '#101014' }, { duration: 500 })
await setBackground({ assetPath: './assets/space.png' })
```

## Fades

Every visibility change above accepts `{ duration, easing }`. Asset overlays
fade too, via `fadeIn` / `fadeOut` (milliseconds) in their config:

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

Video narration cues render through the narration bubble, so they follow the
narration fades. The mouse cursor's hide/show remains instant.

## Rules and limits

- **Easings**: `linear`, `ease-in`, `ease-out`, `ease-in-out`, and the
  `-strong` variants. Defaults to `ease-in-out`.
- **No overlapping updates**: a second update on the same target (narration,
  recording, or background) throws if it lands before the previous
  transition has finished. Wait out the transition first (for example
  `await page.waitForTimeout(600)` after a 600 ms move).
- **Corner roundness follows the tile**: `roundness` is a fraction of the
  tile's shorter side, so the corner radius shrinks and grows with the tile
  during a resize. That keeps the radius correct at every resting size.
- **Recording drop shadow**: the standard 0-1 `dropShadow` moves and scales
  with the animated recording frame. A custom CSS-string shadow authored in
  the editor is not rendered while recording/background updates are used.
- **Updates inside `hide()` spans**: an animation that would span cut
  footage is clamped, so it completes by the cut instead of animating
  through removed time.
- **Cursor**: the pointer rides the recording frame through resizes and
  hides with it. During zooms combined with recording resize the cursor
  follows the largest recording size instead; prefer keeping zoomed,
  pointer-heavy interaction at the recording's largest size.
