import { access } from 'fs/promises'
import { dirname, resolve } from 'path'
let activeRecorder = null
const registeredAssetPaths = new Set()
export function setActiveAssetRecorder(recorder) {
  activeRecorder = recorder
}
export function resetRegisteredAssetPaths() {
  registeredAssetPaths.clear()
}
export async function validateRegisteredAssetPaths(testFilePath) {
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
export function createAssets(assetsMap) {
  const result = {}
  for (const name in assetsMap) {
    const config = assetsMap[name]
    registeredAssetPaths.add(config.path)
    result[name] = createAssetController(name, config)
  }
  return result
}
function createAssetController(name, config) {
  const startFn = () => {
    if (activeRecorder === null) return Promise.resolve()
    activeRecorder.addAssetStart(
      name,
      config.path,
      config.audio,
      config.fullScreen
    )
    return Promise.resolve()
  }
  return {
    then(resolve, reject) {
      return startFn().then(resolve, reject)
    },
  }
}
