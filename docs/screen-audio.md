# Screen Audio

Recording system audio takes two settings that play different roles:

- **`enableCaptureAudio`** (root of your config, boolean): turns on audio mode
  for the whole run. It is the launch-time switch, decided once per worker
  before any individual video runs.
- **`recordOptions.captureAudio`** (per video): turns capture on for an
  individual recording. Off by default; set `true` to capture at unity gain,
  or `{ gain }` for a custom level.

Both are needed: `enableCaptureAudio` makes the browser able to emit audio, and
`captureAudio` says which videos record it and how loud. A video that sets
`captureAudio` while `enableCaptureAudio` is off throws at record time.

## Linux only

Screen audio capture is supported on **Linux only**. On macOS and Windows there
is no reliable way to route just the recording browser into an isolated capture
device without third-party tooling, so capturing there would either pick up
every app's sound or require muting the whole machine. On those platforms
screenci **skips capture and warns** (at the start of the run and at the end)
rather than writing a misleading track. For audio in CI, record on a Linux
runner (the default `ubuntu-latest` works).

## Why the split

The recording browser is launched **once per worker**, before any individual
video's options are known. Capturing audio requires launching it differently
(unmuted, in Chromium's new headless mode, because the legacy headless shell
registers an audio stream but never emits samples, producing silence). That
launch decision therefore has to come from a run-level switch, which is what
`enableCaptureAudio` is. `captureAudio` is a record option, so it can then live
wherever you like, including on an individual `video.recordOptions(...)`.

## Silent and isolated by default

When audio mode is on, screenci gives **each worker its own virtual null sink**,
routes that worker's browser into it, and captures only that sink's monitor.
This happens automatically, with no setup, and means:

- You **do not hear** the recording on the host: the browser plays into a sink
  with no physical output.
- The capture is **isolated**: only the browser's own audio is recorded, never
  other apps (music, notifications) or other workers.
- It is **parallel-safe**: each worker captures its own sink, so recordings do
  not bleed into each other.

It requires the `pactl` control tool and a running PulseAudio/PipeWire server
(present on typical Linux desktops; in CI, install `pulseaudio` and run
`pulseaudio --start --exit-idle-time=-1`, so the server stays up for the whole
job instead of exiting after ~20s idle). The `pulseaudio` daemon binary itself
is not required:
PipeWire systems provide the pulse server and `pactl` (via `pipewire-pulse`)
without it, and capture works there.

Because captureAudio promises **isolated** audio, it must succeed or the run
fails: if `pactl` or a reachable server is missing, the dedicated sink cannot be
created, or you are on macOS/Windows, screenci stops the recording with an
actionable error rather than shipping a video that silently lacks its audio.

### Choosing the ffmpeg binary

Capture shells out to ffmpeg, defaulting to the bundled `ffmpeg-static` build.
On Linux that build (the static johnvansickle builds) ships without `libpulse`,
so it cannot read the per-worker monitor and fails with
`Unknown input format: 'pulse'` even though a PulseAudio or PipeWire server is
running and `pactl` works. The bundled `alsa` input cannot bridge to pulse
either: loading the host's ALSA pulse plugin into the binary's own bundled
libasound crashes on an ABI mismatch.

screenci handles this automatically: when the bundled binary lacks the `pulse`
demuxer, it falls back to a system `ffmpeg` on `PATH` that provides it. So on a
typical Linux desktop (or a CI runner with `ffmpeg` installed) audio capture
works with no extra configuration. Install one with your package manager, e.g.
`sudo apt-get install -y ffmpeg`.

To force a specific binary, set `SCREENCI_FFMPEG_PATH`, which always wins:

```bash
SCREENCI_FFMPEG_PATH=/usr/bin/ffmpeg pnpm screenci record
```

Verify a binary has the input with `ffmpeg -hide_banner -formats | grep pulse`.

## Quick start

```ts
// screenci.config.ts
import { defineConfig } from 'screenci'

export default defineConfig({
  // Launch the browser in audio mode for the whole run (Linux only).
  enableCaptureAudio: true,
})
```

`enableCaptureAudio` is the run-level switch. Turn capture on for a video with
`captureAudio` in its `video.recordOptions(...)`:

```ts
import { video } from 'screenci'

video.recordOptions({
  // Capture this video at unity gain.
  captureAudio: true,
})('My video', async ({ page }) => {
  await page.goto('/')
})
```

`captureAudio` is `true`, or an object with a linear `gain` on the same scale
used by overlay volumes: `captureAudio: true` captures at unity gain,
`captureAudio: { gain: 0.5 }` at half volume, `{ gain: 2 }` at double. Leaving
it unset (or `false`) disables capture for that video.

## Running recordings in parallel

Parallel recording with audio is supported with no extra configuration: each
worker gets its own isolated null sink, so `workers` can be greater than `1`
with no cross-talk between recordings.

## CI setup

On a GitHub Actions Ubuntu runner two things are needed, and the default
`screenci init` workflow includes neither (audio is off by default), so add them
when you set `enableCaptureAudio: true`.

**1. Install the full Chromium browser, not just the headless shell.** Audio
capture runs Chromium in new headless mode, which the headless shell does not
support (it would record silence). Drop `--only-shell` so both the full browser
and the shell are installed:

```yaml
- name: Install Chromium
  run: npx playwright install --with-deps chromium
```

**2. Start a PulseAudio server** so screenci can create its per-worker sinks in
it (no default sink or manual sink needed, screenci manages them):

```yaml
- name: Start PulseAudio server
  run: |
    sudo apt-get update
    sudo apt-get install -y pulseaudio
    # --exit-idle-time=-1 keeps the daemon alive for the whole job. Without
    # it PulseAudio exits after ~20s idle, which can kill the server before
    # the first captureAudio client connects and make `pactl` fail.
    pulseaudio --start --exit-idle-time=-1
```

## Interaction with narration and other audio

Screen audio is mixed alongside narration cues.
If the captured level is too loud relative to narration, lower the capture gain
(e.g. `captureAudio: { gain: 0.3 }`) rather than changing the system output
volume.
