import type { Easing } from './types.js'
/**
 * Evaluate a polynomial easing function at normalized time t in [0, 1].
 */
export declare function evaluateEasingAtT(t: number, easing: Easing): number
