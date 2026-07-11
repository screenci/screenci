import { describe, expect, it } from 'vitest'
import {
  computeControlPoints,
  controlPointsToTuple,
  parseCursorCurve,
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

describe('controlPointsToTuple', () => {
  it('round-trips a tuple through computeControlPoints', () => {
    const tuple: [number, number, number, number] = [0.17, 0.67, 0.83, -0.4]
    const a: Point = { x: 12, y: 34 }
    const b: Point = { x: 250, y: 180 }
    const control = computeControlPoints(a, b, { curve: tuple })!
    const back = controlPointsToTuple(a, b, control[0], control[1])!
    back.forEach((component, i) => expect(component).toBeCloseTo(tuple[i]!, 6))
  })

  it('round-trips pixel control points through the tuple', () => {
    const a: Point = { x: 40, y: 300 }
    const b: Point = { x: 400, y: 60 }
    const c1: Point = { x: 90, y: 120 }
    const c2: Point = { x: 310, y: 220 }
    const tuple = controlPointsToTuple(a, b, c1, c2)!
    const control = computeControlPoints(a, b, { curve: tuple })!
    expect(control[0].x).toBeCloseTo(c1.x, 6)
    expect(control[0].y).toBeCloseTo(c1.y, 6)
    expect(control[1].x).toBeCloseTo(c2.x, 6)
    expect(control[1].y).toBeCloseTo(c2.y, 6)
  })

  it('returns undefined for a degenerate move', () => {
    const a: Point = { x: 10, y: 10 }
    expect(controlPointsToTuple(a, { x: 10.2, y: 10 }, a, a)).toBeUndefined()
  })
})

describe('parseCursorCurve', () => {
  it('accepts preset names', () => {
    expect(parseCursorCurve('none')).toBe('none')
    expect(parseCursorCurve('natural')).toBe('natural')
    expect(parseCursorCurve('arc')).toBe('arc')
  })

  it('accepts a 4-finite-number tuple', () => {
    expect(parseCursorCurve([0.1, -0.2, 0.9, 0.4])).toEqual([
      0.1, -0.2, 0.9, 0.4,
    ])
  })

  it('rejects everything else', () => {
    expect(parseCursorCurve('wiggly')).toBeUndefined()
    expect(parseCursorCurve([0.1, 0.2, 0.3])).toBeUndefined()
    expect(parseCursorCurve([0.1, 0.2, 0.3, Number.NaN])).toBeUndefined()
    expect(parseCursorCurve([0.1, 0.2, 0.3, '0.4'])).toBeUndefined()
    expect(parseCursorCurve({})).toBeUndefined()
    expect(parseCursorCurve(undefined)).toBeUndefined()
    expect(parseCursorCurve(null)).toBeUndefined()
  })
})
