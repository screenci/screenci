import type { IEventRecorder } from './events.js'
import { access } from 'fs/promises'
import { dirname, resolve } from 'path'

export type AssetConfig = {
  path: string
  audio: number
  fullScreen: boolean
}

let activeRecorder: IEventRecorder | null = null
const registeredAssetPaths = new Set<string>()

export function setActiveAssetRecorder(recorder: IEventRecorder | null): void {
  activeRecorder = recorder
}

export function resetRegisteredAssetPaths(): void {
  registeredAssetPaths.clear()
}

export async function validateRegisteredAssetPaths(
  testFilePath: string
): Promise<void> {
  const testDir = dirname(testFilePath)

  for (const assetPath of registeredAssetPaths) {
    const candidates = [assetPath, resolve(testDir, assetPath)]
    let exists = false

    for (const candidate of candidates) {
      try {
        await access(candidate)
        exists = true
        break
      } catch {
        // try next candidate
      }
    }

    if (!exists) {
      throw new Error(`Asset file not found: ${assetPath}`)
    }
  }
}

export interface AssetController {
  /**
   * Marks the asset in the recording timeline. Resolves immediately after
   * recording the start and end events.
   *
   * The renderer places the asset at this point in the video and plays it
   * for its natural duration — no timing config required.
   *
   * @example
   * ```ts
   * const assets = createAssets({
   *   logo:  { path: './logo.png',  audio: 0,   fullScreen: false },
   *   intro: { path: './intro.mp4', audio: 1.0, fullScreen: true },
   * })
   *
   * await assets.logo.start()
   * await page.goto('/dashboard')
   * await assets.intro.start()
   * ```
   */
  start(): Promise<void>
}

export type Assets<T extends Record<string, AssetConfig>> = {
  [K in keyof T]: AssetController
}

/**
 * Creates a set of typed asset controllers, one per key in the map.
 *
 * Each controller exposes a single `start()` method that marks the asset
 * in the recording timeline. The renderer places the asset at that point
 * and plays it for its natural duration.
 *
 * @example
 * ```ts
 * const assets = createAssets({
 *   logo:  { path: './logo.png',  audio: 0,   fullScreen: false },
 *   intro: { path: './intro.mp4', audio: 1.0, fullScreen: true },
 * })
 *
 * video('Product demo', async ({ page }) => {
 *   await assets.logo.start()
 *   await page.goto('/dashboard')
 *   await assets.intro.start()
 * })
 * ```
 */
export function createAssets<
  const T extends Record<string, AssetConfig>,
>(assetsMap: { [K in keyof T]: T[K] }): Assets<T> {
  const result = {} as Assets<T>

  for (const name in assetsMap) {
    const config = assetsMap[name]! as AssetConfig
    registeredAssetPaths.add(config.path)
    result[name] = createAssetController(name, config)
  }

  return result
}

function createAssetController(
  name: string,
  config: AssetConfig
): AssetController {
  return {
    start(): Promise<void> {
      if (activeRecorder === null) return Promise.resolve()
      activeRecorder.addAssetStart(
        name,
        config.path,
        config.audio,
        config.fullScreen
      )
      return Promise.resolve()
    },
  }
}
