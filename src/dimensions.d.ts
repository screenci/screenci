import type { AspectRatio, Quality } from './types.js'
/**
 * Compute pixel dimensions from an aspect ratio and quality preset.
 *
 * The `quality` value determines the shorter side in pixels:
 * - `'720p'`   → 720 px
 * - `'1080p'`  → 1080 px
 * - `'1440p'`  → 1440 px
 * - `'2160p'`  → 2160 px
 *
 * The `aspectRatio` then sets the longer dimension. For landscape ratios
 * (W > H) height equals the base; for portrait ratios (H > W) width equals
 * the base. Dimension table:
 *
 * | Aspect Ratio | 720p      | 1080p      | 1440p      | 2160p      |
 * |--------------|-----------|------------|------------|------------|
 * | 16:9         | 1280×720  | 1920×1080  | 2560×1440  | 3840×2160  |
 * | 9:16         | 720×1280  | 1080×1920  | 1440×2560  | 2160×3840  |
 * | 1:1          | 720×720   | 1080×1080  | 1440×1440  | 2160×2160  |
 * | 4:3          | 960×720   | 1440×1080  | 1920×1440  | 2880×2160  |
 * | 3:4          | 720×960   | 1080×1440  | 1440×1920  | 2160×2880  |
 * | 5:4          | 900×720   | 1350×1080  | 1800×1440  | 2700×2160  |
 * | 4:5          | 720×900   | 1080×1350  | 1440×1800  | 2160×2700  |
 */
export declare function getDimensions(
  aspectRatio: AspectRatio,
  quality: Quality
): {
  width: number
  height: number
}
export declare function getViewportCenter(dimensions: {
  width: number
  height: number
}): {
  x: number
  y: number
}
