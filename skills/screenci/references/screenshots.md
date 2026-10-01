# Screenshots (stills)

`screenshot()` produces a still image instead of a video: same Playwright-style body, same overlays and branding, no narration and no camera. Use it when the person asks for an image (a README shot, a social card, a docs figure).

```ts
import { screenshot } from 'screenci'

screenshot('Billing overview', async ({ page, clip }) => {
  await page.goto('https://app.example.com/settings/billing')
  // A locator crop re-resolves on every re-record; padding frames it on the background.
  await clip(page.getByRole('region', { name: 'Plan' }), { padding: 48 })
})
```

- Never add `narration` to a `screenshot()`: a still is silent. Camera motion and audio are ignored.
- Only the final page state is kept, so `hide()` is a no-op and `autoZoom()` / `zoomTo()` do nothing. Drive the page to the state you want, then clip.
- A file can mix `video()` and `screenshot()`. For a still of a moment inside a video, call `page.screenshot({ name: 'Dashboard' })` in the `video()` body.
- Framing lives in code: `screenshot.renderOptions({ screenshot: { margin, aspectRatio, format } })`. Stills have no browser editor.
- `preview` and `export` treat stills like videos; exports are named `<title>.<lang>.png`.

Full reference: [Screenshots](https://screenci.com/docs/guides/screenshots).
