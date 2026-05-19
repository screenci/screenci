import type { ElementRect, IEventRecorder } from './events.js'
import type { AutoZoomOptions } from './types.js'
export type CurrentZoomViewport = {
  focusPoint: {
    x: number
    y: number
  }
  elementRect?: ElementRect
  end: {
    pointPx: {
      x: number
      y: number
    }
    size: {
      widthPx: number
      heightPx: number
    }
  }
  optimalOffset?: {
    x: number
    y: number
  }
  viewportSize: {
    width: number
    height: number
  }
}
export declare function setActiveAutoZoomRecorder(
  recorder: IEventRecorder | null
): void
export declare function getCurrentZoomViewport(): CurrentZoomViewport | null
export type AutoZoomState = {
  insideAutoZoom: boolean
  options: AutoZoomOptions
  currentZoomViewport: CurrentZoomViewport | null
}
export declare function getAutoZoomState(): AutoZoomState
export declare function setAutoZoomState(state: AutoZoomState): void
export declare function setCurrentZoomViewport(
  viewport: CurrentZoomViewport | null
): void
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
export declare function autoZoom(
  fn: () => Promise<void> | void,
  options?: AutoZoomOptions
): Promise<void>
