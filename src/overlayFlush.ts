import type { IEventRecorder } from './events.js'
import {
  rasterizeHtmlOverlay,
  rasterizeAnimatedHtmlOverlay,
  overlayInputHash,
} from './htmlRasterizer.js'

/**
 * Rasterizes the rendered/animated overlays that were deferred during the test,
 * then patches their `assetStart` events with the real path and content hash.
 *
 * Rasterization (a browser screenshot, or a frame capture plus ffmpeg encode)
 * runs here, after the test body has succeeded, instead of inline during the
 * recording. Identical overlays (same resolved markup and render params, hashed
 * by {@link overlayInputHash}) are rasterized once per run: the in-memory map
 * below avoids even a disk-cache lookup and a duplicate `generated/` file, while
 * the rasterizer's own cross-run cache still serves unchanged overlays from a
 * previous run.
 *
 * A no-op when there are no deferred overlays (including the no-op recorder used
 * outside a recording).
 */
export async function flushPendingOverlays(
  recorder: IEventRecorder
): Promise<void> {
  const pending = recorder.getPendingOverlays()
  if (pending.length === 0) return

  const byHash = new Map<string, { path: string; fileHash: string }>()
  for (const { event, request } of pending) {
    const key = overlayInputHash(request)
    let resolved = byHash.get(key)
    if (resolved === undefined) {
      if (request.kind === 'image') {
        const result = await rasterizeHtmlOverlay({
          name: request.name,
          html: request.html,
          css: request.css,
          cssResolved: true,
          deviceScaleFactor: request.deviceScaleFactor,
          capturePadding: request.capturePadding,
        })
        resolved = { path: result.path, fileHash: result.fileHash }
      } else {
        const result = await rasterizeAnimatedHtmlOverlay({
          name: request.name,
          html: request.html,
          durationMs: request.durationMs,
          fps: request.fps,
          css: request.css,
          cssResolved: true,
          deviceScaleFactor: request.deviceScaleFactor,
          capturePadding: request.capturePadding,
        })
        resolved = { path: result.path, fileHash: result.fileHash }
      }
      byHash.set(key, resolved)
    }
    event.path = resolved.path
    event.fileHash = resolved.fileHash
  }
}
