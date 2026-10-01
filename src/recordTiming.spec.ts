import { describe, expect, it } from 'vitest'
import { recordWallClockMs } from './recordTiming.js'

describe('recordWallClockMs', () => {
  it('returns the whole ms between start and finish', () => {
    expect(recordWallClockMs(1_000, 43_500)).toBe(42_500)
    expect(recordWallClockMs(0, 1234.6)).toBe(1235)
  })

  it('leaves the value out when the clock gives nothing usable', () => {
    expect(recordWallClockMs(5_000, 5_000)).toBeUndefined()
    expect(recordWallClockMs(5_000, 4_000)).toBeUndefined()
    expect(recordWallClockMs(0, 86_400_001)).toBeUndefined()
    expect(recordWallClockMs(Number.NaN, 10)).toBeUndefined()
  })
})
