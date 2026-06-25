# Screen Audio

`captureAudio` records system audio alongside the screen recording and mixes it
into the rendered video starting at time 0.

The default is `0` (disabled).

## Quick start

```ts
// screenci.config.ts
import { defineConfig } from 'screenci'

export default defineConfig({
  use: {
    recordOptions: {
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
- **Linux:** PulseAudio monitor source (`default.monitor`) — captures system
  output (what the speakers play), the same as WASAPI loopback on Windows. If
  nothing is playing the track will be silence, which is fine.
- **macOS:** AVFoundation default input — usually the microphone. To capture
  system audio, install a virtual loopback driver such as
  [BlackHole](https://github.com/ExistentialAudio/BlackHole) and set it as
  the default input in _System Settings > Sound > Input_.

## CI setup

GitHub Actions Ubuntu runners have no audio device by default. Create a
PulseAudio null sink before recording:

```yaml
- name: Set up virtual audio device
  run: |
    sudo apt-get install -y pulseaudio
    pulseaudio --start
    pactl load-module module-null-sink sink_name=virtual_speaker \
      sink_properties=device.description=VirtualSpeaker
    pactl set-default-sink virtual_speaker
    pactl set-default-source virtual_speaker.monitor
```

Then `captureAudio: 1` picks up the monitor source automatically.

**macOS runners** have no built-in loopback. Use a self-hosted runner with
BlackHole installed if you need screen audio on macOS CI.

**Windows runners** work with `captureAudio: 1` out of the box via WASAPI
loopback, though the captured track will be silence if nothing is playing.

## Interaction with narration and other audio

Screen audio is mixed alongside narration cues and `createAudio` tracks.
If the captured level is too loud relative to narration, lower `captureAudio`
(e.g. `0.3`) rather than changing the system output volume.
