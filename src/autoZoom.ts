import { DEFAULT_ZOOM_OPTIONS } from './defaults.js'
import { invalidOptionError, ScreenciError } from './errors.js'
import type { ElementRect, IEventRecorder } from './events.js'
import type { AutoZoomOptions, Easing } from './types.js'
function assertAutoZoomUnitIntervalOption(
  value: number,
  name: 'amount' | 'centering'
): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw invalidOptionError({
      api: 'autoZoom',
      option: name,
      expectation: 'must be between 0 and 1',
      value,
    })
  }
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
  options: {},
  currentZoomViewport: null,
}

export function setActiveAutoZoomRecorder(
  recorder: IEventRecorder | null
): void {
  activeRecorder = recorder
}

export function getCurrentZoomViewport(): CurrentZoomViewport | null {
  return currentAutoZoomState.currentZoomViewport
}

export type AutoZoomState = {
  insideAutoZoom: boolean
  options: AutoZoomOptions
  currentZoomViewport: CurrentZoomViewport | null
}

export function getAutoZoomState(): AutoZoomState {
  return currentAutoZoomState
}

export function setAutoZoomState(state: AutoZoomState): void {
  currentAutoZoomState = state
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
    options: {},
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
    throw new ScreenciError('Cannot nest autoZoom() calls')
  }
  if (activeRecorder !== null) {
    activeRecorder.addAutoZoomStart(options)
  }
  const resolvedOptions = {
    ...DEFAULT_ZOOM_OPTIONS,
    ...(options ?? {}),
  }
  assertAutoZoomUnitIntervalOption(resolvedOptions.amount, 'amount')
  assertAutoZoomUnitIntervalOption(resolvedOptions.centering, 'centering')
  setAutoZoomState({
    ...currentAutoZoomState,
    insideAutoZoom: true,
    options: {
      duration: resolvedOptions.duration,
      easing: resolvedOptions.easing as Easing,
      amount: resolvedOptions.amount,
      ...(options?.centering !== undefined
        ? { centering: options.centering }
        : {}),
      preZoomDelay: resolvedOptions.preZoomDelay,
      postZoomDelay: resolvedOptions.postZoomDelay,
    },
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
            zoom: {
              startMs: zoomOutStartMs,
              endMs:
                zoomOutStartMs +
                (currentAutoZoomState.options.duration ??
                  DEFAULT_ZOOM_OPTIONS.duration),
              easing:
                currentAutoZoomState.options.easing ??
                DEFAULT_ZOOM_OPTIONS.easing,
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
    if ((currentAutoZoomState.options.postZoomDelay ?? 0) > 0) {
      await sleep(currentAutoZoomState.options.postZoomDelay ?? 0)
    }
  } finally {
    resetAutoZoomState()
  }
}
