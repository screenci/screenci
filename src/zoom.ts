import { DEFAULT_ZOOM_AMOUNT, DEFAULT_ZOOM_EASING } from './defaults.js'
import type { ElementRect, FocusChangeEvent } from './events.js'
import type { AutoZoomOptions, Easing } from './types.js'
import type { AutoZoomState } from './autoZoom.js'

type FocusChangeZoom = NonNullable<FocusChangeEvent['zoom']>

export type ResolvedAutoZoomConfig = {
  easing: Easing
  duration: number
  amount: number
  centering: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function resolveFixedFocusViewportSize(
  viewport: { width: number; height: number },
  amount: number
): { width: number; height: number } {
  const resolvedAmount = clamp(amount, 0, 1)
  return {
    width: viewport.width * resolvedAmount,
    height: viewport.height * resolvedAmount,
  }
}

function resolveIdealFocusOriginForAxis(params: {
  rectStart: number
  rectSize: number
  focusSize: number
  centering: number
}): number {
  const { rectStart, rectSize, focusSize, centering } = params
  if (rectSize <= focusSize) {
    const slack = focusSize - rectSize
    const idealRectOffset = (slack * centering) / 2
    return rectStart - idealRectOffset
  }
  return rectStart + rectSize / 2 - focusSize / 2
}

function resolveIdealFocusOrigin(
  locatorRect: ElementRect,
  focusViewport: { width: number; height: number },
  centering: number
): { x: number; y: number } {
  return {
    x: resolveIdealFocusOriginForAxis({
      rectStart: locatorRect.x,
      rectSize: locatorRect.width,
      focusSize: focusViewport.width,
      centering,
    }),
    y: resolveIdealFocusOriginForAxis({
      rectStart: locatorRect.y,
      rectSize: locatorRect.height,
      focusSize: focusViewport.height,
      centering,
    }),
  }
}

export function resolveCenteringValue(centering: number | undefined): number {
  if (centering === undefined) return 1
  return clamp(centering, 0, 1)
}

export function resolveAutoZoomConfig(
  state: AutoZoomState,
  options: AutoZoomOptions
): ResolvedAutoZoomConfig {
  const useZoomAnimation =
    state.insideAutoZoom && state.lastZoomLocation !== null

  return {
    easing:
      options.easing ??
      (useZoomAnimation
        ? (state.easing ?? DEFAULT_ZOOM_EASING)
        : DEFAULT_ZOOM_EASING),
    duration:
      options.duration ?? (useZoomAnimation ? (state.duration ?? 0) : 0),
    amount:
      options.amount ??
      state.amount ??
      (state.insideAutoZoom ? DEFAULT_ZOOM_AMOUNT : 1),
    centering:
      options.centering !== undefined
        ? resolveCenteringValue(options.centering)
        : (state.centering ?? 1),
  }
}

export function resolveZoomTarget(
  locatorRect: ElementRect,
  viewport: { width: number; height: number },
  config: Pick<ResolvedAutoZoomConfig, 'amount' | 'centering'>
): { end: FocusChangeZoom['end']; optimalOffset: { x: number; y: number } } {
  const focusViewport = resolveFixedFocusViewportSize(viewport, config.amount)
  const widthPx = Math.min(
    viewport.width,
    Math.max(1, Math.round(focusViewport.width))
  )
  const heightPx = Math.min(
    viewport.height,
    Math.max(1, Math.round(focusViewport.height))
  )
  const idealOrigin = resolveIdealFocusOrigin(
    locatorRect,
    { width: widthPx, height: heightPx },
    config.centering
  )
  const actualOrigin = {
    x: clamp(
      Math.round(idealOrigin.x),
      0,
      Math.max(0, viewport.width - widthPx)
    ),
    y: clamp(
      Math.round(idealOrigin.y),
      0,
      Math.max(0, viewport.height - heightPx)
    ),
  }

  return {
    end: {
      pointPx: actualOrigin,
      size: {
        widthPx,
        heightPx,
      },
    },
    optimalOffset: {
      x: idealOrigin.x - actualOrigin.x,
      y: idealOrigin.y - actualOrigin.y,
    },
  }
}

function isSameZoomEnd(
  left: FocusChangeZoom['end'] | undefined,
  right: FocusChangeZoom['end']
): boolean {
  return (
    left !== undefined &&
    left.pointPx.x === right.pointPx.x &&
    left.pointPx.y === right.pointPx.y &&
    left.size.widthPx === right.size.widthPx &&
    left.size.heightPx === right.size.heightPx
  )
}

export function buildZoomEvent(params: {
  target: {
    end: FocusChangeZoom['end']
    optimalOffset: { x: number; y: number }
  }
  config: ResolvedAutoZoomConfig
  startMs: number
  currentZoomEnd: FocusChangeZoom['end'] | undefined
}): FocusChangeZoom | undefined {
  const { target, config, startMs, currentZoomEnd } = params
  const isFullViewport =
    target.end.pointPx.x === 0 &&
    target.end.pointPx.y === 0 &&
    target.end.size.widthPx >= 1 &&
    target.end.size.heightPx >= 1 &&
    config.amount >= 1

  if (isSameZoomEnd(currentZoomEnd, target.end) || isFullViewport) {
    return undefined
  }

  return {
    startMs,
    endMs: startMs + config.duration,
    ...(config.duration > 0 ? { easing: config.easing } : {}),
    end: target.end,
    optimalOffset: target.optimalOffset,
  }
}
