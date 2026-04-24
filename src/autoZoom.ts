import {
  DEFAULT_ZOOM_DURATION,
  DEFAULT_ZOOM_EASING,
  DEFAULT_POST_ZOOM_IN_OUT_DELAY,
} from './defaults.js'
import type { ElementRect, IEventRecorder } from './events.js'
import type { AutoZoomOptions, Easing } from './types.js'
import { resolveCenteringValue } from './zoom.js'

export type ZoomLocation = {
  x: number
  y: number
  elementRect: ElementRect
  eventType: 'click' | 'fill'
}

export type CurrentZoomViewport = {
  focusPoint: { x: number; y: number }
  elementRect?: ElementRect
  end: {
    pointPx: { x: number; y: number }
    size: { widthPx: number; heightPx: number }
  }
  optimalOffset?: { x: number; y: number }
  viewportSize: { width: number; height: number }
}

let activeRecorder: IEventRecorder | null = null
let currentAutoZoomState: AutoZoomState = {
  insideAutoZoom: false,
  lastZoomLocation: null,
  easing: null,
  duration: null,
  amount: null,
  centering: null,
  preZoomDelay: null,
  postZoomDelay: null,
  currentZoomViewport: null,
}

export function setActiveAutoZoomRecorder(
  recorder: IEventRecorder | null
): void {
  activeRecorder = recorder
}

export function getLastZoomLocation(): ZoomLocation | null {
  return currentAutoZoomState.lastZoomLocation
}

export function getCurrentZoomViewport(): CurrentZoomViewport | null {
  return currentAutoZoomState.currentZoomViewport
}

export type AutoZoomState = {
  insideAutoZoom: boolean
  lastZoomLocation: ZoomLocation | null
  easing: Easing | null
  duration: number | null
  amount: number | null
  centering: number | null
  preZoomDelay: number | null
  postZoomDelay: number | null
  currentZoomViewport: CurrentZoomViewport | null
}

export function getAutoZoomState(): AutoZoomState {
  return currentAutoZoomState
}

export function setAutoZoomState(state: AutoZoomState): void {
  currentAutoZoomState = state
}

export function setLastZoomLocation(loc: ZoomLocation | null): void {
  setAutoZoomState({
    ...currentAutoZoomState,
    lastZoomLocation: loc,
  })
}

export function setCurrentZoomViewport(
  viewport: CurrentZoomViewport | null
): void {
  setAutoZoomState({
    ...currentAutoZoomState,
    currentZoomViewport: viewport,
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function resetAutoZoomState(): void {
  setAutoZoomState({
    ...currentAutoZoomState,
    insideAutoZoom: false,
    lastZoomLocation: null,
    duration: null,
    easing: null,
    amount: null,
    centering: null,
    preZoomDelay: null,
    postZoomDelay: null,
    currentZoomViewport: null,
  })
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
  if (currentAutoZoomState.insideAutoZoom) {
    throw new Error('Cannot nest autoZoom() calls')
  }
  if (activeRecorder !== null) {
    activeRecorder.addAutoZoomStart(options)
  }
  setAutoZoomState({
    ...currentAutoZoomState,
    insideAutoZoom: true,
    duration: options?.duration ?? DEFAULT_ZOOM_DURATION,
    easing: (options?.easing ?? DEFAULT_ZOOM_EASING) as Easing,
    amount: options?.amount ?? null,
    centering:
      options?.centering !== undefined
        ? resolveCenteringValue(options.centering)
        : null,
    preZoomDelay: options?.preZoomDelay ?? 0,
    postZoomDelay: options?.postZoomDelay ?? DEFAULT_POST_ZOOM_IN_OUT_DELAY,
  })
  try {
    await fn()
    if (activeRecorder !== null) {
      activeRecorder.addAutoZoomEnd(options)
      if (currentAutoZoomState.currentZoomViewport !== null) {
        const zoomOutStartMs = Date.now()
        activeRecorder.addInput('focusChange', undefined, [
          {
            type: 'focusChange',
            x: currentAutoZoomState.currentZoomViewport.focusPoint.x,
            y: currentAutoZoomState.currentZoomViewport.focusPoint.y,
            ...(currentAutoZoomState.currentZoomViewport.elementRect !==
            undefined
              ? {
                  elementRect:
                    currentAutoZoomState.currentZoomViewport.elementRect,
                }
              : {}),
            focusOnly: true,
            zoom: {
              startMs: zoomOutStartMs,
              endMs: zoomOutStartMs + (currentAutoZoomState.duration ?? 0),
              easing: currentAutoZoomState.easing ?? DEFAULT_ZOOM_EASING,
              end: {
                pointPx: { x: 0, y: 0 },
                size: {
                  widthPx:
                    currentAutoZoomState.currentZoomViewport.viewportSize.width,
                  heightPx:
                    currentAutoZoomState.currentZoomViewport.viewportSize
                      .height,
                },
              },
            },
          },
        ])
      }
    }
    if ((currentAutoZoomState.postZoomDelay ?? 0) > 0) {
      await sleep(currentAutoZoomState.postZoomDelay ?? 0)
    }
  } finally {
    resetAutoZoomState()
  }
}
