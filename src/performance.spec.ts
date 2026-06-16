import { describe, it, expect } from 'vitest'
import { resolvePerformanceIntervals } from './performance.js'

describe('resolvePerformanceIntervals', () => {
  it('defaults the cursor to skip 5 frames and the scroll to skip none', () => {
    // At 60fps: cursor every 6th frame (100ms), scroll every frame (~16.67ms).
    expect(resolvePerformanceIntervals(undefined)).toEqual({
      mouseMs: 6 * (1000 / 60),
      scrollMs: 1000 / 60,
    })
  })

  it('derives intervals from the recording fps', () => {
    // At 30fps a frame is ~33.3ms, so the same skips dispatch half as often.
    expect(resolvePerformanceIntervals(undefined, 30)).toEqual({
      mouseMs: 6 * (1000 / 30),
      scrollMs: 1000 / 30,
    })
  })

  it('tunes the frame skip per stream from an object', () => {
    const frameMs = 1000 / 60
    expect(
      resolvePerformanceIntervals({ mouseFrameSkip: 5, scrollFrameSkip: 0 })
    ).toEqual({
      mouseMs: 6 * frameMs,
      scrollMs: frameMs,
    })
  })

  it('falls back to the per-stream default for a missing object field', () => {
    const frameMs = 1000 / 60
    expect(resolvePerformanceIntervals({ mouseFrameSkip: 2 })).toEqual({
      mouseMs: 3 * frameMs,
      scrollMs: frameMs, // scroll default skip 0
    })
    expect(resolvePerformanceIntervals({ scrollFrameSkip: 3 })).toEqual({
      mouseMs: 6 * frameMs, // cursor default skip 5
      scrollMs: 4 * frameMs,
    })
  })

  it('treats negative or non-finite skips as zero', () => {
    const frameMs = 1000 / 60
    expect(
      resolvePerformanceIntervals({ mouseFrameSkip: -3, scrollFrameSkip: NaN })
    ).toEqual({
      mouseMs: frameMs,
      scrollMs: frameMs,
    })
  })
})
