import { describe, it, expect, beforeEach } from 'vitest'
import { applyCropPadding, getRecordedCrop, resetCrop } from './crop.js'

describe('applyCropPadding', () => {
  it('returns the rect unchanged (clamped) with zero padding', () => {
    const rect = { x: 0.2, y: 0.3, width: 0.4, height: 0.2 }
    const result = applyCropPadding(rect, 0)
    expect(result.x).toBeCloseTo(0.2, 6)
    expect(result.y).toBeCloseTo(0.3, 6)
    expect(result.width).toBeCloseTo(0.4, 6)
    expect(result.height).toBeCloseTo(0.2, 6)
  })

  it('expands by a fraction of the longer edge on every side', () => {
    // longer edge = width 0.4; pad = 0.4 * 0.1 = 0.04
    const rect = { x: 0.2, y: 0.3, width: 0.4, height: 0.2 }
    const padded = applyCropPadding(rect, 0.1)
    expect(padded.x).toBeCloseTo(0.16, 6)
    expect(padded.y).toBeCloseTo(0.26, 6)
    expect(padded.width).toBeCloseTo(0.48, 6)
    expect(padded.height).toBeCloseTo(0.28, 6)
  })

  it('clamps to the [0, 1] image bounds', () => {
    const rect = { x: 0.05, y: 0.0, width: 0.9, height: 1.0 }
    const padded = applyCropPadding(rect, 0.5)
    expect(padded.x).toBe(0)
    expect(padded.y).toBe(0)
    expect(padded.width).toBe(1)
    expect(padded.height).toBe(1)
  })
})

describe('recorded crop state', () => {
  beforeEach(() => resetCrop())

  it('is undefined until a crop is recorded', () => {
    expect(getRecordedCrop()).toBeUndefined()
  })

  it('reset clears a previously recorded crop', () => {
    resetCrop()
    expect(getRecordedCrop()).toBeUndefined()
  })
})
