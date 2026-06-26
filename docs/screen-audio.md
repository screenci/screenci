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

## Why the split

The recording browser is launched **once per worker**, before any individual
video's options are known. Capturing audio requires launching it differently
(unmuted, in Chromium's new headless mode, because the legacy headless shell
registers an audio stream but never emits samples, producing silence). That
launch decision therefore has to come from a run-level switch, which is what
`enableCaptureAudio` is. `captureAudio` can then live wherever you like,
including on an individual `video.use()`.

## Audio plays out loud while recording

To capture system audio, the browser has to actually output it to the host's
audio mixer (this is where the recorder taps the audio from). So with audio mode
enabled, a recording video's audio is **played out loud on the host machine**.
This is expected: the same audio that plays through your speakers is what gets
recorded and mixed into the video.

## Quick start

```ts
// screenci.config.ts
import { defineConfig } from 'screenci'

export default defineConfig({
  // Launch the browser in audio mode for the whole run.
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

## What gets captured

The behavior depends on the OS:

- **Windows:** WASAPI loopback — captures system output (what the speakers
  play). Works with no setup.
- **Linux:** PulseAudio/PipeWire monitor source (`default.monitor`) — captures
  system output (what the speakers play), the same as WASAPI loopback on
  Windows. If nothing is playing the track will be silence, which is fine. See
  [Linux: capturing the right device](#linux-capturing-the-right-device) when
  the capture is unexpectedly silent.
- **macOS:** AVFoundation default input — usually the microphone. To capture
  system audio, install a virtual loopback driver such as
  [BlackHole](https://github.com/ExistentialAudio/BlackHole) and set it as
  the default input in _System Settings > Sound > Input_.

## Linux: capturing the right device

`captureAudio` captures `default.monitor`, the monitor of whatever PulseAudio /
PipeWire reports as the **default sink**. That works when the recording browser
actually plays its audio onto that same sink. Two things can break that and
produce a silent track even though capture "succeeds":

1. The default sink is a device the headless browser cannot reliably play to
   (commonly a **USB or wireless headset**). The browser falls back to a null
   output, so nothing reaches the monitor being captured.
2. Another app changed the default sink between recordings, so you are
   monitoring a sink the browser is not using.

To make capture independent of whatever the current default sink is, route the
browser to a **dedicated virtual sink** and capture that sink's monitor with the
`SCREENCI_AUDIO_DEVICE` override:

```bash
# 1. Create a null sink that always exists and is trivial to open (once per boot).
pactl load-module module-null-sink \
  sink_name=screenci \
  sink_properties=device.description=screenci

# 2. Record with the browser routed to that sink (PULSE_SINK is inherited by the
#    browser process) and the capture pointed at its monitor.
PULSE_SINK=screenci SCREENCI_AUDIO_DEVICE=screenci.monitor \
  npx screenci record videos/my-video.screenci.ts
```

`SCREENCI_AUDIO_DEVICE` replaces the capture device (`ffmpeg -i`) on any platform
while keeping the platform's input format, so it can also point at a specific
PipeWire/Pulse source on macOS or Windows. When it is unset, capture uses the
platform default (`default.monitor` on Linux).

To check whether a capture device is receiving audio without recording a full
video, play something and sample the monitor directly:

```bash
ffmpeg -loglevel quiet -f pulse -i screenci.monitor -t 3 -c:a pcm_s16le -y /tmp/test.wav
ffmpeg -hide_banner -i /tmp/test.wav -af volumedetect -f null /dev/null 2>&1 \
  | grep -E 'mean_volume|max_volume'
```

A `max_volume` near `-91 dB` means the device captured silence.

## CI setup

Two things are needed on a GitHub Actions Ubuntu runner, and the default
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

**2. Create a PulseAudio null sink** for the browser to play into and the
recorder to capture:

```yaml
- name: Set up virtual audio device
  run: |
    sudo apt-get update
    sudo apt-get install -y pulseaudio
    pulseaudio --start
    pactl load-module module-null-sink sink_name=screenci \
      sink_properties=device.description=screenci
    pactl set-default-sink screenci
```

The browser plays to the default sink, so `captureAudio` picks up
`screenci.monitor` automatically. To be explicit (and immune to the default sink
changing), set `SCREENCI_AUDIO_DEVICE: screenci.monitor` on the record step.

**macOS runners** have no built-in loopback. Use a self-hosted runner with
BlackHole installed if you need screen audio on macOS CI.

**Windows runners** work with `captureAudio: 1` out of the box via WASAPI
loopback, though the captured track will be silence if nothing is playing.

## Running recordings in parallel

Audio capture taps a single, system-wide monitor source (the default output's
loopback). It is **not isolated per recording**. If two recordings run at the
same time with `captureAudio` enabled, both browsers play to the same mixer and
both capture the combined audio, so each video can pick up the other's sound.

If you record with `enableCaptureAudio` on, run those recordings sequentially by
setting `workers: 1` in your config. screenci warns at startup when
`enableCaptureAudio` is on and `workers` is anything other than `1`. Runs that
leave `enableCaptureAudio` off stay muted and are safe to run in parallel.

## Interaction with narration and other audio

Screen audio is mixed alongside narration cues and `createAudio` tracks.
If the captured level is too loud relative to narration, lower `captureAudio`
(e.g. `0.3`) rather than changing the system output volume.
