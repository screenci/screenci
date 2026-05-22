import { describe, it, expect, vi } from 'vitest'
import { getDimensions, getViewportCenter } from './dimensions.js'
import { getMousePosition } from './mouse.js'
import {
  finalizeDeferredRecordingStops,
  POST_VIDEO_PAUSE,
  positionMouseAtViewportCenter,
} from './video.js'

/**
 * Dimension table (shorter side = quality base, longer side from ratio):
 *
 * | Aspect Ratio | 720p      | 1080p      | 1440p      | 2160p      |
 * |--------------|-----------|------------|------------|------------|
 * | 16:9         | 1280×720  | 1920×1080  | 2560×1440  | 3840×2160  |
 * | 9:16         | 720×1280  | 1080×1920  | 1440×2560  | 2160×3840  |
 * | 1:1          | 720×720   | 1080×1080  | 1440×1440  | 2160×2160  |
 * | 4:3          | 960×720   | 1440×1080  | 1920×1440  | 2880×2160  |
 * | 3:4          | 720×960   | 1080×1440  | 1440×1920  | 2160×2880  |
 * | 5:4          | 900×720   | 1350×1080  | 1800×1440  | 2700×2160  |
 * | 4:5          | 720×900   | 1080×1350  | 1440×1800  | 2160×2700  |
 */
describe('getDimensions', () => {
  describe('16:9 (landscape widescreen)', () => {
    it('720p → 1280×720', () => {
      expect(getDimensions('16:9', '720p')).toEqual({
        width: 1280,
        height: 720,
      })
    })
    it('1080p → 1920×1080', () => {
      expect(getDimensions('16:9', '1080p')).toEqual({
        width: 1920,
        height: 1080,
      })
    })
    it('1440p → 2560×1440', () => {
      expect(getDimensions('16:9', '1440p')).toEqual({
        width: 2560,
        height: 1440,
      })
    })
    it('2160p → 3840×2160', () => {
      expect(getDimensions('16:9', '2160p')).toEqual({
        width: 3840,
        height: 2160,
      })
    })
  })

  describe('9:16 (portrait / vertical)', () => {
    it('720p → 720×1280', () => {
      expect(getDimensions('9:16', '720p')).toEqual({
        width: 720,
        height: 1280,
      })
    })
    it('1080p → 1080×1920', () => {
      expect(getDimensions('9:16', '1080p')).toEqual({
        width: 1080,
        height: 1920,
      })
    })
    it('1440p → 1440×2560', () => {
      expect(getDimensions('9:16', '1440p')).toEqual({
        width: 1440,
        height: 2560,
      })
    })
    it('2160p → 2160×3840', () => {
      expect(getDimensions('9:16', '2160p')).toEqual({
        width: 2160,
        height: 3840,
      })
    })
  })

  describe('1:1 (square)', () => {
    it('720p → 720×720', () => {
      expect(getDimensions('1:1', '720p')).toEqual({ width: 720, height: 720 })
    })
    it('1080p → 1080×1080', () => {
      expect(getDimensions('1:1', '1080p')).toEqual({
        width: 1080,
        height: 1080,
      })
    })
    it('1440p → 1440×1440', () => {
      expect(getDimensions('1:1', '1440p')).toEqual({
        width: 1440,
        height: 1440,
      })
    })
    it('2160p → 2160×2160', () => {
      expect(getDimensions('1:1', '2160p')).toEqual({
        width: 2160,
        height: 2160,
      })
    })
  })

  describe('4:3 (landscape standard)', () => {
    it('720p → 960×720', () => {
      expect(getDimensions('4:3', '720p')).toEqual({ width: 960, height: 720 })
    })
    it('1080p → 1440×1080', () => {
      expect(getDimensions('4:3', '1080p')).toEqual({
        width: 1440,
        height: 1080,
      })
    })
    it('1440p → 1920×1440', () => {
      expect(getDimensions('4:3', '1440p')).toEqual({
        width: 1920,
        height: 1440,
      })
    })
    it('2160p → 2880×2160', () => {
      expect(getDimensions('4:3', '2160p')).toEqual({
        width: 2880,
        height: 2160,
      })
    })
  })

  describe('3:4 (portrait standard)', () => {
    it('720p → 720×960', () => {
      expect(getDimensions('3:4', '720p')).toEqual({ width: 720, height: 960 })
    })
    it('1080p → 1080×1440', () => {
      expect(getDimensions('3:4', '1080p')).toEqual({
        width: 1080,
        height: 1440,
      })
    })
    it('1440p → 1440×1920', () => {
      expect(getDimensions('3:4', '1440p')).toEqual({
        width: 1440,
        height: 1920,
      })
    })
    it('2160p → 2160×2880', () => {
      expect(getDimensions('3:4', '2160p')).toEqual({
        width: 2160,
        height: 2880,
      })
    })
  })

  describe('5:4 (landscape near-square)', () => {
    it('720p → 900×720', () => {
      expect(getDimensions('5:4', '720p')).toEqual({ width: 900, height: 720 })
    })
    it('1080p → 1350×1080', () => {
      expect(getDimensions('5:4', '1080p')).toEqual({
        width: 1350,
        height: 1080,
      })
    })
    it('1440p → 1800×1440', () => {
      expect(getDimensions('5:4', '1440p')).toEqual({
        width: 1800,
        height: 1440,
      })
    })
    it('2160p → 2700×2160', () => {
      expect(getDimensions('5:4', '2160p')).toEqual({
        width: 2700,
        height: 2160,
      })
    })
  })

  describe('4:5 (portrait near-square)', () => {
    it('720p → 720×900', () => {
      expect(getDimensions('4:5', '720p')).toEqual({ width: 720, height: 900 })
    })
    it('1080p → 1080×1350', () => {
      expect(getDimensions('4:5', '1080p')).toEqual({
        width: 1080,
        height: 1350,
      })
    })
    it('1440p → 1440×1800', () => {
      expect(getDimensions('4:5', '1440p')).toEqual({
        width: 1440,
        height: 1800,
      })
    })
    it('2160p → 2160×2700', () => {
      expect(getDimensions('4:5', '2160p')).toEqual({
        width: 2160,
        height: 2700,
      })
    })
  })
})

describe('getViewportCenter', () => {
  it('returns centered coordinates for even dimensions', () => {
    expect(getViewportCenter({ width: 1280, height: 720 })).toEqual({
      x: 640,
      y: 360,
    })
  })

  it('floors centered coordinates for odd dimensions', () => {
    expect(getViewportCenter({ width: 721, height: 1281 })).toEqual({
      x: 360,
      y: 640,
    })
  })
})

describe('startup mouse positioning', () => {
  it('uses the viewport center as the initial mouse position target', () => {
    expect(getViewportCenter(getDimensions('16:9', '720p'))).toEqual({
      x: 640,
      y: 360,
    })
  })

  it('tracks the centered startup mouse position after moving the real cursor', async () => {
    const move = vi.fn().mockResolvedValue(undefined)
    const page = {
      mouse: {
        _move: move,
      },
    } as never

    const result = await positionMouseAtViewportCenter(page, {
      width: 1280,
      height: 720,
    })

    expect(move).toHaveBeenCalledWith(640, 360)
    expect(result).toEqual({ x: 640, y: 360 })
    expect(getMousePosition(page)).toEqual({ x: 640, y: 360 })
  })
})

describe('POST_VIDEO_PAUSE', () => {
  it('adds a 500ms tail before stopping recording resources', () => {
    expect(POST_VIDEO_PAUSE).toBe(500)
  })
})

describe('deferred recording stops', () => {
  it('does not stop recorders until shared finalization runs', async () => {
    const finalized = Promise.resolve({ written: true })
    const recorder = {
      stop: vi.fn().mockResolvedValue({ written: true }),
      finalized,
    }

    expect(recorder.stop).not.toHaveBeenCalled()

    await finalizeDeferredRecordingStops([{ recorder: recorder as never }])

    expect(recorder.stop).toHaveBeenCalledOnce()
  })

  it('waits for every deferred stop to finalize', async () => {
    let resolveFirst!: () => void
    let resolveSecond!: () => void
    const firstRecorder = {
      stop: vi.fn().mockResolvedValue({ written: true }),
      finalized: new Promise((resolve) => {
        resolveFirst = () => resolve({ written: true })
      }),
    }
    const secondRecorder = {
      stop: vi.fn().mockResolvedValue({ written: true }),
      finalized: new Promise((resolve) => {
        resolveSecond = () => resolve({ written: true })
      }),
    }

    let completed = false
    const finalizePromise = finalizeDeferredRecordingStops([
      { recorder: firstRecorder as never },
      { recorder: secondRecorder as never },
    ]).then(() => {
      completed = true
    })

    await Promise.resolve()
    expect(completed).toBe(false)

    resolveFirst()
    await Promise.resolve()
    expect(completed).toBe(false)

    resolveSecond()
    await finalizePromise

    expect(completed).toBe(true)
  })

  it('surfaces finalization failures from deferred stops', async () => {
    let rejectFinalized!: (error: Error) => void
    const finalized = new Promise((_, reject) => {
      rejectFinalized = reject
    })
    finalized.catch(() => {})
    const recorder = {
      stop: vi.fn().mockResolvedValue({ written: true }),
      finalized,
    }

    const finalizePromise = finalizeDeferredRecordingStops([
      { recorder: recorder as never },
    ])
    rejectFinalized(new Error('finalization failed'))

    await expect(finalizePromise).rejects.toThrow('finalization failed')
  })
})
