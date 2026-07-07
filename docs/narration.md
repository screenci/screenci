# Narration

ScreenCI narration is cue-based. You attach a script to a video with
`video.narration(...)`, then place named cue markers into the visible flow where
speech should start, overlap, and end.

The spoken text lives in `video.narration(...)`, owned by code or handed to
[Editor](./editor.md) (the web app where non-developers edit it without touching
the test). See [the two ways to declare narration](#two-ways-to-declare-narration)
just below.

When you own it in code you can pass it two shapes. The **language-major** form is
keyed by language code (`{ en: {...} }`), with per-language cues. The
**content-major** form is a flat map of cue names (`{ intro: 'Hi' }`) that applies
to every language. The disambiguation is purely structural: an object is
language-major if every top-level key is a supported language code or the literal
`default`; otherwise it is content-major. There is no `languages:` wrapper, and a
content name may not be a bare language code or `default`.

The default voice is set once with `renderOptions.narration.voice`, in
`screenci.config.ts` or `video.renderOptions(...)`. A per-cue `voice` (inside the narration
value) is the most specific override. Changing the voice re-renders without
re-recording; changing the spoken text re-records.

Built-in voices are shared across supported narration languages with one current
exception: for Russian (`ru`), the built-in choices are `Ava`, `Daniel`, `Emma`,
`Leo`, `Lily`, `Max`, `Miles`, and `Nora`. The built-in fallback voice is `Ava`,
so an unconfigured video stays valid there too.

`style` prompts require the Business tier, as does choosing `modelType:
'expressive'` for a language that also has a consistent voice (a tone upgrade).
A language whose only built-in voice is the expressive model uses it
automatically on every plan, so Free and Starter can narrate it without setting
`modelType`.

Recording yourself is always possible on every tier: you can supply your own
recorded audio for any cue with a [`media` file](#balance-narration-volume), or
narrate in your own [self-recorded voice clone](#clone-a-voice-from-an-audio-sample).
Neither needs the Business tier (only hosted ElevenLabs library voices do), so
you never have to use a synthesized voice if you would rather use your own.

#### You will learn

- [how to attach a narration script](#attach-a-narration-script)
- [how to overlap narration with visible motion](#timing-modes)
- [how to balance cue volume](#balance-narration-volume)
- [how to set the voice per cue](#voice-per-language-and-per-cue)
- [how to use inline speech markup](#inline-speech-markup)
- [how to use ElevenLabs voices](#elevenlabs-voices)

<!-- screenci-doc-video:docs/guides/narration -->

## Two ways to declare narration

There are two ways to declare narration, and both are editable in the web app.
The same two forms apply to [`values`](./values.md),
[`overlays`](./overlays.md), and [`audio`](./audio.md). See the
[Editor guide](./editor.md) for how the web editing works.

**1. Code values.** You write the text; it is used at record time. Changing it
re-records. The text stays editable in [Editor](./editor.md), and an Editor
edit wins over the code value from then on.

```ts
video.narration({ en: { intro: 'Welcome.' } })
```

**2. Editor-owned (blank).** Pass a bare array of cue names: the names exist in
code (so the body can call `narration.intro`), but [Editor](./editor.md) owns
the text. Chain `.languages([...])`, since there is no text to infer the set
from.

```ts
import { video } from 'screenci'

video.narration(['intro', 'outro']).languages(['en'])
```

## Attach a narration script

Attach the narration script with `video.narration(...)`. The body receives a
`narration` object whose markers (`narration.intro()`, `.start()`, `.end()`)
carry timing only: the text comes from the narration spec, the voice from your
config or `video.renderOptions(...)` default.

```ts
import { video, voices } from 'screenci'

video
  // The default voice (how the narration is spoken).
  .renderOptions({ narration: { voice: { name: voices.Ava } } })
  .narration({
    en: {
      intro: 'Open the settings page.',
      save: 'Save the changes when you are ready.',
    },
  })('Settings', async ({ page, narration }) => {
  await narration.intro()
  await page.goto('/settings')

  await narration.save.start()
  await page.getByRole('button', { name: 'Save' }).click()
  await narration.save.end()
})
```

For a script that is the same in every language, pass the **content-major** form
(a flat map of cue names): `video.narration({ intro: 'Open the settings page.' })`.
For multi-language videos, see [Languages](/docs/guides/languages).

## Timing modes

Use the cue markers intentionally:

- `await narration.key()` waits for the full spoken line to finish.
- `await narration.key.start()` begins the cue and keeps the script moving.
- `await narration.key.end()` closes the same cue later.

That is the main tool for overlapping speech with UI motion without losing
control of the timeline.

### How recording pacing works

When a recording pass targets one language (the default per-language mode) and
your project is linked to an account, ScreenCI looks up each cue's real audio
length before the cue ends and paces the recording to it: `await narration.key()`
takes as long as the spoken line, and the recording's length matches the
finished video. This makes freeze-frames (inserted when the audio outlasts the
recording) the exception rather than the rule.

Pacing is best-effort. When the length is unknown (offline, shared-capture
multi-language mode, or an unlinked project) the recording keeps only a short
gap per cue and the render freezes a frame for the remaining audio, exactly as
before. Editing narration text after recording re-renders without re-recording:
the render inserts the missing time when a line grew, and trims the paced-in
extra when a line shrank (never cutting into mouse movement, scrolls, clicks,
or zooms; a safety buffer is kept around them).

To skip pacing and record as fast as possible, pass `--fast-narration`:

```bash
npx screenci record --fast-narration
```

### Holding a cue until a position

Pass a string position to hold the cue window until an absolute point in the
finished video, instead of only until its audio ends:

- `await narration.key.until('0:10')` holds until 10 seconds in.
- `await narration.key.until('2s')` / `'5.51s'` use seconds (fractions allowed).
- `await narration.key.until('1:02:03.5')` uses an `h:mm:ss(.f)` timecode.
- `await narration.key.until('56%')` holds until 56% through the video.

Positions are resolved against the finished render, so they line up with the
actual video. The audio is never cut: if a line runs longer than the position,
the window extends so it always finishes. A position that lands before the line
even starts is ignored with a warning.

Keep cues small. In practice, one sentence per cue is the safest default for
timing, overlap control, and subtitle readability.

If only one file needs a different narration layout, pair `video.narration(...)`
with `video.renderOptions()` instead of changing the whole project:

```ts
import { video, voices } from 'screenci'

video
  // `corner` is a visual render option; `voice` is the default voice for every
  // language. Both are render options set with `renderOptions`.
  .renderOptions({
    narration: { corner: 'top-right', voice: { name: voices.Ava } },
  })
  .narration({
    en: {
      intro: 'Open the analytics tab.',
      summary: 'Review the latest numbers.',
    },
  })('Analytics walkthrough', async ({ page, narration }) => {
  await narration.intro.start()
  await page.getByRole('tab', { name: 'Analytics' }).click()
  await narration.intro.end()

  await narration.summary()
})
```

## Balance narration volume

Set a per-cue `volume` to balance a spoken line against the recording and any
background audio. Use the object form of a cue and add `volume`:

```ts
video.narration({
  en: {
    // Quieter than natural, e.g. to sit under a louder moment in the recording.
    intro: { cue: 'Open the settings page.', volume: 0.6 },
    // Natural level (the default); the same as `summary: 'Review the numbers.'`.
    summary: { cue: 'Review the numbers.', volume: 1 },
  },
})('Settings', async ({ page, narration }) => {
  /* ... */
})
```

`volume` is a linear gain: `1` is the natural level (the default), `0` is silent,
and values above `1` boost the line (capped at `4`). It is a per-cue setting, so a
file-based cue accepts it too:

```ts
clip: { media: '/walkthrough.mp4', volume: 0.5 }
```

Volume is applied when the narration is mixed into the final video, not when the
speech is generated. Changing it never regenerates the audio, and it is not a
per-language setting: when more than one language sets a volume for the same cue,
the first one wins.

A `media` file is uploaded the first time you record with it present and reused
on later runs, so you do not have to commit the file. If it is missing locally,
ScreenCI reuses the version uploaded for this video (matched by file path). See
[Asset files do not need to be committed](/docs/ci-setup#asset-files-do-not-need-to-be-committed).

### Crop and trim a media cue

A `media`/`path` cue that is a **video** (a talking-head or webcam clip shown as a
corner tile) accepts `crop`, `start`, and `end`:

```ts
clip: {
  media: '/webcam.mp4',
  // Reframe the source onto the speaker's face (source pixels, top-left origin).
  crop: { x: 320, y: 80, width: 720, height: 720 },
  // Play only seconds 2 through the halfway point of the source.
  start: '0:02',
  end: '50%',
}
```

`crop` selects a region of the source video in its own pixels; the tile keeps its
square shape (the crop reframes the source first, then the usual square fit
applies). `start`/`end` trim the played slice of the source: each is a time string
(`'2s'`/`'1.5s'`, a `'0:02'` timecode, or `'50%'` of the source duration), and
`start` must come before `end`. Both the picture and the spoken audio are trimmed
together.

## Voice per language and per cue

The default voice for every language is set once with `renderOptions.narration.voice`
(in your config or `video.renderOptions(...)`). To override the voice for a specific
language or a single line, use the object form of the cue value and pass its own
`voice` (a per-cue override). When a whole language needs a different voice or
delivery profile, set that `voice` on each of its cues:

```ts
import { video, voices } from 'screenci'

video.narration({
  en: {
    intro: { cue: 'Welcome to the dashboard.', voice: { name: voices.Ava } },
  },
  fi: {
    intro: {
      cue: 'Tervetuloa hallintapaneeliin.',
      voice: { name: voices.Nora, pacing: 0.95 },
    },
  },
  de: {
    intro: {
      cue: 'Willkommen im Dashboard.',
      voice: {
        name: voices.Julian,
        modelType: 'expressive',
        style: 'A friendly and energetic German speaker.',
      },
    },
  },
})('Dashboard tour', async ({ page, narration }) => {
  await narration.intro()
})
```

The German entry above is a Business-tier example because it uses expressive
narration. A per-cue voice can also carry a `seed` (an integer mixed into the
audio cache key) to force regeneration or pin a specific take.

A per-cue `voice` is the most specific level of the cascade, so you can also
single out one line within an otherwise default-voiced language:

```ts
video.narration({
  en: {
    intro: 'Welcome to the dashboard.',
    // This one line is read by a different voice.
    alert: {
      cue: 'Heads up: billing is overdue.',
      voice: { name: voices.Marcus },
    },
  },
})('Dashboard tour', async ({ page, narration }) => {
  await narration.intro()
  await narration.alert()
})
```

The voice is resolved per cue and language, first defined wins: the per-cue
`voice` overrides the `renderOptions.narration.voice` default set with `use`,
which falls back to a built-in voice. Because voice is never captured, you can
change it at any level and re-render without re-recording the browser.

### Speak a cue in a different language

A cue object can also set `language`, the locale its text is spoken in. It
defaults to the version language, so you only set it when a single line should be
pronounced in another language: a brand name, a quoted phrase, or a line you keep
in a base language on purpose. The text is always present (subtitles show that
exact text); `language` only changes the synthesis locale, not the version.

```ts
video.narration({
  en: { intro: 'Welcome.', tagline: 'Just do it' },
  fi: {
    intro: 'Tervetuloa.',
    // Spoken in English inside the Finnish version (e.g. a brand tagline).
    tagline: { cue: 'Just do it', language: 'en' },
  },
})('Landing', async ({ narration }) => {
  await narration.intro()
  await narration.tagline()
})
```

`language` applies only to spoken (text) cues, not to file-based `media` cues
(those carry their own audio). It is part of the audio cache key, so changing it
regenerates just that cue.

When you use ElevenLabs-specific voices or custom cloned voices, keep each cue as
its own sentence-sized unit. That makes re-recording cheaper and avoids paying
to regenerate long blocks when only one line changes.

## Available voices

ScreenCI ships with built-in voices that you can use across supported languages
through the `voices` export.

Russian (`ru`) currently has a smaller built-in subset: `Ava`, `Daniel`, `Emma`,
`Leo`, `Lily`, `Max`, `Miles`, and `Nora`. Use one of those names whenever a cue
is spoken in Russian.

| Name       | Gender | Character                      |
| ---------- | ------ | ------------------------------ |
| `Adrian`   | Male   | Clear, direct, and structured  |
| `Aria`     | Female | Soft and calm                  |
| `Ava`      | Female | Bright and optimistic          |
| `Clara`    | Female | Cheerful and energetic         |
| `Daniel`   | Male   | Clear and educational          |
| `Elena`    | Female | Smooth and composed            |
| `Emma`     | Female | Youthful and playful           |
| `Ethan`    | Male   | Warm and approachable          |
| `Evan`     | Male   | Casual and relaxed             |
| `Grace`    | Female | Gentle and caring              |
| `Hassan`   | Male   | Insightful and reliable        |
| `Helena`   | Female | Mature and authoritative       |
| `Isabella` | Female | Confident and proactive        |
| `Julian`   | Male   | Polished and fluid             |
| `Layla`    | Female | Warm and empathetic            |
| `Leo`      | Male   | High-energy and enthusiastic   |
| `Lily`     | Female | Light and effortless           |
| `Marcus`   | Male   | Firm and directive             |
| `Max`      | Male   | Upbeat and lively              |
| `Maya`     | Female | Relaxed and flexible           |
| `Miles`    | Male   | Grounded and assertive         |
| `Noah`     | Male   | Soft and intimate              |
| `Nora`     | Female | Strong and decisive            |
| `Omar`     | Male   | Detailed and explanatory       |
| `Ryan`     | Male   | Dynamic and spirited           |
| `Sam`      | Male   | Relaxed and conversational     |
| `Sophie`   | Female | Precise and easy to understand |
| `Thomas`   | Male   | Balanced and steady            |
| `Victor`   | Male   | Deep and serious               |
| `Zoe`      | Female | Positive and motivating        |

## Model type

Use `modelType` (on the default voice in `use`, or on a per-cue `voice`) when you
need to choose between consistency and expressiveness.

- `consistent` is the safer default for docs and product walkthroughs
- `expressive` is useful when you want a more natural, less uniform delivery
- choosing `expressive` for a language that also has a consistent voice, and
  `style` prompts, require the Business tier
- a language whose only built-in voice is the expressive model uses it
  automatically on every plan, no `modelType` needed

## Inline speech markup

You can embed bracket tags directly in cue text to control how a line is
delivered. All tags are stripped from displayed subtitles automatically.

### Pauses

Pause tags work with all voice models:

| Tag              | Duration |
| ---------------- | -------- |
| `[short pause]`  | 250 ms   |
| `[medium pause]` | 500 ms   |
| `[long pause]`   | 1 000 ms |

```ts
intro: 'Welcome to the dashboard. [short pause] Let me show you around.',
```

For the consistent model, pauses are rendered as precise SSML breaks. For
expressive synthesis, they are passed as natural-language cues to the model.

### Pronunciation

`word [pronounce: spoken form]` tells the synthesizer how to say a word that is
spelled differently from how it sounds: a brand name, a code term, or an
abbreviation:

```ts
intro: 'Open ScreenCI [pronounce: screen see eye] in your terminal.',
```

### Expressive speech directives (expressive only)

For expressive synthesis you can embed `[any word or phrase]` anywhere in the
text to steer delivery at that point. The model interprets the brackets as a
natural-language instruction, so you are not limited to a fixed list: write
whatever describes the sound or feeling you want:

```ts
intro: '[laughs] And that is all it takes! [short pause] [cheerful] Pretty neat.',
cta:   '[warm and inviting] Start your free trial today.',
error: '[concerned] Something went wrong. [reassuring] But it is easy to fix.',
```

Broad categories that work well:

- **Non-speech sounds** - `[laughs]`, `[sighs]`, `[gasps]`, `[clears throat]`
- **Style modifiers** - `[cheerful]`, `[excited]`, `[calm]`, `[serious]`
- **Delivery directions** - `[whispering]`, `[slower]`, `[with emphasis]`

Directives are passed as-is to the model, so the more descriptive you are the
better the result. Unrecognized or unsupported directives are silently ignored.
These tags are stripped from subtitles and throw a runtime error if used with
consistent voices.

## Voices and plans

Built-in model voices are available on every plan. Free and Starter narrate with
the built-in voice or your own self-recorded voice (a clone from an audio sample,
see [Clone a voice from an audio sample](#clone-a-voice-from-an-audio-sample)).
Hosted ElevenLabs voices (`voices.elevenlabs({ voiceId })`, a voice id from your
ElevenLabs account) require the Business tier. Both hosted voices and clones use
your own ElevenLabs API key.

The consistent model is the default, and the expressive model is selected
automatically for a language that has no consistent voice (its only built-in
option), on every plan. Choosing the expressive model as a tone upgrade for a
language that also has a consistent voice, and `style` prompts, require the
Business tier.

Free and Starter also render a single narration language across the whole
organization; multiple languages require Business. See
[One language per plan](/docs/guides/languages#one-language-per-plan).

## ElevenLabs voices

Hosted ElevenLabs voices (`voices.elevenlabs({ voiceId })`) require the ScreenCI
Business tier and use your own ElevenLabs API key. (A self-recorded clone works
on every plan, see below.) Add your key once on the **Secrets** page in the
ScreenCI app. It is
encrypted at rest and used only to synthesize narration for your videos. The app
never shows the stored key again, only whether one is set, and every render
(from the CLI or the app) uses it. You do not set an ElevenLabs key locally.

Without a key, a video that uses an ElevenLabs or custom voice cannot render.
`screenci record` fails that video at record time: its render is marked failed
right away (rather than being queued only to die during synthesis), the CLI
prints an error with a link to the Secrets page, and the command exits non-zero.
Other videos in the same run are unaffected. Add your key on the Secrets page and
record again.

Use `voices.elevenlabs({ voiceId })` when you want to target a specific
ElevenLabs voice from your own account. Set it as the default voice with
`video.renderOptions(...)`, or as a per-cue `voice`:

```ts
import { video, voices } from 'screenci'

video
  // The default voice for every language.
  .renderOptions({
    narration: {
      voice: { name: voices.elevenlabs({ voiceId: 'tMvyQtpCVQ0DkixuYm6J' }) },
    },
  })
  .narration({
    en: {
      intro: 'Welcome to the dashboard.',
      details: 'Open settings to review billing details.',
    },
  })('Billing walkthrough', async ({ page, narration }) => {
  await narration.intro()

  await narration.details.start()
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Open billing' }).click()
  await narration.details.end()
})
```

Replace the `voiceId` with the voice from your ElevenLabs account. For the
env-file setup, see [Configuration](/docs/reference/configuration).

ScreenCI supports the ElevenLabs `eleven_multilingual_v2` model only. Its
supported per-voice controls are `stability` (`0`-`1`), `similarityBoost`
(`0`-`1`), numeric `style` exaggeration (`0`-`1`), `speed` (`0.7`-`1.2`),
and `useSpeakerBoost`. These fields are accepted only for
`voices.elevenlabs(...)` and custom cloned voices:

```ts
video.narration({
  en: {
    intro: {
      cue: 'Welcome to the dashboard.',
      voice: {
        name: voices.elevenlabs({ voiceId: 'tMvyQtpCVQ0DkixuYm6J' }),
        stability: 0.45,
        similarityBoost: 0.8,
        style: 0.2,
        speed: 0.9,
        useSpeakerBoost: true,
      },
    },
  },
})('Billing walkthrough', async ({ narration }) => {
  await narration.intro()
})
```

See the ElevenLabs
[Create speech with timing API](https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps)
for the upstream request fields. ElevenLabs `style` is a numeric exaggeration
control. It is not the free-form style prompt available to ScreenCI expressive
model voices.

Author cues sparingly, one sentence at a time, instead of large paragraphs.
ScreenCI also uses the ElevenLabs API sparingly: generated narration is cached
per cue, so unchanged cues are reused and only changed narration is synthesized
again. Smaller cues keep the timeline easier to control and further reduce API
cost when you revise only part of the script.

### Automatic voice cleanup

ElevenLabs accounts cap how many custom (cloned) voices they can hold. To keep
that cap from silently filling up, ScreenCI cleans up after itself:

- It only acts when a clone would otherwise fail because the account is at its
  custom-voice limit. At that point ScreenCI deletes cloned voices it created but
  no longer uses, then retries the clone.
- It only ever deletes voices it created, named `ScreenCI:<language>:<file>` (for
  example `ScreenCI:en:my-voice.mp3`), that are no longer referenced by any of
  your renders. Your own voices and ElevenLabs premade voices are never touched.
- Cleanup always works against the live voice list of the account behind the API
  key used for that run, so it stays correct even if different runs use different
  ElevenLabs accounts.

Your ElevenLabs key is stored only in the app (encrypted at rest) and never
returned to the browser. It is used live at render time to clone, synthesize,
list, and delete its own voices, and is never written to your project or env
files.

### Clone a voice from an audio sample

Instead of a `voiceId` from your account, you can clone a voice from a local
audio or video sample using ElevenLabs Instant Voice Cloning. A self-recorded
clone is available on every plan (it does not require the Business tier that
hosted ElevenLabs voices do), but it still uses your ElevenLabs key on the
Secrets page (see the setup above).

Use the same `voices.elevenlabs(...)` helper, but pass `{ path }` instead of
`{ voiceId }`:

```ts
video
  // The default voice for every language.
  .renderOptions({
    narration: {
      voice: { name: voices.elevenlabs({ path: './my-voice.mp3' }) },
    },
  })
  .narration({
    en: {
      intro: 'Welcome to the dashboard.',
      details: 'Open settings to review billing details.',
    },
  })('Billing walkthrough', async ({ page, narration }) => {
  await narration.intro()

  await narration.details.start()
  await page.goto('/settings')
  await narration.details.end()
})
```

The `path` is resolved relative to your video script. The sample can be an audio
file (`.mp3`, `.wav`, `.m4a`, `.aac`, `.ogg`, `.flac`, `.opus`) or a video file
(`.mp4`, `.mov`, `.webm`, `.mkv`, `.avi`); for a video, the audio track is used.
A voice clone only needs audio, so when the sample is a video (or a large file),
ScreenCI extracts just the audio to a compact file before uploading. ScreenCI
uploads the sample and creates the cloned voice once, then reuses it: the clone
is keyed by the sample and language, so the same file does not get re-cloned on
later runs. Because of that, the sample file does not need to stay present after
the first upload: like overlays and narration media, a later run with the file
missing locally (for example a gitignored sample on CI) reuses the voice from the
previous upload instead of failing. See
[Asset files do not need to be committed](/docs/ci-setup#asset-files-do-not-need-to-be-committed).

A cloned voice is an ElevenLabs voice, so it accepts the same
`eleven_multilingual_v2` controls as `voices.elevenlabs(...)`, and can be set as
the default voice in `use` or as a per-cue `voice` (so a single language can use
a different sample):

```ts
video.narration({
  en: {
    intro: {
      cue: 'Welcome to the dashboard.',
      voice: {
        name: voices.elevenlabs({ path: './my-voice.mp3' }),
        stability: 0.45,
        similarityBoost: 0.8,
        speed: 0.95,
      },
    },
  },
  fi: {
    // A different sample (or a built-in voice) for another language.
    intro: {
      cue: 'Tervetuloa hallintapaneeliin.',
      voice: { name: voices.elevenlabs({ path: './my-voice-fi.mp3' }) },
    },
  },
})('Billing walkthrough', async ({ narration }) => {
  await narration.intro()
})
```

Only clone voices you have the right to use. Use samples of your own voice, or
voices you are licensed to reproduce, in line with the ElevenLabs
[voice cloning terms](https://elevenlabs.io/docs/product-guides/voices/voice-cloning).

> **Note:** Your ElevenLabs account has a limit on how many custom voices it can
> hold (the cap depends on your plan). When that limit is reached, ScreenCI first
> tries to free space automatically by deleting its own unused cloned voices and
> retrying (see [Automatic voice cleanup](#automatic-voice-cleanup)). That only
> removes voices named `ScreenCI:<language>:<file>` (for example
> `ScreenCI:en:my-voice.mp3`) that ScreenCI no longer uses. If the account is
> still full of other voices ScreenCI does not manage, the render fails. In that
> case open the [Voices page](https://elevenlabs.io/app/voice-lab) in your
> ElevenLabs account, delete custom voices you no longer need to free up slots,
> then re-run the render.

## Manage narration from Editor

You can manage narration text from the web app instead of code. Pass a bare
array of cue names and let Editor own the spoken text per language:

```ts
import { video } from 'screenci'

video
  // Editor fills in the text per language for these cue names.
  .narration(['intro', 'save'])
  .languages(['en', 'fi'])('Settings', async ({ page, narration }) => {
  await narration.intro()
  await page.goto('/settings')
  await narration.save()
})
```

Editor cue names are language-agnostic (declared once). Because the bare-array
form carries no code values, seed the recorded set with
`video.languages([...])`, since there is no text to infer it from. You can also
supply starting text from code by passing a plain object (for example
`video.narration({ intro: 'Welcome' })`): the code values are used until the
cue is edited in Editor, and from then on the Editor value wins. You can also
hand the language set itself to the web with `video.languages()` (no argument).
The same bare-array form works for values via `video.values([...])`. The
markers still carry timing the same way; only the text lives in Editor. See
[Editor](/docs/guides/editor).
