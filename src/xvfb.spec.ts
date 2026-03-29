import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { isHeadless } from './xvfb.js'

describe('isHeadless', () => {
  let originalDisplay: string | undefined

  beforeEach(() => {
    originalDisplay = process.env.DISPLAY
  })

  afterEach(() => {
    if (originalDisplay === undefined) {
      delete process.env.DISPLAY
    } else {
      process.env.DISPLAY = originalDisplay
    }
    vi.restoreAllMocks()
  })

  it('returns true when DISPLAY is not set', () => {
    delete process.env.DISPLAY
    expect(isHeadless()).toBe(true)
  })

  it('returns false when DISPLAY is set', () => {
    process.env.DISPLAY = ':99'
    expect(isHeadless()).toBe(false)
  })

  it('returns false for any non-empty DISPLAY value', () => {
    process.env.DISPLAY = ':0'
    expect(isHeadless()).toBe(false)
  })
})
