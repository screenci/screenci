import {
  DEFAULT_ZOOM_DURATION,
  DEFAULT_ZOOM_EASING,
  DEFAULT_POST_ZOOM_IN_OUT_DELAY,
} from './defaults.js'
import type { ElementRect, IEventRecorder } from './events.js'
import type { AutoZoomOptions, Easing } from './types.js'

export type ZoomLocation = {
  x: number
  y: number
  elementRect: ElementRect
  eventType: 'click' | 'fill'
}

let activeRecorder: IEventRecorder | null = null
let insideAutoZoom = false
let currentZoomDuration: number | null = null
let currentZoomEasing: Easing | null = null
let currentZoomAmount: number | null = null
let currentZoomCentering: number | null = null
let currentAllowZoomingOut: boolean | null = null
let currentPostZoomInOutDelay: number | null = null
let lastZoomLocation: ZoomLocation | null = null

export function setActiveAutoZoomRecorder(
  recorder: IEventRecorder | null
): void {
  activeRecorder = recorder
}

export function isInsideAutoZoom(): boolean {
  return insideAutoZoom
}

export function getZoomDuration(): number | null {
  return currentZoomDuration
}

export function getZoomEasing(): Easing | null {
  return currentZoomEasing
}

export function getZoomAmount(): number | null {
  return currentZoomAmount
}

export function getZoomCentering(): number | null {
  return currentZoomCentering
}

export function getAllowZoomingOut(): boolean | null {
  return currentAllowZoomingOut
}

export function getPostZoomInOutDelay(): number | null {
  return currentPostZoomInOutDelay
}

export function getLastZoomLocation(): ZoomLocation | null {
  return lastZoomLocation
}

export type AutoZoomState = {
  insideAutoZoom: boolean
  lastZoomLocation: ZoomLocation | null
  easing: Easing | null
  duration: number | null
  amount: number | null
  centering: number | null
}

export function getAutoZoomState(): AutoZoomState {
  return {
    insideAutoZoom: isInsideAutoZoom(),
    lastZoomLocation: getLastZoomLocation(),
    easing: getZoomEasing(),
    duration: getZoomDuration(),
    amount: getZoomAmount(),
    centering: getZoomCentering(),
  }
}

export function setLastZoomLocation(loc: ZoomLocation | null): void {
  lastZoomLocation = loc
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function resolveCenteringValue(
  centering: AutoZoomOptions['centering']
): number | undefined {
  if (centering === undefined) return undefined
  return centering
}

/**
 * Zooms the camera in on interactions inside `fn`, panning to follow each
 * click and fill. After `fn` resolves the camera zooms back out.
 *
 * Wrap page sections or forms — not individual clicks. One `autoZoom` per
 * distinct area of the UI gives the camera a natural rhythm.
 *
 * Cannot be nested — calling `autoZoom()` inside another `autoZoom()` throws.
 *
 * @param fn - The interactions to zoom in on
 * @param options - Optional zoom settings
 *
 * @example
 * ```ts
 * await autoZoom(
 *   async () => {
 *     await page.locator('#name').fill('Jane Doe')
 *     await page.locator('#email').fill('jane@example.com')
 *     await page.locator('button[type="submit"]').click()
 *   },
 *   { duration: 400, easing: 'ease-in-out', amount: 0.4 }
 * )
 * ```
 */
export async function autoZoom(
  fn: () => Promise<void> | void,
  options?: AutoZoomOptions
): Promise<void> {
  if (insideAutoZoom) {
    throw new Error('Cannot nest autoZoom() calls')
  }
  if (activeRecorder !== null) {
    activeRecorder.addAutoZoomStart(options)
  }
  insideAutoZoom = true
  currentZoomDuration = options?.duration ?? DEFAULT_ZOOM_DURATION
  currentZoomEasing = (options?.easing ?? DEFAULT_ZOOM_EASING) as Easing
  currentZoomAmount = options?.amount ?? null
  currentZoomCentering = resolveCenteringValue(options?.centering) ?? null
  currentAllowZoomingOut = options?.allowZoomingOut ?? null
  currentPostZoomInOutDelay =
    options?.postZoomDelay ??
    options?.postZoomInOutDelay ??
    DEFAULT_POST_ZOOM_IN_OUT_DELAY
  const preZoomDelay = options?.preZoomDelay ?? 0
  try {
    if (preZoomDelay > 0) {
      await sleep(preZoomDelay)
    }
    await fn()
    if (activeRecorder !== null) {
      activeRecorder.addAutoZoomEnd(options)
    }
    if (currentPostZoomInOutDelay !== null && currentPostZoomInOutDelay > 0) {
      await sleep(currentPostZoomInOutDelay)
    }
  } finally {
    insideAutoZoom = false
    lastZoomLocation = null
    currentZoomDuration = null
    currentZoomEasing = null
    currentZoomAmount = null
    currentZoomCentering = null
    currentAllowZoomingOut = null
    currentPostZoomInOutDelay = null
  }
}
