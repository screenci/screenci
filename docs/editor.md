# Editor

Editor lets your team remix videos from the ScreenCI web app: change render
options, narration text, and voices without touching code or re-running the
recording.

It is built for teamwork: developers create the video in code once, and
teammates who never touch the repo can then swap assets, rewrite narration,
retune voices, and adjust overlays and render options in the browser, then ship
a new version themselves.

**Everything is editable by default.** Every feature a video declares
(narration, values, overlays, audio, languages, render and record options) can
be edited in the web app. There is nothing to opt in to; the only choice you
make in code is where the content starts:

- **Arrays declare blank editor-owned names.** `video.narration(['intro'])`
  keeps the name in code (so the body can call `narration.intro`) while the
  content is filled in on the Editor page.

- **Plain objects are code values.** `video.narration({ intro: 'Welcome' })`
  supplies the content from code. It is used at record time and stays fully
  editable in the web app: once a value is edited in Editor, the Editor value
  wins over the code value on every later upload.

- **Render a one-off version.** Any video can be opened in Editor and rendered
  as a one-off, overriding anything for a single render. One-off renders are
  not saved and do not change what future uploads render.

The `video.narration`, `video.values`, `video.overlays`, and `video.audio`
declarations type the matching fixtures to exactly those names, so a typo is a
compile error. The fixtures (`narration`, `values`, `overlays`, `audio` in the
test body) expose the controllers and values regardless of which form declared
them.

The declaration forms at a glance:

```ts
import { video } from 'screenci'

// Blank editor-owned names: the names live in code, the content in Editor.
video.narration(['intro', 'outro'])
video.values(['cta'])
video.overlays(['intro', 'logo'])
video.audio(['theme', 'sting'])

// Plain objects: code values, used at record time, editable in the web app.
video.narration({ en: { intro: 'Welcome', outro: 'Thanks' } })
video.values({ cta: 'Get started' })

// Languages: hand the whole set to the web, or seed an initial set.
video.languages() // web-owned set
video.languages(['en', 'fi']) // code seed the web app can extend
video.languages({ languages: ['en', 'fi'], mode: 'shared' }) // seed with capture options

// Render / record options: code values are the starting point, web edits win.
video.use({ renderOptions: { output: { aspectRatio: '9:16' } } })
video.use({ recordOptions: { fps: 30 } })
```

#### You will learn

- [how to edit and render a video in Editor](#editing-in-editor)
- [how saved edits and one-off renders differ](#saved-edits-vs-one-off-renders)
- [how to manage narration from Editor](#editor-narration-from-code)
- [how to use uploaded media as narration](#narration-media-from-editor)
- [how to manage on-screen values from Editor](#editor-values-from-code)
- [how to manage overlays from Editor](#editor-overlays-from-code)
- [how to manage background audio from Editor](#editor-audio-from-code)
- [how render and record options combine with web edits](#editor-render-and-record-options)
- [how to manage languages from Editor](#editor-languages-from-code)
- [how action parameters are tracked and overridden](#action-parameter-tracking-and-overrides)
- [how to migrate from the removed `editable()` helper](#migrating-from-editable)

<!-- screenci-doc-video:docs/guides/editor -->

## Editing in Editor

Open a video in the web app and choose **Open in Editor**. Editor shows the
narration, voices, overlays, audio, and render options the video uses. Every
item is editable: names declared as a blank array start empty and wait for
content, and values declared in code show their current code value as the
starting point.

Items whose current value still comes from code are marked with a **code**
badge. Editing such an item replaces the code value with the Editor value from
then on; the badge switches to show the value is now web-owned. Each section
also has a **How to edit from Editor** link to the matching guide below.

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

- **Saved edits** autosave into the video's Editor configuration. That
  configuration is reused automatically on every later upload, so CI keeps
  rendering with your Editor values instead of the code values. When this
  happens the CLI prints a line in the upload output, so it is visible in CI
  logs:

  ```
  Editor configuration applied for "Checkout walkthrough".
  ```

- **One-off renders** produce a single version without saving anything. Choose
  **Create one-off version**, confirm the prompt, edit freely, then **Render
  one-off**. One-off renders never change what future uploads render.

The same idea applies to languages: a
[one-off language](./languages.md#one-off-languages) adds a single language from
the web to a video without changing your code, and CI never auto-updates it.

## Editor narration from code

Pass an **array of cue names** to `video.narration(...)` to declare the cue
keys in code while the narration text, languages, and voices are configured in
Editor. Chain `.languages([...])` to seed the language list, since there is no
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

For each cue, Editor exposes the same voice controls available in code (model
type, style, accent, and pacing) plus a per-cue volume, alongside the narration
text and language list.

On the **first upload** of a video with blank name-only narration, rendering is
held until someone fills in the narration on the Editor page. The CLI prints
the hold together with a direct link to Editor:

```
Rendering for "Checkout walkthrough" is on hold. Configure it in Editor:
https://app.screenci.com/project/<projectId>/video/<videoId>?editor
```

After the video has been configured once, subsequent uploads reuse the saved
Editor configuration and render automatically.

To supply the text from code instead, pass a plain object. The object takes the
same shapes as before, either content-major (`{ intro: 'Welcome' }`) or
language-major (`{ en: { intro: 'Welcome' }, fi: { intro: 'Tervetuloa' } }`):

```ts
import { video } from 'screenci'

video.narration({ intro: 'Welcome', checkout: 'Add an item to the cart.' })(
  'Checkout walkthrough',
  async ({ page, narration }) => {
    await narration.intro()
    await page.goto('/checkout')
    await narration.checkout()
  }
)
```

Because a plain object already carries the narration text, it is **not held**
on the first upload: it renders straight away from the code values, while
staying editable so editors can change it later. Once a cue is edited in
Editor, that Editor value wins and the code value never clobbers it. A blank
array declaration carries no text, so it is still held until someone fills it
in. See [Narration](/docs/guides/narration) for the full narration API.

## Narration media from Editor

Any narration entry in Editor can use an uploaded media file instead of
synthesized speech, the web equivalent of a code narration cue's
`{ media: './intro.mp4' }` entry. Switch a cue's entry from **Text** to
**Media**, upload an `.mp4` file, and optionally provide a subtitle used for
captions.

This works per language, so one language can use an uploaded recording while
the others keep text-to-speech.

### Media subtitles

A media narration entry can carry an optional subtitle. When you leave it
blank, captions are generated automatically from the speech in the uploaded
file. When you provide one, that text is used instead. Either way, captions are
timed from the detected speech, so they appear only while the line is actually
spoken (not during any leading silence or music).

## Editor overlays from code

Pass an **array of overlay names** to `video.overlays(...)` to declare the
names in code while the files and display options are configured in Editor. To
start from code values instead, pass an object (the same overlay shapes as
always, content-major or language-major): the code values are used until the
overlay is edited in Editor, after which the Editor value wins. The declared
names are exposed through the injected `overlays` fixture:

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

To supply the file and placement from code instead, pass an object:

```ts
video.overlays({ logo: { path: 'assets/logo.png', width: 288 } })
```

Calling a controller marks the point in the timeline, exactly like before. The
file (`.svg`, `.png`, or `.mp4`), full-screen mode, overlay duration for
images, and audio level for videos are all editable on the Editor page. The
audio level is a linear-gain slider: `1` (the default) plays the video at its
natural level, `0` mutes it, and values above `1` boost it (up to `4`). Video
overlays also have **speed** and **time** controls: speed plays the clip faster
or slower (a multiplier), and time fits it to a target playback duration in ms.
Set at most one. TypeScript knows the declared names, so `overlays.typo` is a
compile error.

Like blank narration, the first upload of a video that declares overlays by
name only is held until every declared overlay has a file configured in Editor.
The CLI prints a direct link. Later uploads reuse the saved configuration. See
[Overlays](./overlays.md) for how overlays behave on the timeline.

## Editor render and record options

Render and record options declared in code are the **starting point**; web
edits override them:

```ts
import { video } from 'screenci'

// Code values: Editor starts from these. An Editor edit wins from then on.
video.use({ renderOptions: { recording: { size: 0.85 } } })
video.use({ renderOptions: { output: { aspectRatio: '9:16' } } })

// Or declare nothing: Editor starts from the system defaults.
```

There is no separate deferral: every video's render options are managed on the
Editor page whether or not code declares any. Options you never touch in
Editor keep following the code values (and the system defaults beneath them),
so tuning a value in code still takes effect on later uploads as long as that
value has not been edited in the web app.

Render options are applied when the version renders:

```ts
import { video } from 'screenci'

video('Product demo', async ({ page }) => {
  await page.goto('/dashboard')
})
```

Record options (aspect ratio, quality, fps) work the same way but change the
captured viewport and encode, so Editor edits to them take effect on the
**next recording**, not when you click **Render**. They are fetched before the
recording runs and applied to that capture (later uploads reuse the saved
values). Like the Values section, the Recording options section shows this
reminder inline with a **Re-record this video** button:

```ts
video.use({ recordOptions: { fps: 30 } })

video('Product demo', async ({ page }) => {
  await page.goto('/dashboard')
})
```

These options combine with the per-feature declarations and `.each()` like any
other per-video configuration:

```ts
import { video } from 'screenci'

video.use({ recordOptions: { fps: 30 } })

video.narration(['intro']).overlays(['logo'])(
  'Product demo',
  async ({ page, narration, overlays }) => {
    await narration.intro()
    await page.goto('/dashboard')
    await overlays.logo()
  }
)
```

The recorded **language set** is managed separately via `video.languages(...)`:
see [Editor languages from code](#editor-languages-from-code) below. There is no
`recordOptions.languages`.

## Editor languages from code

> **Set `mode`, `locales`, and `browserLocale` correctly in code up front.** The
> web app can add and remove languages, but it cannot yet edit `mode`,
> `locales`, or `browserLocale`. Those fields are seeded from code once and used
> for every render until web editing of them ships, so give them their final
> values now (via `video.languages({ languages, mode, locales, browserLocale })`).
> Only the language **set** is editable from the web today.

Every declared language set is web-owned: the recorded set is the **union** of
the web app's selection, the code seed, and any language keys used by
per-language features (narration, values, overlays, audio). Call
`video.languages()` with no argument to hand the whole set to the web app. The
**Languages** section on the Editor page shows the current set and lets you add
or remove languages:

```ts
import { video } from 'screenci'

video.narration(['intro']).languages()(
  'Product tour',
  async ({ page, narration }) => {
    await narration.intro()
    await page.goto('/dashboard')
  }
)
```

With no argument, nothing is seeded, so rendering is held until the web app
selects a language set. To start from an initial set the web app can still
change, seed it with an array of language codes:

```ts
import { video } from 'screenci'

// Records en and fi, plus whatever the web app adds.
video.languages(['en', 'fi'])
```

To seed the capture options too, pass a config object:

```ts
// Seeded with the set and shared mode. The web app owns the set.
video.languages({ languages: ['en', 'fi'], mode: 'shared' })
```

The config accepts the same `languages`, `mode`, `locales`, and `browserLocale`
fields as before. As noted above, the web app can edit the language set but not
`mode` / `locales` / `browserLocale` yet, so set those to their final values
here.

Adding a language triggers a re-record: the Languages section shows a
**Re-record this video** button that queues a new recording pass from the web
when the project is connected to GitHub. The new pass reuses the same Editor
narration, overlays, and audio configuration. Removing a language takes effect
on the next upload without re-recording. Languages seeded in code or carried by
per-feature language keys stay in the recorded set even if removed from the web
selection, since the recorded set is the union of all three sources.

Unlike narration text and overlays (applied at render time), the language set
changes the captured recording itself, so adding a language always requires a
new recording pass.

Combine `video.languages()` with name-only narration
(`video.narration(['intro'])`) so both the narration content and the language
set start blank and are filled in from the web app. See
[Languages](./languages.md) for the full language API.

## Action parameter tracking and overrides

Every instrumented Playwright action (`click`, `fill`, `pressSequentially`,
`tap`, `check`, `uncheck`, `selectOption`, `hover`, `dragTo`, `selectText`,
`scrollIntoViewIfNeeded`) records which option values it used, for example
`move.duration`, `move.speed`, `move.easing`, `move.delayAfter`, `position`,
`noWaitAfter`, `duration`, and `dragSteps`, and whether each value was set
explicitly at the call site or came from a default. This provenance is:

- written into the uploaded recording data (`actionParams` in `data.json`), so
  the backend and Editor can present the parameters for editing;
- snapshotted to `.screenci/action-params.json`, which is never wiped between
  runs.

At the start of `screenci record`, editor overrides fetched from the backend
are compared against the snapshot, and an info line is printed for each
override that shadows an explicitly code-set value:

```
[screenci] editor override shadows code value: <selector> <method> <optionPath>: code <value> -> editor <value> (video: <name>)
```

During recording, editor overrides are applied to actions and each application
prints:

```
[screenci] editor override: <selector> <method> <optionPath>: <used> (code: <codeValue>, explicit|default)
```

The backend endpoint for fetching action overrides is not live yet; until it
is, no overrides are fetched, and recordings simply track and report the
provenance.

## Migrating from `editable()`

The `editable()` helper has been removed. Everything is editable in the web app
by default now, so the wrapper is no longer needed:

| Before                                          | After                                         |
| ----------------------------------------------- | --------------------------------------------- |
| `editable(['intro'])`                           | `['intro']`                                   |
| `editable({ intro: 'Hi' })`                     | `{ intro: 'Hi' }`                             |
| `video.languages(editable())`                   | `video.languages()`                           |
| `video.languages(editable(['en', 'fi']))`       | `video.languages(['en', 'fi'])`               |
| `video.languages(editable({ mode: 'shared' }))` | `video.languages({ mode: 'shared' })`         |
| `use({ recordOptions: editable({ fps: 30 }) })` | `use({ recordOptions: { fps: 30 } })`         |
| `use({ renderOptions: editable() })`            | omit `renderOptions` (or pass a plain object) |

A bare array still declares blank editor-owned names. A plain object now
supplies code values that are used at record time and remain editable in the
web app: once edited there, the Editor value wins over the code value.
