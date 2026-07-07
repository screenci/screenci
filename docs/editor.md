# Editor

Editor lets your team remix videos from the ScreenCI web app: change render
options, narration text, and voices without touching code or re-running the
recording.

It is built for teamwork: developers create the video in code once, and
teammates who never touch the repo can then swap assets, rewrite narration,
retune voices, and adjust overlays and render options in the browser, then ship
a new version themselves. Each feature is opted in independently (see below), so
you choose exactly which parts a video hands to the web and which stay owned in
code.

There are two ways to use it:

- **Opt in from code.** Wrap a feature's names in `editable(...)`, imported from
  `screenci`, so the web app owns their content while the names stay in code.
  Declaring the feature with a plain object keeps it in code instead. That is the
  whole mental model, and it is independent per video and per feature: hand Editor
  one feature and leave the rest in code, with no all-or-nothing switch. Editor
  edits autosave and apply automatically to every later upload.

- **Render a one-off version.** Any video can be opened in Editor and rendered
  as a one-off, overriding any code-defined narration, overlays, or render
  options for a single render. One-off renders are not saved and do not change
  what future uploads render.

The `video.narration`, `video.values`, `video.overlays`, and `video.audio`
`editable(...)` declarations type the matching fixtures to exactly those names, so a
typo is a compile error. The fixtures (`narration`, `values`, `overlays`, `audio`
in the test body) expose the Editor-managed controllers and values alongside any
defined in code.

The `editable(...)` forms at a glance:

```ts
import { video, editable } from 'screenci'

// Editor owns the content; the names still live in code.
video.narration(editable(['intro', 'outro']))
video.values(editable(['cta']))
video.overlays(editable(['intro', 'logo']))
video.audio(editable(['theme', 'sting']))

// Plain object instead: the content stays owned in code.
video.narration({ en: { intro: 'Welcome', outro: 'Thanks' } })

// Seed Editor with starting content (an edit in Editor wins over the seed).
video.narration(editable({ intro: 'Welcome' }))
video.values(editable({ cta: 'Get started' }))

// Languages: hand the whole set to Editor, or seed an initial set.
video.languages(editable()) // or editable(['en', 'fi'])

// Render / record options: defer for the whole file with the builder methods.
video.renderOptions(editable())
video.recordOptions(editable())
video.renderOptions(editable({ output: { aspectRatio: '9:16' } }))
```

#### You will learn

- [how to edit and render a video in Editor](#editing-in-editor)
- [how saved edits and one-off renders differ](#saved-edits-vs-one-off-renders)
- [how to manage narration from Editor](#editor-narration-from-code)
- [how to use uploaded media as narration](#narration-media-from-editor)
- [how to manage on-screen values from Editor](#editor-values-from-code)
- [how to manage overlays from Editor](#editor-overlays-from-code)
- [how to manage background audio from Editor](#editor-audio-from-code)
- [how to defer render and record options to Editor](#editor-render-and-record-options)
- [how to manage languages from Editor](#editor-languages-from-code)

<!-- screenci-doc-video:docs/guides/editor -->

## Editing in Editor

Open a video in the web app and choose **Open in Editor**. Editor shows the
narration, voices, overlays, audio, and render options the video uses. Items you
opted into from code by wrapping their names in `editable(...)`
(`video.narration(editable([...]))`, `video.values(editable([...]))`,
`video.overlays(editable([...]))`, `video.audio(editable([...]))`, plus the
`video.renderOptions(editable())` / `video.recordOptions(editable())` deferrals) are editable;
anything defined in code is shown read-only and marked with a **code** badge.

Click a **code** badge to see how to edit that value: it shows the exact
declaration to opt the feature in for saved edits (the `editable(...)` form, for
example `video.narration(editable([...]))`), links to that feature's guide, and
offers to create a one-off version to change it just once. Each section also has
a **How to edit from Editor** link to the matching guide below.

Edits autosave: a status line shows **Saving...** and then **All changes
saved**. The saved set is this video's Editor configuration, and it is applied
automatically to every later upload (see [Saved edits vs one-off
renders](#saved-edits-vs-one-off-renders)).

Pick a language at the top, then choose **Render** to render a new version in
that language from the same recording. Rendering is per language: switch the
language and render again to update another localized version.

Editor versions are marked with an **Editor** badge in the version list, and the
version page shows exactly which values were changed compared to the
code-specified ones.

## Saved edits vs one-off renders

Editor separates changes that stick from changes that do not:

- **Saved edits** to app-editable items (anything wrapped in `editable(...)`:
  `video.narration(editable([...]))`, `video.values(editable([...]))`,
  `video.overlays(editable([...]))`, `video.audio(editable([...]))`, plus the
  `video.renderOptions(editable())` / `video.recordOptions(editable())` deferrals) autosave into
  the video's Editor
  configuration. That configuration is reused automatically on every later
  upload, so CI keeps rendering with your Editor values instead of the code
  defaults. When this happens the CLI prints a line in the upload output, so it
  is visible in CI logs:

  ```
  Editor configuration applied for "Checkout walkthrough".
  ```

- **One-off renders** let you change anything, including values defined in code.
  Choose **Create one-off version**, confirm the prompt, edit freely, then
  **Render one-off** to produce a single version. One-off renders are not saved
  and never change what future uploads render. To make a code-defined value
  editable in the normal, saved flow instead, wrap its names in `editable(...)`
  (switch `video.narration({...})` to `video.narration(editable([...]))`, and
  likewise for `values`, `overlays`, or `audio`, or set
  `video.renderOptions(editable())` / `video.recordOptions(editable())`).

The same idea applies to languages: a
[one-off language](./languages.md#one-off-languages) adds a single language from
the web to a code-defined video without changing your code, and CI never
auto-updates it.

## Editor narration from code

Wrap an **array of cue names** in `editable([...])` and pass it to
`video.narration(...)` to declare the cue keys in code while the narration text,
languages, and voices are configured in Editor. Chain `.languages([...])` to set
the language list, since there is no text in code to infer it from:

```ts
import { video, editable } from 'screenci'

video.narration(editable(['intro', 'checkout', 'outro'])).languages(['en'])(
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

For each cue, Editor exposes the same voice controls available in code (model
type, style, accent, and pacing) plus a per-cue volume, alongside the narration
text and language list.

On the **first upload** of a app-editable video, rendering is held until
someone fills in the narration on the Editor page. The CLI prints the hold
together with a direct link to Editor:

```
Rendering for "Checkout walkthrough" is on hold. Configure it in Editor:
https://app.screenci.com/project/<projectId>/video/<videoId>?editor
```

After the video has been configured once, subsequent uploads reuse the saved
Editor configuration and render automatically.

To start the web app from seed values instead of blank cues, pass an object to
`editable({...})`. The web app starts from those values but still owns them: once a
cue is edited in Editor, that Editor value wins and the seed never clobbers it.
The seed object takes the same shapes as a code-owned narration object, either
content-major (`{ intro: 'Welcome' }`) or language-major
(`{ en: { intro: 'Welcome' }, fi: { intro: 'Tervetuloa' } }`):

```ts
import { video, editable } from 'screenci'

video.narration(
  editable({ intro: 'Welcome', checkout: 'Add an item to the cart.' })
)('Checkout walkthrough', async ({ page, narration }) => {
  await narration.intro()
  await page.goto('/checkout')
  await narration.checkout()
})
```

Because the seed already carries the narration text, a seeded `editable({...})`
declaration is **not held** on the first upload: it renders straight away from the
seed, while staying Editor-owned so editors can change it later (an Editor edit
wins over the seed). A blank `editable([...])` declaration carries no text, so it is
still held until someone fills it in. If you want narration that is never
Editor-owned, define it in code with a plain object, `video.narration({ en: {...} })`.

To define narration values in code instead, pass a plain object with
language-code keys: `video.narration({ en: {...}, fi: {...} })`. See
[Narration](/docs/guides/narration) for the full narration API.

## Narration media from Editor

Any editable narration entry in Editor can use an uploaded media file instead
of synthesized speech, the web equivalent of a code narration cue's
`{ media: './intro.mp4' }` entry. Switch a cue's entry from **Text** to
**Media**, upload an `.mp4` file, and optionally provide a subtitle used for
captions.

This works per language, so one language can use an uploaded recording while
the others keep text-to-speech. Entries whose media file is specified in code
stay read-only in Editor.

### Media subtitles

A media narration entry can carry an optional subtitle. When you leave it
blank, captions are generated automatically from the speech in the uploaded
file. When you provide one, that text is used instead. Either way, captions are
timed from the detected speech, so they appear only while the line is actually
spoken (not during any leading silence or music).

## Editor overlays from code

Wrap an **array of overlay names** in `editable([...])` and pass it to
`video.overlays(...)` to declare the names in code while the files and display
options are configured in Editor. You can also seed the web app with starting
files and options by passing an object to `editable({...})` (the same overlay
shapes you would define in code, content-major or language-major): the web app
starts from those values but owns them, so a seed is used only until the overlay
is edited in Editor. The declared names are exposed through the injected
`overlays` fixture:

```ts
import { video, editable } from 'screenci'

video.overlays(editable(['intro', 'logo']))(
  'Product demo',
  async ({ page, overlays }) => {
    await overlays.intro()
    await page.goto('/dashboard')
    await overlays.logo()
  }
)
```

To seed the web app instead, pass an object to `editable({...})` (the same overlay
shapes you would define in code):

```ts
video.overlays(editable({ logo: { path: 'assets/logo.png', width: 288 } }))
```

Calling a controller marks the point in the timeline, exactly like overlays
whose files are defined in code. The file (`.svg`, `.png`, or `.mp4`),
full-screen mode, overlay duration for images, and audio level for videos are
all set on the Editor page. The audio level is a linear-gain slider: `1` (the
default) plays the video at its natural level, `0` mutes it, and values above
`1` boost it (up to `4`). Video overlays also have **speed** and **time**
controls: speed plays the clip faster or slower (a multiplier), and time fits it
to a target playback duration in ms. Set at most one.
TypeScript knows the declared names, so `overlays.typo` is a compile error.

Like editable narration, the first upload of a video that declares Editor overlays
is held until every declared overlay has a file configured in Editor. The CLI
prints a direct link. Later uploads reuse the saved configuration. See
[Overlays](./overlays.md) for how overlays behave on the timeline.

## Editor render and record options

Render and record options follow the same three forms as the feature
declarations, via `editable()` in `video.renderOptions(...)`:

```ts
import { video, editable } from 'screenci'

// 1. Code-owned (unchanged): Editor shows these read-only.
video.renderOptions({ recording: { size: 0.85 } })

// 2. Editor-owned, blank: the web app starts from the system defaults.
video.renderOptions(editable())

// 3. Editor-owned, seeded: the web app starts from your values but owns them.
video.renderOptions(editable({ output: { aspectRatio: '9:16' } }))
```

Use the seeded form to hand the format to Editor starting from your tuned code
values rather than from system defaults. An Editor edit always wins over the seed.

Unlike editable narration (where a blank declaration holds the first render until
someone fills the text), blank render options are **not** held: they fall back to
the system defaults, which is a valid render. The seed is purely an editing
starting point, not a way to avoid a blank render.

Set `video.renderOptions(editable())` to manage render options from Editor
instead of code. Render options are applied when the version renders:

```ts
import { video } from 'screenci'

video.renderOptions(editable())('Product demo', async ({ page }) => {
  await page.goto('/dashboard')
})
```

Set `video.recordOptions(editable())` to defer the record options (aspect
ratio, quality, fps) to Editor as well. Unlike render options, record options
change the captured viewport and encode, so they take effect on the **next
recording**, not when you click **Render**. They are fetched before the recording
runs and applied to that capture (later uploads reuse the saved values). Like the
Values section, the Recording options section shows this reminder inline with a
**Re-record this video** button:

```ts
video.renderOptions(editable()).recordOptions(editable())(
  'Product demo',
  async ({ page }) => {
    await page.goto('/dashboard')
  }
)
```

These deferrals combine with the `editable(...)` declarations and `.each()` like
any other per-video configuration. For example, defer the record options while
handing narration and overlays to Editor:

```ts
import { video, editable } from 'screenci'

video
  .recordOptions(editable())
  .narration(editable(['intro']))
  .overlays(editable(['logo']))(
  'Product demo',
  async ({ page, narration, overlays }) => {
    await narration.intro()
    await page.goto('/dashboard')
    await overlays.logo()
  }
)
```

Until the video is configured in Editor, uploads render with the default options
(or are held together with editable narration, if both are used).

The recorded **language set** is managed separately via `video.languages(...)`:
see [Editor languages from code](#editor-languages-from-code) below. There is no
`recordOptions.languages`.

## Editable timeline actions

Interaction timings, zoom options, speed blocks, and pauses can be edited from
the web timeline and applied on the next record, without touching code.

By default (`recordOptions.implicitEditable: true`) every interaction that uses
default values in code is editable from the web: its identity is the captured
locator description (for example `getByRole(button, name=Save)`) plus its
position on the timeline. Setting any explicit option in code locks that whole
action; there are no partially editable actions. Set
`implicitEditable: false` to keep every timing owned by code.

Actions can also be declared editable explicitly with `editable(...)`:

```ts
import { autoZoom, editable, speed } from 'screenci'

// Named speed block: the multiplier is owned by the web editor (defaults to 1).
await speed('intro-speedup', async () => { ... })

// Unnamed editable block, identified by its timeline position.
await speed(async () => { ... })

// Locked: the multiplier comes from code.
await speed(3, async () => { ... })

// autoZoom stays fully web-editable, starting from the seeded centering.
await autoZoom(async () => { ... }, editable({ centering: 0.5 }))

// Web-editable pause: defaults to 0ms until edited in the web timeline.
await page.waitForTimeout()

// Named web-editable pause with a seed duration.
await page.waitForTimeout(editable('settle', { durationMs: 500 }))

// Editable click timings, named and seeded.
await page.getByRole('button', { name: 'Save' }).click(
  editable('save-click', { moveDuration: 600 })
)
```

Before `screenci record` (and `screenci test --mock-record`) the CLI fetches
the saved web edits and applies them to the run. Plain `screenci test` skips
timings entirely, so it neither fetches nor applies them. After each upload the
stored timeline is reconciled against what was actually recorded: new actions
appear in place, removed actions disappear, and edits whose action vanished are
kept as stale entries in the editor for cleanup instead of being dropped.

## Editor languages from code

> **Set `mode`, `locales`, and `browserLocale` correctly in code up front.** When
> you hand languages to Editor, the web app can add and remove languages, but it
> cannot yet edit `mode`, `locales`, or `browserLocale`. Those fields are seeded
> from code once and used for every render until web editing of them ships, so
> give them their final values now (via `editable({ languages, mode, locales,
browserLocale })`). Only the language **set** is editable from the web today.

Pass keyless `editable()` to `video.languages(...)` to hand the recorded language
set to the web app. The **Languages** section on the Editor page shows the
current set and lets you add or remove languages:

```ts
import { video, editable } from 'screenci'

video.narration(editable(['intro'])).languages(editable())(
  'Product tour',
  async ({ page, narration }) => {
    await narration.intro()
    await page.goto('/dashboard')
  }
)
```

With keyless `editable()`, nothing is seeded, so rendering is held until the web
app selects a language set. To start from an initial set the web app can still
change, seed it with an array of language codes:

```ts
import { video, editable } from 'screenci'

// Renders en and fi until the web app edits the set.
video.languages(editable(['en', 'fi']))
```

To seed the capture options too (so the web app starts from them and owns the
whole config), wrap a config object in `editable({ ... })`:

```ts
// Web-owned, seeded with the set and shared mode.
video.languages(editable({ languages: ['en', 'fi'], mode: 'shared' }))
```

The `editable({ ... })` config accepts the same `languages`, `mode`, `locales`, and
`browserLocale` fields as the code-owned config form. As noted above, the web app
can edit the language set but not `mode` / `locales` / `browserLocale` yet, so set
those to their final values here.

Adding a language triggers a re-record: the Languages section shows a
**Re-record this video** button that queues a new recording pass from the web
when the project is connected to GitHub. The new pass reuses the same Editor
narration, overlays, and audio configuration. Removing a language takes effect
on the next upload without re-recording.

Unlike narration text and overlays (applied at render time), the language set
changes the captured recording itself, so adding a language always requires a
new recording pass.

Use `editable()` together with app-editable narration
(`video.narration(editable([...]))`) so both the narration content and the language
set are owned by the web app. Combined with `video.recordOptions(editable())`,
the web app controls the full recording configuration.

To fix languages in code instead, pass a plain array
(`video.languages(['en', 'fi'])`) or a config object. A plain array of codes is a
code-defined fixed set, not an editable seed, so do not wrap it in `editable()`.
See [Languages](./languages.md) for the full language API.
