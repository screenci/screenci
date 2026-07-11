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

## Center and full screen

Beyond the four corners, `moveNarration` accepts `'center'` and
`'full-screen'`.

`'center'` places the bubble in the middle of the frame, displaced by an
optional signed `offset` (per-axis fractions of the shorter output side).
Center moves slide like corner moves and keep the rounded corners and drop
shadow. The offset persists for later center moves until overridden.

```ts
await moveNarration('center', { offset: { x: 0.1, y: -0.05 }, duration: 400 })
```

`'full-screen'` shows the UNCROPPED narration source over the whole frame,
at its real aspect ratio (not the square bubble crop). `fit: 'contain'` (the
default) letterboxes with black bars; `fit: 'cover'` fills the frame with
slight cropping. No rounded corners or shadow. Full screen never slides:
the bubble fades out in place while the full-screen video fades in over
`duration` (omit for an instant switch). Any later move to a corner or
center exits the same way, restoring the bubble where it was (or at the new
position you name).

```ts
await moveNarration('full-screen', { fit: 'cover', duration: 300 })
// ... the speaker fills the screen ...
await moveNarration('bottom-right', { duration: 300 })
```

While full screen is active, `resizeNarration` and padding changes apply
when the bubble reappears; a second `moveNarration('full-screen')` throws
(move to a corner or center first). `hideNarration` hides the full-screen
video too. Full screen covers the recording, overlays, and cursor; only the
watermark stays above it.

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

## Delaying an update into an interaction

A call cannot execute while an interaction is awaited, so an update written
between two interactions always lands in the gap between them. To land an
update DURING an interaction, write the call before it and pass `delay`
(milliseconds): the call runs immediately, but the change is recorded `delay`
ms later on the timeline.

```ts
await setBackground({ backgroundCss: '#101014' }, { delay: 500 })
await page.getByRole('button', { name: 'Open dashboard' }).click()
// The background switches 500 ms into the click above.
```

Every update on this page accepts `delay`: `moveNarration`,
`resizeNarration`, `resizeRecording`, `hideRecording` / `showRecording`,
`hideNarration` / `showNarration`, and `setBackground`. It combines freely
with `duration` (the transition starts at the delayed instant). The same
option exists on media `start()` calls (narration cues, overlays, audio) and
on the `hide` / `speed` / `time` wrappers, where it shifts the recorded start
only.

Two rules apply:

- **Same-type events stay in time order.** Recording fails with an error when
  a delayed event would land behind a same-type event recorded after it, for
  example a delayed `hideRecording` overtaken by a later `showRecording`.
  Reduce the delay or reorder the calls.
- **A delay cannot outlive the recording.** If the recording ends before the
  delayed instant, the recording fails with an error naming the event.

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
