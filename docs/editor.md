# Editor

Editor is the ScreenCI web app's editing surface for a video: a live preview of
the raw recording, a multi-track timeline, and panels for narration, overlays,
and render options. You edit visually in the browser, and every change is
written back into your `.screenci.ts` source through a connected
`screenci dev` machine, so code stays the single source of truth.

**Editing needs a connected machine.** Run `screenci dev` in your project to
connect it. While no machine is connected the editor stays open for viewing and
playback, but the editing controls are locked with a note explaining how to
connect. Each edit you make is sent to your machine as a code change, applied
to the sources within seconds, and the preview updates from the result. Edits
that change what is captured (record options, interaction timings) also
trigger an automatic preview re-record on your machine.

**Everything is editable by default.** Every feature a video declares
(narration, overlays, languages, render and record options) can
be edited in the web app. There is nothing to opt in to; the only choice you
make in code is where the content starts:

- **Arrays declare blank editor-owned names.** `video.narration(['intro'])`
  keeps the name in code (so the body can call `narration.intro`) while the
  content is filled in on the Editor page.

- **Plain objects are code values.** `video.narration({ intro: 'Welcome' })`
  supplies the content from code. It is used at record time and stays fully
  editable in the web app: once a value is edited in Editor, the Editor value
  wins over the code value on every later upload.

- **Edits write back to code.** Whichever form declared a value, editing it in
  the web app produces a code change applied by your connected `screenci dev`
  machine, so the sources always show what the video renders with.

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

// Languages: hand the whole set to the web, or seed an initial set.
video.languages() // web-owned set
video.languages(['en', 'fi']) // code seed the web app can extend
video.languages({ languages: ['en', 'fi'], mode: 'shared' }) // seed with capture options

// Render / record options: code values are the starting point, web edits win.
// Declare them per video with the builder methods (renderOptions supports
// per-language overrides via { default, <lang> }).
video.renderOptions({ output: { aspectRatio: '9:16' } })
video.recordOptions({ fps: 30 })
```

#### You will learn

- [how the editor is laid out and what each part does](#the-editor-at-a-glance)
- [why editing requires a connected machine](#editing-needs-a-connected-machine)
- [how to edit and export a video in Editor](#editing-in-editor)
- [how to record from the editor](#recording-from-the-editor)
- [how to manage narration from Editor](#editor-narration-from-code)
- [how to use uploaded media as narration](#narration-media-from-editor)
- [how to manage overlays from Editor](#editor-overlays-from-code)
- [how render and record options combine with web edits](#editor-render-and-record-options)
- [how to manage languages from Editor](#editor-languages-from-code)
- [how to place effects from code](#effects-in-code-block-wrappers-and-gap-sleeps)
- [how web edits move into code with an agent](#the-agentic-loop)
- [how action parameters are tracked and overridden](#action-parameter-tracking-and-overrides)
- [how to migrate from the removed `editable()` helper](#migrating-from-editable)

<!-- screenci-doc-video:docs/guides/editor -->

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
  overlay's right edge changes its duration.
- **Side panel** (right): render options (canvas, background, roundness,
  shadow, padding), recording options with a visual crop editor, and the
  editor for whichever timeline item is selected.
- **Sidebar** (left): the language picker, the **Editor** view, the
  **Exported** group listing every exported version, and the **Recording**
  group showing your connected `screenci dev` machine and record actions.
- **Top right**: undo and redo (up to 20 steps, Cmd+Z / Shift+Cmd+Z), export
  status, and the **Export** button.

## Editing needs a connected machine

Every edit is a code change: the editor sends it to your machine over the
`screenci dev` channel, the CLI writes it into the `.screenci.ts` source, and
the preview updates from the applied result. Because of that, editing is
locked until a machine you own is connected:

1. Create a personal dev token on the Secrets page and add it to your project
   env file as `SCREENCI_DEV_TOKEN=<token>`.
2. Run `screenci dev` in your project (add `--sync` to also codify pending web
   edits, see [the agentic loop](#the-agentic-loop)).
3. The sidebar's Recording group shows your machine connected (for example
   `you@laptop`), and the editing controls unlock.

While no machine is connected the editor is view-only: playback, seeking, and
version browsing keep working, but the edit controls are dimmed and show
"Editing needs a connected machine" when clicked. Only your own account can
use your machine; teammates see it connected but each need their own.

Edits that only affect rendering (narration text, overlay files, render
options) preview immediately. Edits that change the capture itself (record
options, interaction timings, added effects) are marked **Needs re-record**
and trigger an automatic preview re-record on the connected machine.

## Editing in Editor

The editor shows the narration, voices, overlays, and render options the video
uses. Every item is editable: names declared as a blank array start empty and
wait for content, and values declared in code show their current code value as
the starting point.

Items whose current value still comes from code are marked with a **set in
code** badge. Editing such an item writes the new value back into your source
through the connected machine, so code and editor never drift apart.

Pick a language in the sidebar, then choose **Export** to export a new version
in that language. Exports are per language: switch the language and export
again to update another localized version. If edits that need a new recording
are pending and your machine is connected, Export records first and then
renders. Exported versions appear in the sidebar's **Exported** group, with a
status glyph while rendering and a marker on the version served at the public
URL.

Saved editor values are applied automatically to every later upload, so CI
keeps rendering with them. When this happens the CLI prints a line in the
upload output, so it is visible in CI logs:

```
Editor configuration applied for "Checkout walkthrough".
```

## Recording from the editor

The sidebar's **Recording** group collects every way to produce fresh footage:

- **Record on your machine**: with `screenci dev` connected, the record menu
  offers "Record <language> on <machine>". This runs a normal local record of
  the open video and language on your machine and syncs the result back.
- **Record raw preview footage**: records without rendering, refreshing the
  live preview only. This is also what automatic preview re-records use.
- **Record via CI**: when the project is connected to GitHub, queues the
  project's recording workflow for this video, no local machine needed.

A status line under the menu tracks the run ("Recording en on laptop...",
"Recording synced."). The regular record run lock applies: if another
`screenci record` is already running on the machine, the request is reported
back as failed.

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
the web timeline and applied on the next record, without touching code.

Every interaction is editable from the web, whether its values come from
package defaults or from explicit options in code. Its identity is the
captured locator description (for example `getByRole(button, name=Save)`)
plus its position on the timeline. Explicit code options do not block edits:
the editor shows those fields with a `code` marker, and saving an edit over
one shows a note that it shadows the code value. At the next record the CLI
prints a matching warning (`editor override shadows code value: ...`), and
`screenci status` lists every shadowing edit so you can move it into code or
clear it.

Cursor-move fields (`move.duration`/`move.speed`, `move.easing`, `move.curve`,
`move.curviness`, `move.delayAfter`), action durations, and pre-action pauses
all sync back into code: `screenci sync` writes each edited value as the
matching option on the `editId`-stamped call. The cursor path's curve can be
edited visually in the preview by dragging its bezier handles.

Manual `zoomTo(...)` calls and `scrollIntoViewIfNeeded()` also appear on the
editor's "Zooms & scrolls" row with editable `easing`, `duration`, `amount`,
and `centering` fields.

The main editable action forms:

```ts
import { autoZoom, speed } from 'screenci'

// Named speed block: the multiplier is owned by the web editor (defaults to 1).
await speed('intro-speedup', async () => { ... })

// Unnamed editable block, identified by its timeline position.
await speed(async () => { ... })

// Explicit: the multiplier comes from code (a web edit shadows it and warns).
await speed(3, async () => { ... })

// Bare autoZoom stays fully web-editable, starting from the package defaults.
await autoZoom(async () => { ... })

// Web-editable pause: defaults to 0ms until edited in the web timeline.
await page.waitForTimeout()

// Explicit pause: the duration comes from code (a web edit shadows it).
await page.waitForTimeout(500)
```

Pointer actions also expose a web-owned `sleepBefore` field (default 0): the
SDK sleeps that long after the previous event before the cursor starts
moving, pushing the action later on the timeline. In the editor, dragging a
bar's left edge sets it, and the pause shows as a leading "sleep" part of the
bar.

Before `screenci record` (and `screenci test --mock-record`) the CLI fetches
the saved web edits and applies them to the run. Plain `screenci test` skips
timings entirely, so it neither fetches nor applies them. After each upload the
stored timeline is reconciled against what was actually recorded: new actions
appear in place, removed actions disappear, and edits whose action vanished are
kept as stale entries in the editor for cleanup instead of being dropped.

## Web-authored events

Render-affecting events can also be ADDED and MOVED from the web timeline,
without any code change: hides, speedups, time remaps, narration cues,
overlays, and recording changes (resize/hide/show). Interactions are
different on
purpose: a click or tap always stays where the test code performed it, and
only its parameters (durations, sleeps) are editable.

Everything the timeline adds is stored as one unified edit keyed to a call
position; there is no separate legacy path. A newly added event appears
immediately on the timeline as a pending item (a dashed, dimmed bar) that
reads "applies at the next record", so you can see and remove it before
re-recording.

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

At the next record the CLI fetches the stored edits and the SDK plays them in
call order. An action that no longer exists (its editId vanished from the
latest recording) never fails the recording and is never dropped silently: the
edit is reported as `skipped` with a reason. The editor shows these outcomes on
the timeline, and `screenci status` reports them with a fix suggestion.

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
shows this same linear timeline, and `screenci sync` writes these
call-position statements back into code, keyed by each action's `editId`.

## The agentic loop

Web edits and code stay in sync through a loop designed for coding agents:

1. **Edit in the web timeline.** Drags and added events are stored as
   call-position edits (which action the event sits after, or the run it
   brackets, plus any gap sleeps), each keyed to a stable `editId`.
2. **Record.** `screenci record` fetches the edits, applies them, and prints
   the override report; every edit ends as applied or skipped with a reason,
   in the logs and in the editor.
3. **Check drift.** `screenci status` lists edits that shadow explicit code
   values and stale edits whose action vanished.
4. **Codify.** `screenci sync` applies the edits directly to the `.screenci.ts`
   sources via static analysis (dry-run by default, `--write` to save). Each
   edit locates its call site by the exact `editId` slug and writes the
   call-position statement: a `narration.x()` / overlay / presentation call
   (with a `waitForTimeout` gap) into the right spot, or an
   `autoZoom` / `hide` / `speed` / `time` block bracketing the right run of
   interactions. There is no agent-prompt fallback: an edit either applies by
   editId or its section is locked (a loop or branch) and reported as an
   unappliable count.
5. **Clear the web layer.** `screenci reset-web-edits` removes the codified
   edits so the next record runs purely from code, and the loop is closed
   (`screenci sync --write --reset` does this automatically for videos whose
   edits were all applied).

Because the web timeline and code share one linear model, codifying an edit
inserts the same call you would have written by hand, and the next recording's
override report confirms the code now produces the same result.

## Action identity: editId

Every editable action can carry a stable, human-readable identity slug in
code, e.g. `.click({ editId: 'click1' })` or
`autoZoom(fn, { editId: 'autoZoom1' })`. `screenci sync` (and `screenci dev
--sync`) stamps missing slugs automatically after a recording, allocating
numbers from `.screenci/edit-ids.json` (commit it; numbers are never reused
and stamped ids are never removed). With an editId, the action's stable key
IS the slug: edits keep matching across re-records even after refactors, moved
lines, or locator changes, and `screenci sync`
locates the call site by the exact slug instead of heuristics.

The slug is the action's display name on the editor timeline, and it can be
renamed there: the rename is stored as a web edit and `screenci sync` applies
it by replacing the slug's string literal in code. Nothing goes stale in
between because the recorded slug keeps matching until the rename is
codified.

editId is optional until edits need to reach code. Actions without one keep
the matcher-based identity (locator description + occurrence) for display and
record-time overrides, but `screenci sync` never guesses at their call sites:
their edits stay web-runtime-only until a record plus sync stamps them. An
action that executes more than once in a recording (a loop) gets keys like
`click1#1` for the repeat executions; those sit in a locked section that
cannot be expressed as code options and stay web-runtime-only.

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

The editor can also ADD events without code changes: hides, speedups, time
remaps, and recording changes,
each placed by call position (after a known action, or bracketing a run of
actions) with any gap expressed as a `waitForTimeout` sleep.

## Resetting web edits

- In the editor: the "pending web edits" strip has a **Reset all** button
  (clears timing overrides and authored events for the video).
- From the CLI: `screenci reset-web-edits [--video <name>]` clears the whole
  project (or one video), so the next record runs purely from code.
- `screenci sync --write` moves web edits INTO code, locating each call site by
  its `editId` slug and writing the call-position statement. After codifying,
  clear the web layer with `reset-web-edits`.

## The override report

Every record run produces an override report: one line per web edit the run
tried to apply, with its outcome. Skips and edits that shadow explicit code
values are always logged; a summary line closes each video:

```
[screenci overrides] applied event hide after=submit +250ms h_ab12
[screenci overrides] SKIPPED event narrationCue after=intro reason=editIdMissing:intro n_9
[screenci overrides] My video: 3 applied, 1 skipped
```

The same items are embedded into the uploaded recording data
(`overrideReport` in `data.json`), so the editor can show whether each edit
was applied or skipped and why: after a record run the timeline surfaces
**Broken edits** and **Stale edits** strips listing anything that did not
apply, until you fix or dismiss them. A fetch failure before the run also
warns loudly: a recording never silently ignores your saved edits.

## Debugging overrides

Set `SCREENCI_DEBUG_OVERRIDES=1` when running `screenci record` to trace the
whole loop: the CLI first dumps every override set fetched from the backend
(timing overrides, action parameters, timeline edits, text values, record
options, web-added languages), then the run logs each value again at the
moment it is applied (applied lines join the always-on skip/fallback lines):

```
[screenci debug] Editor timing overrides:
  { "My video": [ { "key": "input|click|locator(#go)|0", "values": { "moveDuration": 150 } } ] }
[screenci debug] editor override applied: input|click|locator(#go)|0 moveDuration: 900 -> 150
[screenci overrides] applied event speed from=next until=confirm s_3
```

## Editor languages from code

> **Set `mode`, `locales`, and `browserLocale` correctly in code up front.** The
> web app can add and remove languages, but it cannot yet edit `mode`,
> `locales`, or `browserLocale`. Those fields are seeded from code once and used
> for every render until web editing of them ships, so give them their final
> values now (via `video.languages({ languages, mode, locales, browserLocale })`).
> Only the language **set** is editable from the web today.

Every declared language set is web-owned: the recorded set is the **union** of
the web app's selection, the code seed, and any language keys used by
per-language features (narration, overlays). Call
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
narration and overlays configuration. Removing a language takes effect
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

Editor overrides can target both kinds of values: an option you set explicitly
in code and one that fell back to a default. Overriding a default is the quiet,
normal case; the Editor shows a small warning marker only when your edit
shadows an explicitly code-set value.

At the start of `screenci record`, editor overrides fetched from the backend
are compared against the latest local snapshot, and an info line is printed for
each override that shadows an explicitly code-set value:

```
[screenci] editor override shadows code value: <selector> <method> <optionPath>: code <value> -> editor <value> (video: <name>)
```

During recording, editor overrides are applied to actions. Only an override
that actually changes the value the recording runs with is reported (an
override that restates the code value is a no-op):

```
[screenci] editor override: <selector> <method> <optionPath>: <used> (code: <codeValue>, explicit|default)
```

When an override changed a value, the recording's `actionParams` entry carries
the actually used value in a `used` field next to the code value, so the Editor
can update its own copy of the options from what the recording really ran with.

The SDK also exports `ACTION_PARAM_DEFAULTS`, the default value of every
tracked option per action method, so integrations can tell an override that
merely restates the default from a real change and offer "reset to default".

### Checking and syncing: `status` and `sync`

Two commands keep code and Editor edits from drifting apart:

- `screenci status` fetches the Editor's current edits and compares them with
  the latest recorded run: which overrides shadow explicit code values, which
  change defaults, which are stale (the action no longer exists in the latest
  recording, usually because the code changed).
- `screenci sync` applies the Editor's edits directly to the `.screenci.ts`
  sources (dry-run by default, `--write` to save). It locates each call site by
  the exact `editId` slug and writes the change in place: action-parameter
  edits set or remove option values, and added effects become call-position
  statements (a `narration.x()` / overlay / presentation call with a
  `waitForTimeout` gap, or an `autoZoom` / `hide` / `speed` / `time` block
  bracketing the right run of interactions). There is no agent-prompt path: an
  edit either applies by editId or its section is locked and reported as an
  unappliable count. Render and record options the Editor holds are codified
  into `video.renderOptions(...)` / `video.recordOptions(...)`; record options
  are captured at record time, so re-record after codifying them.

Both accept `-g, --grep <regex>` to filter videos by name (the same semantics
as Playwright's `--grep`) and `-c, --config <path>`.

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
