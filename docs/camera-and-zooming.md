# Camera and Zooming

ScreenCI has two camera styles: `autoZoom()` for sections where the camera should follow the interaction automatically, and manual zoom helpers when you want exact framing. Treat these as direction tools, not decorative effects.

#### You will learn

- [when to use `autoZoom()`](#automatic-zoom)
- [when to use manual framing](#manual-zoom)
- [how to direct attention with multiple zooms](#manual-zoom)
- [how to keep camera motion readable](#manual-zoom)

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
