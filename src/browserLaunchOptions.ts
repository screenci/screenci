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

export function getChromiumLaunchOptions(shouldRecord: boolean):
  | {
      headless: true
      args: string[]
      ignoreDefaultArgs: string[]
    }
  | undefined {
  if (!shouldRecord) {
    return undefined
  }

  return {
    headless: true,
    args: [...RECORDING_CHROMIUM_ARGS],
    // Playwright adds --mute-audio to all headless launches. Remove it so the
    // browser outputs audio to the system mixer (PulseAudio/PipeWire on Linux,
    // CoreAudio on macOS, WASAPI on Windows) where the ffmpeg monitor capture
    // can pick it up.
    ignoreDefaultArgs: ['--mute-audio'],
  }
}
