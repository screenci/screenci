import type { IEventRecorder } from './events.js'
import { access } from 'fs/promises'
import { dirname, resolve } from 'path'

type ImageExt = 'png' | 'jpg' | 'jpeg' | 'gif' | 'webp' | 'svg' | 'bmp'

/** Asset config for image files. `duration` is required (images have no intrinsic duration). */
export type ImageAssetConfig = {
  path: string
  audio: number
  fullScreen: boolean
  /** How long (in ms) to display the image before auto-hiding. */
  duration: number
}

/** Asset config for video/audio files. Duration is inferred from the media file. */
export type VideoAssetConfig = {
  path: string
  audio: number
  fullScreen: boolean
}

export type AssetConfig = ImageAssetConfig | VideoAssetConfig

// Enforces `duration` when path ends with a known image extension
type AssetConfigFor<P extends string> =
  Lowercase<P> extends `${string}.${ImageExt}`
    ? { path: P; audio: number; fullScreen: boolean; duration: number }
    : { path: P; audio: number; fullScreen: boolean }

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
   * Shows the asset overlay and records an assetStart event.
   *
   * For image assets, `show()` blocks for the configured `duration` ms and
   * then auto-records the assetEnd event. Calling `hide()` before the timer
   * fires cancels the auto-hide.
   *
   * Also directly awaitable: `await assets.logo` is equivalent to
   * `await assets.logo.show()`.
   *
   * @example
   * ```ts
   * await assets.logo          // show image for its configured duration
   * await page.goto('/page')
   * await assets.clip.show()   // start playing video overlay
   * await assets.clip.hide()   // stop video overlay manually
   * ```
   */
  show(): Promise<void>
  /**
   * Hides the asset overlay and records an assetEnd event.
   * For image assets, also cancels any pending auto-hide timer.
   */
  hide(): Promise<void>
  // Thenable — `await assets.logo` calls show() internally
  then<T>(
    onfulfilled?: ((value: void) => T | PromiseLike<T>) | null,
    onrejected?: ((reason: unknown) => T | PromiseLike<T>) | null
  ): PromiseLike<T>
}

export type Assets<T extends Record<string, AssetConfig>> = {
  [K in keyof T]: AssetController
}

/**
 * Creates a set of typed asset controllers, one per key in the map.
 *
 * Each controller exposes `show()` and `hide()` methods. It is also
 * directly awaitable — `await assets.logo` is shorthand for
 * `await assets.logo.show()`.
 *
 * **Image assets** require a `duration` (in ms). Calling `show()` will
 * automatically record the assetEnd after that many milliseconds. Calling
 * `hide()` before the timer fires cancels the auto-hide.
 *
 * **Video assets** do not require a `duration` — the video's natural length
 * determines how long it plays. Call `hide()` explicitly to stop it.
 *
 * @example
 * ```ts
 * const assets = createAssets({
 *   logo:  { path: './logo.png',   audio: 0,   fullScreen: false, duration: 3000 },
 *   intro: { path: './intro.mp4',  audio: 1.0, fullScreen: true  },
 * })
 *
 * await assets.logo          // shows logo for 3 s, then auto-hides
 * await page.goto('/dashboard')
 * assets.intro.show()        // start video overlay (non-blocking for caller)
 * await assets.intro.hide()  // hide video overlay manually
 * ```
 */
export function createAssets<
  const T extends Record<string, AssetConfig>,
>(assetsMap: { [K in keyof T]: AssetConfigFor<T[K]['path']> }): Assets<T> {
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
  let autoHideTimer: ReturnType<typeof setTimeout> | null = null

  const controller: AssetController = {
    show(): Promise<void> {
      if (activeRecorder === null) return Promise.resolve()
      activeRecorder.addAssetStart(
        name,
        config.path,
        config.audio,
        config.fullScreen
      )
      if ('duration' in config && typeof config.duration === 'number') {
        return new Promise<void>((resolve) => {
          autoHideTimer = setTimeout(() => {
            autoHideTimer = null
            activeRecorder?.addAssetEnd(name)
            resolve()
          }, config.duration)
        })
      }
      return Promise.resolve()
    },
    hide(): Promise<void> {
      if (autoHideTimer !== null) {
        clearTimeout(autoHideTimer)
        autoHideTimer = null
      }
      if (activeRecorder === null) return Promise.resolve()
      activeRecorder.addAssetEnd(name)
      return Promise.resolve()
    },
    then<T>(
      onfulfilled?: ((value: void) => T | PromiseLike<T>) | null,
      onrejected?: ((reason: unknown) => T | PromiseLike<T>) | null
    ): PromiseLike<T> {
      return controller.show().then(onfulfilled, onrejected)
    },
  }
  return controller
}
