import { describe, expect, it } from 'vitest'
import { evaluateEasingAtT } from './easing.js'
import type { Easing } from './types.js'

describe('evaluateEasingAtT', () => {
  it('clamps values outside the normalized range', () => {
    expect(evaluateEasingAtT(-1, 'ease-in')).toBe(0)
    expect(evaluateEasingAtT(2, 'ease-out')).toBe(1)
  })

  it.each([
    ['linear', 0.25, 0.25],
    ['ease-in', 0.5, 0.125],
    ['ease-out', 0.5, 0.875],
    ['ease-in-out', 0.25, 0.0625],
    ['ease-in-out', 0.75, 0.9375],
    ['ease-in-strong', 0.5, 0.0625],
    ['ease-out-strong', 0.5, 0.9375],
    ['ease-in-out-strong', 0.25, 0.03125],
    ['ease-in-out-strong', 0.75, 0.96875],
  ] satisfies Array<[Easing, number, number]>)(
    'evaluates %s at t=%s',
    (easing, t, expected) => {
      expect(evaluateEasingAtT(t, easing)).toBeCloseTo(expected)
    }
  )
})
