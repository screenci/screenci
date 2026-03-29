import {
  DEFAULT_ZOOM_DURATION,
  DEFAULT_POST_ZOOM_IN_OUT_DELAY,
} from './defaults.js'
import type { ElementRect, IEventRecorder } from './events.js'
import type { AutoZoomOptions } from './types.js'

export type ZoomLocation = {
  x: number
  y: number
  elementRect: ElementRect
  eventType: 'click' | 'fill'
}

let activeRecorder: IEventRecorder | null = null
let insideAutoZoom = false
let currentZoomDuration: number | null = null
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

export function getPostZoomInOutDelay(): number | null {
  return currentPostZoomInOutDelay
}

export function getLastZoomLocation(): ZoomLocation | null {
  return lastZoomLocation
}

export function setLastZoomLocation(loc: ZoomLocation | null): void {
  lastZoomLocation = loc
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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
  const zoomStartTime = Date.now()
  insideAutoZoom = true
  currentZoomDuration = options?.duration ?? DEFAULT_ZOOM_DURATION
  currentPostZoomInOutDelay =
    options?.postZoomInOutDelay ?? DEFAULT_POST_ZOOM_IN_OUT_DELAY
  try {
    await fn()
  } finally {
    insideAutoZoom = false
    lastZoomLocation = null
    currentZoomDuration = null
    currentPostZoomInOutDelay = null
  }
  const duration = options?.duration ?? DEFAULT_ZOOM_DURATION
  const postZoomInOutDelay =
    options?.postZoomInOutDelay ?? DEFAULT_POST_ZOOM_IN_OUT_DELAY
  const elapsed = Date.now() - zoomStartTime
  const remaining = duration + postZoomInOutDelay - elapsed
  if (remaining > 0) {
    await sleep(remaining)
  }

  if (activeRecorder !== null) {
    activeRecorder.addAutoZoomEnd(options)
  }
  const postEndDelay = duration + postZoomInOutDelay
  if (postEndDelay > 0) {
    await sleep(postEndDelay)
  }
}
