import type { IEventRecorder } from './events.js'
export type AssetConfig = {
  path: string
  audio: number
  fullScreen: boolean
}
export declare function setActiveAssetRecorder(
  recorder: IEventRecorder | null
): void
export declare function resetRegisteredAssetPaths(): void
export declare function validateRegisteredAssetPaths(
  testFilePath: string
): Promise<void>
/**
 * An asset controller. Awaiting it marks the asset in the recording timeline.
 *
 * The renderer places the asset at this point in the video and plays it for
 * its natural duration — no timing config required.
 *
 * @example
 * ```ts
 * await assets.intro
 * await page.goto('/dashboard')
 * await assets.logo
 * ```
 */
export type AssetController = PromiseLike<void>
export type Assets<T extends Record<string, AssetConfig>> = {
  [K in keyof T]: AssetController
}
/**
 * Creates a set of typed asset controllers, one per key in the map.
 *
 * Awaiting a controller marks the asset in the recording timeline.
 * The renderer places the asset at that point and plays it for its natural duration.
 *
 * @example
 * ```ts
 * const assets = createAssets({
 *   logo:  { path: './logo.png',  audio: 0,   fullScreen: false },
 *   intro: { path: './intro.mp4', audio: 1.0, fullScreen: true },
 * })
 *
 * video('Product demo', async ({ page }) => {
 *   await assets.intro
 *   await page.goto('/dashboard')
 *   await assets.logo
 * })
 * ```
 */
export declare function createAssets<
  const T extends Record<string, AssetConfig>,
>(assetsMap: {
  [K in keyof T]: T[K]
}): Assets<T>
