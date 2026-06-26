# Audio

`video.audio(...)` adds background music or sound effects that mix under the
recording and any narration. It takes a map of named tracks, each a file path or
a config object, and accepts `.mp3`, `.wav`, `.m4a`, `.aac`, or an audio-only
`.mp4`. The body receives the track controllers via the injected `audio` fixture:

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

On the Business tier you can also declare track names as an **array** with
`video.audio(['theme', 'sting'])` and upload the files plus options on the
Studio page instead of keeping them in the repository. See
[Studio](./studio.md#studio-audio-from-code).

For per-language audio tracks (e.g. a locale-specific music bed), see
[Languages](/docs/guides/languages).
