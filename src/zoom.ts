import { DEFAULT_ZOOM_OPTIONS } from './defaults.js'
import type { ElementRect, FocusChangeEvent } from './events.js'
import { invalidOptionError } from './errors.js'
import type { AutoZoomOptions } from './types.js'
import type { AutoZoomState } from './autoZoom.js'

type FocusChangeZoom = NonNullable<FocusChangeEvent['zoom']>

export type ResolvedAutoZoomOptions = Required<AutoZoomOptions>

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

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

export function resolveAutoZoomOptions(
  state: AutoZoomState,
  options: AutoZoomOptions
): ResolvedAutoZoomOptions {
  const mergedOptions = {
    ...DEFAULT_ZOOM_OPTIONS,
    ...state.options,
    ...options,
  }

  assertAutoZoomUnitIntervalOption(mergedOptions.amount, 'amount')
  assertAutoZoomUnitIntervalOption(mergedOptions.centering, 'centering')

  return mergedOptions
}

export function resolveZoomTarget(params: {
  locatorRect: ElementRect
  viewport: { width: number; height: number }
  targetViewport: { width: number; height: number }
  targetRectPositionInZoomViewport: { x: number; y: number }
}): { end: FocusChangeZoom['end']; optimalOffset: { x: number; y: number } } {
  const placement = resolveZoomViewportPlacement(params)

  return {
    end: {
      pointPx: placement.actualOrigin,
      size: placement.size,
    },
    optimalOffset: {
      x: placement.idealOrigin.x - placement.actualOrigin.x,
      y: placement.idealOrigin.y - placement.actualOrigin.y,
    },
  }
}

export function resolveZoomViewportPlacement(params: {
  locatorRect: ElementRect
  viewport: { width: number; height: number }
  targetViewport: { width: number; height: number }
  targetRectPositionInZoomViewport: { x: number; y: number }
}): {
  idealOrigin: { x: number; y: number }
  actualOrigin: { x: number; y: number }
  size: { widthPx: number; heightPx: number }
} {
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
  config: ResolvedAutoZoomOptions
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
