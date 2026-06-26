/**
 * Environment variable used to surface the root-level `enableCaptureAudio`
 * switch to the worker-scoped browser fixture. The browser launch flags that
 * control muting and headless mode are set once per worker, before any per-test
 * `recordOptions` is resolved, so the value is bridged here from `defineConfig`.
 * Set to `'1'` when audio capture is enabled, unset otherwise.
 */
export const CAPTURE_AUDIO_ENV = 'SCREENCI_CAPTURE_AUDIO'

/**
 * Whether the root-level `enableCaptureAudio` switch was on when `defineConfig`
 * ran (recorded in the environment). When true the recording browser launches
 * in audio mode (unmuted, new headless).
 */
export function isCaptureAudioEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env[CAPTURE_AUDIO_ENV] === '1'
}

/**
 * A video requested audio capture (`perVideoCaptureAudio > 0`) but the run was
 * not launched in audio mode (`enableCaptureAudio` was off), so the browser is
 * muted and on the legacy headless shell and the captured track would be
 * silent. Callers throw with a docs link rather than writing a silent file.
 */
export function captureRequestedButNotEnabled(
  perVideoCaptureAudio: number,
  captureAudioEnabled: boolean
): boolean {
  return perVideoCaptureAudio > 0 && !captureAudioEnabled
}

const RECORDING_CHROMIUM_ARGS = [
  '--disable-translate',
  '--disable-spell-checking',
  '--disable-notifications', // no permission popups
  '--disable-save-password-bubble', // no "save password?" dialog
  '--deny-permission-prompts',
  '--disable-infobars', // no "Chrome is being controlled by..." bar
  '--no-first-run', // skip first-run UI
  '--hide-scrollbars', // scrollbars invisible in recordings
] as const

export function getChromiumLaunchOptions(
  shouldRecord: boolean,
  captureAudioEnabled = false
):
  | {
      headless: boolean
      args: string[]
      ignoreDefaultArgs: string[]
    }
  | undefined {
  if (!shouldRecord) {
    return undefined
  }

  // With audio capture disabled (the default) we use Playwright's standard
  // headless mode and leave the browser muted, so recordings stay silent and
  // don't play site audio out loud on the host machine.
  if (!captureAudioEnabled) {
    return {
      headless: true,
      args: [...RECORDING_CHROMIUM_ARGS],
      ignoreDefaultArgs: [],
    }
  }

  // With audio capture enabled we need the browser to actually emit audio onto
  // the system mixer (PulseAudio/PipeWire on Linux, CoreAudio on macOS, WASAPI
  // on Windows) where the ffmpeg monitor capture can pick it up. Two things are
  // required:
  //
  //   1. Drop --mute-audio (Playwright adds it to every headless launch).
  //   2. Run the *new* headless mode (`--headless=new`), i.e. the full browser
  //      headless rather than the legacy headless shell. The legacy shell
  //      registers an audio output stream but never emits real samples, so the
  //      captured track is silent. New headless emits audio normally.
  //
  // To select new headless we launch with `headless: false` (so Playwright does
  // not inject its own legacy `--headless`) and pass `--headless=new`
  // ourselves, ignoring any default `--headless`. Unmuting plus new headless is
  // necessary but still not sufficient on its own: the browser also has to land
  // its audio on the sink whose monitor is captured. The recording browser
  // fixture handles that by routing the browser into a dedicated per-worker null
  // sink (via PULSE_SINK) and capturing that sink's monitor.
  return {
    headless: false,
    args: [...RECORDING_CHROMIUM_ARGS, '--headless=new'],
    ignoreDefaultArgs: ['--mute-audio', '--headless'],
  }
}
