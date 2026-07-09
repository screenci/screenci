import { describe, expect, it } from 'vitest'
import {
  computeControlPoints,
  cubicBezierAt,
  type Point,
} from './cursorCurve.js'
import { DEFAULT_NATURAL_CURVINESS } from './defaults.js'

const from: Point = { x: 0, y: 0 }
const to: Point = { x: 100, y: 0 } // left-to-right, length 100

describe('computeControlPoints', () => {
  it('returns undefined for a straight move', () => {
    expect(computeControlPoints(from, to, { curve: 'none' })).toBeUndefined()
    expect(computeControlPoints(from, to, {})).toBeUndefined()
  })

  it('returns undefined for a zero-length move', () => {
    expect(
      computeControlPoints(from, { x: 0, y: 0 }, { curve: 'natural' })
    ).toBeUndefined()
  })

  it('returns undefined for a tuple with no deflection', () => {
    expect(
      computeControlPoints(from, to, { curve: [0.33, 0, 0.66, 0] })
    ).toBeUndefined()
  })

  it('maps a normalized tuple onto the travel frame', () => {
    // For a left-to-right move the along-axis is +x and the left-normal is -y,
    // so a positive `y` deflection bends upward (negative screen y).
    const control = computeControlPoints(from, to, {
      curve: [0.25, 0.5, 0.75, 0.5],
    })
    expect(control).toEqual([
      { x: 25, y: -50 },
      { x: 75, y: -50 },
    ])
  })

  it('derives the preset bow from the default curviness', () => {
    const control = computeControlPoints(from, to, {
      curve: 'natural',
      seq: 0, // even -> positive sign -> upward bow
    })
    expect(control).not.toBeUndefined()
    const [c1, c2] = control!
    expect(c1.x).toBeCloseTo(100 / 3)
    expect(c1.y).toBeCloseTo(-DEFAULT_NATURAL_CURVINESS * 100)
    expect(c2.x).toBeCloseTo((100 * 2) / 3)
    // 'natural' is slightly asymmetric.
    expect(c2.y).toBeCloseTo(-DEFAULT_NATURAL_CURVINESS * 100 * 0.85)
  })

  it('alternates the natural bow direction by seq', () => {
    const even = computeControlPoints(from, to, { curve: 'natural', seq: 0 })!
    const odd = computeControlPoints(from, to, { curve: 'natural', seq: 1 })!
    expect(Math.sign(even[0].y)).toBe(-Math.sign(odd[0].y))
  })

  it('lets an explicit signed curviness fix the direction', () => {
    const pos = computeControlPoints(from, to, {
      curve: 'natural',
      curviness: 0.3,
      seq: 1, // seq would otherwise flip it
    })!
    const neg = computeControlPoints(from, to, {
      curve: 'natural',
      curviness: -0.3,
      seq: 1,
    })!
    expect(pos[0].y).toBeCloseTo(-30)
    expect(neg[0].y).toBeCloseTo(30)
  })

  it('is deterministic without a seq (coordinate hash)', () => {
    const a = computeControlPoints(from, to, { curve: 'natural' })
    const b = computeControlPoints(from, to, { curve: 'natural' })
    expect(a).toEqual(b)
  })
})

describe('cubicBezierAt', () => {
  const p0: Point = { x: 0, y: 0 }
  const c1: Point = { x: 0, y: 100 }
  const c2: Point = { x: 100, y: 100 }
  const p3: Point = { x: 100, y: 0 }

  it('returns the endpoints at t=0 and t=1', () => {
    expect(cubicBezierAt(0, p0, c1, c2, p3)).toEqual(p0)
    expect(cubicBezierAt(1, p0, c1, c2, p3)).toEqual(p3)
  })

  it('bows away from the straight line at the midpoint', () => {
    const mid = cubicBezierAt(0.5, p0, c1, c2, p3)
    expect(mid.x).toBeCloseTo(50)
    expect(mid.y).toBeCloseTo(75) // pulled toward the control points
  })
})
