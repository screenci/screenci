import { describe, expect, it } from 'vitest'
import { DEFAULT_FPS, DEFAULT_VIDEO_OPTIONS } from './defaults.js'

describe('video defaults', () => {
  it('defaults recording fps to 60', () => {
    expect(DEFAULT_FPS).toBe(60)
    expect(DEFAULT_VIDEO_OPTIONS.fps).toBe(60)
  })
})
