import type { ScreenCIConfig, ExtendedScreenCIConfig } from './types.js'
/**
 * Defines a screenci configuration file.
 *
 * Extends Playwright's config with screenci-specific options and enforces
 * settings required for reliable video recording. Some Playwright options
 * are locked and cannot be set — `workers`, `fullyParallel`, `retries`,
 * `testDir`, and `testMatch`. Attempting to set them throws at startup.
 *
 * @example
 * Minimal — all options have sensible defaults:
 * ```ts
 * import { defineConfig } from 'screenci'
 * export default defineConfig({})
 * ```
 *
 * @example
 * Full config:
 * ```ts
 * import { defineConfig } from 'screenci'
 *
 * export default defineConfig({
 *   projectName: 'my-project',
 *   videoDir: './videos',
 *   use: {
 *     baseURL: 'https://app.example.com',
 *     recordOptions: {
 *       aspectRatio: '16:9',  // '16:9' | '9:16' | '1:1' | '4:3' | ...
 *       quality: '1080p',     // '720p' | '1080p' | '1440p' | '2160p'
 *       fps: 30,              // 24 | 30 | 60
 *     },
 *     trace: 'retain-on-failure',
 *   },
 * })
 * ```
 *
 * @param config - screenci configuration options
 * @returns Extended Playwright configuration with enforced sequential execution settings
 */
export declare function defineConfig(
  config: ScreenCIConfig
): ExtendedScreenCIConfig
