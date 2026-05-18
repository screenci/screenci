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
    }
  | undefined {
  if (!shouldRecord) {
    return undefined
  }

  return {
    headless: true,
    args: [...RECORDING_CHROMIUM_ARGS],
  }
}
