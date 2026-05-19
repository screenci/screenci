import type { ElementRect, FocusChangeEvent } from './events.js'
import type { AutoZoomOptions } from './types.js'
import type { AutoZoomState } from './autoZoom.js'
type FocusChangeZoom = NonNullable<FocusChangeEvent['zoom']>
export type ResolvedAutoZoomOptions = Required<AutoZoomOptions>
export declare function resolveAutoZoomOptions(
  state: AutoZoomState,
  options: AutoZoomOptions
): ResolvedAutoZoomOptions
export declare function resolveZoomTarget(params: {
  locatorRect: ElementRect
  viewport: {
    width: number
    height: number
  }
  targetViewport: {
    width: number
    height: number
  }
  targetRectPositionInZoomViewport: {
    x: number
    y: number
  }
  currentZoomEnd?: FocusChangeZoom['end']
}):
  | {
      end: FocusChangeZoom['end']
      optimalOffset: {
        x: number
        y: number
      }
    }
  | undefined
export declare function resolveZoomViewportPlacement(params: {
  locatorRect: ElementRect
  viewport: {
    width: number
    height: number
  }
  targetViewport: {
    width: number
    height: number
  }
  targetRectPositionInZoomViewport: {
    x: number
    y: number
  }
}): {
  idealOrigin: {
    x: number
    y: number
  }
  actualOrigin: {
    x: number
    y: number
  }
  size: {
    widthPx: number
    heightPx: number
  }
}
export declare function buildZoomEvent(params: {
  target:
    | {
        end: FocusChangeZoom['end']
        optimalOffset: {
          x: number
          y: number
        }
      }
    | undefined
  zoomTiming:
    | Pick<
        NonNullable<FocusChangeEvent['zoom']>,
        'startMs' | 'endMs' | 'easing'
      >
    | undefined
  currentZoomEnd: FocusChangeZoom['end'] | undefined
}): FocusChangeZoom | undefined
export {}
