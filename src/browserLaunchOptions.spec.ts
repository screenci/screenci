import { describe, expect, it } from 'vitest'
import {
  CAPTURE_AUDIO_ENV,
  captureRequestedButNotEnabled,
  getChromiumLaunchOptions,
  isCaptureAudioEnabled,
} from './browserLaunchOptions.js'

describe('getChromiumLaunchOptions', () => {
  it('returns undefined when recording is disabled', () => {
    expect(getChromiumLaunchOptions(false)).toBeUndefined()
  })

  it('returns chromium flags that suppress permission prompts when recording', () => {
    const options = getChromiumLaunchOptions(true)

    expect(options?.headless).toBe(true)
    expect(options?.args).toContain('--deny-permission-prompts')
    expect(options?.args).toContain('--disable-notifications')
  })

  it('keeps the browser muted when audio capture is not enabled', () => {
    expect(getChromiumLaunchOptions(true).ignoreDefaultArgs).not.toContain(
      '--mute-audio'
    )
    expect(
      getChromiumLaunchOptions(true, false).ignoreDefaultArgs
    ).not.toContain('--mute-audio')
  })

  it('removes --mute-audio when audio capture is enabled', () => {
    const options = getChromiumLaunchOptions(true, true)

    expect(options?.ignoreDefaultArgs).toContain('--mute-audio')
  })

  it('switches to new headless when audio capture is enabled', () => {
    // The legacy headless shell registers an audio stream but emits no samples,
    // producing a silent capture. New headless emits audio, so audio capture
    // must launch the full browser in new headless mode.
    const options = getChromiumLaunchOptions(true, true)

    expect(options?.headless).toBe(false)
    expect(options?.args).toContain('--headless=new')
    expect(options?.ignoreDefaultArgs).toContain('--headless')
    // Still suppresses the same prompts as a normal recording launch.
    expect(options?.args).toContain('--deny-permission-prompts')
  })

  it('stays in standard headless when audio capture is not enabled', () => {
    const options = getChromiumLaunchOptions(true, false)

    expect(options?.headless).toBe(true)
    expect(options?.args).not.toContain('--headless=new')
    expect(options?.ignoreDefaultArgs).not.toContain('--headless')
  })
})

describe('isCaptureAudioEnabled', () => {
  it('is false when the env var is unset', () => {
    expect(isCaptureAudioEnabled({})).toBe(false)
  })

  it('is true when the env var is "1"', () => {
    expect(isCaptureAudioEnabled({ [CAPTURE_AUDIO_ENV]: '1' })).toBe(true)
  })

  it('is false for any other value', () => {
    expect(isCaptureAudioEnabled({ [CAPTURE_AUDIO_ENV]: '0' })).toBe(false)
    expect(isCaptureAudioEnabled({ [CAPTURE_AUDIO_ENV]: 'true' })).toBe(false)
    expect(isCaptureAudioEnabled({ [CAPTURE_AUDIO_ENV]: '' })).toBe(false)
  })
})

describe('captureRequestedButNotEnabled', () => {
  it('is true when a video requests capture but the run is not in audio mode', () => {
    expect(captureRequestedButNotEnabled(1, false)).toBe(true)
  })

  it('is false when the run is in audio mode', () => {
    expect(captureRequestedButNotEnabled(1, true)).toBe(false)
  })

  it('is false when the video does not request capture', () => {
    expect(captureRequestedButNotEnabled(0, false)).toBe(false)
    expect(captureRequestedButNotEnabled(0, true)).toBe(false)
  })
})
