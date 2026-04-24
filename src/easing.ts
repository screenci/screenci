import type { Easing } from './types.js'

/**
 * Evaluate a polynomial easing function at normalized time t in [0, 1].
 */
export function evaluateEasingAtT(t: number, easing: Easing): number {
  if (t <= 0) return 0
  if (t >= 1) return 1

  switch (easing) {
    case 'linear':
      return t
    case 'ease-in':
      return t * t * t
    case 'ease-out':
      return 1 - (1 - t) * (1 - t) * (1 - t)
    case 'ease-in-out':
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
    case 'ease-in-strong':
      return t * t * t * t
    case 'ease-out-strong':
      return 1 - (1 - t) * (1 - t) * (1 - t) * (1 - t)
    case 'ease-in-out-strong':
      return t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2
    default: {
      const _: never = easing
      throw new Error(`Unknown easing: ${_}`)
    }
  }
}
