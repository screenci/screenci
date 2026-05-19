import { DEFAULT_ZOOM_OPTIONS } from './defaults.js'
import { invalidOptionError } from './errors.js'
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}
function assertAutoZoomUnitIntervalOption(value, name) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw invalidOptionError({
      api: 'autoZoom',
      option: name,
      expectation: 'must be between 0 and 1',
      value,
    })
  }
}
export function resolveAutoZoomOptions(state, options) {
  const mergedOptions = {
    ...DEFAULT_ZOOM_OPTIONS,
    ...state.options,
    ...options,
  }
  assertAutoZoomUnitIntervalOption(mergedOptions.amount, 'amount')
  assertAutoZoomUnitIntervalOption(mergedOptions.centering, 'centering')
  return mergedOptions
}
export function resolveZoomTarget(params) {
  const placement = resolveZoomViewportPlacement(params)
  const isFullViewport =
    placement.actualOrigin.x === 0 &&
    placement.actualOrigin.y === 0 &&
    placement.size.widthPx >= params.viewport.width &&
    placement.size.heightPx >= params.viewport.height &&
    params.currentZoomEnd === undefined
  if (isFullViewport) return undefined
  return {
    end: {
      pointPx: placement.actualOrigin,
      size: placement.size,
    },
    optimalOffset: {
      x: Math.round(placement.idealOrigin.x - placement.actualOrigin.x),
      y: Math.round(placement.idealOrigin.y - placement.actualOrigin.y),
    },
  }
}
export function resolveZoomViewportPlacement(params) {
  const {
    locatorRect,
    viewport,
    targetViewport,
    targetRectPositionInZoomViewport,
  } = params
  const widthPx = Math.min(
    viewport.width,
    Math.max(1, Math.round(targetViewport.width))
  )
  const heightPx = Math.min(
    viewport.height,
    Math.max(1, Math.round(targetViewport.height))
  )
  const idealOrigin = {
    x: locatorRect.x - targetRectPositionInZoomViewport.x,
    y: locatorRect.y - targetRectPositionInZoomViewport.y,
  }
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
    idealOrigin,
    actualOrigin,
    size: {
      widthPx,
      heightPx,
    },
  }
}
function isSameZoomEnd(left, right) {
  return (
    left !== undefined &&
    right !== undefined &&
    left.pointPx.x === right.pointPx.x &&
    left.pointPx.y === right.pointPx.y &&
    left.size.widthPx === right.size.widthPx &&
    left.size.heightPx === right.size.heightPx
  )
}
export function buildZoomEvent(params) {
  const { target, zoomTiming, currentZoomEnd } = params
  if (
    target === undefined ||
    zoomTiming === undefined ||
    isSameZoomEnd(currentZoomEnd, target.end)
  ) {
    return undefined
  }
  return {
    startMs: zoomTiming.startMs,
    endMs: zoomTiming.endMs,
    ...(zoomTiming.easing !== undefined ? { easing: zoomTiming.easing } : {}),
    end: target.end,
    optimalOffset: target.optimalOffset,
  }
}
