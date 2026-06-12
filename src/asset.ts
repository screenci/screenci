import type { IEventRecorder } from './events.js'
import { access } from 'fs/promises'
import { dirname, resolve } from 'path'
import {
  getScreenCIRuntimeContext,
  getRuntimeAssetRecorder,
  setRuntimeAssetRecorder,
} from './runtimeContext.js'

export type SvgPath = `${string}.svg`
export type PngPath = `${string}.png`
export type Mp4Path = `${string}.mp4`

/**
 * Image assets are timed overlays. The duration must be recorded up front so
 * rendering never needs to probe image files for timing.
 */
export type ImageAssetConfig<
  TPath extends SvgPath | PngPath = SvgPath | PngPath,
> = {
  path: TPath
  durationMs: number
  fullScreen: boolean
  audio?: never
}

/**
 * Video assets use their natural media duration. Audio is allowed only here so
 * the API cannot attach soundtrack controls to still-image overlays. When
 * omitted, audio defaults to full volume for `.mp4` playback.
 */
export type VideoAssetConfig<TPath extends Mp4Path = Mp4Path> = {
  path: TPath
  audio?: number
  fullScreen: boolean
  durationMs?: never
}

export type AssetConfig =
  | ImageAssetConfig<SvgPath | PngPath>
  | VideoAssetConfig<Mp4Path>

type AssetConfigForPath<TPath extends string> = string extends TPath
  ? AssetConfig
  : TPath extends SvgPath | PngPath
    ? ImageAssetConfig<TPath>
    : TPath extends Mp4Path
      ? VideoAssetConfig<TPath>
      : never

const registeredAssetPaths = new Set<string>()

export function setActiveAssetRecorder(recorder: IEventRecorder | null): void {
  setRuntimeAssetRecorder(recorder)
}

export function resetRegisteredAssetPaths(): void {
  registeredAssetPaths.clear()
}

export async function validateRegisteredAssetPaths(
  testFilePath: string
): Promise<void> {
  for (const assetPath of registeredAssetPaths) {
    await validateAssetPath(assetPath, testFilePath)
  }
}

async function validateAssetPath(
  assetPath: string,
  testFilePath: string | null
): Promise<void> {
  const candidates = [assetPath]
  if (testFilePath !== null) {
    candidates.push(resolve(dirname(testFilePath), assetPath))
  }

  for (const candidate of candidates) {
    try {
      await access(candidate)
      return
    } catch {
      // try next candidate
    }
  }

  throw new Error(`Asset file not found: ${assetPath}`)
}

/**
 * An asset controller.
 *
 * Calling it marks the asset in the recording timeline. The renderer places
 * the asset at this point in the video. Images use explicit `durationMs`
 * overlays; `.mp4` assets use the media file's natural duration.
 *
 * @example
 * ```ts
 * await assets.intro()
 * await page.goto('/dashboard')
 * await assets.logo()
 * ```
 */
export type AssetController = () => Promise<void>

/** Typed asset controllers keyed by the names passed to {@link createAssets}. */
export type Assets<T extends Record<string, AssetConfig>> = {
  [K in keyof T]: AssetController
}

/**
 * Creates a set of typed asset controllers, one per key in the map.
 *
 * Calling a controller marks the asset in the recording timeline.
 * `.svg`/`.png` assets require explicit `durationMs`; `.mp4` assets use their
 * natural duration and default `audio` to `1` when omitted.
 *
 * @example
 * ```ts
 * const assets = createAssets({
 *   logo:  { path: './logo.png',  durationMs: 1200, fullScreen: false },
 *   intro: { path: './intro.mp4', fullScreen: true },
 * })
 *
 * video('Product demo', async ({ page }) => {
 *   await assets.intro()
 *   await page.goto('/dashboard')
 *   await assets.logo()
 * })
 * ```
 */
export function createAssets<const T extends Record<string, AssetConfig>>(
  assetsMap: T & { [K in keyof T]: AssetConfigForPath<T[K]['path']> }
): Assets<T> {
  const result = {} as Assets<T>

  for (const name in assetsMap) {
    const config = assetsMap[name]! as AssetConfig
    validateAssetConfig(name, config)
    registeredAssetPaths.add(config.path)
    result[name] = createAssetController(name, config)
  }

  return result
}

function createAssetController(
  name: string,
  config: AssetConfig
): AssetController {
  return async (): Promise<void> => {
    const testFilePath = getScreenCIRuntimeContext().testFilePath
    if (testFilePath !== null) {
      await validateAssetPath(config.path, testFilePath)
    }
    const activeRecorder = getRuntimeAssetRecorder()
    activeRecorder.addAssetStart(name, toRecordedAssetStart(name, config))
    return Promise.resolve()
  }
}

function getAssetExtension(path: string): '.svg' | '.png' | '.mp4' | null {
  const dotIndex = path.lastIndexOf('.')
  if (dotIndex === -1) return null
  const extension = path.slice(dotIndex).toLowerCase()
  if (extension === '.svg' || extension === '.png' || extension === '.mp4') {
    return extension
  }
  return null
}

function validateAssetConfig(name: string, config: AssetConfig): void {
  const extension = getAssetExtension(config.path)
  if (extension === null) {
    throw new Error(
      `[screenci] Asset "${name}" must use one of: .svg, .png, .mp4. Received: ${config.path}`
    )
  }

  if (extension === '.svg' || extension === '.png') {
    if ('audio' in config && config.audio !== undefined) {
      throw new Error(
        `[screenci] Asset "${name}" (${config.path}) is an image asset and must not provide audio. Use durationMs instead.`
      )
    }
    if (
      !('durationMs' in config) ||
      config.durationMs === undefined ||
      !Number.isFinite(config.durationMs) ||
      config.durationMs < 0
    ) {
      throw new Error(
        `[screenci] Asset "${name}" (${config.path}) must provide a finite durationMs greater than or equal to 0.`
      )
    }
    return
  }

  if ('durationMs' in config && config.durationMs !== undefined) {
    throw new Error(
      `[screenci] Asset "${name}" (${config.path}) is a video asset and must not provide durationMs. Its natural media duration is used instead.`
    )
  }
  if (
    'audio' in config &&
    config.audio !== undefined &&
    (!Number.isFinite(config.audio) || config.audio < 0 || config.audio > 1)
  ) {
    throw new Error(
      `[screenci] Asset "${name}" (${config.path}) must provide a finite audio value between 0 and 1 for .mp4 assets when audio is specified. Use audio: 0 for silent playback.`
    )
  }
}

function toRecordedAssetStart(
  name: string,
  config: AssetConfig
): Parameters<IEventRecorder['addAssetStart']>[1] {
  const extension = getAssetExtension(config.path)
  if (extension === '.svg' || extension === '.png') {
    const imageConfig = config as ImageAssetConfig
    return {
      kind: 'image',
      path: imageConfig.path,
      durationMs: imageConfig.durationMs,
      fullScreen: imageConfig.fullScreen,
    }
  }
  if (extension === '.mp4') {
    const videoConfig = config as VideoAssetConfig
    return {
      kind: 'video',
      path: videoConfig.path,
      audio: videoConfig.audio ?? 1,
      fullScreen: videoConfig.fullScreen,
    }
  }
  throw new Error(
    `[screenci] Asset "${name}" has an unsupported path: ${config.path}`
  )
}
