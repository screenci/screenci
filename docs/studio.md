# Studio

Studio lets your team remix videos from the ScreenCI web app — change render
options, narration text, and voices without touching code or re-running the
recording. Studio is available on the Business tier.

There are two ways to use it:

- **Remix an existing video.** Any video recorded with `createNarration` can
  be remixed in Studio. Your code-specified values are prefilled; override
  them and render a new version server-side.
- **Opt in from code.** Declare cue keys with `createStudioNarration` and set
  `renderOptions: STUDIO_RENDER_OPTIONS` so narration and render options are
  managed entirely on the Studio page.

#### You will learn

- [how to remix a video from the web](#remix-a-video)
- [how to reapply or auto-apply a remix](#reapply-and-auto-apply)
- [how to manage narration from Studio](#studio-narration-from-code)
- [how to defer render options to Studio](#studio-render-options)

## Remix a video

Open a video in the web app and choose **Open in Studio**. Studio shows the
current narration text, voices, and render options from the latest upload.
Change what you need and choose **Save & render** — a new version is rendered
from the same recording, with your overrides applied.

Remixed versions are marked with a **Studio** badge in the version list, and
the version page shows exactly which values were changed compared to the
code-specified ones.

A remix is one-off by default: the next CI upload renders with the values
from code again.

## Reapply and auto-apply

Your Studio edits are saved with the video, so reapplying the same changes to
a newer upload is one click.

If you want every new upload to get the same treatment, enable
**Auto-apply to new uploads** in Studio. When auto-apply is active, the CLI
prints which selections were overridden in Studio as part of the upload
output, so it is always visible in CI logs that the rendered video differs
from what the code specifies.

## Studio narration from code

`createStudioNarration` declares the cue keys in code while the narration
text, languages, and voices are configured in Studio:

```ts
import { createStudioNarration, video } from 'screenci'

const narration = createStudioNarration('intro', 'checkout', 'outro')

video('Checkout walkthrough', async ({ page }) => {
  await narration.intro()
  await page.goto('/checkout')
  await narration.checkout.start()
  // ... visible workflow ...
  await narration.checkout.end()
  await narration.outro()
})
```

The cues behave exactly like `createNarration` cues — callable, with explicit
`start()` and `end()`, and automatic sequencing between consecutive cues.
TypeScript knows the declared keys, so `narration.typo` is a compile error.

On the **first upload** of a studio-mode video, rendering is held until
someone fills in the narration on the Studio page. The CLI prints the hold
together with a direct link to Studio:

```
Rendering for "Checkout walkthrough" is on hold — configure it in Studio:
https://app.screenci.com/project/<projectId>/video/<videoId>/studio
```

After the video has been configured once, subsequent uploads reuse the saved
Studio configuration and render automatically.

## Studio render options

Set the `renderOptions` option to `STUDIO_RENDER_OPTIONS` to manage render
options from Studio instead of code:

```ts
import { defineConfig, STUDIO_RENDER_OPTIONS } from 'screenci'

export default defineConfig({
  use: {
    renderOptions: STUDIO_RENDER_OPTIONS,
  },
})
```

This works in the top-level `use` block and in per-project `use` blocks. Until
the video is configured in Studio, uploads render with the default render
options (or are held together with studio narration, if both are used).

## Tier requirements

Studio requires the **Business** tier. Uploads that opt into studio mode from
code are rejected at upload start on other tiers, and the Studio page shows an
upgrade prompt instead of the editor.
