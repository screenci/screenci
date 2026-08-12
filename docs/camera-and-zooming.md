# Camera and Zooming

ScreenCI has two camera styles: `autoZoom()` for sections where the camera should follow the interaction automatically, and manual zoom helpers when you want exact framing. Treat these as direction tools, not decorative effects.

#### You will learn

- [when to use `autoZoom()`](#automatic-zoom)
- [when to use manual framing](#manual-zoom)
- [how to direct attention with multiple zooms](#manual-zoom)
- [how to keep camera motion readable](#manual-zoom)
- [how targets are placed in frame](#comfort-band-placement)
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

Inside an `autoZoom()` block the camera also follows raw cursor gestures. When you move the cursor by hand with `page.mouse.move` (or `page.mouse.click` / `page.mouse.dblclick`), the camera pans to keep the cursor framed, and zooms in on the first move if it was not already zoomed. This means hand-built gestures such as a slider drag composed from `page.mouse.move` / `down` / `up` stay in frame instead of leaving the camera parked on the last element:

```ts
await autoZoom(async () => {
  // The camera follows the cursor across the drag.
  await page.mouse.move(thumbX, thumbY)
  await page.mouse.down()
  await page.mouse.move(targetX, targetY)
  await page.mouse.up()
})
```

Use automatic zoom when the camera should react to the flow instead of following a storyboard you planned in advance.

Note on naming: `autoZoom`'s own `delay` / `delayAfter` options are real pauses slept before and after the zoom. They are unrelated to the `delay` option on overlay updates and media `start()` calls, which offsets an event's recorded timestamp (see [Mid-Video Overlay Updates](./overlay-updates.md#delaying-an-update-into-an-interaction)). Zoom brackets do not take that offset; use the editor's lead-in instead.

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

## Comfort-band placement

Every focus operation, whether it is a plain scroll, a `zoomTo()`, or an `autoZoom()` frame, uses one unified placement model: a **direction-aware comfort band**. The target is moved only as far as needed to bring it into the band, so the motion follows the direction it enters from. A target reached by scrolling down rests near the bottom of the frame; one reached by scrolling up rests near the top; a target that is already comfortably framed does not move at all.

To place a target without zooming, `scrollIntoViewIfNeeded()` accepts framing options, `centering` (`0`-`1`), plus `amount`, `duration`, and `easing`:

```ts
await page
  .getByPlaceholder('Style prompt')
  .scrollIntoViewIfNeeded({ centering: 0.2 })
```

`centering` (`0`-`1`) sets the band inset:

- `0` reveals the target right at the nearest edge (a pure minimal reveal),
- `1` collapses the band to a single point, so the target is always centered,
- anything in between keeps a proportional margin at the framing edges.

A target larger than the frame is always centered, regardless of `centering`.

For a zoom the focus window is the (smaller) zoom viewport, so the band is naturally tight: `centering: 1` centers exactly, and lower values nudge the target slightly toward the edge it came from.

The default `centering` varies by operation, and any explicit `centering` you pass overrides it (and is itself run through the band, so it stays direction-aware):

| Operation                                                     | Default centering                               |
| ------------------------------------------------------------- | ----------------------------------------------- |
| Plain scroll (`click`, `fill`, `scrollIntoViewIfNeeded`, ...) | `recordOptions.scrollCentering` (default `0.2`) |
| `zoomTo()` / manual zoom                                      | `1` (center)                                    |
| `autoZoom()` framing                                          | `0.6` (a tight direction-aware band)            |

## Overlays and zoom

By default [overlays](/docs/guides/overlays) are burned into the scene: when the camera zooms or pans, an overlay moves and scales with the recording underneath it, so a ring placed `over` an element stays glued to that element as you zoom into it. Set `pinToScreen: true` on an overlay to keep it fixed in screen space instead (a corner logo or badge that should stay put through a zoom). See [Overlays and zoom](/docs/guides/overlays#overlays-and-zoom-pintoscreen).

## Recording size

```ts
import { video } from 'screenci'

video.renderOptions({
  recording: { size: 0.8 },
})
```

By default the recording fills the output frame ("full screen"). Set `recording.size` in `renderOptions` when the whole video should sit inside the styled background. `size` is a `0-1` fraction of the frame: `1` is full screen, `0.8` shows the recording at 80% of the frame, centered.

Keep size and zoom separate: hold a steady recording size across any `zoomTo()`/`autoZoom()` sequence rather than resizing while the camera is zoomed in.

## Motion blur

Camera pans and zooms are blurred by default so fast movement smears naturally
instead of stepping frame to frame. Tune it with `zoom.motionBlur` in
`renderOptions` (0-1, default `0.5`, `0` disables it). The cursor has its own
independent `mouse.motionBlur`. See
[Configuration](/docs/reference/configuration#motion-blur) for the full reference.

## Mid-video layout changes

The narration bubble, the recording frame, and the background can all change
mid-video with animated transitions: see
[Mid-Video Overlay Updates](/docs/guides/overlay-updates).
