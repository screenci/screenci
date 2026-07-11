# Audio

`video.audio(...)` adds background music or sound effects that mix under the
recording and any narration. It takes a map of named tracks, each a file path or
a config object, and accepts `.mp3`, `.wav`, `.m4a`, `.aac`, `.ogg`, `.flac`,
`.opus`, or an audio-only `.mp4`. The tracks can be owned by code or handed to
[Editor](./editor.md) (the web app where non-developers swap the files); see
[the two ways to declare audio](#two-ways-to-declare-audio) below. The body
receives the track controllers via the injected `audio` fixture:

```ts
import { video } from 'screenci'

video.audio({
  theme: { path: 'assets/bg.mp3', volume: 0.3, repeat: true },
  sting: 'assets/celebrate.wav',
})('Overview', async ({ page, audio }) => {
  await audio.theme() // plays under the whole video, looping to fill
  await page.goto('/dashboard')

  await audio.sting.start() // bound a track to a span
  await page.click('#celebrate')
  await audio.sting.end()
})
```

## Two ways to declare audio

There are two ways to declare audio, and both are editable in the web app. The
same two forms apply to [`narration`](./narration.md),
[`values`](./values.md), and [`overlays`](./overlays.md). See the
[Editor guide](./editor.md) for how the web editing works.

**1. Code values.** You point each track at a file; the code values are used
until the track is edited in [Editor](./editor.md), and from then on the
Editor value wins.

```ts
video.audio({ theme: { path: 'assets/bg.mp3', volume: 0.3, repeat: true } })
```

**2. Editor-owned (blank).** Pass a bare array of track names: the names exist
in code (so the body can call `audio.theme`), but [Editor](./editor.md) owns
the files and options.

```ts
import { video } from 'screenci'

video.audio(['theme', 'sting'])
```

Options:

- `volume` is a linear gain. `1` (the default) is the source's natural level,
  `0` is silent, and values above `1` boost it (e.g. `2` is twice as loud, up to
  `4`). Lower it (for example `0.2`-`0.4`) so music sits under narration.
- `repeat: true` loops a short track to fill its span. Omit it (the default) to
  play the source once and then fall silent.
- `speed` or `time` play the track faster or slower. `speed` is a multiplier
  (`2` plays it twice as fast, `0.5` at half speed); `time` is a target playback
  duration in ms (the source is sped up or slowed down to play over exactly that
  long). Set at most one. The track keeps its span and never shifts the
  recording: only the source is consumed faster or slower.

Timing:

- A bare call (`await audio.theme()`) starts the track at that point and plays it
  for the **rest of the video**.
- `start()` / `end()` bound a track to a specific span, without freezing a frame.
  `start()` accepts a `delay` (milliseconds) that offsets the recorded start,
  so a track can begin during the interaction that follows the call:
  `await music.sting.start({ delay: 300 })`. See
  [Mid-Video Overlay Updates](./overlay-updates.md#delaying-an-update-into-an-interaction).
- Tracks are **non-exclusive**: starting one never stops another, so music and a
  sound effect can overlap. Each track also runs independently of narration.

Unlike overlays, audio tracks have no placement and never hold a frozen frame:
they simply mix into the soundtrack.

You can also declare track names alone with a bare array,
`video.audio(['theme', 'sting'])`, and upload the files plus options on the
Editor page instead of keeping them in the repository. Tracks declared with
code values stay editable too: the code values are used until the track is
edited in Editor, and from then on the Editor value wins. See
[Editor](./editor.md#editor-audio-from-code).

For per-language audio tracks (e.g. a locale-specific music bed), see
[Languages](/docs/guides/languages).

Audio files are uploaded the first time you record with them present and reused
on later runs, so you do not have to commit the files. If a file is missing
locally, ScreenCI reuses the version uploaded for this video (matched by file
path). See
[Asset files do not need to be committed](/docs/ci-setup#asset-files-do-not-need-to-be-committed).

Background audio tracks play as provided; automatic cleanup applies only to
self-recorded narration, see
[Clean up recorded narration audio](./narration.md#clean-up-recorded-narration-audio).
