import type {
  DeferredRasterizeRequest,
  IEventRecorder,
  OverlayPlacement,
} from './events.js'
import { resolveAnchoredBox } from './anchorPlacement.js'
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
type Rasterized = {
  path: string
  fileHash: string
  /** Rendered root size in CSS px. */
  width: number
  height: number
  previewPath?: string
  previewFileHash?: string
}

export async function flushPendingOverlays(
  recorder: IEventRecorder
): Promise<void> {
  const pending = recorder.getPendingOverlays()
  if (pending.length === 0) return

  const byHash = new Map<string, Rasterized>()
  // Rasterizes one document for a request (the request's own html, or the
  // flipped variant of an anchored overlay), de-duplicated by content hash.
  const rasterize = async (
    request: DeferredRasterizeRequest,
    html: string
  ): Promise<Rasterized> => {
    const key = overlayInputHash({ ...request, html })
    let resolved = byHash.get(key)
    if (resolved !== undefined) return resolved
    if (request.kind === 'image') {
      const result = await rasterizeHtmlOverlay({
        name: request.name,
        html,
        ...(request.awaitMount !== undefined && {
          awaitMount: request.awaitMount,
        }),
        deviceScaleFactor: request.deviceScaleFactor,
      })
      resolved = {
        path: result.path,
        fileHash: result.fileHash,
        width: result.width,
        height: result.height,
      }
    } else {
      const result = await rasterizeAnimatedHtmlOverlay({
        name: request.name,
        html,
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
        width: result.width,
        height: result.height,
        ...(result.previewPath !== undefined && {
          previewPath: result.previewPath,
        }),
        ...(result.previewFileHash !== undefined && {
          previewFileHash: result.previewFileHash,
        }),
      }
    }
    byHash.set(key, resolved)
    return resolved
  }

  for (const { event, request } of pending) {
    let resolved = await rasterize(request, request.html)
    if (request.anchor !== undefined) {
      const placed = await placeAnchored(request, resolved, rasterize)
      resolved = placed.resolved
      event.placement = placed.placement
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

/**
 * Computes an anchored overlay's box now that its content size is known: the
 * rendered root (content plus bleed padding) is placed on the requested side;
 * if that flips the overlay and a side-specific document exists, that document
 * is rasterized and placed on the flipped side instead. The recorded width
 * equals the captured CSS width, so the renderer never rescales the capture.
 */
async function placeAnchored(
  request: DeferredRasterizeRequest,
  first: Rasterized,
  rasterize: (
    request: DeferredRasterizeRequest,
    html: string
  ) => Promise<Rasterized>
): Promise<{ resolved: Rasterized; placement: OverlayPlacement }> {
  const anchor = request.anchor!
  const { spec } = anchor
  const contentSize = (r: Rasterized) => ({
    width: Math.max(0, r.width - 2 * spec.bleed),
    height: Math.max(0, r.height - 2 * spec.bleed),
  })
  let resolved = first
  let result = resolveAnchoredBox(spec, contentSize(first))
  if (result.flipped && anchor.htmlFlipped !== undefined) {
    resolved = await rasterize(request, anchor.htmlFlipped)
    result = resolveAnchoredBox(
      { ...spec, side: result.side, flip: false },
      contentSize(resolved)
    )
  }
  const { box } = result
  const provenance =
    anchor.origin === 'point'
      ? {}
      : {
          anchorSide: result.side,
          anchorAlign: spec.align,
          anchorGapPx: spec.gap,
        }
  return {
    resolved,
    placement: {
      relativeTo: anchor.relativeTo ?? 'recording',
      x: box.x,
      y: box.y,
      width: box.width,
      ...(box.height > 0 && { aspectRatio: box.width / box.height }),
      ...provenance,
      ...(spec.bleed > 0 && { bleedPx: spec.bleed }),
    },
  }
}
