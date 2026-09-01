# Editor

Editor is the ScreenCI web app's editing surface for a video: a live preview of
the raw recording, a multi-track timeline, and panels for narration, overlays,
and render options. Your `.screenci.ts` sources declare the video and record
the footage; edits made in the editor live in the web app and shape every
preview and render of that video. Editor edits are not written back into your
sources.

**Anyone in your org can edit.** Open a video and change narration, overlays,
render options, and the rest right away; the edits render immediately in the
preview and in exports, no connected machine needed.

Edits that change what is captured (record options, interaction timings,
on-screen text, the language set) cannot take effect until a recording runs.
The editor badges them "applies after next recording" and marks the preview
stale rather than pretending they took effect. The next recording (a preview
from your machine, CI, or `screenci export`) bakes them in. While a machine is
actively recording a video, that video's editing controls lock briefly until
it finishes.

**Everything is editable by default.** Every feature a video declares
(narration, overlays, languages, render and record options) can
be edited in the web app. There is nothing to opt in to; the only choice you
make in code is where the content starts:

- **Arrays declare blank editor-owned names.** `video.narration(['intro'])`
  keeps the name in code (so the body can call `narration.intro`) while the
  content is filled in on the Editor page.

- **Plain objects are code values.** `video.narration({ intro: 'Welcome' })`
  supplies the starting content from code. It stays fully editable in the web
  app: an edit overrides the code value for rendering from then on.

The `video.narration` and `video.overlays`
declarations type the matching fixtures to exactly those names, so a typo is a
compile error. The fixtures (`narration` and `overlays` in the
test body) expose the controllers regardless of which form declared
them.

The declaration forms at a glance:

```ts
import { video } from 'screenci'

// Blank editor-owned names: the names live in code, the content in Editor.
video.narration(['intro', 'outro'])
video.overlays(['intro', 'logo'])

// Plain objects: code values, used at record time, editable in the web app.
video.narration({ en: { intro: 'Welcome', outro: 'Thanks' } })

// Languages: the code set. The editor can add more on top of it.
video.languages(['en', 'fi']) // the code language set
video.languages({ languages: ['en', 'fi'], mode: 'shared' }) // set with capture options

// Render / record options: code values are the starting point; the editor
// can override them (renderOptions supports per-language overrides via
// { default, <lang> }).
video.renderOptions({ output: { aspectRatio: '9:16' } })
video.recordOptions({ fps: 30 })
```

#### You will learn

- [how the editor is laid out and what each part does](#the-editor-at-a-glance)
- [where edits live](#where-edits-live)
- [how to edit and export a video in Editor](#editing-in-editor)
- [how to record from the editor](#recording-from-the-editor)
- [how to manage narration from Editor](#editor-narration-from-code)
- [how to use uploaded media as narration](#narration-media-from-editor)
- [how to manage overlays from Editor](#editor-overlays-from-code)
- [how render and record options combine with web edits](#editor-render-and-record-options)
- [how to manage languages from Editor](#editor-languages-from-code)
- [how to place effects from code](#effects-in-code-block-wrappers-and-gap-sleeps)
- [how edits and code fit together](#how-edits-and-code-fit-together)
- [how action parameters are tracked and overridden](#action-parameter-tracking-and-overrides)
- [how to migrate from the removed `editable()` helper](#migrating-from-editable)

<!-- screenci-doc-video:docs/editor -->

## The editor at a glance

Opening a video in the web app opens the editor. The page is laid out as:

- **Live preview** (center): plays the raw recording with your edits applied
  on top, render-free. Camera zooms, cursor paths, overlays, narration audio,
  and subtitles are all previewed live, so you see the result without spending
  an export. A **Live preview** badge marks this mode. Some edits happen
  directly on the video: drag an overlay to move it (a corner to resize),
  pause and drag the cyan handles to reshape a cursor path, or type into the
  subtitle box to change a cue's text.
- **Timeline** (bottom, resizable): rows for **Overlays**, **Zooms**,
  **Interactions**, **Recording**, and **Narration**. Click or drag to seek,
  scroll to pan, pinch or Ctrl+scroll to zoom (1x to 60x). Selecting a bar
  opens its editor in the side panel; dragging a bar moves it, and dragging an
  overlay's right edge changes its duration. Any item can be deleted: select it
  and press Delete or Backspace, or right-click and choose **Delete**. Deleting
  a zoom removes the bracket (its start and end snap to the surrounding steps);
  deleting a narration cue or overlay leaves everything else in place. Deleting
  a recorded interaction asks to confirm first (it changes what is captured and
  a fresh recording will run), then shifts the following steps left so the video
  jumps forward past the removed step; a `waitForTimeout` delay deletes with no
  prompt. If the code write later fails, the deletion is reverted.
- **Side panel** (right): render options (canvas, background, roundness,
  shadow, padding), recording options with a visual crop editor, and the
  editor for whichever timeline item is selected.
- **Sidebar** (left): the language picker, the **Editor** view, the
  **Exported** group listing every exported version, and the **Recording**
  group showing your connected `screenci preview` machine and record actions.
- **Top right**: undo and redo (up to 20 steps, Cmd+Z / Shift+Cmd+Z), export
  status, and the **Export** button.

## Where edits live

Editor edits live in the ScreenCI backend, per video. They render immediately
in the preview and in every later export, and they survive re-records: an edit
is keyed to the action it belongs to (its stable `editId` slug), so it stays
in place when fresh footage lands. Your `.screenci.ts` sources stay the
declaration of the video (what is recorded and in which order); the editor
owns the visual polish layered on top. Edits are not written back into the
sources.

Edits that only affect rendering (narration text, overlay files, render
options) preview and export immediately.
Edits that change the capture itself
(record options, interaction timings, on-screen text, the language set) are
badged **applies after next recording**: the preview is marked stale until a
recording runs. Trigger a re-record via CI (see the CI setup guide), or run
`screenci preview` or `screenci export` in the project.

## Editing in Editor

The editor shows the narration, voices, overlays, and render options the video
uses. Every item is editable: names declared as a blank array start empty and
wait for content, and values declared in code show their current code value as
the starting point.

Items whose current value still comes from code are marked with a **set in
code** badge. Editing such an item stores the new value as an editor edit that
overrides the code value from then on.

Pick a language in the sidebar, then choose **Export** to export a new version
in that language. Exports are per language: switch the language and export
again to update another localized version. If edits that need a new recording
are pending, record fresh footage first and then export. Exported versions appear in the sidebar's **Exported** group, with a
status glyph while rendering and a marker on the version served at the public
URL.

Editor-uploaded media is stored alongside the edits: overlay files, audio tracks,
uploaded narration audio, and cloned voices. Their bytes live in the ScreenCI
backend (code references them as `{ editor: '<name>' }`), so they are merged
onto every later upload automatically and apply at render time. When that
happens the CLI prints one line per video in the upload output, so it is
visible in CI logs:

```
Editor-uploaded media for "Checkout walkthrough" applies at render time; recordings always run from code.
```

## Recording from the editor

The sidebar's **Recording** group collects every way to produce fresh footage:

- **Record via CI**: when the project is connected to GitHub, queues the
  project's recording workflow for this video, no local machine needed.
- **Record locally**: run `screenci preview` (or `screenci export`) in the
  project to record fresh footage from your machine.

When the CLI starts recording a preview, the open web preview page shows a
live "Recording preview..." indicator, and it updates automatically (with a
"New preview loaded" toast) once the new preview lands.

A status line under the menu tracks the run. The regular record run lock
applies: if another recording run is already active on the machine, the run
fails instead of sharing the same output.

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
// Declare per video (supports per-language overrides via { default, <lang> }):
video.renderOptions({ recording: { size: 0.85 } })
video.renderOptions({ output: { aspectRatio: '9:16' } })

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
**next recording**, not when you click **Export**. They are fetched before the
recording runs and applied to that capture (later uploads reuse the saved
values). The Recording options section shows this
reminder inline with a **Re-record this video** button:

```ts
video.recordOptions({ fps: 30 })('Product demo', async ({ page }) => {
  await page.goto('/dashboard')
})
```

These options combine with the per-feature declarations and `.each()` like any
other per-video configuration:

```ts
import { video } from 'screenci'

video.recordOptions({ fps: 30 }).narration(['intro']).overlays(['logo'])(
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

## Editable timeline actions

Interaction timings, zoom options, speed blocks, and pauses can be edited from
the web timeline, without hand-editing code: each saved edit is stored in the
editor and picked up by every later preview and render.

Every interaction is editable from the web, whether its values come from
package defaults or from explicit options in code. Its identity is the
captured locator description (for example `getByRole(button, name=Save)`)
plus its position on the timeline; edits are keyed by the action's `editId`
slug so they survive re-records.

Cursor-move fields (`move.duration`/`move.speed`, `move.easing`, `move.curve`,
`move.curviness`, `move.delayAfter`), action durations, and pre-action pauses
are all edited as the matching option of the `editId`-stamped call. The
cursor path's curve can be edited visually in the preview by dragging its
bezier handles.

Manual `zoomTo(...)` calls and `scrollIntoViewIfNeeded()` also appear on the
editor's "Zooms & scrolls" row with editable `easing`, `duration`, `amount`,
and `centering` fields.

The main editable action forms:

```ts
import { autoZoom, speed } from 'screenci'

// Editable block: the multiplier is owned by the web editor (defaults to 1).
// The editId identity slug is stamped automatically when an edit session
// starts; you can also set it yourself.
await speed(async () => { ... }, { editId: 'intro-speedup' })

// Without an editId yet, the block is identified by its timeline position
// until the next edit session stamps one.
await speed(async () => { ... })

// Explicit: the multiplier comes from code (a web edit rewrites this call).
await speed(3, async () => { ... })

// Bare autoZoom stays fully web-editable, starting from the package defaults.
await autoZoom(async () => { ... })

// Web-editable pause: defaults to 0ms until edited in the web timeline.
await page.waitForTimeout()

// Explicit pause: the duration comes from code (a web edit rewrites it).
await page.waitForTimeout(500)
```

Pointer actions also expose a web-owned `sleepBefore` field (default 0): the
SDK sleeps that long after the previous event before the cursor starts
moving, pushing the action later on the timeline. In the editor, dragging a
bar's left edge sets it, and the pause shows as a leading "sleep" part of the
bar.

Dragging a whole interaction along the timeline absorbs into the recorded
`waitForTimeout` next to it: moving it later grows the preceding sleep (and
moving it earlier shrinks it), rewriting the `waitForTimeout(<ms>)` argument in
code so the timeline matches what the next record will produce. When an edit
leaves two `waitForTimeout` calls back-to-back in the source (nothing but sleeps
between them), they collapse into a single `waitForTimeout` whose duration is
their sum.

Recordings always run purely from code: nothing is fetched or overridden at
record time. After each upload the timeline is reconciled against what was
actually recorded, so new actions appear in place and removed actions
disappear.

## Web-authored events

Render-affecting events can also be ADDED and MOVED from the web timeline,
without hand-editing code: hides, speedups, time remaps, narration cues,
overlays, and recording changes (resize/hide/show). Interactions are
different on purpose: a click or tap always stays where the test code performed it, and
only its parameters (durations, sleeps) are editable.

Everything the timeline adds is one unified edit record keyed to a call
position, saved in the editor the moment it is placed.

A web-authored event can be deleted again: select it and press **Delete** or
**Backspace**, or right-click it and choose **Delete** (the same path "Reset
all" uses). Recorded interactions are code-owned and cannot be deleted this
way.

Events are added in two ways:

- **The Add effect popover** (the "+" on a timeline row) creates a narration
  cue, overlay, camera zoom, speedup, hide, time remap, or recording change,
  anchored to the interaction(s) you pick.
- **Directly on the Recording row**: toggle **split mode** (the scissors) and
  click the recording to cut it, or drag a section's edge to hide footage from
  either end. Right-clicking a section offers remove (hide), split at the
  current time, reset trim, merge with the neighbor, and quick speed
  (0.5x/2x/4x) and time-remap presets.

Every web-placed or web-moved event is positioned by **call position**: which
editable action it sits after (or, for a span, the run of actions it brackets),
plus any timing gap as a plain millisecond sleep. The editor snaps to the
identity of a known action (its stable `editId` slug) rather than to
wall-clock time, so positions survive re-records whose real durations drift.

- A point event (a narration cue, an overlay, a recording resize) is stored
  as "after action X, with an optional `waitForTimeout(ms)` gap before it".
- A span event (hide, speed, time) is stored as the run of actions it brackets:
  "from action X until action Y", with optional gap sleeps at each edge.
- A zoom is stored as the run of interactions it wraps, with a lead-in and hold
  expressed as sleeps inside the block.

When you drag an event just before an upcoming click, the editor glues it to
that click by making it the action the event sits before, with a `waitForTimeout`
gap. There is no free offset field: everything lands in a gap between known
actions or brackets a known run of actions.

An edit whose target action is absent from the current recording snapshot
(its action was removed, or an ordinal-keyed target such as a
`waitForTimeout` delay drifted since the edit was authored) is discarded as
orphaned rather than surfaced as something the user must clear by hand.

## Effects in code: block wrappers and gap sleeps

Everything the web timeline can place, code expresses directly as calls in the
linear timeline. There are no declarative "placed" helpers and no anchors or
offsets: an effect's position is simply where its call sits in the test body,
and timing gaps are plain `await page.waitForTimeout(ms)` sleeps.

Render-time spans (hide, speed, time) and camera zooms are **block wrappers**
that bracket the interactions they cover. Lead-in and hold are sleeps inside
the block:

```ts
video('Checkout', async ({ page }) => {
  await page.getByRole('button', { name: 'Submit' }).click({ editId: 'submit' })

  // Hide a loading flicker that appears 250ms after the click, for 500ms.
  await page.waitForTimeout(250)
  await hide(async () => {
    await page.waitForTimeout(500)
  })

  // Play a stretch of steps at 3x.
  await speed(3, async () => {
    await page.getByRole('button', { name: 'Next' }).click({ editId: 'next' })
    await page
      .getByRole('button', { name: 'Confirm' })
      .click({ editId: 'confirm' })
  })

  // Fit a block to exactly 400ms of output.
  await time(400, async () => {
    await page
      .getByRole('tab', { name: 'Receipt' })
      .click({ editId: 'receipt' })
  })

  // Zoom the camera into a click: lead in 400ms BEFORE it and hold 600ms
  // after it. The camera target comes from the mouse positions recorded
  // inside the block.
  await autoZoom(async () => {
    await page.waitForTimeout(400) // lead-in before the first inner action
    await page.getByRole('button', { name: 'Save' }).click({ editId: 'save' })
    await page.waitForTimeout(600) // hold after the last inner action
  })
})
```

To place an effect a fixed time after an interaction, put a
`waitForTimeout(ms)` right after that interaction and then the effect. To lead a
zoom in before a click, open the `autoZoom` block earlier and lead in with a
sleep as its first inner line. The block's first and last actions define its
window; you never compute an absolute offset. See
[Camera and zooming](./camera-and-zooming.md) for `autoZoom`, `zoomTo`, and
`resetZoom`.

Point effects that DO happen at call time (a narration cue, an overlay) are
just imperative calls in the timeline, paced by ordinary sleeps:

```ts
await page.getByRole('button', { name: 'Stats' }).click({ editId: 'stats' })
// Start the narration 800ms after the click.
await page.waitForTimeout(800)
await narration.stats()
```

Rule of thumb: gaps are `waitForTimeout` sleeps, render-time spans and zooms
are block wrappers over the interactions they cover, and narration/overlay
cues are plain calls placed where you want them in call order. The web editor
shows this same linear timeline, and editor edits are stored as the same
call-position statements, keyed by each action's `editId`.

### Splitting and trimming the recording from the web editor

The web timeline has a scissors mode: clicking the recording track cuts it at
that instant. A bare split is stored as a zero-width `hide` span edit and
stays editable on the web.

A cut snaps to where it will actually land, and the guide line (plus the live
preview, when paused) tracks that snapped point rather than the raw cursor. A
click inside an interaction cannot split it mid-action, so it snaps to the
nearer edge (the gap before or after it), and a second cut in a spot already
taken is refused. A cut left of the first interaction (over the footage leading
into it) anchors to that interaction with a backward lead instead of a forward
gap sleep; once such a span reaches code it opens with a leading
`waitForTimeout` over that lead-in.

Dragging a split's edges inward swallows footage (and the interactions in it)
into the hide; the span edit is re-anchored to whole interactions, with
`waitForTimeout` sleeps preserving any partial gap on both sides. Dragging back
out restores the footage. The trimmed span behaves like a regular
`hide(...)` block.

### Removing a code block from the web editor

A block carrying an `editId` (`hide(fn, { editId: 'setup' })`, and likewise
`speed`/`time`) can be removed from the web editor (merge two recording
sections, reset a trim). This stores a `blockRemoveEdit` targeting the
block's editId; the render treats the block as unwrapped, keeping the wrapped
calls (any `waitForTimeout` pacing inside survives as plain gap sleeps).

### Splitting a camera zoom in two

An `autoZoom` bracket on the Zooms row can be split into two back-to-back
brackets from the web editor: enter split mode (the scissors) and click the
zoom at the interaction boundary where it should break. A web-added zoom is
split by rewriting its own edit record. A code-authored `autoZoom` is split
by storing a `blockRemoveEdit` for the original bracket's `editId` plus two
`zoomEdit`s over the two interaction sub-runs, each carrying the original
zoom options (`amount`/`duration`/`easing`/`centering`) so the halves are
identical apart from their time. A zoom framing a single interaction cannot
be split.

Overlays and narration cues are not yet splittable from the web editor: their
placements are stored as points (a start position, not a code-level span), so
there is no duration to divide.

### Actions inside `hide()`

Instrumented actions inside a `hide()` run raw (no cursor animation) and emit
no input events, but each one records a small `hiddenAction` marker
(`{ type: 'hiddenAction', timeMs, action, matcher? }`) in the recording data.
Renderers ignore these markers; the web editor uses them to know what a hide
was suppressing.

## How edits and code fit together

Code declares the video and records the footage; the editor layers edits on
top:

1. **Record.** `screenci preview` (locally or in CI) records purely from code,
   so the footage always matches what the sources say.
2. **Edit in the web timeline.** Each saved edit is stored in the editor,
   keyed to its action's `editId` slug (or its call position), and applies to
   every later preview and render of the video.
3. **Re-record freely.** Because edits are keyed to stable action identities,
   they stay in place when fresh footage lands.

## Action identity: editId

> **Note:** automatic editId stamping is currently disabled. The editor only
> supports editing narration, `renderOptions` and `recordOptions`, which are
> applied by video name and need no editIds, so the CLI does not rewrite
> sources to stamp slugs and does not warn about missing ones. Existing
> stamped editIds remain valid. The rest of this section describes the
> mechanism as it works when stamping is enabled.

Every editable action can carry a stable, human-readable identity slug in
code, e.g. `.click({ editId: 'click1' })` or
`autoZoom(fn, { editId: 'autoZoom1' })`. The `screenci preview` startup handshake
stamps missing slugs automatically after a recording, allocating numbers from
`.screenci/edit-ids.json` (commit it; numbers are never reused and stamped ids
are never removed). With an editId, the action's stable key IS the slug: edits
keep matching across re-records even after refactors, moved lines, or locator
changes. An action that has not been stamped yet falls back to a readable
identity key built from what was recorded (`delay`, `input click Save`, with
`#2` appended for repeat executions); these keys can drift across re-records,
which is why stamping exists.

The slug is the action's display name on the editor timeline.

Because the slug IS the identity, two distinct actions must never share one. A
copy-pasted `editId` silently merges both into a single identity (the second
looks like a loop repeat and cannot hold its own edits). Static analysis
guards against this automatically: before recording, and during the
`screenci preview` startup handshake, any slug found at two
or more distinct call sites is resolved by keeping the first occurrence and
re-stamping the rest with fresh slugs (allocated from `.screenci/edit-ids.json`,
so they never collide with an existing id). A genuine loop (one call site that
runs repeatedly) is a single occurrence in source and is left untouched.
Resolving needs the `typescript` package resolvable from your project; when it
is missing, the CLI warns only if a possible duplicate was actually detected,
and leaves the sources unchanged.

editId is optional. Actions without one keep the matcher-based identity
(locator description + occurrence), which can drift across re-records. An
action that executes more than once in a
recording (a loop) gets keys like `click1#1` for the repeat executions; those
sit in a locked section that cannot be expressed as code options and are not
editable.

## What is editable from the web

Every recorded action carries identity metadata, so the timeline covers:

- **Interactions**: all pointer actions (click, fill, tap, check, select,
  hover, selectText, dragTo), with per-part timing (`sleepBefore`, move
  duration, pre-press pause, typing/hover/drag durations).
- **Camera**: `autoZoom()` blocks, `zoomTo()`, `resetZoom()`,
  `scrollIntoViewIfNeeded()`.
- **Pacing**: `speed()` blocks (multiplier), `time()` blocks (target
  duration), `page.waitForTimeout()` delays, and named `hide()` spans
  (visible, read-only). `speed`, `time` and `hide` all accept an optional
  name as their first argument for a stable identity.
- **Presentation**: `resizeRecording`/`hideRecording`/`showRecording` (size,
  duration) and `redact()` mask styling
  (color, radius, css).
- **Hard borders**: `page.goto` navigations are recorded and shown as
  full-height borders. Their duration is app time: never editable, and
  timing edits cannot cross them.

The editor can also ADD events without hand-editing code: hides, speedups,
time remaps, and recording changes,
each placed by call position (after a known action, or bracketing a run of
actions) with any gap expressed as a `waitForTimeout` sleep.

## Option panels and narration text are editable too

The editor's option panels store their edits the same way as timeline edits:

- **Render options** (recording size and roundness, background, aspect ratio,
  quality, mouse size/style/motion blur, narration
  box styling, shadow, crop) override the video's `.renderOptions({...})`
  values key by key; unrelated keys keep their code values.
- **Record options** override `.recordOptions({...})` the same way. Since
  they change recorded behavior, they apply at the next recording.
- **Narration text** overrides the `video.narration(...)` declaration per
  cue: a new cue key can be added, an existing value replaced, and per-cue
  volume adjusted. Editing a non-default language stores that language's own
  values without touching the others.

Uploaded media bytes (overlay files, audio tracks, uploaded narration audio,
cloned-voice samples) live in the ScreenCI backend and are referenced from
code as `{ editor: '<name>' }`.

Loop repeats stay locked: an action that runs more than once from a single
call site (keys like `click1#1`) cannot be edited per execution. Edit the
first iteration or the code itself.

## Undoing web edits

Use undo in the editor (up to 20 steps, Cmd+Z / Shift+Cmd+Z), or reset an
edited value back to its code value from its panel.

## Editor languages from code

> **Set `mode`, `locales`, and `browserLocale` correctly in code up front.** The
> editor can add languages (by writing them into `video.languages([...])`), but
> it cannot yet edit `mode`, `locales`, or `browserLocale`. Give them their final
> values now (via `video.languages({ languages, mode, locales, browserLocale })`).

The recorded language set is the **union** of the code set declared with
`video.languages([...])` and any language keys used by the narration
declaration (overlays are shared across languages). When you add a language to a
narrated video, the editor offers to auto-translate the existing narrations into
it, or start it with empty placeholders. The **Languages** section on the Editor
page shows the
current set and lets you add a language on top of the code set, then
records:

```ts
import { video } from 'screenci'

// Records en and fi. Adding a language in the editor extends this array.
video.narration({ en: { intro: 'Hi' } }).languages(['en', 'fi'])(
  'Product tour',
  async ({ page, narration }) => {
    await narration.intro()
    await page.goto('/dashboard')
  }
)
```

To set the capture options too, pass a config object:

```ts
video.languages({ languages: ['en', 'fi'], mode: 'shared' })
```

The config accepts the same `languages`, `mode`, `locales`, and `browserLocale`
fields. As noted above, the editor can edit the language set but not
`mode` / `locales` / `browserLocale` yet, so set those to their final values
here.

Adding a language records a fresh pass for it: the new pass reuses the existing
capture and the new narration. Because the language set changes the captured
recording itself (unlike narration text and overlays, applied at render time),
adding a language always requires a new recording pass. See
[Languages](./languages.md) for the full language API.

## Action parameter tracking and overrides

Every instrumented Playwright action (`click`, `fill`, `pressSequentially`,
`tap`, `check`, `uncheck`, `selectOption`, `hover`, `dragTo`, `selectText`,
`scrollIntoViewIfNeeded`) records which option values it used, for example
`move.duration`, `move.speed`, `move.easing`, `move.delayAfter`, `position`,
`noWaitAfter`, `duration`, and `dragSteps`, and whether each value was set
explicitly at the call site or came from a default. This provenance is written
into the uploaded recording data (`actionParams` in `data.json`), so the
backend and Editor can present the parameters for editing.

Editing a parameter in the web editor writes it into the call site as an
explicit option (via the connected `screenci preview` session), whether the value
previously came from code or from a default. The recording always runs with
whatever the code says.

The SDK also exports `ACTION_PARAM_DEFAULTS`, the default value of every
tracked option per action method, so integrations can tell an edit that merely
restates the default from a real change and offer "reset to default".

## Migrating from `editable()`

The `editable()` helper has been removed. Everything is editable in the web app
by default now, so the wrapper is no longer needed:

| Before                                          | After                                  |
| ----------------------------------------------- | -------------------------------------- |
| `editable(['intro'])`                           | `['intro']`                            |
| `editable({ intro: 'Hi' })`                     | `{ intro: 'Hi' }`                      |
| `video.languages(editable())`                   | `video.languages()`                    |
| `video.languages(editable(['en', 'fi']))`       | `video.languages(['en', 'fi'])`        |
| `video.languages(editable({ mode: 'shared' }))` | `video.languages({ mode: 'shared' })`  |
| `use({ recordOptions: editable({ fps: 30 }) })` | `video.recordOptions({ fps: 30 })`     |
| `use({ renderOptions: editable() })`            | `video.renderOptions({ default: {} })` |

A bare array still declares blank editor-owned names. A plain object now
supplies code values that are used at record time and remain editable in the
web app: once edited there, the Editor value wins over the code value.
