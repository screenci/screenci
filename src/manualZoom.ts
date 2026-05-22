import type { Locator, Page } from '@playwright/test'
import { DEFAULT_ZOOM_OPTIONS } from './defaults.js'
import { ScreenciError } from './errors.js'
import type { FocusChangeEvent } from './events.js'
import {
  changeFocus,
  resolveFixedFocusViewportSize,
  resolveTargetRectPosition,
} from './changeFocus.js'
import {
  getActiveAutoZoomRecorder,
  getActiveZoomPage,
  getAutoZoomState,
  setCurrentZoomViewport,
  setZoomMode,
} from './autoZoom.js'
import {
  buildZoomEvent,
  resolveAutoZoomOptions,
  resolveZoomTarget,
} from './zoom.js'
import type { AutoZoomOptions } from './types.js'
import { resolveRecordingTimingDuration } from './runtimeMode.js'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) =>
    setTimeout(resolve, resolveRecordingTimingDuration(ms))
  )
}

export type ZoomTargetPoint = { x: number; y: number }
export type ZoomTarget = Locator | ZoomTargetPoint

function isLocator(target: ZoomTarget): target is Locator {
  return typeof target === 'object' && target !== null && 'evaluate' in target
}

function assertManualZoomAllowed(api: 'zoomTo' | 'resetZoom'): void {
  const state = getAutoZoomState()
  if (state.insideAutoZoom || state.mode === 'auto') {
    throw new ScreenciError(`Cannot call ${api}() while autoZoom() is active`)
  }
}

async function resolveViewportSize(
  page: Page
): Promise<{ width: number; height: number }> {
  const viewport = page.viewportSize()
  if (viewport !== null) return viewport

  return page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }))
}

async function zoomToPoint(
  point: ZoomTargetPoint,
  options: AutoZoomOptions = {}
): Promise<FocusChangeEvent | undefined> {
  const page = getActiveZoomPage()
  if (page === null) {
    throw new ScreenciError(
      'zoomTo({ x, y }) requires an active ScreenCI page during recording'
    )
  }

  const state = getAutoZoomState()
  const viewportSize = await resolveViewportSize(page)
  const resolvedOptions = resolveAutoZoomOptions(state, options)
  const currentZoomEnd = state.currentZoomViewport?.end ?? {
    pointPx: { x: 0, y: 0 },
    size: {
      widthPx: viewportSize.width,
      heightPx: viewportSize.height,
    },
  }
  const targetViewport = resolveFixedFocusViewportSize(
    viewportSize,
    resolvedOptions.amount
  )
  const pointRect = {
    x: point.x,
    y: point.y,
    width: 0,
    height: 0,
  }
  const zoomTarget = resolveZoomTarget({
    locatorRect: pointRect,
    viewport: viewportSize,
    targetViewport,
    targetRectPositionInZoomViewport: resolveTargetRectPosition({
      containerSize: targetViewport,
      rect: { x: 0, y: 0, width: 0, height: 0 },
      amount: 1,
      centering: resolvedOptions.centering,
    }),
    currentZoomEnd,
  })

  const focusChangeStartMs = Date.now()
  if (resolvedOptions.preZoomDelay > 0) {
    await sleep(resolvedOptions.preZoomDelay)
  }

  const zoomStartMs = Date.now()
  if (resolvedOptions.duration > 0) {
    await sleep(resolvedOptions.duration)
  }
  const zoomEndMs = Date.now()

  if (resolvedOptions.postZoomDelay > 0) {
    await sleep(resolvedOptions.postZoomDelay)
  }
  const focusChangeEndMs = Date.now()

  const zoomEvent = buildZoomEvent({
    target: zoomTarget,
    currentZoomEnd,
    zoomTiming:
      zoomTarget !== undefined
        ? {
            startMs: zoomStartMs,
            endMs: zoomEndMs,
            easing: resolvedOptions.easing,
          }
        : undefined,
  })

  const fullViewportEnd = {
    pointPx: { x: 0, y: 0 },
    size: {
      widthPx: viewportSize.width,
      heightPx: viewportSize.height,
    },
  }

  setCurrentZoomViewport({
    focusPoint: point,
    end: zoomTarget?.end ?? fullViewportEnd,
    viewportSize,
    optimalOffset: zoomTarget?.optimalOffset ?? { x: 0, y: 0 },
  })

  if (zoomTarget !== undefined || state.mode === 'manual') {
    setZoomMode('manual')
  } else {
    setZoomMode('idle')
  }

  return {
    type: 'focusChange',
    startMs: focusChangeStartMs,
    endMs: focusChangeEndMs,
    x: point.x,
    y: point.y,
    ...(zoomEvent !== undefined ? { zoom: zoomEvent } : {}),
  }
}

export async function zoomTo(
  target: ZoomTarget,
  options: AutoZoomOptions = {}
): Promise<void> {
  assertManualZoomAllowed('zoomTo')

  const recorder = getActiveAutoZoomRecorder()
  if (isLocator(target)) {
    const previousMode = getAutoZoomState().mode
    const result = await changeFocus(target, options, undefined, true)
    setZoomMode(
      result.zoom !== undefined || previousMode === 'manual' ? 'manual' : 'idle'
    )
    recorder.addInput('focusChange', result.elementRect, [result])
    return
  }

  const result = await zoomToPoint(target, options)
  if (result !== undefined) {
    recorder.addInput('focusChange', undefined, [result])
  }
}

export async function resetZoom(options: AutoZoomOptions = {}): Promise<void> {
  assertManualZoomAllowed('resetZoom')

  const state = getAutoZoomState()
  const viewport = state.currentZoomViewport
  if (state.mode !== 'manual' || viewport === null) {
    return
  }

  const recorder = getActiveAutoZoomRecorder()
  const resolvedOptions = resolveAutoZoomOptions(state, options)
  const fullViewportEnd = {
    pointPx: { x: 0, y: 0 },
    size: {
      widthPx: viewport.viewportSize.width,
      heightPx: viewport.viewportSize.height,
    },
  }
  const focusChangeStartMs = Date.now()
  if (resolvedOptions.preZoomDelay > 0) {
    await sleep(resolvedOptions.preZoomDelay)
  }
  const zoomStartMs = Date.now()
  if (resolvedOptions.duration > 0) {
    await sleep(resolvedOptions.duration)
  }
  const zoomEndMs = Date.now()
  if (resolvedOptions.postZoomDelay > 0) {
    await sleep(resolvedOptions.postZoomDelay)
  }
  const focusChangeEndMs = Date.now()

  const result: FocusChangeEvent = {
    type: 'focusChange',
    startMs: focusChangeStartMs,
    endMs: focusChangeEndMs,
    x: viewport.focusPoint.x,
    y: viewport.focusPoint.y,
    zoom: {
      startMs: zoomStartMs,
      endMs: zoomEndMs,
      easing: resolvedOptions.easing ?? DEFAULT_ZOOM_OPTIONS.easing,
      end: fullViewportEnd,
    },
    ...(viewport.elementRect !== undefined
      ? { elementRect: viewport.elementRect }
      : {}),
  }

  setCurrentZoomViewport({
    focusPoint: viewport.focusPoint,
    end: fullViewportEnd,
    viewportSize: viewport.viewportSize,
    optimalOffset: { x: 0, y: 0 },
    ...(viewport.elementRect !== undefined
      ? { elementRect: viewport.elementRect }
      : {}),
  })
  setZoomMode('idle')

  recorder.addInput('focusChange', viewport.elementRect, [result])
}
