# Audio

`video.audio(...)` adds background music or sound effects that mix under the
recording and any narration. It takes a map of named tracks, each a file path or
a config object, and accepts `.mp3`, `.wav`, `.m4a`, `.aac`, `.ogg`, `.flac`,
`.opus`, or an audio-only `.mp4`. The tracks can be owned by code or handed to
[Studio](./studio.md) (the web app where non-developers swap the files); see
[the three ways to declare audio](#three-ways-to-declare-audio) below. The body
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

## Three ways to declare audio

There are three ways to declare audio. The same three forms apply to
[`narration`](./narration.md), [`values`](./values.md), and
[`overlays`](./overlays.md). See the [Studio guide](./studio.md) for how the web
editing works.

**1. Code-owned.** You point each track at a file.

```ts
video.audio({ theme: { path: 'assets/bg.mp3', volume: 0.3, repeat: true } })
```

**2. Studio-owned (blank).** Wrap the track names in `studio([...])`: the names
exist in code (so the body can call `audio.theme`), but [Studio](./studio.md) owns
the files and options.

```ts
import { video, studio } from 'screenci'

video.audio(studio(['theme', 'sting']))
```

**3. Studio-owned (seeded).** Pass tracks to `studio({...})`: Studio starts from
them but owns them, so an edit in Studio always wins over the seed.

```ts
video.audio(studio({ theme: { path: 'assets/bg.mp3', volume: 0.3 } }))
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
- Tracks are **non-exclusive**: starting one never stops another, so music and a
  sound effect can overlap. Each track also runs independently of narration.

Unlike overlays, audio tracks have no placement and never hold a frozen frame:
they simply mix into the soundtrack.

On the Business tier you can also declare track names by wrapping them in
`studio([...])` (imported from `screenci`) with
`video.audio(studio(['theme', 'sting']))` and upload the files plus options on
the Studio page instead of keeping them in the repository. You can also seed the
web app with starting files and options by passing an object to `studio({...})`:
the web app starts from those values but owns them, so a seed is used only until
the track is edited in Studio. See
[Studio](./studio.md#studio-audio-from-code).

For per-language audio tracks (e.g. a locale-specific music bed), see
[Languages](/docs/guides/languages).

Audio files are uploaded the first time you record with them present and reused
on later runs, so you do not have to commit the files. If a file is missing
locally, ScreenCI reuses the version uploaded for this video (matched by file
path). See
[Asset files do not need to be committed](/docs/ci-setup#asset-files-do-not-need-to-be-committed).
