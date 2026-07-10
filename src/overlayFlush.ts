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

  const byHash = new Map<
    string,
    {
      path: string
      fileHash: string
      previewPath?: string
      previewFileHash?: string
    }
  >()
  for (const { event, request } of pending) {
    const key = overlayInputHash(request)
    let resolved = byHash.get(key)
    if (resolved === undefined) {
      if (request.kind === 'image') {
        const result = await rasterizeHtmlOverlay({
          name: request.name,
          html: request.html,
          ...(request.awaitMount !== undefined && {
            awaitMount: request.awaitMount,
          }),
          deviceScaleFactor: request.deviceScaleFactor,
        })
        resolved = { path: result.path, fileHash: result.fileHash }
      } else {
        const result = await rasterizeAnimatedHtmlOverlay({
          name: request.name,
          html: request.html,
          durationMs: request.durationMs,
          fps: request.fps,
          ...(request.awaitMount !== undefined && {
            awaitMount: request.awaitMount,
          }),
          deviceScaleFactor: request.deviceScaleFactor,
        })
        resolved = {
          path: result.path,
          fileHash: result.fileHash,
          ...(result.previewPath !== undefined && {
            previewPath: result.previewPath,
          }),
          ...(result.previewFileHash !== undefined && {
            previewFileHash: result.previewFileHash,
          }),
        }
      }
      byHash.set(key, resolved)
    }
    event.path = resolved.path
    event.fileHash = resolved.fileHash
    // The alpha-capable preview clip only exists for animated overlays.
    if (
      event.kind === 'animation' &&
      resolved.previewPath !== undefined &&
      resolved.previewFileHash !== undefined
    ) {
      event.previewPath = resolved.previewPath
      event.previewFileHash = resolved.previewFileHash
    }
  }
}
