const RECORDING_CHROMIUM_ARGS = [
  '--window-position=0,0',
  '--kiosk',
  '--disable-translate',
  '--disable-spell-checking',
  '--disable-notifications', // no permission popups
  '--disable-save-password-bubble', // no "save password?" dialog
  '--deny-permission-prompts',
  '--disable-save-password-bubble', // no "save password?" dialog
  '--disable-infobars', // no "Chrome is being controlled by..." bar
  '--no-first-run', // skip first-run UI
  '--hide-scrollbars', // scrollbars invisible in recordings
] as const

export function getChromiumLaunchOptions(shouldRecord: boolean):
  | {
      headless: false
      args: string[]
    }
  | undefined {
  if (!shouldRecord) {
    return undefined
  }

  return {
    headless: false,
    args: [...RECORDING_CHROMIUM_ARGS],
  }
}
