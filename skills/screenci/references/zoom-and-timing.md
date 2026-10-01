# Zoom, cursor speed, and timing

Start with defaults. Add overrides only when the person asks or the flow clearly needs it.

## Camera

- `zoomTo(locator)` / `resetZoom()`: a fixed frame for forms and steady editing.
- `autoZoom(async () => { ... })`: follows movement between targets. Keep blocks sparse, justify each by movement (not text entry), and end a block before a navigation (start a new one on the next page).

```ts
await zoomTo(page.getByRole('form', { name: /profile settings/i }))
await page.getByLabel('Name').fill('Emma Carter')
await page.getByRole('button', { name: 'Save changes' }).click()
await resetZoom()

await autoZoom(async () => {
  await page.getByRole('link', { name: 'Reports' }).click()
  await page.getByRole('option', { name: 'Last 30 days' }).click()
})
```

## Cursor move speed

Every cursor-moving locator action (`click`, `fill`, `check`, `hover`, `selectOption`, `dragTo`, ...) takes a nested `move` option:

```ts
await page.getByRole('button', { name: 'Save' }).click({
  move: { duration: 1200, easing: 'ease-out' }, // ms, default 900
})
await page.getByLabel('Company').fill('Aperture Bio', { move: { speed: 500 } }) // px/s
await page
  .getByRole('link', { name: 'Docs' })
  .click({ move: { curve: 'natural' } })
```

- `duration` and `speed` are mutually exclusive. Other fields: `easing` (default `'ease-in-out'`), `curve` (`'none' | 'natural' | 'arc' | [x1, y1, x2, y2]`), `curviness`, `delayAfter` (ms pause after arrival).
- There are no flat `moveDuration`/`moveSpeed` options; always nest under `move`.
- `page.mouse.move(x, y, { duration, speed, easing, curve })` takes them directly.
- Typing time: `fill(value, { duration })` (default 1000 ms total); `pressSequentially` scales with text length.
- Project-wide curve: `video.recordOptions({ cursorCurve: 'natural' })`.

## Speeding up or slowing down a section

```ts
await speed(3, async () => {
  // a slow upload, played back 3x faster in the render
})
await speed(async () => {
  /* multiplier editable in the web editor */
})
```

`hide(async () => { ... })` removes a section entirely. In `test`, cursor and camera pauses take no time.

Full guides: [Animated interactions](https://screenci.com/docs/guides/animated-interactions), [Camera and zooming](https://screenci.com/docs/guides/camera-and-zooming).
