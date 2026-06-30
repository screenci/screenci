# Studio

Studio lets your team remix videos from the ScreenCI web app: change render
options, narration text, and voices without touching code or re-running the
recording. Studio is available on the Business tier.

There are two ways to use it:

- **Opt in from code.** Declare a feature with an **array of names** (for example
  `video.narration(['intro'])`) to hand it to Studio: the names exist in code,
  but the web app owns their content. The same is true of `video.values([...])`,
  `video.overlays([...])`, and `video.audio([...])`. Render and record options are
  deferred with `use({ renderOptions: 'studio' })` and
  `use({ recordOptions: 'studio' })`. Those items are then edited on the Studio
  page. Your edits are saved and applied automatically to every later upload.

  Declaring a feature with an **object** instead (for example
  `video.narration({ en: {...} })`) keeps the values in code. This array-vs-object
  split is the single mental model: an array of names means "these exist but the
  web app owns their content" (Studio-editable), an object means the values are
  defined in code.

  Opt in **per video and per feature**: each declaration and option flag is
  independent, so you can hand Studio just one thing (for example only
  `video.overlays([...])`) and leave everything else code-defined. There is no
  all-or-nothing switch.

- **Render a one-off version.** Any video can be opened in Studio and rendered
  as a one-off, overriding any code-defined narration, overlays, or render
  options for a single render. One-off renders are not saved and do not change
  what future uploads render.

The `video.narration`, `video.values`, `video.overlays`, and `video.audio` name
arrays type the matching fixtures to exactly those names, so a typo is a compile
error. The fixtures (`narration`, `values`, `overlays`, `audio` in the test body)
expose the Studio-managed controllers and values alongside any defined in code.

#### You will learn

- [how to edit and render a video in Studio](#editing-in-studio)
- [how saved edits and one-off renders differ](#saved-edits-vs-one-off-renders)
- [how to manage narration from Studio](#studio-narration-from-code)
- [how to use uploaded media as narration](#narration-media-from-studio)
- [how to manage on-screen values from Studio](#studio-values-from-code)
- [how to manage overlays from Studio](#studio-overlays-from-code)
- [how to manage background audio from Studio](#studio-audio-from-code)
- [how to defer render and record options to Studio](#studio-render-and-record-options)
- [how to manage languages from Studio](#studio-languages-from-code)

<!-- screenci-doc-video:docs/guides/studio -->

## Editing in Studio

Open a video in the web app and choose **Open in Studio**. Studio shows the
narration, voices, overlays, audio, and render options the video uses. Items you
opted into from code by declaring an array of names (`video.narration([...])`,
`video.values([...])`, `video.overlays([...])`, `video.audio([...])`, plus the
`renderOptions: 'studio'` / `recordOptions: 'studio'` deferrals) are editable;
anything defined in code is shown read-only and marked with a **code** badge.

Click a **code** badge to see how to edit that value: it shows the exact
declaration to opt the feature in for saved edits (the array form, for example
`video.narration([...])`), links to that feature's guide, and offers to create a
one-off version to change it just once. Each section also has a **How to edit
from Studio** link to the matching guide below.

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

- **Saved edits** to studio-declared items (anything declared as an array of
  names: `video.narration([...])`, `video.values([...])`, `video.overlays([...])`,
  `video.audio([...])`, plus the `renderOptions: 'studio'` /
  `recordOptions: 'studio'` deferrals) autosave into the video's Studio
  configuration. That configuration is reused automatically on every later
  upload, so CI keeps rendering with your Studio values instead of the code
  defaults. When this happens the CLI prints a line in the upload output, so it
  is visible in CI logs:

  ```
  Studio configuration applied for "Checkout walkthrough".
  ```

- **One-off renders** let you change anything, including values defined in code.
  Choose **Create one-off version**, confirm the prompt, edit freely, then
  **Render one-off** to produce a single version. One-off renders are not saved
  and never change what future uploads render. To make a code-defined value
  editable in the normal, saved flow instead, declare it as an array of names
  (switch `video.narration({...})` to `video.narration([...])`, and likewise for
  `values`, `overlays`, or `audio`, or set `use({ renderOptions: 'studio' })` /
  `use({ recordOptions: 'studio' })`).

## Studio narration from code

Pass an **array of cue names** to `video.narration([...])` to declare the cue
keys in code while the narration text, languages, and voices are configured in
Studio. Chain `.languages([...])` to set the language list, since there is no
text in code to infer it from:

```ts
import { video } from 'screenci'

video.narration(['intro', 'checkout', 'outro']).languages(['en'])(
  'Checkout walkthrough',
  async ({ page, narration }) => {
    await narration.intro()
    await page.goto('/checkout')
    await narration.checkout.start()
    // ... visible workflow ...
    await narration.checkout.end()
    await narration.outro()
  }
)
```

The cues behave exactly like cues whose text is defined in code: callable, with
explicit `start()` and `end()`, and automatic sequencing between consecutive
cues. TypeScript knows the declared names, so `narration.typo` is a compile
error.

For each cue, Studio exposes the same voice controls available in code (model
type, style, accent, and pacing) plus a per-cue volume, alongside the narration
text and language list.

On the **first upload** of a studio-mode video, rendering is held until
someone fills in the narration on the Studio page. The CLI prints the hold
together with a direct link to Studio:

```
Rendering for "Checkout walkthrough" is on hold. Configure it in Studio:
https://app.screenci.com/project/<projectId>/video/<videoId>?studio
```

After the video has been configured once, subsequent uploads reuse the saved
Studio configuration and render automatically.

To define narration values in code instead, pass an object with language-code
keys: `video.narration({ en: {...}, fi: {...} })`. See [Narration](/docs/guides/narration) for the full narration API.

## Narration media from Studio

Any editable narration entry in Studio can use an uploaded media file instead
of synthesized speech, the web equivalent of a code narration cue's
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

## Studio values from code

On-screen values injected through the `values` fixture can be managed from
Studio. Pass an **array of field names** to `video.values([...])` to keep the
value in Studio, or pass an object with language-code keys to define the values
in code and override them per language on the web:

```ts
video.values(['cta']).values({
  en: { heading: 'Dashboard' },
  fi: { heading: 'Hallinta' },
})('Landing', async ({ page, values }) => {
  await page.getByTestId('heading').fill(values.heading)
  await page.getByTestId('cta').fill(values.cta)
})
```

The video's **Values** section lists each declared field; set its value per
language. A Studio-managed `values` field that has not been set yet is the empty
string, so the first recording still succeeds and registers the field in Studio.

Unlike narration, voices, and overlays (which are applied when a version
renders), on-screen values are captured into the recording itself. Studio cannot
re-render them: saved values are injected by `screenci record` and take effect
on the **next recording**, not when you click **Render** and not on a one-off.
So the flow is: record once (unset fields capture blank), set the copy in the
Values section, then re-record to capture it. The Values section shows this
reminder inline, with a **Re-record this video** button that triggers a fresh
recording from the web when the project is connected to GitHub (otherwise it
links you to connect GitHub first).

See [Values](/docs/guides/values) for the code-side `values` fixture.

## Studio overlays from code

Pass an **array of overlay names** to `video.overlays([...])` to declare the
names in code while the files and display options are configured in Studio. The
declared names are exposed through the injected `overlays` fixture:

```ts
import { video } from 'screenci'

video.overlays(['intro', 'logo'])(
  'Product demo',
  async ({ page, overlays }) => {
    await overlays.intro()
    await page.goto('/dashboard')
    await overlays.logo()
  }
)
```

Calling a controller marks the point in the timeline, exactly like overlays
whose files are defined in code. The file (`.svg`, `.png`, or `.mp4`),
full-screen mode, overlay duration for images, and audio level for videos are
all set on the Studio page. The audio level is a linear-gain slider: `1` (the
default) plays the video at its natural level, `0` mutes it, and values above
`1` boost it (up to `4`). Video overlays also have **speed** and **time**
controls: speed plays the clip faster or slower (a multiplier), and time fits it
to a target playback duration in ms. Set at most one.
TypeScript knows the declared names, so `overlays.typo` is a compile error.

Like studio narration, the first upload of a video that declares Studio overlays
is held until every declared overlay has a file configured in Studio. The CLI
prints a direct link. Later uploads reuse the saved configuration. See
[Overlays](./overlays.md) for how overlays behave on the timeline.

## Studio audio from code

Pass an **array of track names** to `video.audio([...])` to declare the
background-audio names in code while the file, volume, and repeat are configured
in Studio. The declared names are exposed through the injected `audio` fixture:

```ts
import { video } from 'screenci'

video.audio(['theme', 'sting'])('Product demo', async ({ page, audio }) => {
  await audio.theme() // plays under the whole video
  await page.goto('/dashboard')
  await audio.sting.start()
  await page.click('#celebrate')
  await audio.sting.end()
})
```

Calling a controller marks the point in the timeline, exactly like audio tracks
whose files are defined in code: a bare call plays from that point to the end of
the video, while `start()`/`end()` bound the track to a span. The audio file, the
volume, and whether the track loops to fill its span are all set on the Studio
page. The volume is a linear-gain slider: `1` (the default) plays the source at
its natural level, `0` mutes it, and values above `1` boost it (up to `4`).
Tracks also have **speed** and **time** controls: speed plays the track faster
or slower (a multiplier), and time fits it to a target playback duration in ms.
Set at most one.
TypeScript knows the declared names, so `audio.typo` is a compile error.

Like studio overlays, the first upload of a video that declares Studio audio is
held until every declared track has a file configured in Studio. The CLI prints
a direct link. Later uploads reuse the saved configuration. See
[Background audio](./overlays.md) for how audio behaves on the
timeline.

## Studio render and record options

Set `use({ renderOptions: 'studio' })` to manage render options from Studio
instead of code. Render options are applied when the version renders:

```ts
import { video } from 'screenci'

video.use({ renderOptions: 'studio' })

video('Product demo', async ({ page }) => {
  await page.goto('/dashboard')
})
```

Set `use({ recordOptions: 'studio' })` to defer the record options (aspect
ratio, quality, fps) to Studio as well. Unlike render options, record options
change the captured viewport and encode, so they take effect on the **next
recording**, not when you click **Render**. They are fetched before the recording
runs and applied to that capture (later uploads reuse the saved values). Like the
Values section, the Recording options section shows this reminder inline with a
**Re-record this video** button:

```ts
video.use({ renderOptions: 'studio', recordOptions: 'studio' })

video('Product demo', async ({ page }) => {
  await page.goto('/dashboard')
})
```

These deferrals combine with the array-of-names declarations and `.each()` like
any other per-video configuration. For example, defer the record options while
handing narration and overlays to Studio:

```ts
video.use({ recordOptions: 'studio' })

video.narration(['intro']).overlays(['logo'])(
  'Product demo',
  async ({ page, narration, overlays }) => {
    await narration.intro()
    await page.goto('/dashboard')
    await overlays.logo()
  }
)
```

Until the video is configured in Studio, uploads render with the default options
(or are held together with studio narration, if both are used).

The recorded **language set** is managed separately via `video.languages(...)`:
see [Studio languages from code](#studio-languages-from-code) below. There is no
`recordOptions.languages`.

## Studio languages from code

Pass `'studio'` to `video.languages(...)` to hand the recorded language set to
the web app. The **Languages** section on the Studio page shows the current set
and lets you add or remove languages:

```ts
import { video } from 'screenci'

video.narration(['intro']).languages('studio')(
  'Product tour',
  async ({ page, narration }) => {
    await narration.intro()
    await page.goto('/dashboard')
  }
)
```

Adding a language triggers a re-record: the Languages section shows a
**Re-record this video** button that queues a new recording pass from the web
when the project is connected to GitHub. The new pass reuses the same Studio
narration, overlays, and audio configuration. Removing a language takes effect
on the next upload without re-recording.

Unlike narration text and overlays (applied at render time), the language set
changes the captured recording itself, so adding a language always requires a
new recording pass.

Use `'studio'` together with studio-declared narration
(`video.narration([...])`) so both the narration content and the language set
are owned by the web app. Combined with `use({ recordOptions: 'studio' })`, the
web app controls the full recording configuration.

To fix languages in code instead, pass an array (`video.languages(['en', 'fi'])`)
or a config object. See [Languages](./languages.md) for the full language API.

## Tier requirements

Studio requires the **Business** tier. Uploads that opt into studio mode from
code are rejected at upload start on other tiers, and the Studio page shows an
upgrade prompt instead of the editor.
