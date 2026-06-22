/**
 * Studio mode — configure narration and render options from the ScreenCI web
 * app instead of code. Business tier only.
 *
 * Code opts in per concern:
 * - `video.localize({ languages, narration: ['intro', 'outro'] })` declares cue
 *   keys whose text is filled in on the Studio page.
 * - `renderOptions: 'studio'` defers render options to Studio.
 *
 * On the first upload of a studio-mode video, rendering is held until the
 * video is configured in Studio; later uploads reuse the saved configuration.
 */

/**
 * Sentinel value for the `renderOptions` fixture/config option meaning
 * "render options are configured in Studio".
 *
 * A plain string literal (not an object or symbol) so it survives Playwright's
 * serialization of `use` options between the config file and test workers, and
 * cannot collide with a real {@link import('./types.js').RenderOptions} value,
 * which is always an object.
 *
 * @example
 * ```ts
 * import { defineConfig } from 'screenci'
 *
 * export default defineConfig({
 *   use: { renderOptions: 'studio' },
 * })
 * ```
 */
export type StudioRenderOptionsSentinel = 'studio'

export function isStudioRenderOptions(
  value: unknown
): value is StudioRenderOptionsSentinel {
  return value === 'studio'
}
