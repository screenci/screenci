import { describe, expect, it } from 'vitest'
import { getChromiumLaunchOptions } from './browserLaunchOptions.js'

describe('getChromiumLaunchOptions', () => {
  it('returns undefined when recording is disabled', () => {
    expect(getChromiumLaunchOptions(false)).toBeUndefined()
  })

  it('returns chromium flags that suppress permission prompts when recording', () => {
    const options = getChromiumLaunchOptions(true)

    expect(options?.headless).toBe(false)
    expect(options?.args).toContain('--deny-permission-prompts')
    expect(options?.args).toContain('--disable-notifications')
  })
})
