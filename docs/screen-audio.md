# Screen Audio

Recording system audio takes two settings that play different roles:

- **`enableCaptureAudio`** (root of your config, boolean): turns on audio mode
  for the whole run. It is the launch-time switch, decided once per worker
  before any individual video runs.
- **`recordOptions.captureAudio`** (number, per config/project/video): the gain
  for an individual recording. `0` (the default) captures nothing.

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
`enableCaptureAudio` is. `captureAudio` can then live wherever you like,
including on an individual `video.use()`.

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

It requires a running PulseAudio/PipeWire server and the `pactl` tool (present on
typical Linux desktops; in CI, install `pulseaudio` and run `pulseaudio
--start`). If a sink cannot be created, screenci warns and falls back to the
default device (audible and not isolated).

## Quick start

```ts
// screenci.config.ts
import { defineConfig } from 'screenci'

export default defineConfig({
  // Launch the browser in audio mode for the whole run (Linux only).
  enableCaptureAudio: true,
  use: {
    recordOptions: {
      // Capture every video at unity gain. Or set this per video instead.
      captureAudio: 1,
    },
  },
})
```

`captureAudio` is a linear gain value, the same scale used by `createAudio` and
overlay volumes: `1` is unity gain, `0.5` is half volume, `2` is double, `0`
disables capture.

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
    pulseaudio --start
```

## Interaction with narration and other audio

Screen audio is mixed alongside narration cues and `createAudio` tracks.
If the captured level is too loud relative to narration, lower `captureAudio`
(e.g. `0.3`) rather than changing the system output volume.
