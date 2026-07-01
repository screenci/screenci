# Camera and Zooming

ScreenCI has two camera styles: `autoZoom()` for sections where the camera should follow the interaction automatically, and manual zoom helpers when you want exact framing. Treat these as direction tools, not decorative effects.

#### You will learn

- [when to use `autoZoom()`](#automatic-zoom)
- [when to use manual framing](#manual-zoom)
- [how to direct attention with multiple zooms](#manual-zoom)
- [how to keep camera motion readable](#manual-zoom)
- [how to shrink the recording to show the background](#recording-size)

<!-- screenci-doc-video:docs/guides/camera-and-zooming -->

## Automatic zoom

```ts
import { autoZoom, video } from 'screenci'

video('Edit profile', async ({ page }) => {
  await page.goto('/settings/profile')

  await autoZoom(async () => {
    await page.getByLabel('Name').fill('Jane Doe')
    await page.getByLabel('Email').fill('jane@screenci.com')
    await page.getByRole('button', { name: 'Save' }).click()
  })
})
```

Use it when the viewer should follow a group of related actions, such as filling a form or editing a focused panel.

`autoZoom()` works best when it covers a real interaction cluster, not a single isolated click. Wrap the whole related sequence so ScreenCI can zoom in, follow the active area, and zoom back out once the section is finished.

For locator targets, ScreenCI compares your chosen zoom `amount` with a padded fit around the target and keeps the larger viewport. The default `padding` is `0.2`, which gives the viewer some breathing room instead of cropping tightly around the element.

Use automatic zoom when the camera should react to the flow instead of following a storyboard you planned in advance.

## Manual zoom

```ts
import { resetZoom, video, zoomTo } from 'screenci'

video('Dashboard walkthrough', async ({ page }) => {
  await page.goto('/dashboard')

  await zoomTo(page.getByText('Net revenue'))
  await page.waitForTimeout(600)

  await zoomTo(page.getByText('Conversion rate'))
  await page.waitForTimeout(600)

  await zoomTo({ x: 1200, y: 680 })
  await page.waitForTimeout(600)

  await resetZoom()
})
```

Manual framing is better when:

- you want to frame something before interacting with it
- the important target is not the next clicked element
- you want a deliberate pan between two exact points

`zoomTo()` accepts either a locator or an explicit viewport point like `{ x, y }`. Use a locator when you want framing to stay tied to a real UI target. Use a point when you want a very deliberate composition or pan that is not attached to the next clickable element.

To place a target without zooming, `scrollIntoViewIfNeeded()` also accepts framing options, `centering` (`0`-`1`), plus `amount`, `duration`, and `easing`. `centering: 0` reveals the target at the top of the frame, `1` centers it, and something like `0.2` keeps it high with context below:

```ts
await page
  .getByPlaceholder('Style prompt')
  .scrollIntoViewIfNeeded({ centering: 0.2 })
```

Plain interactions (a `click()`, `fill()`, `scrollIntoViewIfNeeded()`, etc. that are not zooming) auto-scroll their target into view with a **direction-aware minimal reveal**: the target is scrolled only as far as needed to bring it into a comfort band, so the motion follows the direction it enters from. Scroll down to reach a target below the fold and it rests near the bottom of the frame; scroll up to a target above the fold and it rests near the top; a target that is already comfortably visible is not scrolled at all. `recordOptions.scrollCentering` (`0`-`1`, default `0.2`) sets the band inset: `0` reveals the target right at the nearest edge (a pure minimal reveal), `1` always centers it, and the default `0.2` keeps a comfortable margin at the framing edges. An explicit per-call `centering` (via `scrollIntoViewIfNeeded({ centering })` or an interaction's zoom options) opts out of the band and uses fixed placement instead (for example `centering: 0.2` always lands the target high, regardless of scroll direction), and `zoomTo()`/`autoZoom()` keep their own tight fixed centering.

Manual zoom becomes more useful when one focused sequence has multiple camera beats:

- zoom to one panel
- stay close while the viewer reads it
- pan to another panel or metric
- finish on a hand-picked point
- reset to the full frame at the end

`resetZoom()` returns from the current manual zoom state to the full recording viewport, so it is the natural last step after multiple `zoomTo()` calls.

Keep manual zoom readable:

- use one camera idea for a segment
- do not zoom every interaction just because you can
- keep movement slower and simpler than your first instinct
- reset to the full frame after a focused sequence

Do not mix `autoZoom()` and manual zooming at the same time. In practice, that means:

- do not call `zoomTo()` or `resetZoom()` inside `autoZoom()`
- do not start `autoZoom()` while a manual zoom is still active

for the exported zoom helpers.

## Recording size

By default the recording fills the output frame ("full screen"). `resizeRecording()` shrinks it to a fraction of the frame so the styled background shows around it, which is useful for a deliberate "step back" moment. `resetRecordingSize()` returns to full screen.

```ts
import { resetRecordingSize, resizeRecording, video } from 'screenci'

video('Pricing overview', async ({ page }) => {
  await page.goto('/pricing')

  await resizeRecording(0.8)
  await page.getByRole('button', { name: 'Compare plans' }).click()
  await page.waitForTimeout(800)

  await resetRecordingSize()
})
```

`size` is a `0-1` fraction of the frame: `1` is full screen, `0.8` shows the recording at 80% of the frame, centered. The switch is an instant cut, in effect from the call until `resetRecordingSize()` (or the end of the video). `resetRecordingSize()` is a no-op when the recording is already full screen.

This is the timeline version of the static `recording.size` render option: set `recording.size` in `renderOptions` to start the whole video at a fixed size, or call `resizeRecording()` to change size at a specific beat. The same base size set in `renderOptions` applies until the first `resizeRecording()` call.

Keep size and zoom separate: hold a steady recording size across any `zoomTo()`/`autoZoom()` sequence rather than resizing while the camera is zoomed in.

## Motion blur

Camera pans and zooms are blurred by default so fast movement smears naturally
instead of stepping frame to frame. Tune it with `zoom.motionBlur` in
`renderOptions` (0-1, default `0.5`, `0` disables it). The cursor has its own
independent `mouse.motionBlur`. See
[Configuration](/docs/reference/configuration#motion-blur) for the full reference.
