import type { CursorCurve, CurveTuple } from './types.js'
import { DEFAULT_ARC_CURVINESS, DEFAULT_NATURAL_CURVINESS } from './defaults.js'

export type Point = { x: number; y: number }

/** The two middle handles of a cubic bezier, in absolute viewport pixels. */
export type ControlPoints = [Point, Point]

/** Below this travel distance a move is treated as a no-op (stays straight). */
const MIN_CURVE_LENGTH_PX = 1

/**
 * Resolve a cursor {@link CursorCurve} into the two absolute-pixel cubic-bezier
 * control points for a move from `from` to `to`, or `undefined` when the move
 * should stay a straight line (`'none'`, a degenerate/zero-length move, or a
 * tuple with no deflection).
 *
 * Pure and deterministic: given the same inputs it always returns the same
 * points, so a recording re-renders identically. The `'natural'` preset picks
 * its bow direction from `seq` (falling back to a coordinate hash) so
 * consecutive moves alternate without any randomness.
 */
export function computeControlPoints(
  from: Point,
  to: Point,
  options: {
    curve?: CursorCurve | undefined
    curviness?: number | undefined
    seq?: number | undefined
  } = {}
): ControlPoints | undefined {
  const { curve, curviness, seq } = options
  if (curve === undefined || curve === 'none') return undefined

  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy)
  if (length < MIN_CURVE_LENGTH_PX) return undefined

  const tuple = resolveTuple(curve, curviness, seq, from, to)
  if (tuple === undefined) return undefined

  // Travel-frame basis: `u` points from start to end, `n` is the left-hand
  // normal (positive deflection bends to the left of travel, i.e. upward for a
  // left-to-right move). Both are scaled by `length` when mapping, so the
  // normalized frame is isotropic.
  const ux = dx / length
  const uy = dy / length
  const nx = uy
  const ny = -ux

  const [x1, y1, x2, y2] = tuple
  const c1: Point = {
    x: from.x + (ux * x1 + nx * y1) * length,
    y: from.y + (uy * x1 + ny * y1) * length,
  }
  const c2: Point = {
    x: from.x + (ux * x2 + nx * y2) * length,
    y: from.y + (uy * x2 + ny * y2) * length,
  }
  return [c1, c2]
}

/**
 * Invert {@link computeControlPoints}: express two absolute-pixel control
 * points in the normalized travel frame of the move from `from` to `to`.
 * Returns `undefined` for degenerate (near zero-length) moves, where the
 * travel frame is undefined.
 */
export function controlPointsToTuple(
  from: Point,
  to: Point,
  c1: Point,
  c2: Point
): CurveTuple | undefined {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy)
  if (length < MIN_CURVE_LENGTH_PX) return undefined

  const ux = dx / length
  const uy = dy / length
  const nx = uy
  const ny = -ux

  const project = (p: Point): [number, number] => {
    const px = p.x - from.x
    const py = p.y - from.y
    return [(px * ux + py * uy) / length, (px * nx + py * ny) / length]
  }
  const [x1, y1] = project(c1)
  const [x2, y2] = project(c2)
  return [x1, y1, x2, y2]
}

/**
 * Validate an untrusted value (for example a web-editor override) as a
 * {@link CursorCurve}. Accepts the preset names and a 4-finite-number tuple;
 * anything else returns `undefined`.
 */
export function parseCursorCurve(value: unknown): CursorCurve | undefined {
  if (value === 'none' || value === 'natural' || value === 'arc') return value
  if (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every((n) => typeof n === 'number' && Number.isFinite(n))
  ) {
    return [value[0], value[1], value[2], value[3]]
  }
  return undefined
}

/**
 * Turn a curve preset (or pass an explicit tuple through) into a normalized
 * `[x1, y1, x2, y2]` cubic-bezier tuple. Returns `undefined` when the tuple
 * carries no perpendicular deflection (a straight line).
 */
function resolveTuple(
  curve: Exclude<CursorCurve, 'none'>,
  curviness: number | undefined,
  seq: number | undefined,
  from: Point,
  to: Point
): CurveTuple | undefined {
  if (Array.isArray(curve)) {
    return curve[1] === 0 && curve[3] === 0 ? undefined : curve
  }

  const defaultMagnitude =
    curve === 'arc' ? DEFAULT_ARC_CURVINESS : DEFAULT_NATURAL_CURVINESS
  const magnitude =
    curviness !== undefined ? Math.abs(curviness) : defaultMagnitude
  if (magnitude === 0) return undefined

  // An explicit (signed) curviness fixes the direction; otherwise the sign is
  // chosen deterministically so `'natural'` moves alternate their bow.
  const sign =
    curviness !== undefined
      ? curviness < 0
        ? -1
        : 1
      : deterministicSign(seq, from, to)

  if (curve === 'arc') {
    // A symmetric bow: both handles deflect the same way.
    return [1 / 3, magnitude * sign, 2 / 3, magnitude * sign]
  }
  // 'natural': a gentle, slightly asymmetric single arc.
  return [1 / 3, magnitude * sign, 2 / 3, magnitude * sign * 0.85]
}

/**
 * A stable +1/-1 from the move's sequence index when available, else from a
 * hash of the endpoint coordinates. Deterministic (no randomness) so renders
 * reproduce, while still varying the bow between moves.
 */
function deterministicSign(
  seq: number | undefined,
  from: Point,
  to: Point
): 1 | -1 {
  if (seq !== undefined) return seq % 2 === 0 ? 1 : -1
  const hash =
    Math.round(from.x) +
    Math.round(from.y) * 7 +
    Math.round(to.x) * 13 +
    Math.round(to.y) * 17
  return hash % 2 === 0 ? 1 : -1
}

/**
 * Evaluate a cubic bezier at parameter `t` in [0, 1] for `p0 -> p3` with the two
 * middle control points. Shared by the live cursor dispatch and tests.
 */
export function cubicBezierAt(
  t: number,
  p0: Point,
  c1: Point,
  c2: Point,
  p3: Point
): Point {
  const mt = 1 - t
  const a = mt * mt * mt
  const b = 3 * mt * mt * t
  const c = 3 * mt * t * t
  const d = t * t * t
  return {
    x: a * p0.x + b * c1.x + c * c2.x + d * p3.x,
    y: a * p0.y + b * c1.y + c * c2.y + d * p3.y,
  }
}
