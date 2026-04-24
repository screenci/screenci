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
  allowZoomingOut: boolean
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
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
    allowZoomingOut: options.allowZoomingOut ?? state.allowZoomingOut ?? true,
  }
}

function clampZoomViewport(
  point: { x: number; y: number },
  size: { widthPx: number; heightPx: number },
  viewport: { width: number; height: number }
): FocusChangeZoom['end'] {
  const widthPx = Math.min(
    viewport.width,
    Math.max(1, Math.round(size.widthPx))
  )
  const heightPx = Math.min(
    viewport.height,
    Math.max(1, Math.round(size.heightPx))
  )
  return {
    pointPx: {
      x: clamp(Math.round(point.x), 0, Math.max(0, viewport.width - widthPx)),
      y: clamp(Math.round(point.y), 0, Math.max(0, viewport.height - heightPx)),
    },
    size: {
      widthPx,
      heightPx,
    },
  }
}

function computeZoomTarget(
  locatorRect: ElementRect,
  viewport: { width: number; height: number },
  config: ResolvedAutoZoomConfig
): FocusChangeZoom['end'] {
  let widthPx = viewport.width * config.amount
  let heightPx = viewport.height * config.amount

  if (config.allowZoomingOut) {
    widthPx = Math.max(widthPx, locatorRect.width)
    heightPx = Math.max(heightPx, locatorRect.height)
  }

  const xBias = (widthPx - locatorRect.width) * config.centering * 0.5
  const yBias = (heightPx - locatorRect.height) * config.centering * 0.5

  return clampZoomViewport(
    {
      x: locatorRect.x + locatorRect.width / 2 - widthPx / 2 + xBias,
      y: locatorRect.y + locatorRect.height / 2 - heightPx / 2 + yBias,
    },
    { widthPx, heightPx },
    viewport
  )
}

export function buildZoomEvent(params: {
  locatorRect: ElementRect
  viewport: { width: number; height: number }
  config: ResolvedAutoZoomConfig
  startMs: number
  isFirstInteraction: boolean
  currentZoomEnd: FocusChangeZoom['end'] | undefined
}): FocusChangeZoom | undefined {
  const {
    locatorRect,
    viewport,
    config,
    startMs,
    isFirstInteraction,
    currentZoomEnd,
  } = params
  if (config.amount >= 1 && !isFirstInteraction) {
    return undefined
  }

  const end = computeZoomTarget(locatorRect, viewport, config)
  if (
    currentZoomEnd !== undefined &&
    currentZoomEnd.pointPx.x === end.pointPx.x &&
    currentZoomEnd.pointPx.y === end.pointPx.y &&
    currentZoomEnd.size.widthPx === end.size.widthPx &&
    currentZoomEnd.size.heightPx === end.size.heightPx
  ) {
    return undefined
  }

  return {
    startMs,
    endMs: startMs + config.duration,
    ...(config.duration > 0 ? { easing: config.easing } : {}),
    end,
  }
}
