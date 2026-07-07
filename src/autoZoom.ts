import type { Page } from '@playwright/test'
import { DEFAULT_ZOOM_OPTIONS } from './defaults.js'
import { invalidOptionError, ScreenciError } from './errors.js'
import type { IEventRecorder } from './events.js'
import type { AutoZoomOptions, Easing } from './types.js'
import { resolveRecordingTimingDuration } from './runtimeMode.js'
import {
  type AutoZoomState,
  type CurrentZoomViewport,
  getRuntimeAutoZoomState,
  getRuntimeAutoZoomRecorder,
  getRuntimePage,
  setRuntimeAutoZoomState,
  setRuntimeAutoZoomRecorder,
  setRuntimePage,
} from './runtimeContext.js'

function assertAutoZoomUnitIntervalOption(
  value: number,
  name: 'amount' | 'padding' | 'centering'
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

export function setActiveAutoZoomRecorder(
  recorder: IEventRecorder | null
): void {
  setRuntimeAutoZoomRecorder(recorder)
}

export function getActiveAutoZoomRecorder(): IEventRecorder {
  return getRuntimeAutoZoomRecorder()
}

export function setActiveZoomPage(page: Page | null): void {
  setRuntimePage(page)
}

export function getActiveZoomPage(): Page | null {
  return getRuntimePage()
}

export function getCurrentZoomViewport(): CurrentZoomViewport | null {
  return getAutoZoomState().currentZoomViewport
}

export function getAutoZoomState(): AutoZoomState {
  return getRuntimeAutoZoomState()
}

export function setAutoZoomState(state: AutoZoomState): void {
  setRuntimeAutoZoomState(state)
}

export function setZoomMode(mode: AutoZoomState['mode']): void {
  const currentAutoZoomState = getAutoZoomState()
  setAutoZoomState({
    ...currentAutoZoomState,
    mode,
  })
}

export function setCurrentZoomViewport(
  viewport: CurrentZoomViewport | null
): void {
  const currentAutoZoomState = getAutoZoomState()
  setAutoZoomState({
    ...currentAutoZoomState,
    currentZoomViewport: viewport,
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) =>
    setTimeout(resolve, resolveRecordingTimingDuration(ms))
  )
}

function resetAutoZoomState(): void {
  const currentAutoZoomState = getAutoZoomState()
  setAutoZoomState({
    ...currentAutoZoomState,
    insideAutoZoom: false,
    mode: 'idle',
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
  const currentAutoZoomState = getAutoZoomState()
  if (currentAutoZoomState.insideAutoZoom) {
    throw new ScreenciError('Cannot nest autoZoom() calls')
  }
  if (currentAutoZoomState.mode === 'manual') {
    throw new ScreenciError(
      'Cannot call autoZoom() while manual zoom is active'
    )
  }
  const activeRecorder = getRuntimeAutoZoomRecorder()
  activeRecorder.addAutoZoomStart(options)
  const resolvedOptions = {
    ...DEFAULT_ZOOM_OPTIONS,
    ...(options ?? {}),
  }
  assertAutoZoomUnitIntervalOption(resolvedOptions.amount, 'amount')
  assertAutoZoomUnitIntervalOption(resolvedOptions.padding, 'padding')
  assertAutoZoomUnitIntervalOption(resolvedOptions.centering, 'centering')
  setAutoZoomState({
    ...currentAutoZoomState,
    insideAutoZoom: true,
    mode: 'auto',
    options: {
      duration: resolvedOptions.duration,
      zoomOutDuration: resolvedOptions.zoomOutDuration,
      easing: resolvedOptions.easing as Easing,
      amount: resolvedOptions.amount,
      padding: resolvedOptions.padding,
      ...(options?.centering !== undefined
        ? { centering: options.centering }
        : {}),
      delay: resolvedOptions.delay,
      delayAfter: resolvedOptions.delayAfter,
    },
  })
  try {
    await fn()
    const activeRecorder = getRuntimeAutoZoomRecorder()
    const currentAutoZoomState = getAutoZoomState()
    activeRecorder.addAutoZoomEnd(options)
    if (currentAutoZoomState.currentZoomViewport !== null) {
      const zoomOutStartMs = Date.now()
      const zoomOutDuration = resolveRecordingTimingDuration(
        currentAutoZoomState.options.zoomOutDuration ??
          DEFAULT_ZOOM_OPTIONS.zoomOutDuration
      )
      activeRecorder.addInput('focusChange', undefined, [
        {
          type: 'focusChange',
          startMs: zoomOutStartMs,
          endMs: zoomOutStartMs + zoomOutDuration,
          x: currentAutoZoomState.currentZoomViewport.focusPoint.x,
          y: currentAutoZoomState.currentZoomViewport.focusPoint.y,
          ...(currentAutoZoomState.currentZoomViewport.elementRect !== undefined
            ? {
                elementRect:
                  currentAutoZoomState.currentZoomViewport.elementRect,
              }
            : {}),
          zoom: {
            startMs: zoomOutStartMs,
            endMs: zoomOutStartMs + zoomOutDuration,
            easing:
              currentAutoZoomState.options.easing ??
              DEFAULT_ZOOM_OPTIONS.easing,
            end: {
              pointPx: { x: 0, y: 0 },
              size: {
                widthPx:
                  currentAutoZoomState.currentZoomViewport.viewportSize.width,
                heightPx:
                  currentAutoZoomState.currentZoomViewport.viewportSize.height,
              },
            },
          },
        },
      ])
      if (zoomOutDuration > 0) {
        await sleep(zoomOutDuration)
      }
    }
    if ((currentAutoZoomState.options.delayAfter ?? 0) > 0) {
      await sleep(currentAutoZoomState.options.delayAfter ?? 0)
    }
  } finally {
    resetAutoZoomState()
  }
}
