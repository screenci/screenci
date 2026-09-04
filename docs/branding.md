# Branding

Every new video starts from the look and voice your organisation set once:
the **Branding** page in the web app (top-right menu) stores the background,
the output size, the cursor style and the default narration voice. Projects can
override each field. When a coding agent creates a video from a setup prompt,
`screenci start` hands it the resolved branding and the agent writes those
values into the video code, so the result matches your brand without anyone
repeating it in every prompt.

#### You will learn

- [what the fields mean](#the-fields)
- [how shared assets work](#shared-assets)
- [how a project overrides the organisation](#project-overrides)
- [how agents apply the branding](#how-agents-use-it)
- [which voices you can pick and what they need](#the-narration-voice)
- [where the ElevenLabs API key lives](#elevenlabs-api-key)

## The fields

| Field               | What it sets                                                                                                                                              |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Background**      | The frame behind the recording: a color, a two-stop gradient, or one of the wallpaper presets. Becomes `output.background` in the video's render options. |
| **Output size**     | The aspect ratio and quality new videos render at (`output.aspectRatio`, `output.quality`, and the matching `recordOptions`).                             |
| **Cursor**          | The white or black pointer drawn over the recording (`mouse.style`).                                                                                      |
| **Narration voice** | The voice every cue uses unless a video or a cue picks its own (`narration.voice`). See [the narration voice](#the-narration-voice).                      |
| **Shared assets**   | Named images and videos (a logo, an intro clip) the video code references by name. See [shared assets](#shared-assets).                                   |

Any member can edit the organisation values. Nothing changes for videos that
already exist: the values above only inform new videos, and the code of a video
is what renders. Change an existing video in the [Editor](/docs/editor) or in
its script. [Shared assets](#shared-assets) work the other way round: they are
referenced by name and resolved every time a video is exported.

## Shared assets

A shared asset is a file you upload once and reference from any video by name:
a logo, a wordmark, an intro or outro clip. Each asset has

- a **name**, lowercase letters, digits and dashes, which the code references,
- a **kind**, image or video,
- the **file** itself, and
- a **guide**: free text telling a coding agent how to use it, for example
  "bottom-right corner, small, on every screen". The guide never affects a
  render; it is instructions for whoever writes the video.

Use one in code with `{ branding: '<name>' }`, placed and timed like any other
overlay:

```ts
import { video } from 'screenci'

video.overlays({
  logo: { branding: 'logo', x: 1560, y: 960, width: 288 },
  intro: { branding: 'intro-clip', fill: 'screen' },
})('Create an invoice', async ({ page, overlays }) => {
  await overlays.intro()
  await overlays.logo.for(3000)
})
```

An image needs a length; a video plays its own. See
[Overlays](/docs/guides/overlays) for placement and the video options.

### Replacing a file, and outdated videos

The name is a **live reference**. Nothing is copied into the recording: every
export resolves the name to the file the Branding page holds at that moment. So
upload a new logo and the next export of every video that references it picks it
up, with no re-recording and no code change.

The videos already exported from the old file are then out of date. The Branding
page lists them, says which asset changed and when, and offers **Re-export all**,
which re-exports every one of them into a single export run and links to it.
Exports are metered as usual, so the button shows how many videos it covers.
Editing a guide changes nothing about a render and never marks anything
outdated.

Deleting an asset that videos still reference makes their next export fail with
a message naming it, rather than quietly rendering without the overlay. Re-add
it, or update the video code.

`screenci start` and `screenci context` download a copy of each asset into
`screenci/branding/<name>` so the agent can see what it is working with and
local previews can show it. Those copies are never uploaded: the recording only
carries the name.

## Project overrides

The **Branding** button on a project page opens the same form with an
**Override for this project** toggle per field. A field without the toggle
inherits the organisation value, shown as the selected but disabled choice. A
project can keep its own voice sample as well.

## How agents use it

`screenci start` receives the resolved branding with the setup-code exchange
and prints a **Branding** section in the brief: the values, where each comes
from (organisation or project override), any warnings, and a ready-made code
snippet. The agent puts those values on the new video:

```ts
import { video, voices } from 'screenci'

video.recordOptions({ aspectRatio: '9:16', quality: '1080p' }).renderOptions({
  output: {
    background: { backgroundCss: '#334155' },
    aspectRatio: '9:16',
    quality: '1080p',
  },
  mouse: { style: 'black' },
  narration: { voice: { name: 'Ava' } },
})('Create an invoice', async ({ page }) => {
  // ...
})
```

The agent is told to keep these unless the person asks for a different look, so
a prompt like "make this one square" still wins. Values in code are the source
of truth: no hidden layer applies them at record or render time. Shared assets
are the deliberate exception, since a reference by name is what lets one upload
update many videos. Re-read the
branding at any time with [`screenci context`](/docs/reference/cli#screenci-context),
which prints it after the AI context and repeats the same JSON fields.

## The narration voice

Three kinds of voice can be the default:

- **Built-in**: one of the [built-in voices](/docs/guides/narration#voices),
  for example `Ava`. Works on every plan without any key.
- **ElevenLabs account**: a voice from your own ElevenLabs account (the picker
  lists them). Hosted ElevenLabs voices need the Pro plan or higher to record
  and use [your ElevenLabs API key](#elevenlabs-api-key).
- **Cloned from a sample**: drop an audio or video file onto the page, pick one,
  or record a sample with your microphone right in the browser (30 seconds to a
  few minutes of clear speech, up to 11 MB). The sample is stored with your
  organisation; the clone is created the first time a cue is synthesized, in a
  render or in the editor preview, and cached after that. A self-recorded clone
  works on every plan but needs your ElevenLabs API key.

For a cloned voice, `screenci start` (and `screenci context`) also downloads
the sample into the workspace as `screenci/branding/<file>`, and the snippet
points `voices.elevenlabs({ path: './branding/<file>' })` at it. Media files
never enter a source bundle, so a workspace pulled on another machine gets the
sample again from the same command. The Branding page shows a warning when the
default voice cannot render on the current plan or without a key; the brief and
`screenci context` repeat it.

## ElevenLabs API key

The organisation's ElevenLabs API key lives on the Branding page, next to the
voice picker. It is encrypted at rest, never shown again, and used for every
render and editor preview that needs ElevenLabs. See
[ElevenLabs voices](/docs/guides/narration#elevenlabs-voices).

## Related pages

- [Overlays](/docs/guides/overlays) for placing and timing a shared asset.
- [AI context](/docs/guides/ai-context) for what else the agent learns.
- [Configuration](/docs/reference/configuration#rendering-defaults) for the
  render options the branding maps to.
- [Narration](/docs/guides/narration) for voices per language and per cue.
