/**
 * Studio mode — configure narration and render options from the ScreenCI web
 * app instead of code. Business tier only.
 *
 * Code opts in per concern:
 * - `createStudioNarration('intro', 'outro')` declares cue keys whose text and
 *   voice are filled in on the Studio page.
 * - `renderOptions: STUDIO_RENDER_OPTIONS` defers render options to Studio.
 *
 * On the first upload of a studio-mode video, rendering is held until the
 * video is configured in Studio; later uploads reuse the saved configuration.
 */

/**
 * Sentinel value for the `renderOptions` fixture/config option meaning
 * "render options are configured in Studio".
 *
 * Implemented as a frozen, JSON-safe branded object (not a string or symbol)
 * so it survives Playwright's serialization of `use` options between the
 * config file and test workers, and cannot collide with a real
 * {@link import('./types.js').RenderOptions} value.
 *
 * @example
 * ```ts
 * import { defineConfig, STUDIO_RENDER_OPTIONS } from 'screenci'
 *
 * export default defineConfig({
 *   use: { renderOptions: STUDIO_RENDER_OPTIONS },
 * })
 * ```
 */
export const STUDIO_RENDER_OPTIONS = Object.freeze({
  __screenciStudioRenderOptions: true,
} as const)

export type StudioRenderOptionsSentinel = typeof STUDIO_RENDER_OPTIONS

export function isStudioRenderOptions(
  value: unknown
): value is StudioRenderOptionsSentinel {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>).__screenciStudioRenderOptions === true
  )
}
