# Studio

Studio lets your team remix videos from the ScreenCI web app: change render
options, narration text, and voices without touching code or re-running the
recording. Studio is available on the Business tier.

There are two ways to use it:

- **Opt in from code.** Declare narration cue names with
  `video.localize({ languages, studio: { narration: [...] } })`, overlay keys with
  `createStudioOverlays`, background audio keys with `createStudioAudio`, and set
  `renderOptions: 'studio'`. Those items are then edited on the Studio page. Your
  edits are saved and applied automatically to every later upload.
- **Render a one-off version.** Any video can be opened in Studio and rendered
  as a one-off, overriding any code-defined narration, overlays, or render
  options for a single render. One-off renders are not saved and do not change
  what future uploads render.

#### You will learn

- [how to edit and render a video in Studio](#editing-in-studio)
- [how saved edits and one-off renders differ](#saved-edits-vs-one-off-renders)
- [how to manage narration from Studio](#studio-narration-from-code)
- [how to use uploaded media as narration](#narration-media-from-studio)
- [how to manage overlays from Studio](#studio-overlays-from-code)
- [how to manage background audio from Studio](#studio-audio-from-code)
- [how to defer render options to Studio](#studio-render-options)

## Editing in Studio

Open a video in the web app and choose **Open in Studio**. Studio shows the
narration, voices, overlays, audio, and render options the video uses. Items you
opted into from code (name-only `video.localize` narration, `createStudioOverlays`,
`createStudioAudio`, `renderOptions: 'studio'`) are editable; anything defined in
code is shown read-only and marked with a **code** badge.

Edits autosave: a status line shows **Saving...** and then **All changes
saved**. The saved set is this video's Studio configuration, and it is applied
automatically to every later upload (see [Saved edits vs one-off
renders](#saved-edits-vs-one-off-renders)).

Pick a language at the top, then choose **Render** to render a new version in
that language from the same recording. Rendering is per language: switch the
language and render again to update another localized version.

Studio versions are marked with a **Studio** badge in the version list, and the
version page shows exactly which values were changed compared to the
code-specified ones.

## Saved edits vs one-off renders

Studio separates changes that stick from changes that do not:

- **Saved edits** to studio-declared items (name-only `video.localize`
  narration, `createStudioOverlays`, `createStudioAudio`, `renderOptions: 'studio'`) autosave
  into the video's Studio configuration. That configuration is reused
  automatically on every later upload, so CI keeps rendering with your Studio
  values instead of the code defaults. When this happens the CLI prints a line
  in the upload output, so it is visible in CI logs:

  ```
  Studio configuration applied for "Checkout walkthrough".
  ```

- **One-off renders** let you change anything, including values defined in code.
  Choose **Create one-off version**, confirm the prompt, edit freely, then
  **Render one-off** to produce a single version. One-off renders are not saved
  and never change what future uploads render. To make a code-defined value
  editable in the normal, saved flow instead, switch it to the matching Studio
  variant in code (the name-only `narration` form below, `createStudioOverlays`,
  `createStudioAudio`, or `renderOptions: 'studio'`).

## Studio narration from code

List the cue names under `studio.narration` (instead of a per-language text map)
to declare the cue keys in code while the narration text, languages, and voices
are configured in Studio. Provide the `languages` explicitly, since there is no
seeded text to infer them from:

```ts
import { video } from 'screenci'

video.localize({
  languages: ['en'],
  studio: { narration: ['intro', 'checkout', 'outro'] },
})('Checkout walkthrough', async ({ page, narration }) => {
  await narration.intro()
  await page.goto('/checkout')
  await narration.checkout.start()
  // ... visible workflow ...
  await narration.checkout.end()
  await narration.outro()
})
```

The cues behave exactly like seeded `localize` narration cues: callable, with
explicit `start()` and `end()`, and automatic sequencing between consecutive
cues. TypeScript knows the declared keys, so `narration.typo` is a compile error.

For each cue, Studio exposes the same voice controls available in code (model
type, style, accent, and pacing) plus a per-cue volume, alongside the narration
text and language list.

On the **first upload** of a studio-mode video, rendering is held until
someone fills in the narration on the Studio page. The CLI prints the hold
together with a direct link to Studio:

```
Rendering for "Checkout walkthrough" is on hold. Configure it in Studio:
https://app.screenci.com/project/<projectId>/video/<videoId>/studio
```

After the video has been configured once, subsequent uploads reuse the saved
Studio configuration and render automatically.

See [Narration and Localization](/docs/guides/narration-and-localization) for the
full `video.localize` API.

## Narration media from Studio

Any editable narration entry in Studio can use an uploaded media file instead
of synthesized speech, the web equivalent of a `localize` narration cue's
`{ media: './intro.mp4' }` entry. Switch a cue's entry from **Text** to
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
it (up to `4`). Video overlays also have **speed** and **time** controls: speed
plays the clip faster or slower (a multiplier), and time fits it to a target
playback duration in ms. Set at most one.
TypeScript knows the declared keys, so `overlays.typo` is a compile error.

Like studio narration, the first upload of a video using `createStudioOverlays`
is held until every declared overlay has a file configured in Studio. The CLI
prints a direct link. Later uploads reuse the saved configuration. See
[Overlays](./overlays.md) for how overlays behave on the timeline.

API reference: [createStudioOverlays()](/docs/reference/api/functions/createStudioOverlays)

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
Tracks also have **speed** and **time** controls: speed plays the track faster
or slower (a multiplier), and time fits it to a target playback duration in ms.
Set at most one.
TypeScript knows the declared keys, so `music.typo` is a compile error.

Like studio overlays, the first upload of a video using `createStudioAudio` is
held until every declared track has a file configured in Studio. The CLI prints
a direct link. Later uploads reuse the saved configuration. See
[Background audio](./overlays.md) for how audio behaves on the
timeline.

API reference: [createStudioAudio()](/docs/reference/api/functions/createStudioAudio)

## Studio render options

Set the `renderOptions` option to `'studio'` to manage render options from
Studio instead of code:

```ts
import { defineConfig } from 'screenci'

export default defineConfig({
  use: {
    renderOptions: 'studio',
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
