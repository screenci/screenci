---
title: Zooming
description: Use autoZoom for interaction-following camera moves, or zoomTo and resetZoom for explicit manual framing.
---

# Zooming

ScreenCI supports two camera styles:

`autoZoom()` is for sections where the camera should follow the active interaction automatically. `zoomTo()` and `resetZoom()` are for explicit, author-controlled framing.

Use one style at a time. You cannot call `zoomTo()` or `resetZoom()` inside `autoZoom()`, and you cannot start `autoZoom()` while a manual zoom is active.

## `autoZoom()` for guided interaction sections

`autoZoom()` is the higher-level option. Wrap a form, dialog, or page section and ScreenCI will zoom in, follow the active element, and zoom back out when the section is done.

```ts
import { autoZoom, video } from 'screenci'

video('Settings demo', async ({ page }) => {
  await page.goto('/settings/profile')

  await autoZoom(async () => {
    await page.locator('#name').fill('Jane Doe')
    await page.locator('#email').fill('jane@example.com')
    await page.locator('button[type="submit"]').click()
    await page.waitForTimeout(600)
  })
})
```

Use `autoZoom()` when:

Use `autoZoom()` when the viewer should follow a cluster of related interactions, when you want the camera to adapt to clicks and fills automatically, and when you want one zoom-in and one zoom-out around a whole section.

Avoid wrapping a single isolated click. `autoZoom()` works best when it covers a meaningful chunk of the flow.

Locator zooms compare `amount` with a padded locator fit and keep whichever viewport is larger. The padded fit preserves the recording aspect ratio and uses the more limiting side to decide how far to zoom out, so the other side can end up with extra room instead of stretching the video. The default `padding` is `0.2`. Point framing is not affected by `padding`.

You can control things like zoom amount, padding, duration, and easing. See the [API overview](/reference/api-overview/) for the full `autoZoom()` option reference.

## Manual zoom with `zoomTo()` and `resetZoom()`

Manual zooming is the lower-level option. It is useful when you want to frame something specific before any interaction happens, or when you want a deliberate pan between exact targets.

```ts
import { resetZoom, video, zoomTo } from 'screenci'

video('Manual zoom demo', async ({ page }) => {
  await page.goto('/dashboard')
  await zoomTo(page.locator('#quarterly-chart'))
  await page.waitForTimeout(800)
  await zoomTo({ x: 1200, y: 680 })
  await page.waitForTimeout(800)
  await resetZoom()
})
```

`zoomTo()` supports either a `Locator` or an explicit point `{ x, y }` in viewport coordinates.

For locator targets, `zoomTo()` also compares `amount` with the padded locator fit and keeps the larger viewport. That fit preserves the recording aspect ratio and uses the more limiting side, so the other axis may have extra room. The default `padding` is `0.2`. Explicit point zoom still uses only `amount`.

### When manual zoom is a better fit

Use manual zoom when:

Use manual zoom when you want to frame something before clicking it, when you want to pan between exact points or overlays, when you want to stay zoomed in across multiple clicks or steps and reset later, or when `autoZoom()` does not behave the way you want for a specific section and you need explicit camera control.

### `resetZoom()`

`resetZoom()` returns from the current manual zoom state back to the full recording viewport.

That makes manual zoom useful for sequences like:

1. zoom in to a chart or panel
2. pan to another point while staying zoomed
3. reset back to the full page

You can control things like zoom amount, padding, duration, and easing. See the [API overview](/reference/api-overview/) for the full `zoomTo()` and `resetZoom()` option reference.

## Choosing between them

Use `autoZoom()` when the camera should react to the flow.

Use `zoomTo()` when the camera should follow your explicit direction.

As a rule of thumb:

Use `autoZoom()` for forms, multi-step editing, and related interaction clusters. Use manual zoom for overlays, dashboards, charts, sticky panels, and deliberate pans.

## Related docs

[Writing Video Tests](/reference/video-tests) covers ScreenCI interaction behavior. [API Overview](/reference/api-overview) covers the public zoom helper signatures.
