# Mid-Video Overlay Updates

Resize, hide, and show the recording frame and the narration bubble mid-video,
all animated. Each function records a timestamped event at the moment it is
called inside `video()`, so the change lands exactly where it happens in your
script.

#### You will learn

- [how to fade the narration bubble out and in](#hide-and-show-the-narration)
- [how to resize or hide the recording frame](#resize-and-hide-the-recording)
- [how to fade overlays in and out](#fades)
- [the rules and current limits](#rules-and-limits)

## Hide and show the narration

`hideNarration()` and `showNarration()` take `{ duration, easing }`, so the
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
await resizeRecording(0.6, { delay: 500 })
await page.getByRole('button', { name: 'Open dashboard' }).click()
// The recording frame resizes 500 ms into the click above.
```

Every update on this page accepts `delay`: `resizeRecording`,
`hideRecording` / `showRecording`, and `hideNarration` / `showNarration`. It
combines freely with `duration` (the transition starts at the delayed
instant). The same option exists on media `start()` calls (narration cues,
overlays) and on the `hide` / `speed` / `time` wrappers, where it shifts the
recorded start only.

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
- **No overlapping updates**: a second update on the same target (narration
  or recording) throws if it lands before the previous transition has
  finished. Wait out the transition first (for example
  `await page.waitForTimeout(600)` after a 600 ms move).
- **Recording drop shadow**: the standard 0-1 `dropShadow` moves and scales
  with the animated recording frame. A custom CSS-string shadow authored in
  the editor is not rendered while recording updates are used.
- **Updates inside `hide()` spans**: an animation that would span cut
  footage is clamped, so it completes by the cut instead of animating
  through removed time.
- **Cursor**: the pointer rides the recording frame through resizes and
  hides with it. During zooms combined with recording resize the cursor
  follows the largest recording size instead; prefer keeping zoomed,
  pointer-heavy interaction at the recording's largest size.
