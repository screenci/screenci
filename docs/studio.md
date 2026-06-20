# Studio

Studio lets your team remix videos from the ScreenCI web app: change render
options, narration text, and voices without touching code or re-running the
recording. Studio is available on the Business tier.

There are two ways to use it:

- **Remix an existing video.** Any video recorded with `createNarration` can
  be remixed in Studio. Your code-specified values are prefilled. Override
  them and render a new version server-side.
- **Opt in from code.** Declare cue keys with `createStudioNarration`, overlay
  keys with `createStudioOverlays`, background audio keys with
  `createStudioAudio`, and set `renderOptions: STUDIO_RENDER_OPTIONS` so
  narration, overlays, background audio, and render options are managed entirely
  on the Studio page.

#### You will learn

- [how to remix a video from the web](#remix-a-video)
- [how to reapply or auto-apply a remix](#reapply-and-auto-apply)
- [how to manage narration from Studio](#studio-narration-from-code)
- [how to use uploaded media as narration](#narration-media-from-studio)
- [how to manage overlays from Studio](#studio-overlays-from-code)
- [how to manage background audio from Studio](#studio-audio-from-code)
- [how to defer render options to Studio](#studio-render-options)

## Remix a video

Open a video in the web app and choose **Open in Studio**. Studio starts from
the code-specified narration, voices, and render options and lets you **add
modifications** on top: only the changes you make are kept, so a saved override
always means "this was set in Studio, not in code". Studio-declared items
(`createStudioNarration`, `createStudioOverlays`, `createStudioAudio`,
`STUDIO_RENDER_OPTIONS`) are shown as required fields you must fill in before
the first render.

Choose **Save & render** to store your changes in the override set and render a
new version from the same recording. Choose **Render once** to render with your
current edits without saving them: the override set is left untouched, which is
handy for trying a one-off tweak.

Rendering is per language: next to the render button you can toggle which
languages to render, so a one-language fix doesn't re-render every localized
version.

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
prints a line in the upload output so it is always visible in CI logs that the
rendered video uses the Studio configuration rather than what the code
specifies:

```
Studio configuration applied for "Checkout walkthrough".
```

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

The cues behave exactly like `createNarration` cues: callable, with explicit
`start()` and `end()`, and automatic sequencing between consecutive cues.
TypeScript knows the declared keys, so `narration.typo` is a compile error.

On the **first upload** of a studio-mode video, rendering is held until
someone fills in the narration on the Studio page. The CLI prints the hold
together with a direct link to Studio:

```
Rendering for "Checkout walkthrough" is on hold. Configure it in Studio:
https://app.screenci.com/project/<projectId>/video/<videoId>/studio
```

After the video has been configured once, subsequent uploads reuse the saved
Studio configuration and render automatically.

## Narration media from Studio

Any editable narration entry in Studio can use an uploaded media file instead
of synthesized speech, the web equivalent of `createNarration`'s
`{ media: './intro.mp4' }` entries. Switch a cue's entry from **Text** to
**Media**, upload an `.mp4` file, and optionally provide a subtitle used for
captions.

This works per language, so one language can use an uploaded recording while
the others keep text-to-speech. Entries whose media file is specified in code
stay read-only in Studio.

### Media subtitles

A media narration entry can carry an optional subtitle. When you leave it
blank, captions are generated automatically from the speech in the uploaded
file. When you provide one, that text is used instead. Either way, captions are
timed from the detected speech, so they appear only while the line is actually
spoken (not during any leading silence or music).

## Studio overlays from code

`createStudioOverlays` declares overlay keys in code while the files and display
options are configured in Studio:

```ts
import { createStudioOverlays, video } from 'screenci'

const overlays = createStudioOverlays('intro', 'logo')

video('Product demo', async ({ page }) => {
  await overlays.intro()
  await page.goto('/dashboard')
  await overlays.logo()
})
```

Calling a controller marks the point in the timeline, exactly like
`createOverlays` controllers. The file (`.svg`, `.png`, or `.mp4`), full-screen
mode, overlay duration for images, and audio level for videos are all set on
the Studio page. The audio level is a linear-gain slider: `1` (the default)
plays the video at its natural level, `0` mutes it, and values above `1` boost
it (up to `4`).
TypeScript knows the declared keys, so `overlays.typo` is a compile error.

Like studio narration, the first upload of a video using `createStudioOverlays`
is held until every declared overlay has a file configured in Studio. The CLI
prints a direct link. Later uploads reuse the saved configuration. See
[Overlays](./assets-and-overlays.md) for how overlays behave on the timeline.

## Studio audio from code

`createStudioAudio` declares background-audio keys in code while the file,
volume, and repeat are configured in Studio:

```ts
import { createStudioAudio, video } from 'screenci'

const music = createStudioAudio('theme', 'sting')

video('Product demo', async ({ page }) => {
  await music.theme() // plays under the whole video
  await page.goto('/dashboard')
  await music.sting.start()
  await page.click('#celebrate')
  await music.sting.end()
})
```

Calling a controller marks the point in the timeline, exactly like
`createAudio` controllers: a bare call plays from that point to the end of the
video, while `start()`/`end()` bound the track to a span. The audio file, the
volume, and whether the track loops to fill its span are all set on the Studio
page. The volume is a linear-gain slider: `1` (the default) plays the source at
its natural level, `0` mutes it, and values above `1` boost it (up to `4`).
TypeScript knows the declared keys, so `music.typo` is a compile error.

Like studio overlays, the first upload of a video using `createStudioAudio` is
held until every declared track has a file configured in Studio. The CLI prints
a direct link. Later uploads reuse the saved configuration. See
[Background audio](./assets-and-overlays.md) for how audio behaves on the
timeline.

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
