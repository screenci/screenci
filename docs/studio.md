# Studio

Studio lets your team remix videos from the ScreenCI web app: change render
options, narration text, and voices without touching code or re-running the
recording. Studio is available on the Business tier.

There are two ways to use it:

- **Opt in from code.** Wrap a feature's names in `studio(...)`, imported from
  `screenci`, so the web app owns their content while the names stay in code.
  Declaring the feature with a plain object keeps it in code instead. That is the
  whole mental model, and it is independent per video and per feature: hand Studio
  one feature and leave the rest in code, with no all-or-nothing switch. Studio
  edits autosave and apply automatically to every later upload.

- **Render a one-off version.** Any video can be opened in Studio and rendered
  as a one-off, overriding any code-defined narration, overlays, or render
  options for a single render. One-off renders are not saved and do not change
  what future uploads render.

The `video.narration`, `video.values`, `video.overlays`, and `video.audio`
`studio(...)` declarations type the matching fixtures to exactly those names, so a
typo is a compile error. The fixtures (`narration`, `values`, `overlays`, `audio`
in the test body) expose the Studio-managed controllers and values alongside any
defined in code.

The `studio(...)` forms at a glance:

```ts
import { video, studio } from 'screenci'

// Studio owns the content; the names still live in code.
video.narration(studio(['intro', 'outro']))
video.values(studio(['cta']))
video.overlays(studio(['intro', 'logo']))
video.audio(studio(['theme', 'sting']))

// Plain object instead: the content stays owned in code.
video.narration({ en: { intro: 'Welcome', outro: 'Thanks' } })

// Seed Studio with starting content (an edit in Studio wins over the seed).
video.narration(studio({ intro: 'Welcome' }))
video.values(studio({ cta: 'Get started' }))

// Languages: hand the whole set to Studio, or seed an initial set.
video.languages(studio()) // or studio(['en', 'fi'])

// Render / record options: defer for the whole file with use().
video.use({ renderOptions: studio(), recordOptions: studio() })
video.use({ renderOptions: studio({ output: { aspectRatio: '9:16' } }) })
```

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
opted into from code by wrapping their names in `studio(...)`
(`video.narration(studio([...]))`, `video.values(studio([...]))`,
`video.overlays(studio([...]))`, `video.audio(studio([...]))`, plus the
`renderOptions: studio()` / `recordOptions: studio()` deferrals) are editable;
anything defined in code is shown read-only and marked with a **code** badge.

Click a **code** badge to see how to edit that value: it shows the exact
declaration to opt the feature in for saved edits (the `studio(...)` form, for
example `video.narration(studio([...]))`), links to that feature's guide, and
offers to create a one-off version to change it just once. Each section also has
a **How to edit from Studio** link to the matching guide below.

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

- **Saved edits** to studio-declared items (anything wrapped in `studio(...)`:
  `video.narration(studio([...]))`, `video.values(studio([...]))`,
  `video.overlays(studio([...]))`, `video.audio(studio([...]))`, plus the
  `renderOptions: studio()` / `recordOptions: studio()` deferrals) autosave into
  the video's Studio
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
  editable in the normal, saved flow instead, wrap its names in `studio(...)`
  (switch `video.narration({...})` to `video.narration(studio([...]))`, and
  likewise for `values`, `overlays`, or `audio`, or set
  `use({ renderOptions: studio() })` / `use({ recordOptions: studio() })`).

## Studio narration from code

Wrap an **array of cue names** in `studio([...])` and pass it to
`video.narration(...)` to declare the cue keys in code while the narration text,
languages, and voices are configured in Studio. Chain `.languages([...])` to set
the language list, since there is no text in code to infer it from:

```ts
import { video, studio } from 'screenci'

video.narration(studio(['intro', 'checkout', 'outro'])).languages(['en'])(
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

To start the web app from seed values instead of blank cues, pass an object to
`studio({...})`. The web app starts from those values but still owns them: once a
cue is edited in Studio, that Studio value wins and the seed never clobbers it.
The seed object takes the same shapes as a code-owned narration object, either
content-major (`{ intro: 'Welcome' }`) or language-major
(`{ en: { intro: 'Welcome' }, fi: { intro: 'Tervetuloa' } }`):

```ts
import { video, studio } from 'screenci'

video.narration(
  studio({ intro: 'Welcome', checkout: 'Add an item to the cart.' })
)('Checkout walkthrough', async ({ page, narration }) => {
  await narration.intro()
  await page.goto('/checkout')
  await narration.checkout()
})
```

> **Seeded narration is still held on the first upload today.** The narration text
> is Studio-owned, so the render waits for the video to be configured in Studio
> even when a seed is provided (the backend does not yet pre-fill from the seed).
> If you want the video to render immediately without a Studio step, define the
> narration in code with a plain object instead, `video.narration({ en: {...} })`,
> which is not Studio-owned and renders right away. Use seeded `studio({...})`
> narration when you want Studio to own the text but give editors a starting point.

To define narration values in code instead, pass a plain object with
language-code keys: `video.narration({ en: {...}, fi: {...} })`. See
[Narration](/docs/guides/narration) for the full narration API.

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
Studio. Wrap an **array of field names** in `studio([...])` to keep the value in
Studio, or pass a plain object with language-code keys to define the values in
code and override them per language on the web. You can also seed the web app by
passing an object to `studio({...})` (content-major like
`{ cta: 'Get started' }`, or language-major like
`{ en: { cta: 'Get started' }, fi: { cta: 'Aloita' } }`): the web app starts from
those values but owns them, so a seed is used only until the field is edited in
Studio.

```ts
video.values(studio(['cta'])).values({
  en: { heading: 'Dashboard' },
  fi: { heading: 'Hallinta' },
})('Landing', async ({ page, values }) => {
  await page.getByTestId('heading').fill(values.heading)
  await page.getByTestId('cta').fill(values.cta)
})
```

To seed the web app instead, pass an object to `studio({...})`:

```ts
video.values(studio({ cta: 'Get started' }))
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

Wrap an **array of overlay names** in `studio([...])` and pass it to
`video.overlays(...)` to declare the names in code while the files and display
options are configured in Studio. You can also seed the web app with starting
files and options by passing an object to `studio({...})` (the same overlay
shapes you would define in code, content-major or language-major): the web app
starts from those values but owns them, so a seed is used only until the overlay
is edited in Studio. The declared names are exposed through the injected
`overlays` fixture:

```ts
import { video, studio } from 'screenci'

video.overlays(studio(['intro', 'logo']))(
  'Product demo',
  async ({ page, overlays }) => {
    await overlays.intro()
    await page.goto('/dashboard')
    await overlays.logo()
  }
)
```

To seed the web app instead, pass an object to `studio({...})` (the same overlay
shapes you would define in code):

```ts
video.overlays(studio({ logo: { path: 'assets/logo.png', width: 288 } }))
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

Wrap an **array of track names** in `studio([...])` and pass it to
`video.audio(...)` to declare the background-audio names in code while the file,
volume, and repeat are configured in Studio. You can also seed the web app with
starting files and options by passing an object to `studio({...})` (the same
audio shapes you would define in code, content-major or language-major): the web
app starts from those values but owns them, so a seed is used only until the
track is edited in Studio. The declared names are exposed through the injected
`audio` fixture:

```ts
import { video, studio } from 'screenci'

video.audio(studio(['theme', 'sting']))(
  'Product demo',
  async ({ page, audio }) => {
    await audio.theme() // plays under the whole video
    await page.goto('/dashboard')
    await audio.sting.start()
    await page.click('#celebrate')
    await audio.sting.end()
  }
)
```

To seed the web app instead, pass an object to `studio({...})` (the same audio
shapes you would define in code):

```ts
video.audio(studio({ theme: { path: 'assets/bg.mp3', volume: 0.3 } }))
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

Render and record options follow the same three forms as the feature
declarations, via `studio()` in `video.use(...)`:

```ts
import { video, studio } from 'screenci'

// 1. Code-owned (unchanged): Studio shows these read-only.
video.use({ renderOptions: { recording: { size: 0.85 } } })

// 2. Studio-owned, blank: the web app starts from the system defaults.
video.use({ renderOptions: studio() })

// 3. Studio-owned, seeded: the web app starts from your values but owns them.
video.use({ renderOptions: studio({ output: { aspectRatio: '9:16' } }) })
```

Use the seeded form to hand the format to Studio starting from your tuned code
values rather than from system defaults. A Studio edit always wins over the seed.

Unlike studio narration (where a blank declaration holds the first render until
someone fills the text), blank render options are **not** held: they fall back to
the system defaults, which is a valid render. The seed is purely an editing
starting point, not a way to avoid a blank render.

Set `use({ renderOptions: studio() })` to manage render options from Studio
instead of code. Render options are applied when the version renders:

```ts
import { video } from 'screenci'

video.use({ renderOptions: studio() })

video('Product demo', async ({ page }) => {
  await page.goto('/dashboard')
})
```

Set `use({ recordOptions: studio() })` to defer the record options (aspect
ratio, quality, fps) to Studio as well. Unlike render options, record options
change the captured viewport and encode, so they take effect on the **next
recording**, not when you click **Render**. They are fetched before the recording
runs and applied to that capture (later uploads reuse the saved values). Like the
Values section, the Recording options section shows this reminder inline with a
**Re-record this video** button:

```ts
video.use({ renderOptions: studio(), recordOptions: studio() })

video('Product demo', async ({ page }) => {
  await page.goto('/dashboard')
})
```

These deferrals combine with the `studio(...)` declarations and `.each()` like
any other per-video configuration. For example, defer the record options while
handing narration and overlays to Studio:

```ts
import { video, studio } from 'screenci'

video.use({ recordOptions: studio() })

video.narration(studio(['intro'])).overlays(studio(['logo']))(
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

> **Set `mode`, `locales`, and `browserLocale` correctly in code up front.** When
> you hand languages to Studio, the web app can add and remove languages, but it
> cannot yet edit `mode`, `locales`, or `browserLocale`. Those fields are seeded
> from code once and used for every render until web editing of them ships, so
> give them their final values now (via `studio({ languages, mode, locales,
browserLocale })`). Only the language **set** is editable from the web today.

Pass keyless `studio()` to `video.languages(...)` to hand the recorded language
set to the web app. The **Languages** section on the Studio page shows the
current set and lets you add or remove languages:

```ts
import { video, studio } from 'screenci'

video.narration(studio(['intro'])).languages(studio())(
  'Product tour',
  async ({ page, narration }) => {
    await narration.intro()
    await page.goto('/dashboard')
  }
)
```

With keyless `studio()`, nothing is seeded, so rendering is held until the web
app selects a language set. To start from an initial set the web app can still
change, seed it with an array of language codes:

```ts
import { video, studio } from 'screenci'

// Renders en and fi until the web app edits the set.
video.languages(studio(['en', 'fi']))
```

To seed the capture options too (so the web app starts from them and owns the
whole config), wrap a config object in `studio({ ... })`:

```ts
// Web-owned, seeded with the set and shared mode.
video.languages(studio({ languages: ['en', 'fi'], mode: 'shared' }))
```

The `studio({ ... })` config accepts the same `languages`, `mode`, `locales`, and
`browserLocale` fields as the code-owned config form. As noted above, the web app
can edit the language set but not `mode` / `locales` / `browserLocale` yet, so set
those to their final values here.

Adding a language triggers a re-record: the Languages section shows a
**Re-record this video** button that queues a new recording pass from the web
when the project is connected to GitHub. The new pass reuses the same Studio
narration, overlays, and audio configuration. Removing a language takes effect
on the next upload without re-recording.

Unlike narration text and overlays (applied at render time), the language set
changes the captured recording itself, so adding a language always requires a
new recording pass.

Use `studio()` together with studio-declared narration
(`video.narration(studio([...]))`) so both the narration content and the language
set are owned by the web app. Combined with `use({ recordOptions: studio() })`,
the web app controls the full recording configuration.

To fix languages in code instead, pass a plain array
(`video.languages(['en', 'fi'])`) or a config object. A plain array of codes is a
code-defined fixed set, not a studio seed, so do not wrap it in `studio()`. See
[Languages](./languages.md) for the full language API.

## Tier requirements

Studio requires the **Business** tier. Uploads that opt into studio mode from
code are rejected at upload start on other tiers, and the Studio page shows an
upgrade prompt instead of the editor.
