import { describe, expect, it } from 'vitest'
import { contrast, luminance, parseColor, toCss } from './color.js'

describe('parseColor', () => {
  it('parses hex forms', () => {
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 })
    expect(parseColor('#2563eb')).toEqual({ r: 37, g: 99, b: 235, a: 1 })
    expect(parseColor('#2563eb80')?.a).toBeCloseTo(0.502, 2)
    expect(parseColor('#12')).toBeNull()
  })

  it('parses rgb, rgba, hsl and modern space-separated syntax', () => {
    expect(parseColor('rgb(1, 2, 3)')).toEqual({ r: 1, g: 2, b: 3, a: 1 })
    expect(parseColor('rgba(1 2 3 / 0.5)')).toEqual({
      r: 1,
      g: 2,
      b: 3,
      a: 0.5,
    })
    expect(parseColor('hsl(0, 100%, 50%)')).toEqual({
      r: 255,
      g: 0,
      b: 0,
      a: 1,
    })
    expect(parseColor('hsl(210 40% 98%)')).toEqual({
      r: 248,
      g: 250,
      b: 252,
      a: 1,
    })
  })

  it('parses a bare shadcn triplet and named colours', () => {
    expect(parseColor('0 0% 100%')).toEqual({ r: 255, g: 255, b: 255, a: 1 })
    expect(parseColor('white')).toEqual({ r: 255, g: 255, b: 255, a: 1 })
    expect(parseColor('transparent')?.a).toBe(0)
  })

  it('returns null for unsupported values', () => {
    expect(parseColor('oklch(0.7 0.2 47)')).toBeNull()
    expect(parseColor('var(--x)')).toBeNull()
    expect(parseColor('')).toBeNull()
    expect(parseColor(undefined)).toBeNull()
  })
})

describe('contrast', () => {
  it('matches the WCAG reference points', () => {
    const white = parseColor('#fff')!
    const black = parseColor('#000')!
    expect(luminance(white)).toBe(1)
    expect(contrast(white, black)).toBeCloseTo(21, 5)
    expect(contrast(black, white)).toBeCloseTo(21, 5)
    expect(contrast(white, white)).toBe(1)
  })
})

describe('toCss', () => {
  it('writes rgb for opaque and rgba otherwise', () => {
    expect(toCss({ r: 1, g: 2, b: 3, a: 1 })).toBe('rgb(1, 2, 3)')
    expect(toCss({ r: 1, g: 2, b: 3, a: 1 }, 0.18)).toBe('rgba(1, 2, 3, 0.18)')
  })
})
