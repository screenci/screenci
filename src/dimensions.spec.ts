import { describe, it, expect } from 'vitest'
import { aspectRatioToNumber } from './dimensions.js'
import type { AspectRatio } from './types.js'

describe('aspectRatioToNumber', () => {
  it('parses each supported aspect ratio string to width / height', () => {
    expect(aspectRatioToNumber('16:9')).toBeCloseTo(16 / 9, 10)
    expect(aspectRatioToNumber('9:16')).toBeCloseTo(9 / 16, 10)
    expect(aspectRatioToNumber('1:1')).toBe(1)
    expect(aspectRatioToNumber('4:3')).toBeCloseTo(4 / 3, 10)
    expect(aspectRatioToNumber('3:4')).toBeCloseTo(3 / 4, 10)
    expect(aspectRatioToNumber('5:4')).toBe(1.25)
    expect(aspectRatioToNumber('4:5')).toBe(0.8)
  })

  it('returns NaN for a malformed string', () => {
    expect(aspectRatioToNumber('1:0' as AspectRatio)).toBeNaN()
    expect(aspectRatioToNumber('foo' as AspectRatio)).toBeNaN()
  })
})
