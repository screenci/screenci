# Redact Sensitive Content

Use `redact` to keep secrets (API keys, account numbers, personal data) out of a
recording. ScreenCI records the live browser page locally and uploads that
`recording.mp4` to the service for rendering, so `redact` masks the content **in
the page itself, before the frame is captured**. The obscured pixels never enter
the recording and are never uploaded. By default the mask is an opaque panel
filled with a color sampled from the surface underneath, with rounded corners and
a shadow (both adjustable) so it reads as a deliberate redaction chip rather than
an empty field. It is fully opaque, so it cannot leak under any renderer.

> This is true redaction. It is different from drawing an
> [overlay](/docs/guides/overlays) over the content: an overlay is composited by
> the service after the raw recording (with the secret still visible) has been
> uploaded. Use an overlay only for cosmetic covers, never for secrets.

#### You will learn

- [how to mask a locator](#redactlocator)
- [how to mask a typed secret](#masking-a-typed-secret)
- [how to mask always-secret elements from the first frame](#always-secret-elements)
- [how to style the mask](#mask-appearance)

## `redact(locator)`

Mask everything the locator matches. The call returns a handle you can use to
reveal it again later:

```ts
import { redact } from 'screenci'

const handle = await redact(page.getByTestId('api-key'))
// ... the key stays masked through the rest of the video
await handle.unredact()
```

Pass a callback to mask only for the duration of a block (the mask is removed
automatically when the block finishes, even if it throws):

```ts
await redact(page.getByTestId('balance'), async () => {
  await page.getByRole('button', { name: 'Reveal' }).click()
})
```

For a secret that is **already on screen**, register the mask before it becomes
visible (inside `hide()` or via the config option below), so there is no frame
where it could be captured in the clear.

## Masking a typed secret

`fill` and `pressSequentially` take a `redact` option. The mask is applied before
the first character is typed, so a password or token is never captured as it is
entered:

```ts
await page.getByLabel('Password').fill('hunter2', { redact: true })
await page.getByLabel('API key').fill(apiKey, {
  redact: { style: { color: '#fff3d6', radius: 10 } },
})
```

## Always-secret elements

For elements that are secret for the whole video, list their CSS selectors under
`recordOptions.redact`. They are masked from the very first painted frame, before
any page script runs, so there is no reveal race:

```ts
// screenci.config.ts (or a per-video use())
recordOptions: {
  redact: ['.api-key', '[data-sensitive]'],
}
```

## Mask appearance

The mask is always an opaque panel (it cannot leak under any renderer). By
default it samples its color from the surface underneath. Override it with
`RedactOptions.style`:

```ts
await redact(page.locator('.ssn'), { style: { color: '#fff3d6', radius: 10 } })
await redact(page.locator('.token'), {
  style: {
    css: 'background: repeating-linear-gradient(45deg,#222 0 6px,#333 6px 12px)',
  },
})
```

- `color`: a fixed fill color. Omit it to sample a color from underneath
  (the default).
- `radius`: corner radius in px (default 12).
- `shadow`: CSS box-shadow, or `false` to disable it.
- `css`: extra CSS applied to the panel for full custom styling (a pattern, a
  gradient, a label). Applied last, so it overrides the defaults. Keep the panel
  opaque, or the content underneath may show through.

## Related pages

- [Animated Interactions](/docs/guides/animated-interactions)
- [Overlays](/docs/guides/overlays)
- [Configuration](/docs/reference/configuration)
